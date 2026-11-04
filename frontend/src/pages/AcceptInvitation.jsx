// pages/AcceptInvitation.jsx — Écran d'accueil et d'acceptation d'invitation d'équipe
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import BrandLogo from '../components/layout/BrandLogo';
import { useLanguage, LanguageSwitcher } from '../context/LanguageContext';
import { authUnifiedApi } from '../services/api/authUnified';
import { supabase } from '../supabaseClient';

export default function AcceptInvitation() {
  const { token } = useParams();
  const { t } = useLanguage();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [invitationData, setInvitationData] = useState(null);
  const [session, setSession] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // 1. Charger l'invitation et la session
  useEffect(() => {
    async function init() {
      try {
        const { data: { session: s } } = await supabase.auth.getSession();
        setSession(s);

        const res = await authUnifiedApi.getInvitationInfo(token);
        if (!res.valid) {
          setErrorMsg(t('invitation.expiredAlert'));
        } else {
          setInvitationData(res.invitation);
        }
      } catch (err) {
        setErrorMsg(err.message || 'Invitation introuvable ou lien invalide.');
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [token, t]);

  // 2. Accepter l'invitation
  const handleAccept = async () => {
    setSubmitting(true);
    setErrorMsg('');

    try {
      const res = await authUnifiedApi.acceptInvitation(token);
      setSuccessMsg(res.message || t('invitation.successJoined'));

      // Définir l'organisation active
      if (res.membership?.organization_id) {
        localStorage.setItem('active_org_id', res.membership.organization_id);
      }

      setTimeout(() => {
        if (res.role === 'formateur') {
          navigate('/trainer-dashboard', { replace: true });
        } else {
          navigate('/admin/dashboard', { replace: true });
        }
      }, 1500);
    } catch (err) {
      setErrorMsg(err.message || 'Impossible d\'accepter l\'invitation.');
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center page-gradient">
        <div className="animate-spin w-8 h-8 border-4 border-[#f95d00] border-t-transparent rounded-full" />
      </div>
    );
  }

  const org = invitationData?.organizations;
  const roleLabels = {
    admin: 'Administrateur',
    staff: 'Staff / Réception',
    formateur: 'Formateur',
    lecture_seule: 'Lecture seule',
  };

  return (
    <div className="min-h-screen page-gradient flex flex-col font-inter text-on-surface">
      <header className="flex items-center justify-between px-6 py-4 relative z-10 border-b border-outline-variant/15">
        <BrandLogo to="/" height={40} />
        <LanguageSwitcher />
      </header>

      <main className="flex-1 flex items-center justify-center px-4 sm:px-6 py-10 relative z-10">
        <div className="w-full max-w-md animate-fade-up">

          {errorMsg ? (
            <div className="glass-card rounded-3xl p-8 text-center space-y-4 shadow-elevated">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-red-100 text-red-700 flex items-center justify-center">
                <span className="material-symbols-outlined text-[28px]">link_off</span>
              </div>
              <h2 className="font-sora text-xl font-bold text-red-700">Lien invalide ou expiré</h2>
              <p className="text-sm text-on-surface-variant leading-relaxed">{errorMsg}</p>
              <div className="pt-2">
                <Link to="/login" className="btn-primary inline-flex items-center justify-center px-6 py-2.5 rounded-xl text-sm font-semibold">
                  Retour à la connexion
                </Link>
              </div>
            </div>
          ) : (
            <div className="glass-card rounded-3xl p-6 sm:p-8 space-y-6 shadow-elevated text-center">
              {org?.logo_url ? (
                <img
                  src={org.logo_url}
                  alt={org.nom}
                  className="w-16 h-16 mx-auto rounded-2xl object-cover border border-outline-variant/20 shadow-sm"
                />
              ) : (
                <div className="w-16 h-16 mx-auto rounded-2xl bg-[#100f0d] text-white flex items-center justify-center shadow-md">
                  <span className="material-symbols-outlined text-[32px]">domain</span>
                </div>
              )}

              <div>
                <span className="text-[11px] font-bold px-3 py-1 rounded-full bg-orange-100 text-orange-900 uppercase tracking-wider mb-2 inline-block">
                  {t('invitation.title')}
                </span>
                <h1 className="font-sora text-2xl font-bold text-[#100f0d] mt-1">
                  Rejoindre {org?.nom}
                </h1>
                <p className="text-xs sm:text-sm text-on-surface-variant mt-1 leading-relaxed">
                  {t('invitation.receivedDesc')}
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-surface-container-low border border-outline-variant/20 text-left space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-on-surface-variant">Organisation :</span>
                  <strong className="text-on-surface">{org?.nom}</strong>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-on-surface-variant">{t('invitation.joinAs')}</span>
                  <strong className="text-secondary">{roleLabels[invitationData?.role] || invitationData?.role}</strong>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-on-surface-variant">Destiné à :</span>
                  <strong className="text-on-surface">{invitationData?.email}</strong>
                </div>
              </div>

              {successMsg && (
                <div className="p-3.5 rounded-xl bg-emerald-50 text-emerald-800 text-xs font-semibold flex items-center justify-center gap-2 border border-emerald-200">
                  <span className="material-symbols-outlined text-[18px]">check_circle</span>
                  {successMsg}
                </div>
              )}

              {/* Actions selon que l'utilisateur est connecté ou non */}
              {session ? (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleAccept}
                  className="btn-primary w-full py-3.5 rounded-xl font-semibold text-sm shadow-md flex items-center justify-center gap-2"
                >
                  {submitting ? (
                    <><span className="animate-spin material-symbols-outlined text-[18px]">refresh</span> {t('invitation.accepting')}</>
                  ) : (
                    <><span className="material-symbols-outlined text-[18px]">check</span> {t('invitation.acceptBtn')}</>
                  )}
                </button>
              ) : (
                <div className="space-y-3 pt-2">
                  <Link
                    to={`/login?invite_token=${token}`}
                    className="btn-primary w-full py-3.5 rounded-xl font-semibold text-sm shadow-md flex items-center justify-center gap-2"
                  >
                    <span className="material-symbols-outlined text-[18px]">login</span>
                    {t('invitation.loginToAccept')}
                  </Link>

                  <Link
                    to={`/register?invite_token=${token}`}
                    className="btn-outline w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2"
                  >
                    <span className="material-symbols-outlined text-[18px]">person_add</span>
                    {t('invitation.registerToAccept')}
                  </Link>
                </div>
              )}

            </div>
          )}

        </div>
      </main>

      <footer className="text-center py-4 px-6 text-xs text-on-surface-variant/70 border-t border-outline-variant/10">
        © {new Date().getFullYear()} {t('common.appName')} · {t('common.rightsReserved')}
      </footer>
    </div>
  );
}

