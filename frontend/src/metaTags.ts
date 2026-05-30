import type { Bounty } from "./types";

/**
 * Updates Open Graph and Twitter Card meta tags for social sharing
 */
export function updateSocialMetaTags(bounty: Bounty | null) {
  if (!bounty) {
    // Reset to default meta tags when no bounty is loaded
    document.title = "Stellar Bounty Board";
    updateMetaTag("og:title", "Stellar Bounty Board");
    updateMetaTag("og:description", "Fund GitHub issues with on-chain style escrow");
    updateMetaTag("og:url", window.location.origin);
    updateMetaTag("og:type", "website");
    updateMetaTag("twitter:card", "summary");
    updateMetaTag("twitter:title", "Stellar Bounty Board");
    updateMetaTag("twitter:description", "Fund GitHub issues with on-chain style escrow");
    removeMetaTag("og:image");
    removeMetaTag("twitter:image");
    return;
  }

  // Build the canonical URL for this bounty
  const bountyUrl = `${window.location.origin}/bounties/${encodeURIComponent(bounty.id)}`;

  // Build the description with bounty summary, amount, and token
  const description = `${bounty.summary} • Reward: ${bounty.amount} ${bounty.tokenSymbol}`;

  // Extract repository owner for avatar image
  const repoOwner = bounty.repo.split("/")[0];
  const avatarUrl = `https://github.com/${repoOwner}.png?size=400`;

  // Update document title
  document.title = `${bounty.title} | Stellar Bounty Board`;

  // Update Open Graph meta tags
  updateMetaTag("og:title", bounty.title);
  updateMetaTag("og:description", description);
  updateMetaTag("og:url", bountyUrl);
  updateMetaTag("og:type", "article");
  updateMetaTag("og:image", avatarUrl);

  // Update Twitter Card meta tags
  updateMetaTag("twitter:card", "summary");
  updateMetaTag("twitter:title", bounty.title);
  updateMetaTag("twitter:description", description);
  updateMetaTag("twitter:image", avatarUrl);
}

/**
 * Updates or creates a meta tag with the given property/name and content
 */
function updateMetaTag(property: string, content: string) {
  // Try to find existing meta tag by property (for og:) or name (for twitter:)
  const isOgTag = property.startsWith("og:");
  const selector = isOgTag ? `meta[property="${property}"]` : `meta[name="${property}"]`;
  let metaTag = document.querySelector(selector);

  if (!metaTag) {
    // Create new meta tag if it doesn't exist
    metaTag = document.createElement("meta");
    if (isOgTag) {
      metaTag.setAttribute("property", property);
    } else {
      metaTag.setAttribute("name", property);
    }
    document.head.appendChild(metaTag);
  }

  metaTag.setAttribute("content", content);
}

/**
 * Removes a meta tag with the given property/name
 */
function removeMetaTag(property: string) {
  const isOgTag = property.startsWith("og:");
  const selector = isOgTag ? `meta[property="${property}"]` : `meta[name="${property}"]`;
  const metaTag = document.querySelector(selector);
  
  if (metaTag) {
    metaTag.remove();
  }
}
