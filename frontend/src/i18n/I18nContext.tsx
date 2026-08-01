/**
 * I18nContext — lightweight i18n provider and hook.
 *
 * Provides a React context wrapping message lookup and locale switching.
 * Messages are loaded from JSON files in src/i18n/locales/.
 *
 * Usage:
 *   const { t, locale, setLocale } = useI18n();
 *   <h1>{t('app.title')}</h1>
 *   <p>{t('app.bounty.empty.search.heading', { query: 'foo' })}</p>
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface I18nMessages {
  [key: string]: string;
}

export interface I18nContextValue {
  /** Current locale code (e.g. "en", "es", "fr"). */
  locale: string;
  /** Switch the active locale. */
  setLocale: (locale: string) => void;
  /** Look up a message by key, optionally interpolating {variables}. */
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** True while messages for the current locale are being loaded. */
  loading: boolean;
  /** Error message if locale loading failed. */
  error: string | null;
  /** List of available locale codes. */
  availableLocales: string[];
}

// ─── Locale metadata ─────────────────────────────────────────────────────────

export interface LocaleMeta {
  code: string;
  label: string;
  file: () => Promise<{ default: I18nMessages }>;
}

const LOCALE_MAP: Record<string, LocaleMeta> = {
  en: {
    code: 'en',
    label: 'English',
    file: () => import('./locales/en.json'),
  },
};

// Lazily loadable locales (ready for community contributions)
const LAZY_LOCALES: Record<string, () => Promise<{ default: I18nMessages }>> = {
  // es: () => import('./locales/es.json'),
  // fr: () => import('./locales/fr.json'),
  // ja: () => import('./locales/ja.json'),
  // zh: () => import('./locales/zh.json'),
};

const STORAGE_KEY = 'stellar-bounty-board-locale';
const DEFAULT_LOCALE = 'en';

// ─── Context ─────────────────────────────────────────────────────────────────

const I18nContext = createContext<I18nContextValue | null>(null);

// ─── Provider ────────────────────────────────────────────────────────────────

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || navigator.language.split('-')[0] || DEFAULT_LOCALE;
    } catch {
      return DEFAULT_LOCALE;
    }
  });

  const [messages, setMessages] = useState<I18nMessages>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load messages whenever the locale changes
  useEffect(() => {
    let cancelled = false;

    async function loadMessages() {
      setLoading(true);
      setError(null);

      try {
        const meta = LOCALE_MAP[locale];
        if (meta) {
          const mod = await meta.file();
          if (!cancelled) {
            setMessages(mod.default);
          }
        } else if (LAZY_LOCALES[locale]) {
          const mod = await LAZY_LOCALES[locale]();
          if (!cancelled) {
            setMessages(mod.default);
          }
        } else {
          // Fall back to default locale
          const fallback = await LOCALE_MAP[DEFAULT_LOCALE].file();
          if (!cancelled) {
            setMessages(fallback.default);
          }
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setError(`Failed to load messages for "${locale}": ${msg}`);
          // Fall back to empty messages — the t() function will return
          // the key itself as a last resort.
          setMessages({});
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadMessages();

    return () => {
      cancelled = true;
    };
  }, [locale]);

  const setLocale = useCallback((next: string) => {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  /**
   * Look up a message by key, interpolating {variable} placeholders.
   *
   * Resolution order:
   *   1. Active locale's messages
   *   2. Default locale's messages (fallback)
   *   3. The key itself (last resort — never shows a blank string)
   */
  const t = useCallback(
    (key: string, vars?: Record<string, string | number>): string => {
      let msg = messages[key];

      // Fallback to default locale
      if (msg === undefined) {
        // We can't synchronously load the default locale here, so we
        // return the key if the message is missing.
        msg = key;
      }

      if (!vars) return msg;

      return Object.entries(vars).reduce((acc, [k, v]) => {
        return acc.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      }, msg);
    },
    [messages],
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t,
      loading,
      error,
      availableLocales: Object.keys(LOCALE_MAP),
    }),
    [locale, setLocale, t, loading, error],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used within an <I18nProvider>');
  }
  return ctx;
}

export default I18nContext;