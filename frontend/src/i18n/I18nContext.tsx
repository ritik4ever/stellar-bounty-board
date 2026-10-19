import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import enCatalog from './locales/en.json';
import esCatalog from './locales/es.json';

export type SupportedLocale = 'en' | 'es';

export interface SupportedLocaleOption {
  code: SupportedLocale;
  label: string;
}

export const SUPPORTED_LOCALES: SupportedLocaleOption[] = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
];

export type MessageCatalog = Record<string, string>;

export const CATALOGS: Record<SupportedLocale, MessageCatalog> = {
  en: enCatalog as MessageCatalog,
  es: esCatalog as MessageCatalog,
};

export interface I18nContextValue {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
  t: (key: string, fallback?: string) => string;
  supportedLocales: SupportedLocaleOption[];
}

const STORAGE_KEY = 'stellar-bounty-locale';

const defaultContextValue: I18nContextValue = {
  locale: 'en',
  setLocale: () => {},
  t: (key: string, fallback?: string) => {
    return CATALOGS.en[key] ?? fallback ?? key;
  },
  supportedLocales: SUPPORTED_LOCALES,
};

export const I18nContext = createContext<I18nContextValue>(defaultContextValue);

export interface I18nProviderProps {
  children: ReactNode;
  initialLocale?: SupportedLocale;
}

export function I18nProvider({ children, initialLocale }: I18nProviderProps) {
  const [locale, setLocaleState] = useState<SupportedLocale>(() => {
    if (initialLocale && (initialLocale === 'en' || initialLocale === 'es')) {
      return initialLocale;
    }
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as SupportedLocale | null;
      if (saved && (saved === 'en' || saved === 'es')) {
        return saved;
      }
    } catch {
      // ignore storage access errors in sandboxed environments
    }
    return 'en';
  });

  const setLocale = (nextLocale: SupportedLocale) => {
    setLocaleState(nextLocale);
    try {
      localStorage.setItem(STORAGE_KEY, nextLocale);
    } catch {
      // ignore storage access errors
    }
  };

  useEffect(() => {
    try {
      document.documentElement.lang = locale;
    } catch {
      // ignore DOM errors
    }
  }, [locale]);

  const value = useMemo<I18nContextValue>(() => {
    return {
      locale,
      setLocale,
      t: (key: string, fallback?: string): string => {
        const activeCatalog = CATALOGS[locale] || CATALOGS.en;
        if (key in activeCatalog && activeCatalog[key] !== undefined) {
          return activeCatalog[key];
        }
        // Fallback to default locale (English)
        if (key in CATALOGS.en && CATALOGS.en[key] !== undefined) {
          return CATALOGS.en[key];
        }
        return fallback ?? key;
      },
      supportedLocales: SUPPORTED_LOCALES,
    };
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  return context || defaultContextValue;
}

export interface LanguageSwitcherProps {
  className?: string;
}

export function LanguageSwitcher({ className = 'language-switcher' }: LanguageSwitcherProps) {
  const { locale, setLocale, supportedLocales, t } = useI18n();

  return (
    <div className={className}>
      <label htmlFor="language-switcher-select" className="sr-only">
        {t('language.select', 'Language')}
      </label>
      <select
        id="language-switcher-select"
        aria-label={t('language.select', 'Language')}
        value={locale}
        onChange={(e) => setLocale(e.target.value as SupportedLocale)}
        className="secondary-button language-select"
        style={{
          appearance: 'auto',
          cursor: 'pointer',
          padding: '0.4rem 0.6rem',
          fontSize: '0.875rem',
          borderRadius: '6px',
        }}
      >
        {supportedLocales.map((item) => (
          <option key={item.code} value={item.code}>
            {item.label}
          </option>
        ))}
      </select>
    </div>
  );
}
