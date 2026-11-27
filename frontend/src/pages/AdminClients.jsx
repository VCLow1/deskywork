import React, { useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import PortalLayout from '../components/layout/PortalLayout';
import { useSessionUser } from '../hooks/useSessionUser';
import { tenantAdminApi, memberApi, guestApi, documentsApi } from '../services/api';
import { formatDT, formatDateDMY } from '../utils/format';
import { normalizeTunisianPhone, validateTunisianPhone } from '../utils/tunisianPhone';
import TunisianPhoneInput from '../components/common/TunisianPhoneInput';
import Money from '../components/common/Money';

export default function AdminClients({ session }) {
  const { userId, email, metadata } = useSessionUser(session);
  const profile = useMemo(
    () => (userId ? { id: userId, email, role: metadata.role || 'admin', prenom: metadata.prenom || '', nom: metadata.nom || '', ...metadata } : null),
    [userId, email, metadata]
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState('personnes');
  const [personneFilter, setPersonneFilter] = useState('all'); // 'all' | 'membre' | 'invite' | 'prospect'
  const [includeArchived, setIncludeArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [search, setSearch] = useState(() => searchParams.get('search') || '');

  const [members, setMembers] = useState([]);
  const [guests, setGuests] = useState([]);
  const [personnes, setPersonnes] = useState([]);
  const [entreprises, setEntreprises] = useState([]);
  const [docContents, setDocContents] = useState([]);
  const [docSignatures, setDocSignatures] = useState([]);

  // Modales
  const [showCreate, setShowCreate] = useState(() => searchParams.get('new') === '1');
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({
    nom: '',
    prenom: '',
    email: '',
    telephone: '',
    type_membre: 'particulier',
    type_personne: 'membre',
  });
  const [createdTempPwd, setCreatedTempPwd] = useState('');

  const [editMember, setEditMember] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const [historyData, setHistoryData] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [qrMember, setQrMember] = useState(null);

  // Documents editor
  const [docType, setDocType] = useState('reglement_interieur');
  const [docTitre, setDocTitre] = useState('Règlement Intérieur');
  const [docBody, setDocBody] = useState('');
  const [savingDoc, setSavingDoc] = useState(false);
  const [sigMemberId, setSigMemberId] = useState('');
  const [sigType, setSigType] = useState('contrat_domiciliation');
  const [sendingSig, setSendingSig] = useState(false);

  useEffect(() => {
    const q = searchParams.get('search');
    if (q !== null) setSearch(q);
    if (searchParams.get('new') === '1') setShowCreate(true);
  }, [searchParams]);

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await tenantAdminApi.getClientsOverview(
        includeArchived ? { include_archived: 'true' } : {}
      );
      setMembers(data.members || []);
      setGuests(data.guests || []);
      setPersonnes(data.personnes || []);
      setEntreprises(data.entreprises || []);
      const contents = data.documents?.contenus || [];
      setDocContents(contents);
      setDocSignatures(data.documents?.signatures || []);
      const found = contents.find((c) => (c.type_doc || c.type) === docType && c.actif !== false)
        || contents.find((c) => (c.type_doc || c.type) === docType);
      if (found) {
        setDocTitre(found.titre || docTitre);
        setDocBody(found.contenu || '');
      }
    } catch (e) {
      setError(e.message || 'Erreur lors du chargement des clients.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [includeArchived]);

  useEffect(() => {
    const found = docContents.find((c) => (c.type_doc || c.type) === docType && c.actif !== false)
      || docContents.find((c) => (c.type_doc || c.type) === docType);
    if (found) {
      setDocTitre(found.titre || (docType === 'reglement_interieur' ? 'Règlement Intérieur' : 'Contrat de Service / Charte'));
      setDocBody(found.contenu || '');
    } else {
      setDocTitre(docType === 'reglement_interieur' ? 'Règlement Intérieur' : 'Contrat de Service / Charte');
      setDocBody('');
    }
  }, [docType, docContents]);

  const filteredMembers = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return members;
    return members.filter((m) =>
      `${m.prenom || ''} ${m.nom || ''} ${m.email || ''} ${m.telephone || ''}`.toLowerCase().includes(s)
    );
  }, [members, search]);

  const filteredGuests = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return guests;
    return guests.filter((g) =>
      `${g.prenom || ''} ${g.nom || ''} ${g.email || ''} ${g.telephone || ''}`.toLowerCase().includes(s)
    );
  }, [guests, search]);

  const filteredEntreprises = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return entreprises;
    return entreprises.filter((e) =>
      `${e.raison_sociale || ''} ${e.contact_nom || ''} ${e.email || ''} ${e.matricule_fiscale || ''}`.toLowerCase().includes(s)
    );
  }, [entreprises, search]);

  const filteredPersonnes = useMemo(() => {
    const s = search.trim().toLowerCase();
    return personnes.filter((p) => {
      if (!includeArchived && p.archived_at) return false;
      if (personneFilter !== 'all' && p.type_personne !== personneFilter) return false;
      if (!s) return true;
      return `${p.prenom || ''} ${p.nom || ''} ${p.email || ''} ${p.telephone || ''}`.toLowerCase().includes(s);
    });
  }, [personnes, personneFilter, search, includeArchived]);

  const handleArchivePersonne = async (p) => {
    if (!window.confirm(`Archiver la fiche "${p.prenom || ''} ${p.nom || ''}" ? Elle sera conservée dans l'historique.`)) return;
    setError('');
    try {
      await tenantAdminApi.archivePersonne(p.id);
      setMsg('Fiche archivée.');
      await loadData();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRestorePersonne = async (p) => {
    setError('');
    try {
      await tenantAdminApi.restorePersonne(p.id);
      setMsg('Fiche restaurée.');
      await loadData();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCreateMember = async (e) => {
    e.preventDefault();
    setError('');
    setCreatedTempPwd('');
    if (createForm.telephone && createForm.telephone.trim()) {
      const phoneCheck = validateTunisianPhone(createForm.telephone);
      if (!phoneCheck.valid) {
        setError(phoneCheck.error);
        return;
      }
    }
    setCreating(true);
    try {
      const payload = {
        ...createForm,
        telephone: createForm.telephone?.trim() ? normalizeTunisianPhone(createForm.telephone) : '',
      };
      if (createForm.type_personne === 'prospect' || createForm.type_personne === 'invite') {
        await tenantAdminApi.createPersonne(payload);
        setMsg(`${createForm.type_personne === 'prospect' ? 'Prospect' : 'Invité'} ajouté avec succès.`);
        setShowCreate(false);
      } else {
        const res = await tenantAdminApi.createMember(payload);
        if (res.temporary_password) setCreatedTempPwd(res.temporary_password);
        setMsg(res.message || 'Membre créé avec succès.');
      }
      setCreateForm({ nom: '', prenom: '', email: '', telephone: '', type_membre: 'particulier', type_personne: 'membre' });
      if (searchParams.get('new')) setSearchParams({});
      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!editMember) return;
    setError('');
    if (editMember.telephone && String(editMember.telephone).trim()) {
      const phoneCheck = validateTunisianPhone(editMember.telephone);
      if (!phoneCheck.valid) {
        setError(phoneCheck.error);
        return;
      }
    }
    setSavingEdit(true);
    try {
      await memberApi.updateById(editMember.id, {
        nom: editMember.nom,
        prenom: editMember.prenom,
        telephone: editMember.telephone?.trim() ? normalizeTunisianPhone(editMember.telephone) : '',
        type_membre: editMember.type_membre,
        statut_compte: editMember.statut_compte,
      });
      setMsg('Fiche membre mise à jour.');
      setEditMember(null);
      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleToggleSuspend = async (m) => {
    const next = m.statut_compte === 'suspendu' ? 'actif' : 'suspendu';
    if (!window.confirm(`${next === 'suspendu' ? 'Suspendre' : 'Réactiver'} le compte de ${m.prenom || ''} ${m.nom} ?`)) return;
    try {
      await memberApi.updateById(m.id, { statut_compte: next });
      setMsg(`Compte ${next === 'suspendu' ? 'suspendu' : 'réactivé'}.`);
      await loadData();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleOpenHistory = async (m) => {
    setHistoryLoading(true);
    setHistoryData({ member: m, reservations: [], paiements: [], credits: [], documents: [] });
    try {
      const res = await tenantAdminApi.getMemberHistory(m.id);
      setHistoryData(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleConvertGuest = async (g) => {
    if (!window.confirm(`Convertir l'invité ${g.prenom || ''} ${g.nom || g.email} en membre ?`)) return;
    try {
      const res = await guestApi.convert(g.id, {});
      setMsg(res.message || 'Invité converti en membre avec succès.');
      await loadData();
      setTab('membres');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSaveDoc = async () => {
    setSavingDoc(true);
    setError('');
    try {
      await documentsApi.setContent({ type_doc: docType, contenu: docBody });
      setMsg('Document mis à jour avec succès.');
      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingDoc(false);
    }
  };

  const handleSendSignature = async (e) => {
    e.preventDefault();
    if (!sigMemberId) return;
    setSendingSig(true);
    setError('');
    try {
      const docLabel = sigType === 'reglement_interieur' ? 'Règlement intérieur' : 'Contrat / Charte membre';
      const res = await documentsApi.sendSignature(sigMemberId, { type_doc: sigType, nom: docLabel });
      setMsg(res.message || 'Lien de signature PDF envoyé par e-mail.');
      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setSendingSig(false);
    }
  };

  return (
    <PortalLayout profile={profile}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="text-left">
          <h1 className="font-sora font-bold text-2xl sm:text-3xl text-[#100f0d]">Membres</h1>
          <p className="text-sm text-on-surface-variant">
            Table unifiée des personnes (Membres, Invités, Prospects), Entreprises et documents contractuels.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-outline-variant/25 bg-surface-container-lowest text-xs font-semibold cursor-pointer">
            <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} className="accent-[#f95d00]" />
            Afficher les archivés
          </label>
          <button
            type="button"
            onClick={() => { setCreatedTempPwd(''); setCreateForm((p) => ({ ...p, type_personne: 'membre' })); setShowCreate(true); }}
            style={{ backgroundColor: '#f95d00', color: '#ffffff' }}
            className="px-4 py-2.5 rounded-xl font-semibold text-sm hover:opacity-95 flex items-center gap-2 shadow-xs"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>person_add</span>
            Nouvelle personne
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-xs font-bold underline">Fermer</button>
        </div>
      )}
      {msg && (
        <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center justify-between">
          <span>{msg}</span>
          <button onClick={() => setMsg('')} className="text-xs font-bold underline">Fermer</button>
        </div>
      )}

      {/* Onglets + Barre de recherche */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'personnes', label: `Personnes (${personnes.length})`, icon: 'group' },
            { id: 'entreprises', label: `Entreprises (${entreprises.length})`, icon: 'business' },
            { id: 'documents', label: 'Documents & Contrats', icon: 'description' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              style={tab === t.id ? { backgroundColor: '#f95d00', color: '#ffffff' } : undefined}
              className={`px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-2 transition ${
                tab === t.id
                  ? 'shadow-xs'
                  : 'bg-surface-container-lowest text-on-surface-variant border border-outline-variant/15 hover:bg-surface-container-low'
              }`}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 17 }}>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>

        {tab !== 'documents' && (
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filtrer par nom, e-mail, téléphone..."
            className="w-full sm:w-72 px-3.5 py-2 rounded-xl border border-outline-variant/20 bg-surface-container-lowest text-sm"
          />
        )}
      </div>

      {tab === 'personnes' && (
        <div className="flex flex-wrap gap-2 mb-5">
          {[
            { id: 'all', label: 'Tous' },
            { id: 'membre', label: 'Membres' },
            { id: 'invite', label: 'Invités' },
            { id: 'prospect', label: 'Prospects' },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setPersonneFilter(f.id)}
              style={personneFilter === f.id ? { backgroundColor: '#f95d00', color: '#ffffff' } : undefined}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                personneFilter === f.id
                  ? 'shadow-2xs'
                  : 'bg-surface-container-lowest border border-outline-variant/20 text-on-surface-variant hover:text-primary'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="bg-surface-container-lowest rounded-3xl p-8 text-center text-sm text-on-surface-variant">
          Chargement des fiches…
        </div>
      ) : tab === 'personnes' ? (
        <div className="bg-surface-container-lowest rounded-3xl border border-outline-variant/15 overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-outline-variant/15 text-xs uppercase tracking-wider text-on-surface-variant">
                <th className="py-3.5 px-4">Personne</th>
                <th className="py-3.5 px-4">Catégorie</th>
                <th className="py-3.5 px-4">Statut</th>
                <th className="py-3.5 px-4">Activité</th>
                <th className="py-3.5 px-4">Solde</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/10">
              {filteredPersonnes.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-on-surface-variant">
                    Aucune fiche trouvée.
                  </td>
                </tr>
              ) : (
                filteredPersonnes.map((m) => (
                  <tr key={`${m.source}-${m.id}`} className={`hover:bg-surface-container-low/40 ${m.archived_at ? 'opacity-60 bg-slate-50/70' : ''}`}>
                    <td className="py-3 px-4">
                      <p className="font-semibold text-primary">{m.prenom} {m.nom}</p>
                      <p className="text-xs text-on-surface-variant">{m.email || '—'} {m.telephone ? `· ${m.telephone}` : ''}</p>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                        m.type_personne === 'membre'
                          ? 'bg-emerald-100 text-emerald-800'
                          : m.type_personne === 'invite'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-orange-100 text-[#c2410c]'
                      }`}>
                        {m.type_personne === 'invite' ? 'Invité' : m.type_personne === 'prospect' ? 'Prospect' : 'Membre'}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                        m.archived_at
                          ? 'bg-slate-200 text-slate-700'
                          : m.statut_compte === 'suspendu'
                            ? 'bg-red-100 text-red-700'
                            : m.statut_compte === 'en_attente'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {m.archived_at ? 'Archivé' : (m.statut_compte || 'actif')}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-xs text-on-surface-variant">
                      <p>{m.reservations_count || 0} résa(s)</p>
                      <p className="text-xs">{m.abonnement_actif ? `Abo : ${m.abonnement_actif.type}` : 'Sans abonnement'}</p>
                    </td>
                    <td className="py-3 px-4 text-xs">
                      <p className="font-semibold text-emerald-700">Payé : <Money amount={m.total_paye || 0} /></p>
                      {(m.total_du || 0) > 0 && <p className="font-bold text-red-600">Dû : <Money amount={m.total_du} /></p>}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        {m.archived_at ? (
                          <button
                            type="button"
                            onClick={() => handleRestorePersonne(m)}
                            className="px-2.5 py-1 rounded-lg border border-emerald-300 text-emerald-700 text-xs font-semibold hover:bg-emerald-50"
                          >
                            Restaurer
                          </button>
                        ) : (
                          <>
                            {m.source === 'profile' && (
                              <>
                                <button type="button" onClick={() => setQrMember(m)} title="QR Code Check-in" className="p-1.5 rounded-lg hover:bg-surface-container-low text-on-surface-variant">
                                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>qr_code_2</span>
                                </button>
                                <button type="button" onClick={() => handleOpenHistory(m)} title="Historique" className="p-1.5 rounded-lg hover:bg-surface-container-low text-on-surface-variant">
                                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>history</span>
                                </button>
                                <button type="button" onClick={() => setEditMember({ ...m })} title="Modifier" className="p-1.5 rounded-lg hover:bg-surface-container-low text-primary">
                                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>edit</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleToggleSuspend(m)}
                                  title={m.statut_compte === 'suspendu' ? 'Réactiver' : 'Suspendre'}
                                  className={`p-1.5 rounded-lg hover:bg-surface-container-low ${m.statut_compte === 'suspendu' ? 'text-emerald-600' : 'text-red-600'}`}
                                >
                                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                                    {m.statut_compte === 'suspendu' ? 'check_circle' : 'block'}
                                  </span>
                                </button>
                              </>
                            )}
                            {m.source === 'guest' && (
                              <button
                                type="button"
                                onClick={() => handleConvertGuest(m)}
                                style={{ backgroundColor: '#f95d00', color: '#ffffff' }}
                                className="px-2.5 py-1 rounded-lg text-xs font-bold"
                              >
                                Convertir en Membre
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleArchivePersonne(m)}
                              title="Archiver"
                              className="px-2.5 py-1 rounded-lg border border-outline-variant/30 text-on-surface-variant text-xs font-semibold hover:bg-surface-container-low"
                            >
                              Archiver
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : tab === 'guests' ? (
        <div className="bg-surface-container-lowest rounded-3xl border border-outline-variant/15 overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-outline-variant/15 text-xs uppercase tracking-wider text-on-surface-variant">
                <th className="py-3.5 px-4">Invité</th>
                <th className="py-3.5 px-4">Téléphone</th>
                <th className="py-3.5 px-4">Statut</th>
                <th className="py-3.5 px-4">Créé le</th>
                <th className="py-3.5 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/10">
              {filteredGuests.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-on-surface-variant">
                    Aucun invité enregistré pour le moment.
                  </td>
                </tr>
              ) : (
                filteredGuests.map((g) => (
                  <tr key={g.id} className="hover:bg-surface-container-low/40">
                    <td className="py-3 px-4">
                      <p className="font-semibold text-[#100f0d]">{g.prenom} {g.nom || 'Invité'}</p>
                      <p className="text-xs text-on-surface-variant">{g.email}</p>
                    </td>
                    <td className="py-3 px-4 text-xs text-on-surface-variant">{g.telephone || '—'}</td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                        g.converted_user_id ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'
                      }`}>
                        {g.converted_user_id ? 'Converti' : 'Invité ponctuel'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-xs text-on-surface-variant">
                      {g.created_at ? formatDateDMY(g.created_at) : '—'}
                    </td>
                    <td className="py-3 px-4 text-right">
                      {!g.converted_user_id ? (
                        <button
                          type="button"
                          onClick={() => handleConvertGuest(g)}
                          className="px-3 py-1.5 rounded-xl bg-[#f95d00] text-white text-xs font-bold hover:bg-[#e55500]"
                        >
                          Convertir en Membre
                        </button>
                      ) : (
                        <span className="text-xs text-emerald-700 font-semibold">Déjà membre</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : tab === 'entreprises' ? (
        <div className="bg-surface-container-lowest rounded-3xl border border-outline-variant/15 overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-outline-variant/15 text-xs uppercase tracking-wider text-on-surface-variant">
                <th className="py-3.5 px-4">Entreprise / Raison sociale</th>
                <th className="py-3.5 px-4">Contact</th>
                <th className="py-3.5 px-4">Matricule Fiscale</th>
                <th className="py-3.5 px-4">Réservations</th>
                <th className="py-3.5 px-4">Montant cumulé</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/10">
              {filteredEntreprises.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-on-surface-variant">
                    Aucune réservation ou compte Entreprise enregistré.
                  </td>
                </tr>
              ) : (
                filteredEntreprises.map((ent, idx) => (
                  <tr key={ent.id || idx} className="hover:bg-surface-container-low/40">
                    <td className="py-3 px-4">
                      <p className="font-semibold text-primary">{ent.raison_sociale}</p>
                      {ent.adresse && <p className="text-xs text-on-surface-variant">{ent.adresse}</p>}
                    </td>
                    <td className="py-3 px-4 text-xs">
                      <p className="font-semibold text-primary">{ent.contact_nom || '—'}</p>
                      <p className="text-on-surface-variant">{ent.email} · {ent.telephone}</p>
                    </td>
                    <td className="py-3 px-4 text-xs font-mono">{ent.matricule_fiscale || '—'}</td>
                    <td className="py-3 px-4 font-semibold">{ent.reservations_count}</td>
                    <td className="py-3 px-4 font-bold text-[#2fbe8f]">{formatDT(ent.total_ca)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        /* Onglet Documents */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-7 bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/15">
            <h2 className="font-sora font-bold text-base text-primary mb-3">Règlement intérieur & Modèles de documents</h2>
            <div className="flex flex-wrap gap-2 mb-4">
              {[
                { id: 'reglement_interieur', label: 'Règlement intérieur' },
                { id: 'contrat_domiciliation', label: 'Contrat / Charte membre' },
                { id: 'attestation_presence', label: 'Attestation PDF' },
              ].map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setDocType(d.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold ${
                    docType === d.id ? 'bg-[#f95d00] text-white' : 'bg-surface-container-low text-on-surface-variant'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1">Titre du document</label>
                <input
                  type="text"
                  value={docTitre}
                  onChange={(e) => setDocTitre(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-outline-variant/20 text-sm bg-surface-container-low/40"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1">Contenu (affiché lors de la signature membre)</label>
                <textarea
                  rows={8}
                  value={docBody}
                  onChange={(e) => setDocBody(e.target.value)}
                  placeholder="Rédigez les clauses du règlement intérieur ou du contrat…"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-outline-variant/20 text-sm bg-surface-container-low/40"
                />
              </div>
              <button
                type="button"
                onClick={handleSaveDoc}
                disabled={savingDoc}
                style={{ backgroundColor: '#f95d00', color: '#ffffff' }}
                className="px-4 py-2 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-50"
              >
                {savingDoc ? 'Enregistrement…' : 'Enregistrer le modèle'}
              </button>
            </div>
          </div>

          <div className="lg:col-span-5 space-y-5">
            <form onSubmit={handleSendSignature} className="bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/15 space-y-3">
              <h2 className="font-sora font-bold text-base text-primary">Envoyer un contrat PDF à signer</h2>
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1">Membre</label>
                <select
                  required
                  value={sigMemberId}
                  onChange={(e) => setSigMemberId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-outline-variant/20 text-sm bg-surface-container-low/40"
                >
                  <option value="">— Choisir un membre —</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>{m.prenom} {m.nom} ({m.email})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1">Type de document</label>
                <select
                  value={sigType}
                  onChange={(e) => setSigType(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-outline-variant/20 text-sm bg-surface-container-low/40"
                >
                  <option value="contrat_domiciliation">Contrat / Charte membre</option>
                  <option value="reglement_interieur">Règlement intérieur</option>
                </select>
              </div>
              <button
                type="submit"
                disabled={sendingSig || !sigMemberId}
                className="w-full py-2 rounded-xl bg-[#f95d00] text-white font-semibold text-sm hover:bg-[#e55500] disabled:opacity-50"
              >
                {sendingSig ? 'Envoi…' : 'Envoyer lien de signature par e-mail'}
              </button>
            </form>

            <div className="bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/15">
              <h3 className="font-sora font-bold text-sm text-primary mb-3">Documents & signatures membres ({docSignatures.length})</h3>
              {docSignatures.length === 0 ? (
                <p className="text-xs text-on-surface-variant">Aucun document envoyé pour signature.</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {docSignatures.map((d) => {
                    const isSigned = d.signe || d.statut === 'signe';
                    return (
                    <div key={d.id} className="p-2.5 rounded-xl bg-surface-container-low/60 flex items-center justify-between gap-2 text-xs">
                      <div className="min-w-0">
                        <p className="font-semibold text-primary truncate">{d.profiles ? `${d.profiles.prenom} ${d.profiles.nom}` : 'Membre'}</p>
                        <p className="text-on-surface-variant">{d.nom || d.type_doc || d.type}</p>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                        isSigned ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'
                      }`}>
                        {isSigned ? 'signé' : (d.statut || 'en_attente')}
                      </span>
                    </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modale Création Membre */}
      {showCreate && (
        <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-sora font-bold text-lg text-primary">Nouveau membre</h2>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-700">✕</button>
            </div>
            {createdTempPwd ? (
              <div className="space-y-3">
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-900">
                  Compte membre créé ! Mot de passe temporaire :
                  <p className="font-mono font-bold mt-1 text-base select-all">{createdTempPwd}</p>
                </div>
                <button
                  type="button"
                  onClick={() => { setCreatedTempPwd(''); setShowCreate(false); }}
                  style={{ backgroundColor: '#f95d00', color: '#ffffff' }}
                  className="w-full py-2.5 rounded-xl font-semibold text-sm"
                >
                  Fermer
                </button>
              </div>
            ) : (
              <form onSubmit={handleCreateMember} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold mb-1">Catégorie de fiche</label>
                  <select
                    value={createForm.type_personne}
                    onChange={(e) => setCreateForm((p) => ({ ...p, type_personne: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white"
                  >
                    <option value="membre">Membre (avec accès portail)</option>
                    <option value="prospect">Prospect (sans compte d'accès)</option>
                    <option value="invite">Invité ponctuel (sans compte d'accès)</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-semibold mb-1">Prénom</label>
                    <input
                      type="text"
                      value={createForm.prenom}
                      onChange={(e) => setCreateForm((p) => ({ ...p, prenom: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">Nom *</label>
                    <input
                      required
                      type="text"
                      value={createForm.nom}
                      onChange={(e) => setCreateForm((p) => ({ ...p, nom: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">E-mail *</label>
                  <input
                    required
                    type="email"
                    value={createForm.email}
                    onChange={(e) => setCreateForm((p) => ({ ...p, email: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Téléphone</label>
                  <TunisianPhoneInput
                    value={createForm.telephone}
                    onChange={(val) => setCreateForm((p) => ({ ...p, telephone: val }))}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Profil client</label>
                  <select
                    value={createForm.type_membre}
                    onChange={(e) => setCreateForm((p) => ({ ...p, type_membre: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm"
                  >
                    <option value="particulier">Particulier (Membre)</option>
                    <option value="entreprise">Entreprise</option>
                  </select>
                </div>
                <div className="flex gap-2 pt-2">
                  <button type="button" onClick={() => setShowCreate(false)} className="flex-1 py-2.5 rounded-xl bg-gray-100 text-sm font-semibold">
                    Annuler
                  </button>
                  <button type="submit" disabled={creating} className="flex-1 py-2.5 rounded-xl bg-[#f95d00] text-white text-sm font-semibold disabled:opacity-50">
                    {creating ? 'Création…' : 'Créer le membre'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Modale Édition Membre */}
      {editMember && (
        <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
          <form onSubmit={handleSaveEdit} className="bg-white rounded-3xl max-w-md w-full p-6 shadow-xl space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-sora font-bold text-lg text-primary">Modifier le membre</h2>
              <button type="button" onClick={() => setEditMember(null)} className="text-gray-400 hover:text-gray-700">✕</button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-semibold mb-1">Prénom</label>
                <input
                  type="text"
                  value={editMember.prenom || ''}
                  onChange={(e) => setEditMember((p) => ({ ...p, prenom: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Nom</label>
                <input
                  type="text"
                  required
                  value={editMember.nom || ''}
                  onChange={(e) => setEditMember((p) => ({ ...p, nom: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Téléphone</label>
              <TunisianPhoneInput
                value={editMember.telephone || ''}
                onChange={(val) => setEditMember((p) => ({ ...p, telephone: val }))}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-semibold mb-1">Type</label>
                <select
                  value={editMember.type_membre || 'particulier'}
                  onChange={(e) => setEditMember((p) => ({ ...p, type_membre: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm"
                >
                  <option value="particulier">Particulier</option>
                  <option value="entreprise">Entreprise</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Statut</label>
                <select
                  value={editMember.statut_compte || 'actif'}
                  onChange={(e) => setEditMember((p) => ({ ...p, statut_compte: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm"
                >
                  <option value="actif">Actif</option>
                  <option value="suspendu">Suspendu</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={() => setEditMember(null)} className="flex-1 py-2.5 rounded-xl bg-gray-100 text-sm font-semibold">
                Annuler
              </button>
              <button type="submit" disabled={savingEdit} className="flex-1 py-2.5 rounded-xl bg-[#f95d00] text-white text-sm font-semibold">
                {savingEdit ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modale QR Code Membre */}
      {qrMember && (
        <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4" onClick={() => setQrMember(null)}>
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 text-center shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-sora font-bold text-lg text-primary mb-1">Badge QR Check-in</h3>
            <p className="text-xs text-gray-500 mb-4">{qrMember.prenom} {qrMember.nom} · {qrMember.email}</p>
            <div className="inline-block p-4 rounded-2xl border border-gray-100 bg-white mb-4">
              <QRCodeSVG value={`DESKYWORK:MEMBER:${qrMember.id}`} size={180} />
            </div>
            <button onClick={() => setQrMember(null)} style={{ backgroundColor: '#f95d00', color: '#ffffff' }} className="w-full py-2.5 rounded-xl text-sm font-semibold">
              Fermer
            </button>
          </div>
        </div>
      )}

      {/* Modale Historique Membre */}
      {historyData && (
        <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4" onClick={() => setHistoryData(null)}>
          <div className="bg-white rounded-3xl max-w-2xl w-full p-6 max-h-[85vh] overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-sora font-bold text-lg text-primary">
                  Historique — {historyData.member?.prenom} {historyData.member?.nom}
                </h2>
                <p className="text-xs text-gray-500">{historyData.member?.email}</p>
              </div>
              <button onClick={() => setHistoryData(null)} className="text-gray-400 hover:text-gray-700">✕</button>
            </div>
            {historyLoading ? (
              <p className="text-sm text-gray-500 py-8 text-center">Chargement de l'historique…</p>
            ) : (
              <div className="space-y-5 text-sm">
                <div>
                  <h4 className="font-bold text-xs uppercase text-gray-500 mb-2">Réservations ({historyData.reservations?.length || 0})</h4>
                  {(historyData.reservations || []).length === 0 ? (
                    <p className="text-xs text-gray-400">Aucune réservation.</p>
                  ) : (
                    <div className="divide-y divide-gray-100">
                      {historyData.reservations.map((r) => (
                        <div key={r.id} className="py-2 flex justify-between">
                          <span>{r.espaces?.nom || 'Espace'} · {formatDateDMY(r.date_debut)}</span>
                          <span className="font-semibold"><Money amount={r.montant_total} /> ({r.statut})</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <h4 className="font-bold text-xs uppercase text-gray-500 mb-2">Paiements ({historyData.paiements?.length || 0})</h4>
                  {(historyData.paiements || []).length === 0 ? (
                    <p className="text-xs text-gray-400">Aucun paiement.</p>
                  ) : (
                    <div className="divide-y divide-gray-100">
                      {historyData.paiements.map((p) => (
                        <div key={p.id} className="py-2 flex justify-between">
                          <span>{p.numero_recu || p.reference_externe || 'Règlement'} ({p.mode})</span>
                          <span className={`font-bold ${p.statut === 'paid' ? 'text-emerald-700' : 'text-amber-700'}`}>
                            {formatDT(p.montant)} · {p.statut}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </PortalLayout>
  );
}
