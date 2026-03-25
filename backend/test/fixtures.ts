/** Valid Stellar-style public keys for Zod schemas (G + 55 base32 chars). */
export const MAINTAINER = `G${"C".repeat(55)}`;
export const CONTRIBUTOR = `G${"B".repeat(55)}`;
export const OTHER_ACCOUNT = `G${"D".repeat(55)}`;

export const validCreateBody = {
  repo: "owner/repo-name",
  issueNumber: 99,
  title: "Implement the feature for the dashboard UI",
  summary: "Add a clear contributor flow with validation and error handling for users.",
  maintainer: MAINTAINER,
  tokenSymbol: "XLM",
  amount: 42.5,
  deadlineDays: 30,
  labels: ["bug"],
};
