import { OpenApiGeneratorV31, OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import {
  bountyRecordSchema,
  createBountySchema,
  errorResponseSchema,
  healthResponseSchema,
  maintainerActionSchema,
  openIssueSchema,
  reserveBountySchema,
  submitBountySchema,
} from "../validation/schemas";

const registry = new OpenAPIRegistry();

// ---------------------------------------------------------------------------
// Register all named schemas so they appear in #/components/schemas
// ---------------------------------------------------------------------------
registry.register("BountyRecord", bountyRecordSchema);
registry.register("CreateBountyRequest", createBountySchema);
registry.register("ReserveBountyRequest", reserveBountySchema);
registry.register("SubmitBountyRequest", submitBountySchema);
registry.register("MaintainerActionRequest", maintainerActionSchema);
registry.register("ErrorResponse", errorResponseSchema);
registry.register("OpenIssue", openIssueSchema);
registry.register("HealthResponse", healthResponseSchema);

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
    200: jsonResponse("Service is healthy.", z.object({ data: healthResponseSchema })),
  },
});

registry.registerPath({
  method: "get",
  path: "/api/bounties",
  tags: ["Bounties"],
  summary: "List all bounties",
  description:
    "Returns every bounty record sorted by creation date (newest first). " +
    "Bounties whose deadline has passed are automatically transitioned to `expired` before the list is returned.",
  responses: {
    200: jsonResponse("Array of all bounty records.", z.object({ data: z.array(bountyRecordSchema) })),
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
  path: "/api/bounties/{id}/refund",
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
        "Maintainers may also `refund` an `open` or `reserved` bounty at any time. " +
        "Bounties whose deadline passes are automatically transitioned to `expired`.",
    },
    servers: [{ url: "http://localhost:3001", description: "Local development server" }],
  });
}
