// models/dynamicQr.js — Accès QR dynamique 5 min + code court alphanumérique (RM-36)
const crypto = require('crypto');
const { getUnpaidBlockingConfig, computeAgingBucket } = require('./financeHelpers');

const QR_TTL_SECONDS = 300; // 5 minutes
const SHORT_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// Cache mémoire résilient pour déploiements sans colonne/table ou membres sans tenant_id
const memoryQrStore = new Map();

function getQrSecret() {
  return (
    process.env.QR_HMAC_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    'deskywork-qr-v2-secret-key'
  );
}

function hashToken(raw) {
  return crypto.createHash('sha256').update(String(raw || '')).digest('hex');
}

function generateShortCodeRaw() {
  const bytes = crypto.randomBytes(6);
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += SHORT_CODE_ALPHABET[bytes[i] % SHORT_CODE_ALPHABET.length];
  }
  return out;
}

function formatShortCode(raw) {
  const clean = normalizeShortCode(raw);
  if (clean.length !== 6) return clean;
  return `${clean.slice(0, 3)}-${clean.slice(3, 6)}`;
}

function normalizeShortCode(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function signPayload(payloadObj) {
  const encoded = Buffer.from(JSON.stringify(payloadObj), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getQrSecret())
    .update(encoded)
    .digest('base64url');
  return `DWQR2.${encoded}.${sig}`;
}

function verifySignedToken(token) {
  if (typeof token !== 'string' || !token.startsWith('DWQR2.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [, encoded, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', getQrSecret())
    .update(encoded)
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { validSignature: false };
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    return { validSignature: true, payload: parsed };
  } catch {
    return { validSignature: false };
  }
}

async function checkMemberQrBlockStatus(supabaseAdmin, { userId, profile = null, tenantId = null, now = new Date() }) {
  if (!userId) return { blocked: false };

  let prof = profile;
  if (!prof) {
    const { data } = await supabaseAdmin
      .from('profiles')
      .select('id, nom, prenom, email, telephone, tenant_id, statut_compte')
      .eq('id', userId)
      .maybeSingle();
    prof = data || null;
  }

  if (prof?.statut_compte === 'suspendu') {
    return {
      blocked: true,
      reason: 'Accès bloqué : votre compte est actuellement suspendu par l’établissement.',
      overdue_days: 0,
      overdue_amount: 0,
      threshold_days: null,
    };
  }

  const effectiveTenantId = tenantId || prof?.tenant_id || null;
  let tenantSettings = {};
  if (effectiveTenantId) {
    try {
      const { data: tRow } = await supabaseAdmin
        .from('tenants')
        .select('settings')
        .eq('id', effectiveTenantId)
        .maybeSingle();
      tenantSettings = tRow?.settings && typeof tRow.settings === 'object' ? tRow.settings : {};
    } catch (_) {}
  }

  const cfg = getUnpaidBlockingConfig(tenantSettings);
  const thresholdDays = cfg.overdue_block_days || 7;

  try {
    const { data: pendingRows } = await supabaseAdmin
      .from('paiements')
      .select('*, reservations(date_fin)')
      .eq('user_id', userId)
      .in('statut', ['pending', 'partial']);

    let maxOverdueDays = 0;
    let totalOverdueAmount = 0;

    for (const p of pendingRows || []) {
      const total = Number(p.montant ?? p.montant_ttc ?? 0);
      const paid = Number(p.montant_encaisse || 0);
      const remaining = Math.max(0, total - paid);
      if (remaining <= 0.001) continue;

      const refDate = p.due_date || p.reservations?.date_fin || p.created_at;
      const aging = computeAgingBucket(refDate, now);
      if (aging.daysOverdue >= thresholdDays) {
        maxOverdueDays = Math.max(maxOverdueDays, aging.daysOverdue);
        totalOverdueAmount += remaining;
      }
    }

    if (maxOverdueDays >= thresholdDays && totalOverdueAmount > 0.001) {
      return {
        blocked: true,
        reason: `Accès temporairement bloqué : impayé en retard de ${maxOverdueDays} jour${maxOverdueDays > 1 ? 's' : ''} (seuil de ${thresholdDays} jours dépassé). Régularisez votre solde à l’accueil.`,
        overdue_days: maxOverdueDays,
        overdue_amount: Math.round(totalOverdueAmount * 1000) / 1000,
        threshold_days: thresholdDays,
      };
    }
  } catch (_) {}

  return { blocked: false, threshold_days: thresholdDays };
}

function purgeExpiredEntries(list, nowMs) {
  return (Array.isArray(list) ? list : []).filter(
    (entry) => entry && entry.expires_at && new Date(entry.expires_at).getTime() > nowMs - 15 * 60 * 1000
  );
}

async function persistQrEntryFallback(supabaseAdmin, tenantId, entry) {
  memoryQrStore.set(entry.short_code, entry);
  memoryQrStore.set(entry.token_hash, entry);

  if (!tenantId) return;
  try {
    const { data: tRow } = await supabaseAdmin
      .from('tenants')
      .select('settings')
      .eq('id', tenantId)
      .maybeSingle();
    const cur = tRow?.settings && typeof tRow.settings === 'object' ? tRow.settings : {};
    const existing = purgeExpiredEntries(cur.member_qr_tokens, Date.now()).filter(
      (it) => it.user_id !== entry.user_id || new Date(it.expires_at).getTime() > Date.now()
    );
    const nextList = [entry, ...existing].slice(0, 60);
    await supabaseAdmin
      .from('tenants')
      .update({ settings: { ...cur, member_qr_tokens: nextList } })
      .eq('id', tenantId);
  } catch (_) {}
}

async function issueDynamicMemberQr(supabaseAdmin, { userId, profile = null, tenantId = null, now = new Date() }) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowIso = nowDate.toISOString();
  const effectiveTenantId = tenantId || profile?.tenant_id || null;

  const blockStatus = await checkMemberQrBlockStatus(supabaseAdmin, {
    userId,
    profile,
    tenantId: effectiveTenantId,
    now: nowDate,
  });

  const memberInfo = {
    id: userId,
    nom: profile?.nom || '',
    prenom: profile?.prenom || '',
    statut_compte: profile?.statut_compte || 'actif',
  };

  if (blockStatus.blocked) {
    return {
      status: 'blocked',
      reason: blockStatus.reason,
      overdue_days: blockStatus.overdue_days || 0,
      overdue_amount: blockStatus.overdue_amount || 0,
      threshold_days: blockStatus.threshold_days || 7,
      qr_token: null,
      payload: null,
      short_code: null,
      short_code_raw: null,
      issued_at: nowIso,
      expires_at: null,
      ttl_seconds: QR_TTL_SECONDS,
      server_now: nowIso,
      member: memberInfo,
    };
  }

  const shortCodeRaw = generateShortCodeRaw();
  const shortCodeFormatted = formatShortCode(shortCodeRaw);
  const jti = crypto.randomUUID();
  const iatSec = Math.floor(nowDate.getTime() / 1000);
  const expSec = iatSec + QR_TTL_SECONDS;
  const expiresAtIso = new Date(expSec * 1000).toISOString();

  const signedToken = signPayload({
    v: 2,
    uid: userId,
    tid: effectiveTenantId,
    jti,
    code: shortCodeRaw,
    iat: iatSec,
    exp: expSec,
  });

  const tokenHash = hashToken(signedToken);
  const entry = {
    id: jti,
    tenant_id: effectiveTenantId,
    user_id: userId,
    token_hash: tokenHash,
    short_code: shortCodeRaw,
    expires_at: expiresAtIso,
    created_at: nowIso,
  };

  try {
    const { error } = await supabaseAdmin.from('member_qr_tokens').insert({
      id: jti,
      tenant_id: effectiveTenantId,
      user_id: userId,
      token_hash: tokenHash,
      short_code: shortCodeRaw,
      expires_at: expiresAtIso,
    });
    if (error) {
      await persistQrEntryFallback(supabaseAdmin, effectiveTenantId, entry);
    } else {
      memoryQrStore.set(shortCodeRaw, entry);
      memoryQrStore.set(tokenHash, entry);
    }
  } catch {
    await persistQrEntryFallback(supabaseAdmin, effectiveTenantId, entry);
  }

  return {
    status: 'active',
    qr_token: signedToken,
    payload: JSON.stringify({ v: 2, token: signedToken, code: shortCodeFormatted }),
    short_code: shortCodeFormatted,
    short_code_raw: shortCodeRaw,
    issued_at: nowIso,
    expires_at: expiresAtIso,
    ttl_seconds: QR_TTL_SECONDS,
    server_now: nowIso,
    member: memberInfo,
  };
}

