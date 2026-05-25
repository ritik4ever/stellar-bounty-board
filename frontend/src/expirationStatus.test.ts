import { describe, expect, it } from "vitest";

import { getExpirationStatusBadge } from "./expirationStatus";

const NOW = 1_700_000_000;
const DAY_SECONDS = 24 * 60 * 60;

describe("getExpirationStatusBadge", () => {
  it("returns a green badge for open bounties with more than 7 days remaining", () => {
    expect(getExpirationStatusBadge("open", NOW + 8 * DAY_SECONDS, NOW)).toMatchInlineSnapshot(`
      {
        "ariaLabel": "Open: more than 7 days left",
        "className": "status-pill status-pill--expiration-green",
        "label": "Open - more than 7 days left",
        "title": "Open: more than 7 days left",
        "tone": "green",
      }
    `);
  });

  it("returns a yellow badge for active bounties with 1-7 days remaining", () => {
    expect(getExpirationStatusBadge("reserved", NOW + 3 * DAY_SECONDS, NOW)).toMatchInlineSnapshot(`
      {
        "ariaLabel": "Reserved: 1-7 days left",
        "className": "status-pill status-pill--expiration-yellow",
        "label": "Reserved - 1-7 days left",
        "title": "Reserved: 1-7 days left",
        "tone": "yellow",
      }
    `);
  });

  it("returns a red badge for active bounties with less than 24 hours remaining", () => {
    expect(getExpirationStatusBadge("open", NOW + 12 * 60 * 60, NOW)).toMatchInlineSnapshot(`
      {
        "ariaLabel": "Open: less than 24 hours left",
        "className": "status-pill status-pill--expiration-red",
        "label": "Open - less than 24 hours left",
        "title": "Open: less than 24 hours left",
        "tone": "red",
      }
    `);
  });

  it("returns a grey badge for terminal bounty states", () => {
    expect(getExpirationStatusBadge("released", NOW + 8 * DAY_SECONDS, NOW)).toMatchInlineSnapshot(`
      {
        "ariaLabel": "Released: closed",
        "className": "status-pill status-pill--expiration-grey",
        "label": "Released - closed",
        "title": "Released: closed",
        "tone": "grey",
      }
    `);
  });

  it("returns a blue badge for disputed bounties", () => {
    expect(getExpirationStatusBadge("disputed", NOW + 8 * DAY_SECONDS, NOW)).toMatchInlineSnapshot(`
      {
        "ariaLabel": "Disputed: under dispute",
        "className": "status-pill status-pill--expiration-blue",
        "label": "Disputed - under dispute",
        "title": "Disputed: under dispute",
        "tone": "blue",
      }
    `);
  });
});
