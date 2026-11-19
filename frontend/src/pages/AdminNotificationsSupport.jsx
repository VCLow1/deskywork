import React, { useEffect, useState, useMemo } from 'react';
import PortalLayout from '../components/layout/PortalLayout';
import { useSessionUser } from '../hooks/useSessionUser';
import { tenantAdminApi } from '../services/api';

const ALERT_RULES = [
  {
    key: 'alerte_fin_session_inapp',
    label: 'Alerte fin de session imminente (T-15 min)',
    channel: 'Notification In-App',
    desc: 'Affiche un badge « Bientôt terminée - 15 min » dans le back-office.',
  },
  {
    key: 'alerte_depassement_inapp',
    label: 'Alerte dépassement d\'occupation',
    channel: 'Notification In-App',
    desc: 'Signale en rouge toute session non libérée après l\'heure de fin prévue.',
  },
  {
    key: 'confirmation_reservation_email',
    label: 'Confirmation / Annulation de réservation',
    channel: 'In-App + E-mail',
    desc: 'Notifie le membre et l\'administrateur lors de chaque réservation.',
  },
  {
    key: 'recu_paiement_email',
    label: 'Envoi automatique du Reçu PDF numéroté',
    channel: 'In-App + E-mail',
    desc: 'Envoie le reçu PDF (hors facture) par e-mail après encaissement sur place.',
  },
  {
    key: 'rappel_echeance_abonnement_email',
    label: 'Rappel échéance abonnement membre (J-7 / J-3)',
    channel: 'In-App + E-mail',
    desc: 'Prévient les membres dont l\'abonnement arrive à expiration.',
  },
  {
    key: 'relance_impaye_email',
    label: 'Relance automatique des impayés en attente',
    channel: 'In-App + E-mail',
    desc: 'Envoie un rappel e-mail pour les montants dus en attente de règlement.',
  },
  {
    key: 'nouvelle_inscription_email',
    label: 'Nouvelle inscription membre ou formation',
    channel: 'In-App + E-mail',
    desc: 'Alerte l\'équipe à chaque nouvelle inscription.',
  },
];

