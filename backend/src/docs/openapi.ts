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
  bountyIdSchema,
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
});