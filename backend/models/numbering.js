/**
 * Numérotation continue et sans trou pour les documents financiers DESKYWORK :
 * - receipt      -> REC-AAAA-NNNNNN (6 chiffres, généré UNIQUEMENT à l'encaissement, jamais au téléchargement PDF)
 * - invoice      -> FAC-YYYY-XXXX (généré UNIQUEMENT à l'émission de la facture)
 * - quote        -> DEV-YYYY-XXXX
 * - credit_note  -> AV-YYYY-XXXX (généré à la création d'un avoir / remboursement)
 *
 * Prend en charge la RPC Atomique PostgreSQL `next_document_number` ainsi qu'un repli transactionnel
 * basé sur `tenants.settings.document_counters` si la migration SQL n'a pas encore été exécutée.
 */

const DOC_TYPES = {
  receipt: { defaultPrefix: 'REC', settingKey: 'receipt_prefix', counterKey: 'receipt_next' },
  invoice: { defaultPrefix: 'FAC', settingKey: 'invoice_prefix', counterKey: 'invoice_next' },
  quote: { defaultPrefix: 'DEV', settingKey: 'quote_prefix', counterKey: 'quote_next' },
  credit_note: { defaultPrefix: 'AV', settingKey: 'credit_note_prefix', counterKey: 'credit_note_next' },
};

function getTunisFiscalYear(date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Tunis',
      year: 'numeric',
    }).formatToParts(date);
    const y = parts.find((p) => p.type === 'year')?.value;
    const parsed = parseInt(y, 10);
    return Number.isFinite(parsed) ? parsed : new Date().getFullYear();
  } catch {
    return new Date().getFullYear();
  }
}

function formatDocumentNumber(prefix, fiscalYear, seq, docType = null) {
  const safePrefix = String(prefix || 'DOC').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '') || 'DOC';
  const safeSeq = Math.max(1, parseInt(seq, 10) || 1);
  const padWidth = (docType === 'receipt' || safePrefix === 'REC') ? 6 : 4;
  return `${safePrefix}-${fiscalYear}-${String(safeSeq).padStart(padWidth, '0')}`;
}

async function getTenantNumberingConfig(supabaseAdmin, tenantId) {
  const { data } = await supabaseAdmin
    .from('tenants')
    .select('settings')
    .eq('id', tenantId)
    .maybeSingle();

  const settings = data?.settings && typeof data.settings === 'object' ? data.settings : {};
  const numbering = settings.numbering && typeof settings.numbering === 'object' ? settings.numbering : {};
  return { settings, numbering };
}

/**
 * Réserve le prochain numéro continu sans trou pour `docType`.
 * Ne jamais appeler lors d'un téléchargement PDF ou d'une prévisualisation.
 */
