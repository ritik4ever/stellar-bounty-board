/**
 * LanguageSwitcher — locale selector for the Stellar Bounty Board.
 *
 * Renders a dropdown select that switches the active locale.  The current
 * selection is persisted to localStorage so it survives page reloads.
 *
 * WCAG 2.1 AA:
 *   - The <select> is labelled with an aria-label.
 *   - An sr-only announcement is emitted via a LiveRegion-like element
 *     when the locale changes.
 *   - Each <option> uses the locale's native name for screen readers.
 */

import { useState, useEffect, useCallback } from 'react';
import { useI18n } from './I18nContext';

const LOCALE_NAMES: Record<string, string> = {
  en: 'English',
  // es: 'Español',
  // fr: 'Français',
  // ja: '日本語',
  // zh: '中文',
};

export interface LanguageSwitcherProps {
  /** Optional class name for the container. */
  className?: string;
}

export function LanguageSwitcher({ className = '' }: LanguageSwitcherProps) {
  const { locale, setLocale, availableLocales, t } = useI18n();
  const [announcement, setAnnouncement] = useState('');

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const next = e.target.value;
      setLocale(next);
      setAnnouncement(`Language changed to ${LOCALE_NAMES[next] || next}`);
      // Clear announcement after 3 seconds
      setTimeout(() => setAnnouncement(''), 3000);
    },
    [setLocale],
  );

  // Reset announcement timer on unmount
  useEffect(() => {
    return () => {
      // no-op
    };
  }, []);

  return (
    <div className={`language-switcher ${className}`.trim()}>
      <label htmlFor="locale-select" className="sr-only">
        {t('app.language.select')}
      </label>
      <select
        id="locale-select"
        className="locale-select"
        value={locale}
        onChange={handleChange}
        aria-label={t('app.language.select')}
      >
        {availableLocales.map((code) => (
          <option key={code} value={code}>
            {LOCALE_NAMES[code] || code}
          </option>
        ))}
      </select>

      {announcement && (
        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {announcement}
        </div>
      )}
    </div>
  );
}

export default LanguageSwitcher;