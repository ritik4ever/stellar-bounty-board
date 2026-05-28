import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { updateSocialMetaTags } from "./metaTags";
import type { Bounty } from "./types";

describe("updateSocialMetaTags", () => {
  // Store original location for cleanup
  const originalLocation = window.location;

  beforeEach(() => {
    // Clear all meta tags before each test
    document.head.innerHTML = "";
    
    // Mock window.location
    delete (window as any).location;
    window.location = {
      ...originalLocation,
      origin: "https://stellar-bounty.com",
    } as Location;
  });

  afterEach(() => {
    // Restore original location
    window.location = originalLocation;
  });

  it("should set default meta tags when bounty is null", () => {
    updateSocialMetaTags(null);

    expect(document.title).toBe("Stellar Bounty Board");
    expect(getMetaContent("og:title")).toBe("Stellar Bounty Board");
    expect(getMetaContent("og:description")).toBe("Fund GitHub issues with on-chain style escrow");
    expect(getMetaContent("og:url")).toBe("https://stellar-bounty.com");
    expect(getMetaContent("og:type")).toBe("website");
    expect(getMetaContent("twitter:card")).toBe("summary");
    expect(getMetaContent("twitter:title")).toBe("Stellar Bounty Board");
    expect(getMetaContent("twitter:description")).toBe("Fund GitHub issues with on-chain style escrow");
  });

  it("should update meta tags with bounty data", () => {
    const mockBounty: Bounty = {
      id: "bounty-123",
      repo: "stellar/soroban-example",
      issueNumber: 42,
      title: "Add authentication feature",
      summary: "Implement OAuth2 authentication for the API",
      maintainer: "GABC123",
      tokenSymbol: "XLM",
      amount: 500,
      labels: [],
      status: "open",
      createdAt: 1234567890,
      deadlineAt: 1234567890,
      version: 1,
      events: [],
    };

    updateSocialMetaTags(mockBounty);

    expect(document.title).toBe("Add authentication feature | Stellar Bounty Board");
    expect(getMetaContent("og:title")).toBe("Add authentication feature");
    expect(getMetaContent("og:description")).toBe("Implement OAuth2 authentication for the API • Reward: 500 XLM");
    expect(getMetaContent("og:url")).toBe("https://stellar-bounty.com/bounties/bounty-123");
    expect(getMetaContent("og:type")).toBe("article");
    expect(getMetaContent("og:image")).toBe("https://github.com/stellar.png?size=400");
    expect(getMetaContent("twitter:card")).toBe("summary");
    expect(getMetaContent("twitter:title")).toBe("Add authentication feature");
    expect(getMetaContent("twitter:description")).toBe("Implement OAuth2 authentication for the API • Reward: 500 XLM");
    expect(getMetaContent("twitter:image")).toBe("https://github.com/stellar.png?size=400");
  });

  it("should handle special characters in bounty ID", () => {
    const mockBounty: Bounty = {
      id: "bounty/with/slashes",
      repo: "owner/repo",
      issueNumber: 1,
      title: "Test",
      summary: "Test summary",
      maintainer: "GABC123",
      tokenSymbol: "XLM",
      amount: 100,
      labels: [],
      status: "open",
      createdAt: 1234567890,
      deadlineAt: 1234567890,
      version: 1,
      events: [],
    };

    updateSocialMetaTags(mockBounty);

    expect(getMetaContent("og:url")).toBe("https://stellar-bounty.com/bounties/bounty%2Fwith%2Fslashes");
  });

  it("should update existing meta tags instead of creating duplicates", () => {
    const mockBounty: Bounty = {
      id: "bounty-1",
      repo: "owner/repo",
      issueNumber: 1,
      title: "First Title",
      summary: "First summary",
      maintainer: "GABC123",
      tokenSymbol: "XLM",
      amount: 100,
      labels: [],
      status: "open",
      createdAt: 1234567890,
      deadlineAt: 1234567890,
      version: 1,
      events: [],
    };

    // First update
    updateSocialMetaTags(mockBounty);
    const firstCount = document.querySelectorAll('meta[property="og:title"]').length;
    expect(firstCount).toBe(1);

    // Second update with different data
    mockBounty.title = "Second Title";
    updateSocialMetaTags(mockBounty);
    const secondCount = document.querySelectorAll('meta[property="og:title"]').length;
    expect(secondCount).toBe(1);
    expect(getMetaContent("og:title")).toBe("Second Title");
  });

  it("should remove image tags when resetting to default", () => {
    const mockBounty: Bounty = {
      id: "bounty-1",
      repo: "owner/repo",
      issueNumber: 1,
      title: "Test",
      summary: "Test summary",
      maintainer: "GABC123",
      tokenSymbol: "XLM",
      amount: 100,
      labels: [],
      status: "open",
      createdAt: 1234567890,
      deadlineAt: 1234567890,
      version: 1,
      events: [],
    };

    // Set bounty (adds image tags)
    updateSocialMetaTags(mockBounty);
    expect(getMetaContent("og:image")).toBeTruthy();

    // Reset to default (should remove image tags)
    updateSocialMetaTags(null);
    expect(getMetaContent("og:image")).toBeNull();
    expect(getMetaContent("twitter:image")).toBeNull();
  });
});

// Helper function to get meta tag content
function getMetaContent(property: string): string | null {
  const isOgTag = property.startsWith("og:");
  const selector = isOgTag ? `meta[property="${property}"]` : `meta[name="${property}"]`;
  const metaTag = document.querySelector(selector);
  return metaTag ? metaTag.getAttribute("content") : null;
}
