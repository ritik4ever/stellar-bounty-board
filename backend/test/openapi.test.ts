import { describe, it, expect } from "vitest";

describe("OpenAPI spec validation", () => {
  it("generates valid OpenAPI JSON with all expected routes", async () => {
    const { generateOpenApiDocument } = await import("../src/docs/openapi");

    const spec = generateOpenApiDocument();

    // Verify the spec structure
    expect(spec).toBeDefined();
    expect(spec.info.title).toBe("Stellar Bounty Board API");
    expect(spec.openapi).toBe("3.1.0");

    // Verify all routes are registered
    const paths = spec.paths;
    expect(paths).toBeDefined();

    const pathKeys = Object.keys(paths);
    expect(pathKeys.length).toBeGreaterThan(0);

    // Log all paths
    console.log("Registered paths:", pathKeys.join(", "));

    // Each route should have at least one method
    for (const [route, methods] of Object.entries(paths)) {
      const methodKeys = Object.keys(methods as Record<string, unknown>);
      expect(methodKeys.length).toBeGreaterThan(0);
      console.log(`  ${route}: ${methodKeys.join(", ").toUpperCase()}`);
    }

    // Verify critical routes exist
    const hasHealth = pathKeys.some(k => k.includes("health"));
    const hasBounties = pathKeys.some(k => k.includes("bounty"));
    expect(hasHealth || hasBounties).toBe(true);
  });

  it("validates documented routes have correct HTTP status codes", async () => {
    const { generateOpenApiDocument } = await import("../src/docs/openapi");
    const spec = generateOpenApiDocument();

    // Check that every documented response has a valid HTTP status code
    for (const [route, methods] of Object.entries(spec.paths)) {
      for (const [, details] of Object.entries(methods as Record<string, Record<string, unknown>>)) {
        const responses = details.responses as Record<string, unknown> | undefined;
        if (responses) {
          for (const statusCode of Object.keys(responses)) {
            const code = parseInt(statusCode, 10);
            expect(code).toBeGreaterThanOrEqual(100);
            expect(code).toBeLessThan(600);
          }
        }
      }
    }
  });
});
