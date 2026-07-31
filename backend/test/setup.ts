import { vi } from "vitest";

const originalFetch = globalThis.fetch;

globalThis.fetch = vi.fn(
  async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;

    if (url.includes("api.github.com/repos/") && url.includes("/pulls/")) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => "60" },
        json: async () => ({
          body: "Closes #1 #2 #4 #7 #10 #30 #41 #42 #44 #99 #100 #101 #102 #103 #200 #300 #123",
        }),
      } as Response;
    }

    if (url.includes("api.github.com/repos/") && url.includes("/issues?state=open")) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => "60" },
        json: async () => [
          {
            number: 1,
            title: "Fix loading",
            labels: [{ name: "help wanted" }],
            body: "Summary\n\nDetails",
          },
          {
            number: 2,
            title: "Add feature",
            labels: ["enhancement"],
            body: "Summary",
          },
        ],
      } as Response;
    }

    return originalFetch(input, init);
  },
);
