// pages/VerifyEmailPage.jsx — Vérification obligatoire par e-mail (lien 24h + code 6 chiffres, sans SMS/WhatsApp)
import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import BrandLogo from '../components/layout/BrandLogo';
import { authUnifiedApi } from '../services/api/authUnified';
import { getPostVerificationRedirect, clearPendingOAuthRole } from '../constants/registrationRoles';

export default function VerifyEmailPage({ session }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const tokenParam = searchParams.get('token');
  const emailFromUrl = searchParams.get('email') || '';
  const roleFromUrl = searchParams.get('role') || '';

  const [email, setEmail] = useState(
    location.state?.email || emailFromUrl || session?.user?.email || ''
  );
  const [code, setCode] = useState('');
  const [countdown, setCountdown] = useState(location.state?.emailSent === false ? 0 : 60);

  const [loading, setLoading] = useState(false);
  const [verifyingToken, setVerifyingToken] = useState(Boolean(tokenParam));
  const [errorMsg, setErrorMsg] = useState(location.state?.emailWarning || '');
  const [successMsg, setSuccessMsg] = useState('');

  const tokenAttemptedRef = useRef(false);

  // Compte à rebours de 60s pour "Renvoyer l'e-mail"
  useEffect(() => {
    if (countdown <= 0) return undefined;
    const timer = setInterval(() => {
      setCountdown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  // Finalisation après validation réussie du code ou du lien
  const handleVerificationSuccess = async (res) => {
    clearPendingOAuthRole();
    setSuccessMsg('Adresse e-mail vérifiée avec succès ! Redirection…');

    // Cas B2B (Coworking Space / Centre de formation) -> Page de confirmation d'attente de validation
    if (res.isB2BPending) {
      try {
        await supabase.auth.signOut();
      } catch (_) {}
      navigate('/register/pending-b2b', {
        state: { email: res.email || email, requestedRole: res.requestedRole },
        replace: true,
      });
      return;
    }

    // Établir ou rafraîchir la session Supabase pour accéder directement au dashboard cible
    let sessionReady = false;
    if (res.authTokenHash) {
      try {
        const { data: otpRes, error: otpErr } = await supabase.auth.verifyOtp({
          token_hash: res.authTokenHash,
          type: 'magiclink',
        });
        if (!otpErr && otpRes?.session) {
          sessionReady = true;
        }
      } catch (_) {}
    }

    if (!sessionReady && session?.user) {
      try {
        const { data: refreshed } = await supabase.auth.refreshSession();
        if (refreshed?.session) sessionReady = true;
      } catch (_) {}
    }

    const inviteToken = location.state?.inviteToken || (() => {
      try { return sessionStorage.getItem('deskywork_invite_token'); } catch (_) { return null; }
    })();

    if (inviteToken) {
      try { sessionStorage.removeItem('deskywork_invite_token'); } catch (_) {}
      if (sessionReady) {
        navigate(`/invitation/${inviteToken}`, { replace: true });
        return;
      }
    }

    const target = res.postVerifyRedirect || getPostVerificationRedirect(res.requestedRole || roleFromUrl);
    if (sessionReady) {
      await new Promise((r) => setTimeout(r, 150));
      navigate(target, { replace: true });
    } else {
      await supabase.auth.signOut().catch(() => {});
      navigate(`/login?verified=1&email=${encodeURIComponent(res.email || email)}`, { replace: true });
    }
  };

  // Vérification automatique si l'utilisateur a cliqué sur le lien (?token=...)
  useEffect(() => {
    if (!tokenParam || tokenAttemptedRef.current) return;
    tokenAttemptedRef.current = true;

    setVerifyingToken(true);
    setErrorMsg('');

    authUnifiedApi
      .verifyEmailToken(tokenParam)
      .then((res) => handleVerificationSuccess(res))
      .catch((err) => {
        setErrorMsg(err.message || 'Lien de confirmation invalide ou expiré. Vous pouvez saisir le code ou renvoyer un e-mail.');
        setVerifyingToken(false);
      });
  }, [tokenParam]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleVerifyCode = async (e) => {
    e.preventDefault();
    if (!email.trim()) {
      setErrorMsg('Veuillez renseigner votre adresse e-mail.');
      return;
    }
    if (code.trim().length < 6) {
      setErrorMsg('Veuillez saisir le code à 6 chiffres reçu par e-mail.');
      return;
    }

    setLoading(true);
    setErrorMsg('');
    try {
      const res = await authUnifiedApi.verifyEmailOtp({
        email: email.trim().toLowerCase(),
        code: code.trim(),
        userId: location.state?.userId || session?.user?.id,
      });
      await handleVerificationSuccess(res);
    } catch (err) {
      setErrorMsg(err.message || 'Code de vérification invalide ou expiré.');
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (countdown > 0 || loading || !email.trim()) return;
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await authUnifiedApi.resendVerificationEmail(email.trim().toLowerCase());
      setCountdown(res.cooldownSeconds || 60);
      setSuccessMsg(res.message || `Un nouvel e-mail de vérification a été envoyé à ${email}.`);
      if (res.emailWarning) setErrorMsg(res.emailWarning);
    } catch (err) {
      if (err.retryAfter) setCountdown(err.retryAfter);
      setErrorMsg(err.message || 'Impossible de renvoyer l\'e-mail pour le moment.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen page-gradient flex flex-col font-inter text-on-surface bg-[#f8fafc]">
      <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200/70 bg-white/70 backdrop-blur-sm">
        <BrandLogo to="/" height={38} />
        <div className="flex items-center gap-4">
          {session ? (
            <button
              type="button"
              onClick={handleSignOut}
              className="text-xs sm:text-sm font-semibold text-slate-600 hover:text-[#f95d00]"
            >
              Déconnexion
            </button>
          ) : (
            <Link to="/login" className="text-xs sm:text-sm font-semibold text-[#f95d00] hover:underline">
              Se connecter
            </Link>
          )}
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md glass-card rounded-3xl shadow-elevated p-6 sm:p-8 bg-white border border-slate-200/80 text-center space-y-6 animate-fade-up">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-orange-50 border border-orange-200 flex items-center justify-center text-[#f95d00]">
            <span className="material-symbols-outlined text-[32px]">
              {verifyingToken ? 'hourglass_top' : 'mark_email_unread'}
            </span>
          </div>

          {verifyingToken ? (
            <div className="space-y-3 py-4">
              <h1 className="font-sora text-2xl font-bold text-[#100f0d]">
                Vérification en cours…
              </h1>
              <p className="text-sm text-slate-600">
                Nous validons votre lien de confirmation e-mail.
              </p>
              <div className="pt-2">
                <span className="animate-spin inline-block material-symbols-outlined text-[#f95d00] text-[28px]">refresh</span>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <h1 className="font-sora text-2xl font-bold text-[#100f0d]">
                  Vérifiez votre adresse e-mail
                </h1>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Un e-mail de vérification a été envoyé à{' '}
                  <strong className="text-[#100f0d]">{email || 'votre adresse e-mail'}</strong>.
                  Veuillez cliquer sur le lien (ou saisir le code) pour activer votre compte.
                </p>
              </div>

              {errorMsg && (
                <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs text-left flex items-start gap-2">
                  <span className="material-symbols-outlined text-[16px] shrink-0 mt-0.5">error</span>
                  <span>{errorMsg}</span>
                </div>
              )}

              {successMsg && (
                <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs text-left flex items-start gap-2">
                  <span className="material-symbols-outlined text-[16px] shrink-0 mt-0.5">check_circle</span>
                  <span>{successMsg}</span>
                </div>
              )}

              <form onSubmit={handleVerifyCode} className="space-y-4 text-left">
                {!emailFromUrl && !location.state?.email && !session?.user?.email && (
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-on-surface" htmlFor="verify-email-input">
                      Adresse e-mail
                    </label>
                    <input
                      id="verify-email-input"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="votre@email.tn"
                      className="form-input"
                    />
                  </div>
                )}

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-on-surface block text-center" htmlFor="verify-otp-input">
                    Code de confirmation à 6 chiffres
                  </label>
                  <input
                    id="verify-otp-input"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    autoFocus
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="••••••"
                    className="form-input text-center text-2xl tracking-[0.5em] font-mono py-3 font-bold"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading || code.length < 6}
                  className="btn-primary w-full py-3.5 rounded-xl flex items-center justify-center gap-2 font-semibold text-sm shadow-md disabled:opacity-60"
                >
                  {loading ? (
                    <>
                      <span className="animate-spin material-symbols-outlined text-[18px]">refresh</span>
                      Vérification en cours…
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-[18px]">verified</span>
                      Activer mon compte
                    </>
                  )}
                </button>
              </form>

              <div className="pt-2 border-t border-slate-100 space-y-2.5">
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={countdown > 0 || loading || !email.trim()}
                  className={`w-full py-2.5 px-4 rounded-xl border text-xs font-semibold transition-colors ${
                    countdown > 0 || loading || !email.trim()
                      ? 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed'
                      : 'border-slate-300 bg-white text-slate-800 hover:border-[#f95d00] hover:text-[#f95d00]'
                  }`}
                >
                  {countdown > 0
                    ? `Renvoyer l'e-mail (${countdown} s)`
                    : 'Renvoyer l\'e-mail'}
                </button>

                <p className="text-[11px] text-slate-500">
                  Pensez à vérifier votre dossier Spam ou Courrier indésirable.
                </p>

                <div className="pt-1">
                  <Link to="/register" className="text-xs font-medium text-slate-600 hover:text-[#f95d00] hover:underline">
                    ← Retour à l&apos;inscription
                  </Link>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

