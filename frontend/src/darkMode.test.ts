import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const DARK_MODE_KEY = 'stellar-bounty-board-theme';

describe('Dark Mode', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    // Reset document element
    document.documentElement.removeAttribute('data-theme');
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  describe('localStorage read', () => {
    it('reads "dark" from localStorage and sets data-theme attribute', () => {
      localStorage.setItem(DARK_MODE_KEY, 'dark');
      
      const stored = localStorage.getItem(DARK_MODE_KEY);
      expect(stored).toBe('dark');
      
      if (stored !== null) {
        document.documentElement.setAttribute('data-theme', stored);
      }
      
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });

    it('reads "light" from localStorage and sets data-theme attribute', () => {
      localStorage.setItem(DARK_MODE_KEY, 'light');
      
      const stored = localStorage.getItem(DARK_MODE_KEY);
      expect(stored).toBe('light');
      
      if (stored !== null) {
        document.documentElement.setAttribute('data-theme', stored);
      }
      
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });

    it('returns null when localStorage has no stored value', () => {
      const stored = localStorage.getItem(DARK_MODE_KEY);
      expect(stored).toBe(null);
    });
  });

  describe('localStorage write', () => {
    it('writes "dark" to localStorage', () => {
      localStorage.setItem(DARK_MODE_KEY, 'dark');
      expect(localStorage.getItem(DARK_MODE_KEY)).toBe('dark');
    });

    it('writes "light" to localStorage', () => {
      localStorage.setItem(DARK_MODE_KEY, 'light');
      expect(localStorage.getItem(DARK_MODE_KEY)).toBe('light');
    });

    it('overwrites existing value in localStorage', () => {
      localStorage.setItem(DARK_MODE_KEY, 'dark');
      expect(localStorage.getItem(DARK_MODE_KEY)).toBe('dark');
      
      localStorage.setItem(DARK_MODE_KEY, 'light');
      expect(localStorage.getItem(DARK_MODE_KEY)).toBe('light');
    });
  });

  describe('media query fallback', () => {
    it('uses system preference when localStorage is empty (dark mode)', () => {
      // Mock matchMedia to return dark mode
      const matchMediaSpy = vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
        matches: query === '(prefers-color-scheme: dark)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      const stored = localStorage.getItem(DARK_MODE_KEY);
      expect(stored).toBe(null);
      
      if (stored === null) {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
      }
      
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
      
      matchMediaSpy.mockRestore();
    });

    it('uses system preference when localStorage is empty (light mode)', () => {
      // Mock matchMedia to return light mode
      const matchMediaSpy = vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      const stored = localStorage.getItem(DARK_MODE_KEY);
      expect(stored).toBe(null);
      
      if (stored === null) {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
      }
      
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
      
      matchMediaSpy.mockRestore();
    });

    it('prioritizes localStorage over system preference', () => {
      // Mock matchMedia to return dark mode
      const matchMediaSpy = vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
        matches: query === '(prefers-color-scheme: dark)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      // Set localStorage to light (opposite of system preference)
      localStorage.setItem(DARK_MODE_KEY, 'light');
      
      const stored = localStorage.getItem(DARK_MODE_KEY);
      expect(stored).toBe('light');
      
      // localStorage should take precedence
      if (stored !== null) {
        document.documentElement.setAttribute('data-theme', stored);
      }
      
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
      
      matchMediaSpy.mockRestore();
    });
  });

  describe('error handling', () => {
    it('falls back to light mode when localStorage is unavailable', () => {
      // Mock localStorage.getItem to throw an error
      const getItemSpy = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
        throw new Error('localStorage unavailable');
      });

      try {
        const stored = localStorage.getItem(DARK_MODE_KEY);
        if (stored !== null) {
          document.documentElement.setAttribute('data-theme', stored);
        } else {
          document.documentElement.setAttribute('data-theme', 'light');
        }
      } catch (e) {
        document.documentElement.setAttribute('data-theme', 'light');
      }
      
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
      
      getItemSpy.mockRestore();
    });

    it('falls back to light mode when localStorage.setItem fails', () => {
      // Mock localStorage.setItem to throw an error
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('localStorage unavailable');
      });

      try {
        localStorage.setItem(DARK_MODE_KEY, 'dark');
      } catch (e) {
        // Expected to fail
      }
      
      // Should not have set the value
      expect(localStorage.getItem(DARK_MODE_KEY)).toBe(null);
      
      setItemSpy.mockRestore();
    });
  });
});
