import type { Bounty } from "./types";

export function buildBountyPermalink(bountyId: string): string {
  return `${window.location.origin}/bounties/${encodeURIComponent(bountyId)}`;
}

export function buildBountyShareText(
  bounty: Pick<Bounty, "title" | "amount" | "tokenSymbol">,
): string {
  return `${bounty.title} — ${bounty.amount} ${bounty.tokenSymbol} bounty`;
}

export function buildTwitterShareUrl(permalink: string, text: string): string {
  const params = new URLSearchParams({
    text: `${text} ${permalink}`,
  });

  return `https://twitter.com/intent/tweet?${params.toString()}`;
}

export function buildLinkedInShareUrl(permalink: string): string {
  const params = new URLSearchParams({ url: permalink });

  return `https://www.linkedin.com/sharing/share-offsite/?${params.toString()}`;
}