export default function AdminNotificationsSupport({ session }) {
  const { userId, email, metadata } = useSessionUser(session);
  const profile = useMemo(
    () => (userId ? { id: userId, email, role: metadata.role || 'admin', prenom: metadata.prenom || '', nom: metadata.nom || '', ...metadata } : null),
    [userId, email, metadata]
  );
  const [loading, setLoading] = useState(true);
  const [alertSettings, setAlertSettings] = useState({});
  const [tickets, setTickets] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [savingAlerts, setSavingAlerts] = useState(false);
  const [sendingTicket, setSendingTicket] = useState(false);
  const [ticketForm, setTicketForm] = useState({ sujet: '', categorie: 'Technique', priorite: 'normale', message: '' });
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const isManager = profile?.role !== 'staff';

  const loadState = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await tenantAdminApi.getSupportState();
      setAlertSettings(res.alert_settings || {});
      setTickets(res.tickets || []);
      setNotifications(res.notifications || []);
    } catch (e) {
      setError(e.message || 'Erreur lors du chargement.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadState();
  }, []);

  const handleSaveAlerts = async () => {
    setSavingAlerts(true);
    setError('');
    try {
      const res = await tenantAdminApi.updateAlertSettings(alertSettings);
      setMsg(res.message || 'Préférences enregistrées.');
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingAlerts(false);
    }
  };

  const handleCreateTicket = async (e) => {
    e.preventDefault();
    setSendingTicket(true);
    setError('');
    try {
      const res = await tenantAdminApi.createSupportTicket(ticketForm);
      setTickets(res.tickets || []);
      setTicketForm({ sujet: '', categorie: 'Technique', priorite: 'normale', message: '' });
      setMsg(res.message || 'Ticket envoyé.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSendingTicket(false);
    }
  };

  return (
    <PortalLayout profile={profile}>
      <div className="mb-6">
        <h1 className="font-sora font-bold text-2xl sm:text-3xl text-primary">Notifications & Support DeskyWork</h1>
        <p className="text-sm text-on-surface-variant">
          Paramétrage des alertes automatiques (In-App et E-mail uniquement — sans SMS ni WhatsApp) et assistance équipe DeskyWork.
        </p>
      </div>

      {error && <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}
      {msg && <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm">{msg}</div>}

      {loading ? (
        <div className="bg-surface-container-lowest rounded-3xl p-8 text-center text-sm text-on-surface-variant">Chargement…</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Colonne gauche : Paramétrage Alertes + Fil In-App */}
          <div className="lg:col-span-7 space-y-5">
            <div className="bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/15">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <div>
                  <h2 className="font-sora font-bold text-base text-primary">Alertes automatiques (In-App & E-mail)</h2>
                  <p className="text-xs text-on-surface-variant">Notifications in-app et alertes e-mail</p>
                </div>
                <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-800 text-[11px] font-bold">
                  In-App + E-mail
                </span>
              </div>

              <div className="space-y-3">
                {ALERT_RULES.map((rule) => (
                  <label
                    key={rule.key}
                    className="flex items-start justify-between gap-3 p-3 rounded-2xl bg-surface-container-low/50 border border-outline-variant/10 cursor-pointer"
                  >
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-primary">{rule.label}</p>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant">
                          {rule.channel}
                        </span>
                      </div>
                      <p className="text-xs text-on-surface-variant mt-0.5">{rule.desc}</p>
                    </div>
                    <input
                      type="checkbox"
                      disabled={!isManager}
                      checked={Boolean(alertSettings[rule.key])}
                      onChange={(e) => setAlertSettings((prev) => ({ ...prev, [rule.key]: e.target.checked }))}
                      className="mt-1 h-4 w-4 accent-[#f95d00]"
                    />
                  </label>
                ))}
              </div>

              {isManager && (
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    disabled={savingAlerts}
                    onClick={handleSaveAlerts}
                    className="px-4 py-2 rounded-xl bg-primary text-on-primary text-sm font-semibold hover:opacity-90 disabled:opacity-50"
                  >
                    {savingAlerts ? 'Enregistrement…' : 'Enregistrer les alertes'}
                  </button>
                </div>
              )}
            </div>

            <div className="bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/15">
              <h2 className="font-sora font-bold text-base text-primary mb-3">Dernières notifications In-App ({notifications.length})</h2>
              {notifications.length === 0 ? (
                <p className="text-xs text-on-surface-variant py-6 text-center">Aucune notification récente.</p>
              ) : (
                <div className="divide-y divide-outline-variant/10 max-h-72 overflow-y-auto">
                  {notifications.map((n) => (
                    <div key={n.id} className="py-2.5 flex items-start justify-between gap-2 text-xs">
                      <div>
                        <p className="font-semibold text-primary">{n.titre}</p>
                        <p className="text-on-surface-variant">{n.message}</p>
                      </div>
                      <span className="text-[10px] text-on-surface-variant shrink-0">
                        {n.created_at ? new Date(n.created_at).toLocaleDateString('fr-FR') : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Colonne droite : Support DeskyWork */}
          <div className="lg:col-span-5 space-y-5">
            <form onSubmit={handleCreateTicket} className="bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/15 space-y-3">
              <h2 className="font-sora font-bold text-base text-primary">Ouvrir un ticket Support DeskyWork</h2>
              <p className="text-xs text-on-surface-variant">
                Besoin d'aide technique, de facturation SaaS ou de changement de pack ? Contactez directement l'équipe DeskyWork.
              </p>
              <div>
                <label className="block text-xs font-semibold mb-1">Sujet *</label>
                <input
                  required
                  type="text"
                  value={ticketForm.sujet}
                  onChange={(e) => setTicketForm((p) => ({ ...p, sujet: e.target.value }))}
                  placeholder="Ex: Question sur le pack Standard ou anomalie..."
                  className="w-full px-3 py-2 rounded-xl border border-outline-variant/20 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold mb-1">Catégorie</label>
                  <select
                    value={ticketForm.categorie}
                    onChange={(e) => setTicketForm((p) => ({ ...p, categorie: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-outline-variant/20 text-sm"
                  >
                    <option value="Technique">Technique</option>
                    <option value="Abonnement & Facturation">Abonnement & Facturation</option>
                    <option value="Amélioration">Demande d'évolution</option>
                    <option value="Autre">Autre</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Priorité</label>
                  <select
                    value={ticketForm.priorite}
                    onChange={(e) => setTicketForm((p) => ({ ...p, priorite: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-outline-variant/20 text-sm"
                  >
                    <option value="basse">Basse</option>
                    <option value="normale">Normale</option>
                    <option value="haute">Haute</option>
                    <option value="urgente">Urgente</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Message *</label>
                <textarea
                  required
                  rows={4}
                  value={ticketForm.message}
                  onChange={(e) => setTicketForm((p) => ({ ...p, message: e.target.value }))}
                  placeholder="Décrivez votre demande en détail..."
                  className="w-full px-3 py-2 rounded-xl border border-outline-variant/20 text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={sendingTicket}
                className="w-full py-2.5 rounded-xl bg-[#f95d00] text-white font-semibold text-sm hover:bg-[#e55500] disabled:opacity-50"
              >
                {sendingTicket ? 'Envoi en cours…' : 'Envoyer le ticket au support'}
              </button>
            </form>

            <div className="bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/15">
              <h3 className="font-sora font-bold text-sm text-primary mb-3">Mes tickets de support ({tickets.length})</h3>
              {tickets.length === 0 ? (
                <p className="text-xs text-on-surface-variant">Aucun ticket ouvert.</p>
              ) : (
                <div className="space-y-2.5 max-h-72 overflow-y-auto">
                  {tickets.map((t) => (
                    <div key={t.id} className="p-3 rounded-2xl bg-surface-container-low/60 border border-outline-variant/10 text-xs">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="font-mono font-bold text-[#f95d00]">{t.id}</span>
                        <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold uppercase">
                          {t.statut || 'ouvert'}
                        </span>
                      </div>
                      <p className="font-semibold text-primary">{t.sujet}</p>
                      <p className="text-on-surface-variant mt-0.5 line-clamp-2">{t.message}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </PortalLayout>
  );
}
