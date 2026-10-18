import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider, useI18n, LanguageSwitcher } from './i18n/I18nContext';

function TestConsumer() {
  const { t, locale, setLocale } = useI18n();
  return (
    <div>
      <span data-testid="current-locale">{locale}</span>
      <span data-testid="app-title">{t('app.title')}</span>
      <span data-testid="share-text">{t('common.share')}</span>
      <span data-testid="fallback-test">{t('non.existent.key', 'Default Fallback')}</span>
      <span data-testid="raw-key-fallback">{t('unknown.key')}</span>
      <button onClick={() => setLocale('es')}>Switch to Spanish</button>
      <button onClick={() => setLocale('en')}>Switch to English</button>
      <LanguageSwitcher />
    </div>
  );
}

describe('i18n Localization Scaffold', () => {
  it('renders root children and provides default English translations', () => {
    render(
      <I18nProvider initialLocale="en">
        <TestConsumer />
      </I18nProvider>
    );

    expect(screen.getByTestId('current-locale').textContent).toBe('en');
    expect(screen.getByTestId('app-title').textContent).toBe('Stellar Bounty Board');
    expect(screen.getByTestId('share-text').textContent).toBe('Share');
  });

  it('updates extracted strings dynamically when switching locales to Spanish', async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider initialLocale="en">
        <TestConsumer />
      </I18nProvider>
    );

    expect(screen.getByTestId('share-text').textContent).toBe('Share');

    await user.click(screen.getByRole('button', { name: 'Switch to Spanish' }));

    expect(screen.getByTestId('current-locale').textContent).toBe('es');
    expect(screen.getByTestId('app-title').textContent).toBe('Tablero de Recompensas Stellar');
    expect(screen.getByTestId('share-text').textContent).toBe('Compartir');
  });

  it('falls back to default fallback or key string when translation key is missing', () => {
    render(
      <I18nProvider initialLocale="en">
        <TestConsumer />
      </I18nProvider>
    );

    expect(screen.getByTestId('fallback-test').textContent).toBe('Default Fallback');
    expect(screen.getByTestId('raw-key-fallback').textContent).toBe('unknown.key');
  });

  it('allows changing locale via the accessible LanguageSwitcher control', async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider initialLocale="en">
        <TestConsumer />
      </I18nProvider>
    );

    const select = screen.getByLabelText(/language/i);
    expect(select).toBeDefined();

    await user.selectOptions(select, 'es');

    expect(screen.getByTestId('current-locale').textContent).toBe('es');
    expect(screen.getByTestId('app-title').textContent).toBe('Tablero de Recompensas Stellar');
  });
});
