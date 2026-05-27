import '@testing-library/jest-dom';

// Basic matchMedia polyfill for jsdom used in Vitest.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    window.matchMedia = (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => { },
        removeListener: () => { },
        addEventListener: () => { },
        removeEventListener: () => { },
        dispatchEvent: () => false,
    });
}
