/** Valid Stellar-style public keys for Zod schemas (G + 55 base32 chars). */
export const MAINTAINER = `GB5IWBA6RTXMZSCMHFSVNL6IIZMHH5WJOH7JXZ2UTZD3VP2WBVWJJOOK`;
export const CONTRIBUTOR = `GBE6AZEUPV75O3Z7OFW4RIMU7DF453AVK5HCXB3PV2I7BBTYEPCOYWSF`;
export const OTHER_ACCOUNT = `GAFQ647SLVQP5J3EIJGY4XARG4SPK2RMRNYPV7YYEIEUPGBMP6467B6E`;

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
