import React from "react";
import { render, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Mock IntersectionObserver globally
let observerCallback: IntersectionObserverCallback | null = null;
class MockIntersectionObserver {
    callback: IntersectionObserverCallback;
    constructor(cb: IntersectionObserverCallback) {
        this.callback = cb;
        observerCallback = cb;
        // record instances for tests to access
        (window as any).__ioInstances = (window as any).__ioInstances || [];
        (window as any).__ioInstances.push(this);
    }
    observe() {
        // simulate intersection asynchronously when observed so tests can trigger next page
        setTimeout(() => this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as any), 0);
    }
    disconnect() { }
    unobserve() { }
}


Object.defineProperty(window, "IntersectionObserver", {
    writable: true,
    configurable: true,
    value: MockIntersectionObserver,
});

// Polyfill matchMedia for jsdom environment used by Vitest
if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
        writable: true,
        configurable: true,
        value: (query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: () => { },
            removeListener: () => { },
            addEventListener: () => { },
            removeEventListener: () => { },
            dispatchEvent: () => false,
        }),
    });
}

// Mock the api module used by App
vi.mock("./api", async () => {
    const actual = await vi.importActual<typeof import("./api")>("./api");
    const firstPage = Array.from({ length: 20 }).map((_, i) => ({
        id: `BNT-${String(i + 1).padStart(4, "0")}`,
        repo: "owner/repo",
        issueNumber: i + 1,
        title: `Title ${i + 1}`,
        summary: "summary",
        maintainer: "GAAA",
        tokenSymbol: "XLM",
        amount: 10,
        labels: [],
        status: "open",
        createdAt: 1,
        deadlineAt: 9999999999,
        version: 1,
        events: [],
    }));
    const secondPage = Array.from({ length: 5 }).map((_, i) => ({
        id: `BNT-${String(i + 21).padStart(4, "0")}`,
        repo: "owner/repo",
        issueNumber: i + 21,
        title: `Title ${i + 21}`,
        summary: "summary",
        maintainer: "GAAA",
        tokenSymbol: "XLM",
        amount: 10,
        labels: [],
        status: "open",
        createdAt: 1,
        deadlineAt: 9999999999,
        version: 1,
        events: [],
    }));

    const listBountiesPage = vi.fn()
        .mockResolvedValueOnce({ data: firstPage, total: 25, limit: 20, offset: 0 })
        .mockResolvedValueOnce({ data: secondPage, total: 25, limit: 20, offset: 20 });

    return {
        ...(actual as object),
        listBountiesPage,
        listBounties: vi.fn().mockResolvedValue([]),
        listOpenIssues: vi.fn().mockResolvedValue([]),
    } as Partial<typeof import("./api")>;
});

describe("Infinite scroll", () => {
    beforeEach(() => {
        observerCallback = null;
    });

    afterEach(() => {
        vi.resetModules();
    });

    it("triggers page 2 fetch when sentinel intersects", async () => {
        const { default: App } = await import("./App");
        const api = await import("./api");

        render(React.createElement(App));

        // Wait for initial page fetch (first call)
        await waitFor(() => {
            expect(api.listBountiesPage).toHaveBeenCalledTimes(1);
            expect(api.listBountiesPage).toHaveBeenCalledWith(20, 0, undefined);
        });

        // Simulate intersection to trigger next page via captured instance
        const instances = (window as any).__ioInstances as MockIntersectionObserver[] | undefined;
        expect(instances && instances.length).toBeGreaterThan(0);
        const instance = instances && instances[0];
        instance.callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);

        // Wait for second fetch
        await waitFor(() => {
            expect(api.listBountiesPage).toHaveBeenCalledTimes(2);
            expect(api.listBountiesPage).toHaveBeenCalledWith(20, 20, undefined);
        });
    });
});
