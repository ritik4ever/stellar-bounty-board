/**
 * Test fixtures for Stellar Bounty Board backend tests.
 *
 * These exports provide valid, reusable test data compliant with Zod schemas
 * and contract constraints, enabling isolated unit and integration tests without
 * repeating validation setup in each test file.
 *
 * @module test/fixtures
 */

/**
 * Valid Stellar Ed25519 public key for use as a maintainer in tests.
 * Format: G + 55 base32 characters.
 *
 * @type {string}
 * @constant
 */
export const MAINTAINER = `GB5IWBA6RTXMZSCMHFSVNL6IIZMHH5WJOH7JXZ2UTZD3VP2WBVWJJOOK`;

/**
 * Valid Stellar Ed25519 public key for use as a contributor in tests.
 * Format: G + 55 base32 characters.
 *
 * @type {string}
 * @constant
 */
export const CONTRIBUTOR = `GBE6AZEUPV75O3Z7OFW4RIMU7DF453AVK5HCXB3PV2I7BBTYEPCOYWSF`;

/**
 * Valid Stellar Ed25519 public key for use as a third-party account in tests.
 * Format: G + 55 base32 characters.
 *
 * @type {string}
 * @constant
 */
export const OTHER_ACCOUNT = `GAFQ647SLVQP5J3EIJGY4XARG4SPK2RMRNYPV7YYEIEUPGBMP6467B6E`;

/**
 * Valid bounty creation request body.
 *
 * Complies with all POST /api/bounties request schema constraints:
 * - repo: Valid GitHub org/repo slug format
 * - issueNumber: Positive integer
 * - title: Non-empty string, ≤255 characters
 * - summary: Non-empty string, ≤2048 characters
 * - maintainer: Valid Stellar Ed25519 public key
 * - tokenSymbol: Supported token symbol (must exist in token address map)
 * - amount: Positive number, within min/max bounty amount bounds
 * - deadlineDays: Positive integer
 * - labels: Array of valid GitHub label strings
 *
 * @type {object}
 * @constant
 * @property {string} repo - GitHub repository in "owner/name" format
 * @property {number} issueNumber - GitHub issue number
 * @property {string} title - Bounty display title
 * @property {string} summary - Bounty description
 * @property {string} maintainer - Stellar public key of bounty creator
 * @property {string} tokenSymbol - Token symbol (e.g., "XLM", "USDC")
 * @property {number} amount - Bounty amount in token units
 * @property {number} deadlineDays - Days until deadline
 * @property {string[]} labels - GitHub labels for categorization
 */
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
