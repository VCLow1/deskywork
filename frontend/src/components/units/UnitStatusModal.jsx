// components/units/UnitStatusModal.jsx — Changement statut unité avec résolution obligatoire des réservations futures (LOT 3)
import React, { useState, useEffect } from 'react';
import { tenantAdminApi } from '../../services/api';
import { formatDateDMY, formatTime24h, tunisLocalToISO } from '../../utils/format';
import Money from '../common/Money';

const STATUS_OPTIONS = [
  { value: 'disponible', label: 'Disponible', icon: 'check_circle', desc: 'Ouverte à la réservation et au plan 2D', badgeCls: 'border-emerald-300 bg-emerald-50 text-emerald-800' },
  { value: 'non_disponible', label: 'Non disponible', icon: 'block', desc: 'Masquée / bloquée temporairement', badgeCls: 'border-amber-300 bg-amber-50 text-amber-800' },
  { value: 'en_maintenance', label: 'En maintenance', icon: 'construction', desc: 'Affichée hachurée sur le plan 2D', badgeCls: 'border-slate-300 bg-slate-100 text-slate-800' },
];

export default function UnitStatusModal({ unite, isOpen, onClose, onSaved }) {
  const [statut, setStatut] = useState(unite?.statut || 'disponible');
  const [motifInterne, setMotifInterne] = useState(unite?.motif_interne || '');
  const [dateRetourDate, setDateRetourDate] = useState('');
  const [dateRetourTime, setDateRetourTime] = useState('09:00');
  const [impactedBookings, setImpactedBookings] = useState([]);
  const [availableUnits, setAvailableUnits] = useState([]);
  const [resolutions, setResolutions] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen || !unite) return;
    setStatut(unite.statut || 'disponible');
    setMotifInterne(unite.motif_interne || '');
    if (unite.date_retour_auto) {
      const d = new Date(unite.date_retour_auto);
      if (!Number.isNaN(d.getTime())) {
        setDateRetourDate(d.toISOString().slice(0, 10));
        setDateRetourTime(formatTime24h(d.toISOString()) || '09:00');
      }
    } else {
      setDateRetourDate('');
      setDateRetourTime('09:00');
    }
    setImpactedBookings([]);
    setAvailableUnits([]);
    setResolutions({});
    setError('');
  }, [isOpen, unite]);

  if (!isOpen || !unite) return null;

  const setBookingResolution = (bookingId, patch) => {
    setResolutions((prev) => ({
      ...prev,
      [bookingId]: { ...(prev[bookingId] || { action: availableUnits.length > 0 ? 'move' : 'cancel', target_unite_id: availableUnits[0]?.id || '', motif: '' }), ...patch },
    }));
  };

  const allResolved = impactedBookings.length === 0 || impactedBookings.every((b) => {
    const r = resolutions[b.id];
    if (!r) return false;
    if (r.action === 'move') return Boolean(r.target_unite_id);
    if (r.action === 'cancel') return Boolean(String(r.motif || '').trim());
    return false;
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const dateRetourAuto = statut !== 'disponible' && dateRetourDate
        ? tunisLocalToISO(`${dateRetourDate}T${dateRetourTime || '09:00'}`)
        : null;

      const resolutionPayload = impactedBookings.map((b) => ({
        reservation_id: b.id,
        action: resolutions[b.id]?.action || 'cancel',
        target_unite_id: resolutions[b.id]?.target_unite_id || null,
        motif: resolutions[b.id]?.motif || '',
      }));

      const res = await tenantAdminApi.changeUniteStatus(unite.id, {
        statut,
        motif_interne: motifInterne,
        date_retour_auto: dateRetourAuto,
        resolutions: resolutionPayload,
      });

      onSaved?.(res);
      onClose?.();
    } catch (err) {
      const errData = err?.data || err?.body;
      if (err?.status === 409 && Array.isArray(errData?.impacted_bookings)) {
        const list = errData.impacted_bookings;
        const avail = errData.available_units || [];
        setImpactedBookings(list);
        setAvailableUnits(avail);
        const init = {};
        list.forEach((b) => {
          init[b.id] = {
            action: avail.length > 0 ? 'move' : 'cancel',
            target_unite_id: avail[0]?.id || '',
            motif: `Unité ${unite.code} placée en ${statut === 'en_maintenance' ? 'maintenance' : 'indisponibilité'}`,
          };
        });
        setResolutions(init);
        setError(err.message);
      } else {
        setError(err.message || 'Impossible de modifier le statut de l\'unité.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl space-y-4 text-left"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-[#f95d00]">Statut unité / poste</p>
            <h3 className="font-sora text-lg font-bold text-slate-900">
              {unite.code} · {unite.nom}
            </h3>
          </div>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-900 text-sm font-bold px-2 py-1">
            Fermer
          </button>
        </div>

        {error && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-xs font-semibold text-amber-900 flex items-start gap-2">
            <span className="material-symbols-outlined shrink-0" style={{ fontSize: 18 }}>warning</span>
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          {STATUS_OPTIONS.map((opt) => {
            const active = statut === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setStatut(opt.value)}
                style={active ? { backgroundColor: '#f95d00', color: '#ffffff', borderColor: '#f95d00' } : undefined}
                className={`rounded-2xl border p-3 text-left transition ${
                  active ? 'shadow-sm' : 'bg-white border-slate-200 text-slate-800 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center gap-2 font-bold text-xs">
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{opt.icon}</span>
                  <span>{opt.label}</span>
                </div>
                <p className={`text-xs mt-1 ${active ? 'text-white/90' : 'text-slate-500'}`}>{opt.desc}</p>
              </button>
            );
          })}
        </div>

        {statut !== 'disponible' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-800 mb-1">
                Motif interne (jamais exposé au public)
              </label>
              <input
                type="text"
                value={motifInterne}
                onChange={(e) => setMotifInterne(e.target.value)}
                placeholder="Ex : Climatisation HS, serrure à réparer, réservé équipe interne…"
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1">Date de retour auto (optionnelle)</label>
              <input
                type="date"
                value={dateRetourDate}
                onChange={(e) => setDateRetourDate(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1">Heure de retour (Africa/Tunis)</label>
              <input
                type="time"
                value={dateRetourTime}
                disabled={!dateRetourDate}
                onChange={(e) => setDateRetourTime(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 disabled:opacity-50"
              />
            </div>
          </div>
        )}

        {impactedBookings.length > 0 && (
          <div className="rounded-2xl border border-red-200 bg-red-50/70 p-4 space-y-3">
            <div className="flex items-center gap-2 text-red-800 font-bold text-xs">
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>event_busy</span>
              <span>
                {impactedBookings.length} réservation(s) future(s) impactée(s) — résolution obligatoire avant validation
              </span>
            </div>

            <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
              {impactedBookings.map((b) => {
                const clientName = b.profiles
                  ? `${b.profiles.prenom || ''} ${b.profiles.nom || ''}`.trim() || b.profiles.email
                  : b.guests
                    ? `${b.guests.prenom || ''} ${b.guests.nom || ''}`.trim()
                    : 'Client';
                const rState = resolutions[b.id] || {};
                return (
                  <div key={b.id} className="rounded-xl border border-red-200 bg-white p-3 space-y-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-bold text-slate-900">{clientName}</p>
                        <p className="text-slate-600">
                          {formatDateDMY(b.date_debut)} · {formatTime24h(b.date_debut)} → {formatTime24h(b.date_fin)}
                        </p>
                      </div>
                      <Money amount={b.montant_ttc ?? b.montant_total ?? 0} showTaxType="TTC" />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                      <select
                        value={rState.action || 'cancel'}
                        onChange={(e) => setBookingResolution(b.id, { action: e.target.value })}
                        className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold"
                      >
                        {availableUnits.length > 0 && <option value="move">Déplacer vers une autre unité libre</option>}
                        <option value="cancel">Annuler la réservation (avec motif)</option>
                      </select>

                      {rState.action === 'move' ? (
                        <select
                          required
                          value={rState.target_unite_id || ''}
                          onChange={(e) => setBookingResolution(b.id, { target_unite_id: e.target.value })}
                          className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold"
                        >
                          <option value="">— Choisir unité cible —</option>
                          {availableUnits.map((au) => (
                            <option key={au.id} value={au.id}>{au.code} · {au.nom}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          required
                          value={rState.motif || ''}
                          onChange={(e) => setBookingResolution(b.id, { motif: e.target.value })}
                          placeholder="Motif d'annulation obligatoire…"
                          className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={saving || !allResolved}
            style={{ backgroundColor: '#f95d00', color: '#ffffff' }}
            className="rounded-xl px-5 py-2 text-xs font-bold shadow-xs hover:opacity-95 disabled:opacity-50"
          >
            {saving
              ? 'Application…'
              : impactedBookings.length > 0
                ? 'Appliquer les résolutions et valider'
                : 'Enregistrer le statut'}
          </button>
        </div>
      </form>
    </div>
  );
}
