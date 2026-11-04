// context/LanguageContext.jsx — Support bilingue FR/EN
import React, { createContext, useContext, useState, useEffect } from 'react';
import { translations } from '../i18n/translations';

const LanguageContext = createContext({
  lang: 'fr',
  setLang: () => {},
  t: () => '',
});

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    return localStorage.getItem('deskywork_lang') || 'fr';
  });

  const setLang = (newLang) => {
    const valid = newLang === 'en' ? 'en' : 'fr';
    setLangState(valid);
    localStorage.setItem('deskywork_lang', valid);
  };

  /**
   * Helper t('category.key', { param: 'value' })
   */
  const t = (path, params = {}) => {
    const keys = path.split('.');
    let current = translations[lang];

    for (const key of keys) {
      if (!current || current[key] === undefined) {
        // Fallback FR si manquant en EN
        let fallback = translations.fr;
        for (const fKey of keys) {
          if (!fallback || fallback[fKey] === undefined) return path;
          fallback = fallback[fKey];
        }
        current = fallback;
        break;
      }
      current = current[key];
    }

    if (typeof current !== 'string') return path;

    // Remplacement des variables {param}
    let res = current;
    for (const [k, v] of Object.entries(params)) {
      res = res.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
    return res;
  };

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}

/**
 * Composant sélecteur FR / EN stylisé
 */
export function LanguageSwitcher({ className = '' }) {
  const { lang, setLang } = useLanguage();

  return (
    <div
      className={`inline-flex items-center p-0.5 rounded-full border border-outline-variant/30 bg-surface-container-low shadow-sm ${className}`}
      role="group"
      aria-label="Sélecteur de langue"
    >
      <button
        type="button"
        onClick={() => setLang('fr')}
        className={`px-2.5 py-1 text-xs font-semibold rounded-full transition-all ${
          lang === 'fr'
            ? 'bg-[#100f0d] text-white shadow-sm'
            : 'text-on-surface-variant hover:text-on-surface'
        }`}
      >
        FR
      </button>
      <button
        type="button"
        onClick={() => setLang('en')}
        className={`px-2.5 py-1 text-xs font-semibold rounded-full transition-all ${
          lang === 'en'
            ? 'bg-[#100f0d] text-white shadow-sm'
            : 'text-on-surface-variant hover:text-on-surface'
        }`}
      >
        EN
      </button>
    </div>
  );
}

