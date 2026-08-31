import { OpenApiGeneratorV31, OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import {
  bountyAuditLogListResponseSchema,
  bountyAuditLogPaginationSchema,
  bountyAuditLogSchema,
  bountyRecordSchema,
  createBountySchema,
  errorResponseSchema,
  healthResponseSchema,
  deepHealthResponseSchema,
  maintainerActionSchema,
  openIssueSchema,
  reserveBountySchema,
  resolveDisputeBountySchema,
  submitBountySchema,
  updateNotesSchema,
} from '../validation/schemas';

const registry = new OpenAPIRegistry();

// ---------------------------------------------------------------------------
// Register all named schemas so they appear in #/components/schemas
// ---------------------------------------------------------------------------
registry.register("BountyRecord", bountyRecordSchema);
registry.register("BountyAuditLogRecord", bountyAuditLogSchema);
registry.register("BountyAuditLogPagination", bountyAuditLogPaginationSchema);
registry.register("BountyAuditLogListResponse", bountyAuditLogListResponseSchema);
registry.register("CreateBountyRequest", createBountySchema);
registry.register("ReserveBountyRequest", reserveBountySchema);
registry.register("SubmitBountyRequest", submitBountySchema);
registry.register("MaintainerActionRequest", maintainerActionSchema);
registry.register("UpdateNotesRequest", updateNotesSchema);
registry.register("ErrorResponse", errorResponseSchema);
registry.register("OpenIssue", openIssueSchema);
registry.register("HealthResponse", healthResponseSchema);
registry.register("DeepHealthResponse", deepHealthResponseSchema);

// ---------------------------------------------------------------------------
// Reusable inline helpers
// ---------------------------------------------------------------------------
const bountyIdParam = {
  name: "id",
  in: "path" as const,
  required: true,
  description: 'Bounty ID (e.g. "BNT-0001")',
  schema: { type: "string" as const, example: "BNT-0001" },
};

const jsonBody = <T extends z.ZodTypeAny>(schema: T) => ({
  required: true,
  content: { "application/json": { schema } },
});

const jsonResponse = <T extends z.ZodTypeAny>(description: string, schema: T) => ({
  description,
  content: { "application/json": { schema } },
});

const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: errorResponseSchema } },
});

const bountyDataResponse = (description: string) =>
  jsonResponse(description, z.object({ data: bountyRecordSchema }));

const paginatedBountiesSchema = z.object({
  data: z.array(bountyRecordSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  hasMore: z.boolean(),
});

const bountyTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  amount: z.number(),
  labels: z.array(z.string()),
  deadlineDays: z.number().int(),
  tokenSymbol: z.string(),
});

