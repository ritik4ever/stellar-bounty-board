import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);

const STELLAR_ACCOUNT_REGEX = /^G[A-Z2-7]{55}$/;
const REPO_REGEX = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
const TOKEN_REGEX = /^[A-Za-z0-9]{1,12}$/;

const STELLAR_EXAMPLE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

export const bountyIdSchema = z
  .string()
  .trim()
  .min(1, "Bounty ID is required.")
  .openapi({ example: "BNT-0001" });

const stellarAccountSchema = z
  .string()
  .trim()
  .regex(STELLAR_ACCOUNT_REGEX, "Must be a valid Stellar public key.")
  .openapi({
    example: STELLAR_EXAMPLE,
    description: "A valid Stellar public key (starts with G, 56 characters).",
  });

export const createBountySchema = z
  .object({
    repo: z
      .string()
      .trim()
      .regex(REPO_REGEX, "Repo must look like owner/repository.")
      .openapi({ example: "owner/repo", description: "GitHub repository in owner/repo format." }),
    issueNumber: z.coerce
      .number()
      .int()
      .positive("Issue number must be positive.")
      .openapi({ example: 42, description: "GitHub issue number this bounty is attached to." }),
    title: z
      .string()
      .trim()
      .min(5)
      .max(120)
      .openapi({ example: "Fix login redirect bug", description: "Short bounty title (5–120 chars)." }),
    summary: z
      .string()
      .trim()
      .min(20)
      .max(280)
      .openapi({
        example: "The login page does not redirect after successful authentication. Fix the redirect logic.",
        description: "Description of the work required (20–280 chars).",
      }),
    maintainer: stellarAccountSchema,
    tokenSymbol: z
      .string()
      .trim()
      .regex(TOKEN_REGEX, "Token symbol must be 1-12 letters or numbers.")
      .openapi({ example: "XLM", description: "Stellar token symbol for payout (1–12 alphanumeric chars)." }),
    amount: z.coerce
      .number()
      .positive("Amount must be greater than zero.")
      .openapi({ example: 100, description: "Payout amount in the specified token." }),
    deadlineDays: z.coerce
      .number()
      .int()
      .min(1)
      .max(90)
      .openapi({ example: 14, description: "Number of days until the bounty expires (1–90)." }),
    labels: z
      .array(z.string().trim().min(1).max(30))
      .max(6)
      .default([])
      .openapi({ example: ["bug", "help wanted"], description: "Up to 6 labels for categorisation." }),
  })
  .openapi("CreateBountyRequest");

export const reserveBountySchema = z
  .object({
    contributor: stellarAccountSchema.openapi({
      description: "Stellar public key of the contributor reserving the bounty.",
    }),
  })
  .openapi("ReserveBountyRequest");

export const submitBountySchema = z
  .object({
    contributor: stellarAccountSchema.openapi({
      description: "Must match the contributor who reserved the bounty.",
    }),
    submissionUrl: z
      .string()
      .trim()
      .url("Submission URL must be a valid URL.")
      .openapi({
        example: "https://github.com/owner/repo/pull/99",
        description: "Link to the pull request or deliverable.",
      }),
    notes: z
      .string()
      .trim()
      .max(240)
      .optional()
      .openapi({ example: "Fixed by updating the redirect handler.", description: "Optional notes (max 240 chars)." }),
  })
  .openapi("SubmitBountyRequest");

export const maintainerActionSchema = z
  .object({
    maintainer: stellarAccountSchema.openapi({
      description: "Must match the maintainer address on the bounty.",
    }),
  })
  .openapi("MaintainerActionRequest");

// ---------------------------------------------------------------------------
// Shared response schemas
// ---------------------------------------------------------------------------

export const errorResponseSchema = z
  .object({
    error: z.string().openapi({ example: "Bounty not found." }),
  })
  .openapi("ErrorResponse");

export const bountyRecordSchema = z
  .object({
    id: z.string().openapi({ example: "BNT-0001" }),
    repo: z.string().openapi({ example: "owner/repo" }),
    issueNumber: z.number().openapi({ example: 42 }),
    title: z.string().openapi({ example: "Fix login redirect bug" }),
    summary: z.string().openapi({ example: "The login page does not redirect after successful authentication." }),
    maintainer: z.string().openapi({ example: STELLAR_EXAMPLE }),
    contributor: z.string().optional().openapi({ example: STELLAR_EXAMPLE }),
    tokenSymbol: z.string().openapi({ example: "XLM" }),
    amount: z.number().openapi({ example: 100 }),
    labels: z.array(z.string()).openapi({ example: ["bug", "help wanted"] }),
    status: z
      .enum(["open", "reserved", "submitted", "released", "refunded", "expired"])
      .openapi({ example: "open" }),
    createdAt: z.number().openapi({ example: 1710000000, description: "Unix timestamp (seconds)." }),
    deadlineAt: z.number().openapi({ example: 1911000000, description: "Unix timestamp (seconds)." }),
    reservedAt: z.number().optional().openapi({ example: 1710003600 }),
    submittedAt: z.number().optional(),
    releasedAt: z.number().optional(),
    refundedAt: z.number().optional(),
    submissionUrl: z.string().optional().openapi({ example: "https://github.com/owner/repo/pull/99" }),
    notes: z.string().optional(),
  })
  .openapi("BountyRecord");

export const openIssueSchema = z
  .object({
    id: z.string().openapi({ example: "SBB-101" }),
    title: z.string().openapi({ example: "Add Freighter wallet signing" }),
    labels: z.array(z.string()).openapi({ example: ["enhancement", "help wanted"] }),
    summary: z.string().openapi({ example: "Replace prompt-based demo actions with wallet-authenticated transactions." }),
    impact: z.enum(["starter", "core", "advanced"]).openapi({ example: "core" }),
  })
  .openapi("OpenIssue");

export const healthResponseSchema = z
  .object({
    service: z.string().openapi({ example: "stellar-bounty-board-backend" }),
    status: z.string().openapi({ example: "ok" }),
    timestamp: z.string().openapi({ example: "2026-03-24T19:00:00.000Z" }),
  })
  .openapi("HealthResponse");

export function zodErrorMessage(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; ");
}
