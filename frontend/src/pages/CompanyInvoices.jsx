import React, { useState, useEffect } from 'react';
import PortalLayout from '../components/layout/PortalLayout';
import { useSessionUser } from '../hooks/useSessionUser';
import { paymentApi } from '../services/api';
import { supabase } from '../supabaseClient';
import { formatDT } from '../utils/currency';

export default function CompanyInvoices({ session }) {
  const { userId, email, metadata } = useSessionUser(session);
  const profile = userId
    ? { id: userId, email, role: 'company', type_membre: 'entreprise', prenom: metadata.prenom || '', nom: metadata.nom || '', ...metadata }
    : null;

  const [loading, setLoading] = useState(true);
  const [payments, setPayments] = useState([]);
  const [downloadingId, setDownloadingId] = useState(null);

  useEffect(() => {
    async function loadInvoices() {
      if (!userId) return;
      setLoading(true);
      try {
        const res = await paymentApi.listSelf().catch(() => []);
        const list = Array.isArray(res) ? res : res?.paiements || [];
        setPayments(list);
      } catch (err) {
        console.error('Erreur chargement factures:', err);
      } finally {
        setLoading(false);
      }
    }
    loadInvoices();
  }, [userId]);

  const handleDownloadPdf = async (paymentId) => {
    setDownloadingId(paymentId);
    try {
      await paymentApi.downloadReceipt(paymentId);
    } catch (err) {
      alert('Erreur lors du téléchargement du reçu/facture PDF : ' + err.message);
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <PortalLayout profile={profile} onLogout={() => supabase.auth.signOut()}>
      <div className="space-y-6">
        <div>
          <h1 className="font-sora font-bold text-2xl text-slate-900">Mes Factures & Reçus B2B</h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Téléchargez les reçus et factures officiels émis par les établissements partenaires suite à vos réservations et services de coworking.
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-amber-50/70 border border-amber-200/60 flex items-start gap-3 text-xs text-amber-900">
          <span className="material-symbols-outlined text-amber-600 shrink-0 text-xl">info</span>
          <div>
            <strong>Règlement 100% sur place (CDC DeskyWork v3.0) :</strong> Les règlements sont effectués à l'accueil de l'établissement partenaire (espèces, chèque ou virement). Dès validation par le gérant, votre reçu officiel numéroté au format PDF conforme aux normes comptables tunisiennes est instantanément disponible en téléchargement.
          </div>
        </div>

        <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
          {loading ? (
            <div className="p-10 text-center text-slate-400 text-sm">Chargement des pièces comptables…</div>
          ) : payments.length === 0 ? (
            <div className="p-12 text-center space-y-3">
              <span className="material-symbols-outlined text-4xl text-slate-300">receipt_long</span>
              <p className="text-sm font-semibold text-slate-700">Aucune facture émise pour le moment.</p>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Lorsque vous effectuez une réservation d'espace ou souscrivez un pack auprès d'un partenaire, vos factures et reçus apparaîtront ici.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/80 text-[11px] font-bold uppercase text-slate-500 tracking-wider">
                    <th className="px-6 py-4">Réf. / N° Reçu</th>
                    <th className="px-6 py-4">Date</th>
                    <th className="px-6 py-4">Établissement émetteur</th>
                    <th className="px-6 py-4">Montant HT / TTC</th>
                    <th className="px-6 py-4">Mode de règlement</th>
                    <th className="px-6 py-4">Statut</th>
                    <th className="px-6 py-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                  {payments.map((p) => {
                    const isPaid = p.statut === 'paid';
                    const ref = p.reference_recu || `REC-${p.id.slice(0, 8).toUpperCase()}`;
                    const tenantNom = p.reservations?.tenants?.nom || p.reservations?.espaces?.tenants?.nom || 'Établissement Partenaire';

                    return (
                      <tr key={p.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-6 py-4 font-mono font-bold text-slate-900">
                          {ref}
                        </td>
                        <td className="px-6 py-4 text-slate-600">
                          {new Date(p.created_at).toLocaleDateString('fr-FR')}
                        </td>
                        <td className="px-6 py-4 font-semibold text-slate-900">
                          {tenantNom}
                        </td>
                        <td className="px-6 py-4 font-bold text-slate-900">
                          {formatDT(p.montant || 0)}
                        </td>
                        <td className="px-6 py-4">
                          <span className="capitalize">{p.mode || 'Sur place (accueil)'}</span>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                            isPaid ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                          }`}>
                            {isPaid ? 'Payée / Encaissée' : 'En attente de règlement'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={() => handleDownloadPdf(p.id)}
                            disabled={downloadingId === p.id}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-[#f95d00] hover:text-white text-slate-700 text-xs font-semibold transition-all disabled:opacity-50"
                            title="Télécharger le reçu / facture PDF"
                          >
                            <span className="material-symbols-outlined text-[16px]">
                              {downloadingId === p.id ? 'sync' : 'picture_as_pdf'}
                            </span>
                            {downloadingId === p.id ? 'Génération…' : 'PDF'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </PortalLayout>
  );
}
