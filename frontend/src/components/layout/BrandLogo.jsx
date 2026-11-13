import { Link } from 'react-router-dom';
import { useTheme } from '../../context/ThemeContext';
import logoDark from '../../assets/images/logo-deskywork-dark.png';
import logoLight from '../../assets/images/logo-deskywork-light.png';

/**
 * BrandLogo — DeskyWork
 * Logo image officiel (mode clair / sombre) + fallback texte
 * Props:
 *   to       — lien (défaut: '/')
 *   compact  — affiche uniquement l'icône logo
 *   light    — force variante claire (sur fonds sombres)
 *   height   — hauteur du logo en px (défaut: 36)
 */
export default function BrandLogo({ to = '/', className = '', compact = false, light, height = 56 }) {
  const { dark } = useTheme();
  const isDark = light !== undefined ? light : dark;

  /* Logo PNG importé directement via Vite */
  const logoSrc = isDark ? logoLight : logoDark;

  return (
    <Link
      to={to}
      className={`inline-flex items-center gap-2 group shrink-0 ${className}`}
      style={{ textDecoration: 'none' }}
    >
      <img
        src={logoSrc}
        alt="DeskyWork"
        style={{
          height: compact ? Math.round(height * 0.88) : height,
          width: 'auto',
          maxWidth: 'none',
          objectFit: 'contain',
          transition: 'transform 0.2s ease, opacity 0.2s ease',
          display: 'block',
        }}
        className="group-hover:opacity-90"
      />

      {/* Nom textuel visible uniquement si compact=false ET logo non chargé (fallback) */}
      {!compact && (
        <noscript>
          <span
            style={{
              fontFamily: 'Sora, sans-serif',
              fontWeight: 700,
              fontSize: '1.05rem',
              color: isDark ? '#fbffff' : '#100f0d',
              letterSpacing: '-0.01em',
            }}
          >
            DeskyWork
          </span>
        </noscript>
      )}
    </Link>
  );
}