const recurringScheduleSchema = z.object({
  id: z.string().uuid(),
  cadence: z.enum(["daily", "weekly", "monthly"]),
  templateId: z.string(),
  targetRepo: z.string(),
  bounty: z.record(z.unknown()),
  active: z.boolean(),
  createdAt: z.number().int(),
  nextRunAt: z.number().int(),
  lastRunAt: z.number().int().optional(),
  createdBountyIds: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// Route definitions
// ---------------------------------------------------------------------------

registry.registerPath({
  method: "get",
  path: "/api/health",
  tags: ["System"],
  summary: "Health check",
  description: "Returns the service name and current server timestamp. Use this to verify the API is reachable.",
  responses: {
    200: jsonResponse("Service is healthy.", healthResponseSchema),
  },
});

registry.registerPath({
  method: "get",
  path: "/api/health/deep",
  tags: ["System"],
  summary: "Deep health check",
  description:
    "Extended health check that verifies all external dependencies. " +
    "Checks JSON store read/write, Soroban RPC reachability, contract ID configuration, " +
    "and auth configuration (MAINTAINER_PUBLIC_KEY and ARBITER_ADDRESS). " +
    "Excluded from rate limiting. Returns HTTP 503 when any critical component is down.",
  responses: {
    200: jsonResponse("All critical components are healthy.", deepHealthResponseSchema),
    503: jsonResponse("One or more critical components are down.", deepHealthResponseSchema),
  },
});

registry.registerPath({
  method: "get",
  path: "/api/bounties",
  tags: ["Bounties"],
  summary: "List all bounties",
  description:
    "Returns bounty records sorted by `createdAt` descending by default, with optional maintainer/status/token filters and sort parameters. " +
    "Bounties whose deadline has passed are automatically transitioned to `expired` before the list is returned.",
  request: {
    query: z.object({
      q: z.string().optional().openapi({
        description: "Case-insensitive substring filter applied to title, summary, and labels.",
      }),
      contributor: z.string().optional().openapi({
        description: "Exact Stellar public key filter applied to the bounty contributor.",
      }),
      maintainer: z.string().optional().openapi({
        description: "Exact Stellar public key filter applied to the bounty maintainer.",
      }),
      status: z.string().optional().openapi({
        description: "Exact bounty status filter. Combines with maintainer and tokenSymbol using AND logic.",
      }),
      tokenSymbol: z.string().optional().openapi({
        description: "Exact token symbol filter. Combines with maintainer and status using AND logic.",
      }),
      sort: z.enum(["amount", "deadline", "createdAt", "status"]).optional().openapi({
        description: "Field to sort by (default: createdAt).",
      }),
      order: z.enum(["asc", "desc"]).optional().openapi({
        description: "Sort direction (default: desc).",
      }),
      deadlineBefore: z.string().optional().openapi({
        description: "Filter bounties with deadline before this ISO 8601 date string.",
        example: "2026-12-31T23:59:59.000Z",
      }),
      deadlineAfter: z.string().optional().openapi({
        description: "Filter bounties with deadline after this ISO 8601 date string.",
        example: "2026-01-01T00:00:00.000Z",
      }),
      page: z.number().int().min(1).optional().openapi({
        description: "Page number (starts at 1, default 1).",
      }),
      pageSize: z.number().int().min(1).max(100).optional().openapi({
        description: "Number of items per page (max 100, default 20).",
      }),
    }),
  },
  responses: {
    200: jsonResponse("Array of all bounty records.", z.object({ data: z.array(bountyRecordSchema) })),
    400: errorResponse("Invalid query parameters (e.g., invalid date string, maintainer address, sort field, or order)."),
  },
});

registry.registerPath({
  method: "get",
  path: "/api/bounties/search",
  tags: ["Bounties"],
  summary: "Search bounties",
  description: "Free-text search across title, repository, and description, ranked in that order.",
  request: { query: z.object({
    q: z.string(),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
  }) },
  responses: {
    200: jsonResponse("Ranked, paginated search results.", paginatedBountiesSchema),
    400: errorResponse("Invalid pagination parameters."),
  },
});

registry.registerPath({
  method: "get",
  path: "/api/bounty-templates",
  tags: ["Bounties"],
  summary: "List bounty templates",
  responses: { 200: jsonResponse("Available bounty presets.", z.object({ data: z.array(bountyTemplateSchema) })) },
});

registry.registerPath({
  method: "post",
  path: "/api/bounties/import",
  tags: ["Admin"],
  summary: "Import bounties from CSV",
  description: "Admin-only CSV import. Validation failures are reported per data row.",
  request: { body: { required: true, content: { "text/csv": { schema: z.string() } } } },
  responses: {
    201: jsonResponse("Import summary.", z.object({
      data: z.array(z.object({ row: z.number().int(), id: z.string().optional(), errors: z.array(z.string()).optional() })),
      created: z.number().int(), failed: z.number().int(), total: z.number().int(),
    })),
    401: errorResponse("Admin authentication required."),
    415: errorResponse("A CSV content type is required."),
  },
});

registry.registerPath({
  method: "get",
  path: "/api/recurring-bounty-schedules",
  tags: ["Admin"],
  summary: "List recurring bounty schedules",
  responses: {
    200: jsonResponse("Recurring schedules.", z.object({ data: z.array(recurringScheduleSchema) })),
    401: errorResponse("Admin authentication required."),
  },
});

registry.registerPath({
  method: "post",
  path: "/api/recurring-bounty-schedules",
  tags: ["Admin"],
  summary: "Create a recurring bounty schedule",
  request: { body: jsonBody(z.object({
    cadence: z.enum(["daily", "weekly", "monthly"]), templateId: z.string(), targetRepo: z.string(),
    bounty: z.record(z.unknown()), startAt: z.number().int().positive().optional(),
  })) },
  responses: {
    201: jsonResponse("Schedule created.", z.object({ data: recurringScheduleSchema })),
    400: errorResponse("Invalid schedule."),
    401: errorResponse("Admin authentication required."),
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/recurring-bounty-schedules/{id}",
  tags: ["Admin"],
  summary: "Cancel a recurring bounty schedule",
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: jsonResponse("Schedule cancelled.", z.object({ data: recurringScheduleSchema })),
    401: errorResponse("Admin authentication required."),
    404: errorResponse("Schedule not found."),
  },
});

registry.registerPath({
  method: "get",

  path: "/api/bounties/{id}/audit-log",
  tags: ["Bounties"],
  summary: "List audit logs for one bounty",
  description:
    "Returns ordered status transition history for a bounty. " +
    "Use `page` (default 1) and `pageSize` (1-100, default 20) for pagination.",
  request: {
    params: z.object({ id: z.string().openapi(bountyIdParam.schema) }),
    query: z.object({
      page: z.number().int().min(1).optional().openapi({
        example: 1,
        description: "One-based page number.",
      }),
      pageSize: z.number().int().min(1).max(100).optional().openapi({
        example: 20,
        description: "Number of audit entries per page (1-100).",
      }),
    }),
  },
  responses: {
    200: jsonResponse("Audit log page for the requested bounty.", bountyAuditLogListResponseSchema),
    400: errorResponse("Bounty id invalid or pagination query invalid."),
    404: errorResponse("Bounty not found."),
  },
});

registry.registerPath({
  method: "post",
  path: "/api/bounties",
  tags: ["Bounties"],
  summary: "Create a bounty",
  description:
    "Creates a new open bounty and persists it. " +
    "Rate-limited to **5 requests per IP per minute**. " +
    "The `deadlineAt` timestamp is computed as `now + deadlineDays * 86400`.",
  request: {
    body: jsonBody(createBountySchema),
  },
  responses: {
    201: bountyDataResponse("Bounty created successfully."),
    400: errorResponse("Validation failed — see `error` field for details."),
  },
});

registry.registerPath({
  method: "post",
  path: "/api/bounties/{id}/reserve",
  tags: ["Bounties"],
  summary: "Reserve a bounty",
  description:
    "Assigns a contributor to an `open` bounty, transitioning its status to `reserved`. " +
    "Only one contributor can hold a reservation at a time. " +
    "Rate-limited to **5 requests per IP per minute**.",
  request: {
    params: z.object({ id: z.string().openapi(bountyIdParam.schema) }),
    body: jsonBody(reserveBountySchema),
  },
  responses: {
    200: bountyDataResponse("Bounty successfully reserved."),
    400: errorResponse("Bounty not found, not open, or validation failed."),
  },
});

registry.registerPath({
  method: "post",
  path: "/api/bounties/{id}/submit",
  tags: ["Bounties"],
  summary: "Submit work for a bounty",
  description:
    "Transitions a `reserved` bounty to `submitted` by attaching a submission URL. " +
    "The `contributor` field must exactly match the address that reserved the bounty. " +
    "Rate-limited to **5 requests per IP per minute**.",
  request: {
    params: z.object({ id: z.string().openapi(bountyIdParam.schema) }),
    body: jsonBody(submitBountySchema),
  },
  responses: {
    200: bountyDataResponse("Work submitted successfully."),
    400: errorResponse("Bounty not found, not reserved, contributor mismatch, or validation failed."),
  },
});

registry.registerPath({
  method: "post",
  path: "/api/bounties/{id}/release",
  tags: ["Bounties"],
  summary: "Release payment for a bounty",
  description:
    "Transitions a `submitted` bounty to `released`, indicating payment has been sent. " +
    "Only the maintainer address recorded on the bounty may call this endpoint. " +
    "Rate-limited to **5 requests per IP per minute**.",
  request: {
    params: z.object({ id: z.string().openapi(bountyIdParam.schema) }),
    body: jsonBody(maintainerActionSchema),
  },
  responses: {
    200: bountyDataResponse("Payment released."),
    400: errorResponse("Bounty not found, not submitted, maintainer mismatch, or validation failed."),
  },
});

registry.registerPath({
  method: "post",
  path: "/api/bounties/{id}/resolve-dispute",
  tags: ["Bounties"],
  summary: "Resolve a bounty dispute",
  request: {
    params: z.object({ id: z.string().openapi(bountyIdParam.schema) }),
    body: jsonBody(resolveDisputeBountySchema),
  },
  responses: {
    200: bountyDataResponse("Dispute resolved."),
    400: errorResponse("Bounty is not disputed or the resolution is invalid."),
  },
});

registry.registerPath({
  method: "post",
  path: "/api/bounties/:id/refund",
  tags: ["Bounties"],
  summary: "Refund a bounty",
  description:
    "Transitions an `open` or `reserved` bounty to `refunded`. " +
    "Cannot be called on `submitted`, `released`, or already `refunded` bounties. " +
    "Only the maintainer address recorded on the bounty may call this endpoint. " +
    "Rate-limited to **5 requests per IP per minute**.",
  request: {
    params: z.object({ id: z.string().openapi(bountyIdParam.schema) }),
    body: jsonBody(maintainerActionSchema),
  },
  responses: {
    200: bountyDataResponse("Bounty refunded."),
    400: errorResponse("Bounty not found, already finalised, maintainer mismatch, or validation failed."),
  },
});

registry.registerPath({
  method: "post",
  path: "/api/bounties/:id/cancel",
  tags: ["Bounties"],
  summary: "Cancel an open bounty",
  description:
    "Cancels an `open` bounty before any contributor has reserved it. " +
    "Transitions the bounty to `refunded`, records a `canceledAt` timestamp, and returns the full escrow (no fee). " +
    "Cannot be called on `reserved`, `submitted`, `released`, or already `refunded` bounties. " +
    "Only the maintainer address recorded on the bounty may call this endpoint. " +
    "Rate-limited to **5 requests per IP per minute**.",
  request: {
    params: z.object({ id: z.string().openapi(bountyIdParam.schema) }),
    body: jsonBody(maintainerActionSchema),
  },
  responses: {
    200: bountyDataResponse("Bounty canceled."),
    400: errorResponse("Bounty not found, not open, maintainer mismatch, or validation failed."),
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/bounties/:id/notes",
  tags: ["Bounties"],
  summary: "Update bounty notes",
  description:
    "Updates the maintainer notes for a bounty. " +
    "Only the maintainer address recorded on the bounty may call this endpoint. " +
    "Notes are limited to 2000 characters. " +
    "Rate-limited to **5 requests per IP per minute**.",
  request: {
    params: z.object({ id: z.string().openapi(bountyIdParam.schema) }),
    body: jsonBody(updateNotesSchema),
  },
  responses: {
    200: bountyDataResponse("Notes updated successfully."),
    400: errorResponse("Bounty not found, maintainer mismatch, or validation failed."),
  },
});

registry.registerPath({
  method: "get",
  path: "/api/open-issues",
  tags: ["Open Issues"],
  summary: "List open feature requests",
  description:
    "Returns a curated static list of open feature requests and contribution opportunities for the Stellar Bounty Board project itself.",
  responses: {
    200: jsonResponse("Array of open issues.", z.object({ data: z.array(openIssueSchema) })),
  },
});

const globalMetricsSchema = z
  .object({
    totalBounties: z.number().int().openapi({ example: 42, description: "Total number of bounties created." }),
    openCount: z.number().int().openapi({ example: 10, description: "Number of bounties with status 'open'." }),
    reservedCount: z.number().int().openapi({ example: 5, description: "Number of bounties with status 'reserved'." }),
    submittedCount: z.number().int().openapi({ example: 3, description: "Number of bounties with status 'submitted'." }),
    releasedCount: z.number().int().openapi({ example: 20, description: "Number of bounties with status 'released'." }),
    refundedCount: z.number().int().openapi({ example: 2, description: "Number of bounties with status 'refunded'." }),
    expiredCount: z.number().int().openapi({ example: 2, description: "Number of bounties with status 'expired'." }),
    totalFunded: z.number().openapi({ example: 1250.5, description: "Sum of all bounty amounts in XLM." }),
    totalReleased: z.number().openapi({ example: 850.0, description: "Sum of released bounty amounts in XLM." }),
    uniqueMaintainers: z.number().int().openapi({ example: 8, description: "Count of unique maintainer addresses." }),
    uniqueContributors: z.number().int().openapi({ example: 15, description: "Count of unique contributor addresses." }),
  })
  .openapi("GlobalMetrics");

registry.register("GlobalMetrics", globalMetricsSchema);

registry.registerPath({
  method: "get",
  path: "/api/stats",
  tags: ["Stats"],
  summary: "Global platform metrics",
  description:
    "Returns aggregate statistics for the entire platform including bounty status counts, " +
    "total funded and released amounts, and unique participant counts. " +
    "Response is cached with a **30-second TTL** to reduce computation overhead.",
  responses: {
    200: jsonResponse(
      "Global platform metrics.",
      z.object({ data: globalMetricsSchema }),
    ),
    500: errorResponse("Failed to compute global stats."),
  },
});

const leaderboardEntrySchema = z
  .object({
    address: z.string().openapi({ example: "GBBB...BBB", description: "Contributor Stellar address." }),
    totalXlm: z.number().openapi({ example: 350.5, description: "Total XLM received from released bounties." }),
    bountiesCompleted: z.number().int().openapi({ example: 3, description: "Number of released bounties completed." }),
  })
  .openapi("LeaderboardEntry");

registry.register("LeaderboardEntry", leaderboardEntrySchema);

registry.registerPath({
  method: "get",
  path: "/api/leaderboard",
  tags: ["Leaderboard"],
  summary: "Contributor leaderboard",
  description:
    "Returns the top 10 contributors ranked by total XLM received from released bounties. " +
    "Ties are broken by the number of bounties completed. " +
    "Returns an empty array when no bounties have been released yet.",
  responses: {
    200: jsonResponse(
      "Top 10 contributors by XLM earned.",
      z.object({ data: z.array(leaderboardEntrySchema) }),
    ),
  },
});

const publicConfigSchema = z
  .object({
    feeBps: z.number().int().min(0).max(10_000).openapi({
      example: 250,
      description: "Protocol fee in basis points (250 = 2.5%). 0 means no protocol fee.",
    }),
    disputeWindowSeconds: z.number().int().min(0).openapi({
      example: 86400,
      description: "Seconds that must elapse after a dispute is raised before an arbiter can resolve it.",
    }),
    minBountyAmount: z.number().positive().openapi({
      example: 1,
      description: "Minimum allowed bounty amount in the payment token.",
    }),
    maxBountyAmount: z.number().positive().openapi({
      example: 10000,
      description: "Maximum allowed bounty amount in the payment token.",
    }),
    supportedTokens: z.record(z.string()).openapi({
      example: { XLM: "CAS3J7YBBURBV347V3UAEAOAT2IZU7QHWG7YWCOOOFLBEBGKND655DHA" },
      description: "Allowed token symbols mapped to their Soroban contract addresses.",
    }),
    defaultReservationTtlSeconds: z.number().int().positive().openapi({
      example: 604800,
      description: "Default reservation TTL in seconds (7 days = 604800). After this window a reservation returns to open.",
    }),
    network: z.string().openapi({
      example: "testnet",
      description: "Stellar network the backend is connected to (mainnet, testnet, or futurenet).",
    }),
  })
  .openapi("PublicConfig");

registry.register("PublicConfig", publicConfigSchema);

registry.registerPath({
  method: "get",
  path: "/api/config",
  tags: ["System"],
  summary: "Public runtime configuration",
  description:
    "Returns non-sensitive runtime values that the frontend and contract-interaction layer " +
    "need to stay in sync with the backend without hardcoding anything.\n\n" +
    "**Included:** fee bps, dispute window, min/max bounty amounts, supported token addresses, " +
    "default reservation TTL, and network label.\n\n" +
    "**Never included:** API keys, database connection strings, webhook secrets, " +
    "maintainer public keys, or any other internal-only setting.\n\n" +
    "Response is cached with `Cache-Control: public, max-age=300` (5 min) since these values rarely change.",
  responses: {
    200: jsonResponse("Public runtime configuration.", z.object({ data: publicConfigSchema })),
    500: errorResponse("Failed to build configuration."),
  },
});

registry.registerPath({
  method: "get",
  path: "/api/audit-log",
  tags: ["Admin"],
  summary: "List all audit logs (admin-only)",
  description:
    "Admin-only endpoint that returns a paginated view of all audit log records. Requires a valid x-admin-api-key header.",
  request: {
    query: z.object({
      limit: z.number().int().min(1).max(200).optional().openapi({
        example: 50,
        description: "Maximum number of log records to return (1-200, default 50)",
      }),
      offset: z.number().int().min(0).optional().openapi({
        example: 0,
        description: "Zero-based offset into the audit log list",
      }),
      actor: z.string().optional().openapi({
        description: "Filter logs by actor (Stellar address)",
        example: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      }),
      transition: z.string().optional().openapi({
        description: "Filter logs by transition type",
        example: "release",
      }),
      bountyId: z.string().optional().openapi({
        description: "Filter logs by bounty ID",
        example: "BNT-0001",
      }),
      fromStatus: z.string().optional().openapi({
        description: "Filter logs by fromStatus",
        example: "submitted",
      }),
      toStatus: z.string().optional().openapi({
        description: "Filter logs by toStatus",
        example: "released",
      }),
    }),
  },
  responses: {
    200: jsonResponse("Paginated list of audit logs", bountyAuditLogListResponseSchema),
    401: errorResponse("Invalid or missing x-admin-api-key header"),
  },
});

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------
export function generateOpenApiDocument() {
  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "Stellar Bounty Board API",
      version: "1.0.0",
      description:
        "REST API for the Stellar Bounty Board — a platform for posting, reserving, submitting, " +
        "and releasing on-chain bounties backed by Stellar tokens.\n\n" +
        "**Bounty lifecycle:** `open` → `reserved` → `submitted` → `released`\n\n" +
        "Maintainers may `cancel` an `open` bounty before reservation, or `refund` an `open` or `reserved` bounty after the deadline. " +
        "Bounties whose deadline passes are automatically transitioned to `expired`.",
    },
    servers: [{ url: "http://localhost:3001", description: "Local development server" }],
  });
}