async function lookupShortCodeEntry(supabaseAdmin, shortCodeRaw, tenantId = null) {
  try {
    let q = supabaseAdmin
      .from('member_qr_tokens')
      .select('*')
      .eq('short_code', shortCodeRaw)
      .order('created_at', { ascending: false })
      .limit(1);
    if (tenantId) q = q.or(`tenant_id.eq.${tenantId},tenant_id.is.null`);
    const { data, error } = await q.maybeSingle();
    if (!error && data) return data;
  } catch (_) {}

  if (memoryQrStore.has(shortCodeRaw)) {
    return memoryQrStore.get(shortCodeRaw);
  }

  if (tenantId) {
    try {
      const { data: tRow } = await supabaseAdmin
        .from('tenants')
        .select('settings')
        .eq('id', tenantId)
        .maybeSingle();
      const list = Array.isArray(tRow?.settings?.member_qr_tokens) ? tRow.settings.member_qr_tokens : [];
      const found = list.find((it) => it.short_code === shortCodeRaw);
      if (found) return found;
    } catch (_) {}
  }

  return null;
}

async function verifyDynamicQrOrShortCode(supabaseAdmin, rawInput, { tenantId = null, now = new Date() } = {}) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowMs = nowDate.getTime();
  let candidate = String(rawInput || '').trim();
  let codeFallback = null;

  if (!candidate) {
    return { valid: false, status: 'invalid', error: 'Code QR ou code de secours requis.' };
  }

  if (candidate.startsWith('{')) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed.token) candidate = String(parsed.token).trim();
      else if (parsed.qr_token) candidate = String(parsed.qr_token).trim();
      if (parsed.code) codeFallback = normalizeShortCode(parsed.code);
    } catch {
      // Chaîne brute
    }
  }

  let userId = null;
  let method = 'qr_dynamic';
  let matchedTokenId = null;

  if (candidate.startsWith('DWQR2.')) {
    const verified = verifySignedToken(candidate);
    if (!verified || !verified.validSignature || !verified.payload?.uid) {
      return { valid: false, status: 'invalid', error: 'Signature du code QR invalide.' };
    }
    const expMs = Number(verified.payload.exp || 0) * 1000;
    if (nowMs > expMs) {
      return {
        valid: false,
        status: 'expired',
        error: "Ce QR code a expiré (validité 5 minutes dépassée). Demandez au membre d'actualiser son écran « Mon accès ».",
      };
    }
    userId = verified.payload.uid;
    matchedTokenId = verified.payload.jti || null;
  } else {
    const cleanShort = normalizeShortCode(candidate);
    const isShortFormat = cleanShort.length === 6 && !candidate.includes('-'.repeat(2)) && /^[A-Z0-9]{6}$/.test(cleanShort);

    if (isShortFormat) {
      method = 'short_code';
      const entry = await lookupShortCodeEntry(supabaseAdmin, cleanShort, tenantId);
      if (!entry) {
        return { valid: false, status: 'invalid', error: 'Code de secours introuvable ou invalide.' };
      }
      if (new Date(entry.expires_at).getTime() < nowMs) {
        return {
          valid: false,
          status: 'expired',
          error: "Ce code de secours a expiré (validité 5 minutes dépassée). Demandez au membre d'en générer un nouveau.",
        };
      }
      userId = entry.user_id;
      matchedTokenId = entry.id || null;
    } else {
      // Compatibilité transitoire éventuelle ou UUID legacy
      const { data: legacyProf } = await supabaseAdmin
        .from('profiles')
        .select('id, nom, prenom, email, telephone, tenant_id, statut_compte')
        .eq('qr_token', candidate)
        .maybeSingle();

      if (!legacyProf && codeFallback) {
        const entry = await lookupShortCodeEntry(supabaseAdmin, codeFallback, tenantId);
        if (entry && new Date(entry.expires_at).getTime() >= nowMs) {
          method = 'short_code';
          userId = entry.user_id;
          matchedTokenId = entry.id || null;
        }
      } else if (legacyProf) {
        method = 'legacy_qr';
        userId = legacyProf.id;
      }
    }
  }

  if (!userId) {
    return { valid: false, status: 'invalid', error: 'QR code ou code de secours invalide.' };
  }

  const { data: memberProfile, error: profErr } = await supabaseAdmin
    .from('profiles')
    .select('id, nom, prenom, email, telephone, tenant_id, statut_compte')
    .eq('id', userId)
    .maybeSingle();

  if (profErr || !memberProfile) {
    return { valid: false, status: 'invalid', error: 'Membre introuvable pour ce code.' };
  }

  const blockStatus = await checkMemberQrBlockStatus(supabaseAdmin, {
    userId: memberProfile.id,
    profile: memberProfile,
    tenantId: tenantId || memberProfile.tenant_id,
    now: nowDate,
  });

  if (blockStatus.blocked) {
    return {
      valid: false,
      status: 'blocked',
      error: blockStatus.reason,
      overdue_days: blockStatus.overdue_days,
      overdue_amount: blockStatus.overdue_amount,
      member: {
        id: memberProfile.id,
        nom: memberProfile.nom,
        prenom: memberProfile.prenom,
        email: memberProfile.email,
        statut_compte: memberProfile.statut_compte,
      },
    };
  }

  if (matchedTokenId) {
    await supabaseAdmin
      .from('member_qr_tokens')
      .update({ used_at: nowDate.toISOString() })
      .eq('id', matchedTokenId)
      .then(() => {})
      .catch(() => {});
  }

  return {
    valid: true,
    status: 'active',
    method,
    member: {
      id: memberProfile.id,
      nom: memberProfile.nom,
      prenom: memberProfile.prenom,
      email: memberProfile.email,
      statut_compte: memberProfile.statut_compte,
    },
  };
}

module.exports = {
  QR_TTL_SECONDS,
  formatShortCode,
  normalizeShortCode,
  signPayload,
  verifySignedToken,
  checkMemberQrBlockStatus,
  issueDynamicMemberQr,
  verifyDynamicQrOrShortCode,
};
