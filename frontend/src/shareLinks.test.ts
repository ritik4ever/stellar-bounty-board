import { describe, expect, it } from "vitest";

import {
  buildBountyPermalink,
  buildBountyShareText,
  buildLinkedInShareUrl,
  buildTwitterShareUrl,
} from "./shareLinks";

describe("shareLinks", () => {
  const bounty = {
    title: "Add authentication feature",
    amount: 500,
    tokenSymbol: "XLM",
  };

  it("builds a bounty permalink from the current origin", () => {
    expect(buildBountyPermalink("BNTY-42")).toBe(
      "http://localhost:3000/bounties/BNTY-42",
    );
  });

  it("builds share text with title and reward amount", () => {
    expect(buildBountyShareText(bounty)).toBe(
      "Add authentication feature — 500 XLM bounty",
    );
  });

  it("builds a Twitter intent URL with text and link", () => {
    const url = buildTwitterShareUrl(
      "http://localhost:3000/bounties/BNTY-42",
      "Add authentication feature — 500 XLM bounty",
    );

    expect(url).toContain("https://twitter.com/intent/tweet?");
    expect(url).toContain(
      encodeURIComponent("Add authentication feature — 500 XLM bounty http://localhost:3000/bounties/BNTY-42"),
    );
  });

  it("builds a LinkedIn share URL with the bounty permalink", () => {
    const url = buildLinkedInShareUrl("http://localhost:3000/bounties/BNTY-42");

    expect(url).toBe(
      "https://www.linkedin.com/sharing/share-offsite/?url=http%3A%2F%2Flocalhost%3A3000%2Fbounties%2FBNTY-42",
    );
  });
});