async function allocateDocumentNumber(supabaseAdmin, tenantId, docType, options = {}) {
  const meta = DOC_TYPES[docType];
  if (!meta) {
    throw new Error(`Type de document inconnu : ${docType}`);
  }

  const fiscalYear = options.fiscalYear || getTunisFiscalYear();
  const { settings, numbering } = await getTenantNumberingConfig(supabaseAdmin, tenantId);
  const configuredPrefix = String(
    options.prefix || numbering[meta.settingKey] || settings[meta.settingKey] || meta.defaultPrefix
  ).trim().toUpperCase();

  // 1. Tenter la RPC PostgreSQL atomique (LOT 4)
  try {
    const { data: rpcNum, error: rpcErr } = await supabaseAdmin.rpc('next_document_number', {
      p_etablissement_id: tenantId,
      p_doc_type: docType,
      p_prefix: configuredPrefix,
      p_fiscal_year: fiscalYear,
    });
    if (!rpcErr && typeof rpcNum === 'string' && rpcNum.trim()) {
      const trimmed = rpcNum.trim();
      if (docType === 'receipt') {
        const m = trimmed.match(/^([A-Z0-9_-]+-\d{4}-)(\d+)$/);
        if (m && m[2].length < 6) {
          return `${m[1]}${m[2].padStart(6, '0')}`;
        }
      }
      return trimmed;
    }
  } catch {
    // Repli vers document_counters puis tenants.settings
  }

  // 2. Repli sur la table document_counters directement si disponible
  try {
    const { data: existingCounter, error: selErr } = await supabaseAdmin
      .from('document_counters')
      .select('id, last_number, prefix')
      .eq('tenant_id', tenantId)
      .eq('doc_type', docType)
      .eq('fiscal_year', fiscalYear)
      .maybeSingle();

    if (!selErr) {
      if (existingCounter) {
        const nextVal = (parseInt(existingCounter.last_number, 10) || 0) + 1;
        await supabaseAdmin
          .from('document_counters')
          .update({
            last_number: nextVal,
            prefix: configuredPrefix || existingCounter.prefix,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingCounter.id);
        return formatDocumentNumber(configuredPrefix || existingCounter.prefix, fiscalYear, nextVal, docType);
      }
      const floorStart = Math.max(1, parseInt(numbering[`${meta.counterKey}_${fiscalYear}`] || numbering[meta.counterKey] || 1, 10) || 1);
      const { error: insErr } = await supabaseAdmin
        .from('document_counters')
        .insert({
          tenant_id: tenantId,
          doc_type: docType,
          fiscal_year: fiscalYear,
          prefix: configuredPrefix,
          last_number: floorStart,
        });
      if (!insErr) {
        return formatDocumentNumber(configuredPrefix, fiscalYear, floorStart, docType);
      }
    }
  } catch {
    // Repli final sur tenants.settings
  }

  // 3. Repli ultime sur tenants.settings.document_counters + scan du dernier numéro connu
  const storedCounters = settings.document_counters && typeof settings.document_counters === 'object'
    ? { ...settings.document_counters }
    : {};
  const counterSlotKey = `${docType}:${fiscalYear}`;
  let currentMax = parseInt(storedCounters[counterSlotKey], 10) || 0;

  if (currentMax === 0) {
    const startFloor = parseInt(numbering[meta.counterKey], 10) || 1;
    currentMax = Math.max(0, startFloor - 1);
    if (docType === 'receipt') {
      const { data: rows } = await supabaseAdmin
        .from('paiements')
        .select('numero_recu')
        .eq('tenant_id', tenantId)
        .not('numero_recu', 'is', null)
        .order('created_at', { ascending: false })
        .limit(50);
      for (const r of rows || []) {
        const m = String(r.numero_recu || '').match(new RegExp(`-${fiscalYear}-(\\d+)$`));
        if (m) currentMax = Math.max(currentMax, parseInt(m[1], 10));
      }
    } else {
      const typeMap = { invoice: 'facture', quote: 'devis', credit_note: 'avoir' };
      const { data: docs } = await supabaseAdmin
        .from('devis_factures')
        .select('numero')
        .eq('tenant_id', tenantId)
        .eq('type', typeMap[docType])
        .order('created_at', { ascending: false })
        .limit(50);
      for (const d of docs || []) {
        const m = String(d.numero || '').match(new RegExp(`-${fiscalYear}-(\\d+)$`));
        if (m) currentMax = Math.max(currentMax, parseInt(m[1], 10));
      }
    }
  }

  const nextSeq = currentMax + 1;
  storedCounters[counterSlotKey] = nextSeq;
  await supabaseAdmin
    .from('tenants')
    .update({
      settings: {
        ...settings,
        document_counters: storedCounters,
      },
    })
    .eq('id', tenantId);

  return formatDocumentNumber(configuredPrefix, fiscalYear, nextSeq, docType);
}

/**
 * Permet au Responsable d'ajuster manuellement les préfixes ou le prochain numéro minimum.
 */
async function updateNumberingSettings(supabaseAdmin, tenantId, patch = {}) {
  const { settings, numbering } = await getTenantNumberingConfig(supabaseAdmin, tenantId);
  const fiscalYear = getTunisFiscalYear();
  const nextNumbering = {
    receipt_prefix: String(patch.receipt_prefix || numbering.receipt_prefix || 'REC').trim().toUpperCase(),
    invoice_prefix: String(patch.invoice_prefix || numbering.invoice_prefix || 'FAC').trim().toUpperCase(),
    quote_prefix: String(patch.quote_prefix || numbering.quote_prefix || 'DEV').trim().toUpperCase(),
    credit_note_prefix: String(patch.credit_note_prefix || numbering.credit_note_prefix || 'AV').trim().toUpperCase(),
    receipt_next: Math.max(1, parseInt(patch.receipt_next ?? numbering.receipt_next ?? 1, 10) || 1),
    invoice_next: Math.max(1, parseInt(patch.invoice_next ?? numbering.invoice_next ?? 1, 10) || 1),
    quote_next: Math.max(1, parseInt(patch.quote_next ?? numbering.quote_next ?? 1, 10) || 1),
    credit_note_next: Math.max(1, parseInt(patch.credit_note_next ?? numbering.credit_note_next ?? 1, 10) || 1),
  };

  const nextCounters = { ...(settings.document_counters || {}) };
  for (const [docType, meta] of Object.entries(DOC_TYPES)) {
    const requestedMin = Math.max(0, (nextNumbering[meta.counterKey] || 1) - 1);
    const slotKey = `${docType}:${fiscalYear}`;
    if (!nextCounters[slotKey] || requestedMin > nextCounters[slotKey]) {
      nextCounters[slotKey] = requestedMin;
    }
    try {
      const { data: existing } = await supabaseAdmin
        .from('document_counters')
        .select('id, last_number')
        .eq('tenant_id', tenantId)
        .eq('doc_type', docType)
        .eq('fiscal_year', fiscalYear)
        .maybeSingle();
      if (existing) {
        await supabaseAdmin
          .from('document_counters')
          .update({
            prefix: nextNumbering[meta.settingKey],
            last_number: Math.max(existing.last_number || 0, requestedMin),
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);
      } else {
        await supabaseAdmin
          .from('document_counters')
          .insert({
            tenant_id: tenantId,
            doc_type: docType,
            fiscal_year: fiscalYear,
            prefix: nextNumbering[meta.settingKey],
            last_number: requestedMin,
          });
      }
    } catch {
      // ignore if table not yet migrated
    }
  }

  await supabaseAdmin
    .from('tenants')
    .update({
      settings: {
        ...settings,
        numbering: nextNumbering,
        document_counters: nextCounters,
      },
    })
    .eq('id', tenantId);

  return nextNumbering;
}

module.exports = {
  DOC_TYPES,
  getTunisFiscalYear,
  formatDocumentNumber,
  getTenantNumberingConfig,
  allocateDocumentNumber,
  updateNumberingSettings,
};
