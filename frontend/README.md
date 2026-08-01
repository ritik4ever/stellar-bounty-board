# Stellar Bounty Board — Frontend

## Internationalization (i18n)

The app uses a lightweight custom i18n solution built on React Context.

### Adding a new locale

1. Create a new JSON file in `src/i18n/locales/` (e.g. `es.json`)
2. Copy the contents of `en.json` and translate the values
3. Register the locale in `src/i18n/I18nContext.tsx`:
   - Add an entry to `LOCALE_MAP` (for eagerly loaded locales) or to `LAZY_LOCALES` (for lazily loaded locales)
   - Add the native name to `LOCALE_NAMES` in `src/i18n/LanguageSwitcher.tsx`
   - Add the locale code to the `LanguageSwitcher` component's `<option>` elements

### Using i18n in components

```tsx
import { useI18n } from '../i18n/I18nContext';

function MyComponent() {
  const { t } = useI18n();
  return <h1>{t('app.title')}</h1>;
}
```

### Message interpolation

```tsx
t('app.bounty.empty.search.heading', { query: 'foo' })
// → "No results for "foo""
```

### Message key convention

- `app.*` — App-level strings
- `bounty.*` — Bounty-related strings
- `bounty.detail.*` — Bounty detail page strings
- `bounty.status.*` — Status labels
- `bounty.action.*` — Action button labels
- `common.*` — Shared/common strings
- `wallet.*` — Wallet-related strings
- `app.filter.*` — Filter labels
- `app.language.*` — Language-related strings
- `app.shortcuts.*` — Keyboard shortcut hints
- `app.nav.*` — Navigation labels
- `app.theme.*` — Theme labels