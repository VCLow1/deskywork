import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useTheme } from '../../context/ThemeContext';
import { useLanguage } from '../../context/LanguageContext';
import logoDark from '../../assets/images/logo-deskywork-dark.png';
import logoLight from '../../assets/images/logo-deskywork-light.png';

/**
 * Navbar principale — DeskyWork (CDC v3.0)
 * Ordre exact de gauche à droite :
 * 1. Logo DESKYWORK (lien vers /)
 * 2. 4 liens principaux visibles : Trouver un espace, À propos, Mis en avant, Tarifs & Abonnements
 * 3. Menu déroulant Plus : Partenaires, Formations, Témoignages, Contact
 * 4. Contrôles : Mode Sombre / Clair + Traduction FR / EN
 * 5. Boutons auth : Connexion + Créer un compte
 */
export default function Navbar({ session, activeLink = '', transparent = false }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { dark, toggle } = useTheme();
  const { lang, setLang, t } = useLanguage();

  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const onResize = () => { if (window.innerWidth >= 992) setMenuOpen(false); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Fermer le dropdown lors d'un clic extérieur
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/');
  };

  // 4 Liens principaux visibles directement (Ordre exact du CDC)
  const primaryNavLinks = [
    { to: '/#search', label: t('navbar.findSpace') },
    { to: '/#about', label: t('navbar.about') },
    { to: '/#featured', label: t('navbar.featured') },
    { to: '/#tarifs', label: t('navbar.pricing') },
  ];

  // Liens du menu déroulant "Plus"
  const dropdownNavLinks = [
    { to: '/#partenaires', label: t('navbar.partners'), icon: 'handshake' },
    { to: '/#formations', label: t('navbar.formations'), icon: 'school' },
    { to: '/#temoignages', label: t('navbar.testimonials'), icon: 'reviews' },
    { to: '/#contact', label: t('navbar.contact'), icon: 'mail' },
  ];

  const handleNavClick = (e, to) => {
    setMenuOpen(false);
    setDropdownOpen(false);
    if (to.startsWith('/#')) {
      const hashId = to.slice(2);
      if (location.pathname === '/') {
        e.preventDefault();
        const el = document.getElementById(hashId) || (hashId === 'partenaires' ? document.getElementById('entreprises') : null);
        if (el) {
          const yOffset = -85;
          const y = el.getBoundingClientRect().top + window.pageYOffset + yOffset;
          window.scrollTo({ top: y, behavior: 'smooth' });
        }
      }
    }
  };

  const isScrolledOrSolid = scrolled || !transparent;
  const logoSrc = dark ? logoLight : logoDark;

  return (
    <>
      <style>{`
        .ec-navbar {
          position: fixed;
          top: 0; left: 0; right: 0;
          z-index: 1000;
          transition: background .3s ease, box-shadow .3s ease, backdrop-filter .3s;
        }
        .ec-navbar.solid {
          background: rgba(255,255,255,0.96);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          box-shadow: 0 2px 20px rgba(0,13,35,.08);
          border-bottom: 1px solid rgba(0,13,35,.06);
        }
        .dark .ec-navbar.solid {
          background: rgba(16,15,13,0.94);
          box-shadow: 0 2px 24px rgba(0,0,0,0.45);
          border-bottom: 1px solid rgba(255,255,255,0.08);
        }
        .ec-navbar.transparent-nav {
          background: transparent;
        }

        /* ── Logo responsive ── */
        .ec-navbar .brand-logo-img {
          height: 64px;
          width: auto;
          max-width: none;
          object-fit: contain;
          transition: transform .2s ease, opacity .2s ease;
          display: block;
          flex-shrink: 0;
        }
        .ec-navbar .brand-logo-img:hover { transform: scale(1.05); }

        @media (max-width: 991px) {
          .ec-navbar .brand-logo-img {
            height: 52px;
          }
          .ec-navbar .brand-logo-img:hover { transform: scale(1.03); }
        }
        @media (max-width: 479px) {
          .ec-navbar .brand-logo-img {
            height: 44px;
          }
          .ec-navbar .brand-logo-img:hover { transform: scale(1.03); }
        }

        /* ── Nav bar inner wrapper ── */
        .ec-navbar .nav-inner {
          max-width: 1320px;
          margin: 0 auto;
          padding: 0 20px;
        }
        .ec-navbar .nav-bar {
          display: flex;
          align-items: center;
          height: 76px;
          gap: 16px;
        }
        @media (max-width: 991px) {
          .ec-navbar .nav-bar { height: 68px; }
        }

        /* ── Desktop link list ── */
        .ec-navbar .desktop-nav {
          display: flex;
          align-items: center;
          gap: 18px;
          margin-left: 12px;
        }
        @media (max-width: 1200px) {
          .ec-navbar .desktop-nav { gap: 12px; }
          .ec-navbar .nav-link-item { font-size: .84rem !important; }
        }
        @media (max-width: 991px) {
          .ec-navbar .desktop-nav,
          .ec-navbar .desktop-actions { display: none !important; }
        }

        /* ── Mobile right-side controls ── */
        .ec-navbar .mobile-controls {
          display: none;
          align-items: center;
          gap: 8px;
          margin-left: auto;
          flex-shrink: 0;
        }
        @media (max-width: 991px) {
          .ec-navbar .mobile-controls { display: flex; }
        }

        /* ── Link styles ── */
        .ec-navbar .nav-link-item {
          font-size: .88rem;
          font-weight: 600;
          color: #44474d;
          text-decoration: none;
          padding: 6px 4px;
          position: relative;
          transition: color .2s;
          white-space: nowrap;
          cursor: pointer;
          background: transparent;
          border: none;
        }
        .dark .ec-navbar .nav-link-item { color: #cfcac3; }
        .ec-navbar .nav-link-item::after {
          content: '';
          position: absolute;
          bottom: -2px; left: 0;
          width: 0; height: 2px;
          background: #f95d00;
          border-radius: 2px;
          transition: width .25s ease;
        }
        .ec-navbar .nav-link-item:hover,
        .ec-navbar .nav-link-item.active { color: #f95d00; }
        .dark .ec-navbar .nav-link-item:hover,
        .dark .ec-navbar .nav-link-item.active { color: #ff8a3d; }
        .ec-navbar .nav-link-item:hover::after,
        .ec-navbar .nav-link-item.active::after { width: 100%; }

        /* ── Dropdown Plus ── */
        .ec-navbar .dropdown-wrapper {
          position: relative;
          display: inline-flex;
          align-items: center;
        }
        .ec-navbar .dropdown-menu-pane {
          position: absolute;
          top: calc(100% + 14px);
          left: 0;
          min-width: 210px;
          background: #ffffff;
          border: 1px solid rgba(0,13,35,0.08);
          border-radius: 18px;
          box-shadow: 0 16px 40px rgba(0,0,0,0.18);
          padding: 8px;
          z-index: 1050;
          display: flex;
          flex-direction: column;
          gap: 2px;
          animation: navFadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .dark .ec-navbar .dropdown-menu-pane {
          background: #1e1b18;
          border-color: rgba(255,255,255,0.14);
          box-shadow: 0 16px 40px rgba(0,0,0,0.5);
        }
        .ec-navbar .dropdown-menu-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 14px;
          border-radius: 12px;
          font-size: .86rem;
          font-weight: 600;
          color: #1f2937;
          text-decoration: none;
          transition: all .15s ease;
        }
        .dark .ec-navbar .dropdown-menu-item { color: #e6ded7; }
        .ec-navbar .dropdown-menu-item:hover {
          background: rgba(249,93,0,0.1);
          color: #f95d00;
          padding-left: 18px;
        }
        @keyframes navFadeIn {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }

        /* ── Desktop action group ── */
        .ec-navbar .desktop-actions {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-left: auto;
          flex-shrink: 0;
        }

        /* ── Language Switcher Pill ── */
        .ec-navbar .lang-switcher-pill {
          display: inline-flex;
          align-items: center;
          gap: 1px;
          background: rgba(0,13,35,0.05);
          border: 1px solid rgba(0,13,35,0.1);
          border-radius: 999px;
          padding: 2px;
          transition: all .2s ease;
        }
        .dark .ec-navbar .lang-switcher-pill {
          background: rgba(255,255,255,0.08);
          border-color: rgba(255,255,255,0.14);
        }
        .ec-navbar .lang-btn {
          background: transparent;
          border: none;
          font-size: .74rem;
          font-weight: 700;
          padding: 4px 8px;
          border-radius: 999px;
          cursor: pointer;
          color: #6b7280;
          transition: all .2s ease;
          line-height: 1;
        }
        .dark .ec-navbar .lang-btn { color: #9c9589; }
        .ec-navbar .lang-btn:hover { color: #f95d00; }
        .ec-navbar .lang-btn.active {
          background: #f95d00;
          color: #ffffff !important;
          box-shadow: 0 2px 6px rgba(249,93,0,0.35);
        }
        .ec-navbar .lang-sep {
          color: rgba(0,13,35,0.2);
          font-size: .65rem;
          user-select: none;
        }
        .dark .ec-navbar .lang-sep { color: rgba(255,255,255,0.2); }

        /* ── Theme toggle ── */
        .ec-navbar .btn-theme-toggle {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 36px; height: 36px;
          border-radius: 10px;
          border: none;
          cursor: pointer;
          transition: all 0.2s ease;
          background: rgba(16,15,13,0.06);
          color: #100f0d;
          flex-shrink: 0;
        }
        .dark .ec-navbar .btn-theme-toggle {
          background: rgba(255,255,255,0.08);
          color: #ffd966;
        }
        .ec-navbar .btn-theme-toggle:hover {
          background: rgba(249,93,0,0.15);
          color: #f95d00;
        }

        /* ── Auth Buttons ── */
        .ec-navbar .btn-login {
          background: transparent;
          color: #100f0d;
          border: 1.5px solid #100f0d;
          border-radius: 12px;
          padding: 8px 16px;
          font-size: .85rem;
          font-weight: 600;
          cursor: pointer;
          transition: all .22s;
          text-decoration: none;
          white-space: nowrap;
        }
        .dark .ec-navbar .btn-login { color: #fbffff; border-color: rgba(255,255,255,0.3); }
        .ec-navbar .btn-login:hover {
          background: #f95d00;
          color: #ffffff !important;
          border-color: #f95d00;
        }
        .ec-navbar .btn-cta {
          background: #f95d00;
          color: #fbffff !important;
          border: none;
          border-radius: 12px;
          padding: 9px 18px;
          font-size: .85rem;
          font-weight: 700;
          cursor: pointer;
          transition: all .22s;
          text-decoration: none;
          white-space: nowrap;
          box-shadow: 0 4px 14px rgba(249,93,0,0.35);
        }
        .ec-navbar .btn-cta:hover {
          background: #ff7624;
          transform: translateY(-1px);
          box-shadow: 0 6px 20px rgba(249,93,0,0.45);
        }
        .ec-navbar .btn-portal {
          background: rgba(0,13,35,0.06);
          color: #000d23;
          border: none;
          border-radius: 12px;
          padding: 8px 14px;
          font-size: .85rem;
          font-weight: 600;
          cursor: pointer;
          text-decoration: none;
          white-space: nowrap;
          display: inline-flex;
          align-items: center;
        }
        .dark .ec-navbar .btn-portal { background: rgba(255,255,255,0.08); color: #fbffff; }
        .ec-navbar .btn-portal:hover { background: #f95d00; color: #ffffff; }

        .ec-navbar .btn-logout {
          background: transparent;
          color: #44474d;
          border: 1px solid rgba(0,13,35,.15);
          border-radius: 10px;
          padding: 7px 12px;
          font-size: .82rem;
          font-weight: 600;
          cursor: pointer;
          transition: all .2s;
        }
        .dark .ec-navbar .btn-logout { color: #cfcac3; border-color: rgba(255,255,255,.15); }
        .ec-navbar .btn-logout:hover { background: #ba1a1a; color: white; border-color: #ba1a1a; }

        .ec-navbar .menu-toggle {
          background: transparent;
          border: none;
          padding: 4px;
          color: #100f0d;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .dark .ec-navbar .menu-toggle { color: #fbffff; }

        /* ── Mobile menu drawer ── */
        .ec-mobile-menu {
          display: none;
          flex-direction: column;
          gap: 2px;
          padding: 12px 0 20px;
          border-top: 1px solid rgba(0,13,35,.07);
          background: rgba(255,255,255,0.98);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
        }
        .dark .ec-mobile-menu {
          background: rgba(16,15,13,0.98);
          border-top: 1px solid rgba(255,255,255,0.1);
        }
        .ec-mobile-menu.open { display: flex; }

        .ec-mobile-menu .mob-link {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 11px 0;
          font-size: .95rem;
          font-weight: 600;
          color: #374151;
          text-decoration: none;
          border-bottom: 1px solid rgba(0,13,35,.05);
          transition: color .2s, padding-left .2s;
        }
        .dark .ec-mobile-menu .mob-link { color: #cfcac3; border-bottom: 1px solid rgba(255,255,255,0.06); }
        .ec-mobile-menu .mob-link:hover { color: #f95d00; padding-left: 4px; }

        .ec-mobile-menu .mob-section-title {
          font-size: .72rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: .1em;
          color: #f95d00;
          margin-top: 14px;
          margin-bottom: 4px;
        }

        .ec-mobile-menu .mob-actions {
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding-top: 16px;
        }
        .ec-mobile-menu .mob-actions a,
        .ec-mobile-menu .mob-actions button.btn-action {
          width: 100%;
          text-align: center;
          padding: 12px 0;
        }
      `}</style>

      <nav className={`ec-navbar ${isScrolledOrSolid ? 'solid' : 'transparent-nav'}`}>
        <div className="nav-inner">
          <div className="nav-bar">
            {/* 1. Logo DESKYWORK */}
            <Link
              to="/"
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', flexShrink: 0 }}
              title="DeskyWork · Accueil"
            >
              <img src={logoSrc} alt="DeskyWork" className="brand-logo-img" />
            </Link>

            {/* 2. 4 Liens principaux visibles + 3. Dropdown Plus */}
            <div className="desktop-nav">
              {primaryNavLinks.map(({ to, label }) => (
                <Link
                  key={to}
                  to={to}
                  onClick={(e) => handleNavClick(e, to)}
                  className={`nav-link-item ${activeLink === to || (to === '/#search' && activeLink === '/#marketplace') ? 'active' : ''}`}
                >
                  {label}
                </Link>
              ))}

              {/* 3. Bouton Menu déroulant "Plus" */}
              <div className="dropdown-wrapper" ref={dropdownRef}>
                <button
                  type="button"
                  onClick={() => setDropdownOpen((o) => !o)}
                  className={`nav-link-item d-inline-flex align-items-center gap-1 ${dropdownOpen ? 'active' : ''}`}
                  aria-expanded={dropdownOpen}
                >
                  <span>{t('navbar.more')}</span>
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 18, transition: 'transform .2s ease', transform: dropdownOpen ? 'rotate(180deg)' : 'none' }}
                  >
                    expand_more
                  </span>
                </button>

                {dropdownOpen && (
                  <div className="dropdown-menu-pane">
                    {dropdownNavLinks.map(({ to, label, icon }) => (
                      <Link
                        key={to}
                        to={to}
                        onClick={(e) => handleNavClick(e, to)}
                        className="dropdown-menu-item"
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#f95d00' }}>
                          {icon}
                        </span>
                        <span>{label}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* 4. Contrôles d'interface (Thème + Traduction FR / EN) & 5. Boutons Auth */}
            <div className="desktop-actions">
              {/* Bouton Mode Sombre / Clair */}
              <button
                type="button"
                onClick={toggle}
                className="btn-theme-toggle"
                title={dark ? t('navbar.lightMode') : t('navbar.darkMode')}
                aria-label={dark ? t('navbar.lightMode') : t('navbar.darkMode')}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 20, fontVariationSettings: "'FILL' 1" }}>
                  {dark ? 'light_mode' : 'dark_mode'}
                </span>
              </button>

              {/* Sélecteur de langue FR / EN */}
              <div className="lang-switcher-pill" role="group" aria-label={t('navbar.switchLang')}>
                <button
                  type="button"
                  onClick={() => setLang('fr')}
                  className={`lang-btn ${lang === 'fr' ? 'active' : ''}`}
                  title="Français"
                >
                  FR
                </button>
                <span className="lang-sep">|</span>
                <button
                  type="button"
                  onClick={() => setLang('en')}
                  className={`lang-btn ${lang === 'en' ? 'active' : ''}`}
                  title="English"
                >
                  EN
                </button>
              </div>

              {/* 5. Boutons d'authentification */}
              {session ? (
                <>
                  <Link to="/dashboard" className="btn-portal">
                    <span className="material-symbols-outlined" style={{ fontSize: 16, marginRight: 5, verticalAlign: 'middle' }}>
                      dashboard
                    </span>
                    {t('navbar.myPortal')}
                  </Link>
                  <button onClick={handleLogout} className="btn-logout">
                    {t('navbar.logout')}
                  </button>
                </>
              ) : (
                <>
                  <Link to="/login" className="btn-login">
                    {t('navbar.login')}
                  </Link>
                  <Link to="/register" className="btn-cta">
                    {t('navbar.register')}
                  </Link>
                </>
              )}
            </div>

            {/* Contrôles Mobile (Burger & Theme & Langue) */}
            <div className="mobile-controls">
              <button
                type="button"
                onClick={toggle}
                className="btn-theme-toggle"
                title={dark ? t('navbar.lightMode') : t('navbar.darkMode')}
                aria-label="Basculer le thème"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 19, fontVariationSettings: "'FILL' 1" }}>
                  {dark ? 'light_mode' : 'dark_mode'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')}
                className="lang-btn active"
                style={{ padding: '6px 10px', fontSize: '.76rem', borderRadius: 10, background: '#f95d00', color: '#fff' }}
                title={t('navbar.switchLang')}
              >
                {lang.toUpperCase()}
              </button>

              <button
                className="menu-toggle"
                onClick={() => setMenuOpen((o) => !o)}
                aria-label={menuOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
                aria-expanded={menuOpen}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 26 }}>
                  {menuOpen ? 'close' : 'menu'}
                </span>
              </button>
            </div>
          </div>

          {/* Tiroir Mobile */}
          <div className={`ec-mobile-menu ${menuOpen ? 'open' : ''}`} role="navigation" aria-label="Menu mobile">
            {primaryNavLinks.map(({ to, label }) => (
              <Link
                key={to}
                to={to}
                className="mob-link"
                onClick={(e) => handleNavClick(e, to)}
              >
                <span>{label}</span>
                <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#f95d00' }}>arrow_forward</span>
              </Link>
            ))}

            <div className="mob-section-title">{t('navbar.more')}</div>
            {dropdownNavLinks.map(({ to, label, icon }) => (
              <Link
                key={to}
                to={to}
                className="mob-link"
                onClick={(e) => handleNavClick(e, to)}
              >
                <span className="d-inline-flex align-items-center gap-2">
                  <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#f95d00' }}>{icon}</span>
                  {label}
                </span>
                <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#f95d00' }}>arrow_forward</span>
              </Link>
            ))}

            <div className="mob-actions">
              {session ? (
                <>
                  <Link to="/dashboard" className="btn-portal" style={{ display: 'block', textAlign: 'center' }} onClick={() => setMenuOpen(false)}>
                    {t('navbar.myPortal')}
                  </Link>
                  <button onClick={() => { setMenuOpen(false); handleLogout(); }} className="btn-logout btn-action">
                    {t('navbar.logout')}
                  </button>
                </>
              ) : (
                <>
                  <Link to="/login" className="btn-login" style={{ display: 'block', textAlign: 'center' }} onClick={() => setMenuOpen(false)}>
                    {t('navbar.login')}
                  </Link>
                  <Link to="/register" className="btn-cta" style={{ display: 'block', textAlign: 'center' }} onClick={() => setMenuOpen(false)}>
                    {t('navbar.register')}
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </nav>
    </>
  );
}
