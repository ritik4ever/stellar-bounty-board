# Frontend - Stellar Bounty Board

The frontend for Stellar Bounty Board is built with React 18, TypeScript, and Vite.

## Internationalization (i18n) & Localization

The application includes an internationalization scaffold located under `src/i18n`. It supports locale switching, localized catalogs, and fallback to default English translations without breaking rendering.

### Adding a New Locale

To add a new language/locale to the application, follow these steps:

1. **Create the message catalog**:
   Create a new JSON catalog file at `src/i18n/locales/<locale-code>.json` (for example, `src/i18n/locales/fr.json` for French).
   Copy the key structure from `src/i18n/locales/en.json` and provide the translated strings:

   ```json
   {
     "app.title": "Tableau des primes Stellar",
     "app.hero.title": "Financez les issues GitHub avec séquestre sur la blockchain",
     "app.hero.subtitle": "Une plateforme de primes décentralisée propulsée par Stellar.",
     "common.back": "Retour",
     "common.share": "Partager",
     "common.copied": "Copié !",
     "common.print": "Imprimer / Exporter PDF",
     "common.retry": "Réessayer",
     "common.loading": "Chargement...",
     "bounty.kicker": "Prime",
     "bounty.defaultTitle": "Prime",
     "bounty.loading": "Chargement de la prime...",
     "bounty.notFound": "Prime non trouvée.",
     "bounty.details": "Détails de la prime",
     "language.select": "Langue",
     "language.en": "English",
     "language.es": "Español"
   }
   ```

2. **Register the locale in `src/i18n/I18nContext.tsx`**:
   - Update the `SupportedLocale` type:
     ```ts
     export type SupportedLocale = 'en' | 'es' | 'fr';
     ```
   - Import the new JSON catalog and add it to `CATALOGS`:
     ```ts
     import frCatalog from './locales/fr.json';

     export const CATALOGS: Record<SupportedLocale, MessageCatalog> = {
       en: enCatalog as MessageCatalog,
       es: esCatalog as MessageCatalog,
       fr: frCatalog as MessageCatalog,
     };
     ```
   - Add the new option to `SUPPORTED_LOCALES`:
     ```ts
     export const SUPPORTED_LOCALES: SupportedLocaleOption[] = [
       { code: 'en', label: 'English' },
       { code: 'es', label: 'Español' },
       { code: 'fr', label: 'Français' },
     ];
     ```

3. **Verify fallback behavior**:
   Any missing keys in the new catalog will automatically fall back to the default English strings (`en.json`), preventing render crashes.

### Usage in Components

Use the `useI18n` hook to access localized strings or control active locale:

```tsx
import { useI18n } from './i18n/I18nContext';

function MyComponent() {
  const { t, locale, setLocale } = useI18n();
  return <p>{t('common.share', 'Share')}</p>;
}
```
