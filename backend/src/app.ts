import cors from "cors";
import express, { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";
import swaggerUi from "swagger-ui-express";
import { buildCorsOptions } from "./middleware/corsOptions";
import { generateOpenApiDocument } from "./docs/openapi";

import {
  createBounty,
  listBountyAuditLogs,
  listBounties,
  listBountiesCached,
  refundBounty,
  releaseBounty,
  reserveBounty,
  submitBounty,
  getBountyEvents,
  getMaintainerMetrics,
  getGlobalMetrics,
  getLeaderboard,
} from "./services/bountyStore";
import { listOpenIssues } from "./services/openIssues";
import {
  bountyIdSchema,
  createBountySchema,
  maintainerActionSchema,
  reserveBountySchema,
  submitBountySchema,
  zodErrorMessage,
} from "./validation/schemas";
import { logStructured } from "./logger";
import { readLimiter, mutationLimiter } from "./utils";
import {
  captureRawBody,
  createGitHubWebhookSignatureMiddleware,
} from "./webhooks/signatureVerification";
import { handleGitHubPrEvent } from "./webhooks/githubPrHandler";

const INCOMING_REQUEST_ID = /^[a-zA-Z0-9-]{1,128}$/;



function resolveRequestId(req: Request): string {
  const raw = req.headers["x-request-id"];
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (INCOMING_REQUEST_ID.test(trimmed)) {
      return trimmed;
    }
  }
  return randomUUID();
}

function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = resolveRequestId(req);
  req.requestId = requestId;
  res.setHeader("X-Request-ID", requestId);

  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const durationNs = process.hrtime.bigint() - start;
    const durationMs = Number(durationNs) / 1e6;
    logStructured("info", "http_request", {
      requestId,
      method: req.method,
      path: req.path || "/",
      status: res.statusCode,
      durationMs: Math.round(durationMs * 1000) / 1000,
    });
  });

  next();
}

export const app = express();

app.use(cors(buildCorsOptions()));

// Parse JSON bodies; capture raw body for webhook signature verification
app.use(
  express.json({
    verify: captureRawBody,
  }),
);
app.use(requestContextMiddleware);

// Global read limit (GET only); mutation routes carry a stricter limit (#349).
app.use(readLimiter);

const swaggerDoc = generateOpenApiDocument();
app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerDoc));

function parseId(raw: string | string[] | undefined): string {
  return bountyIdSchema.parse(Array.isArray(raw) ? raw[0] : raw);
}

function parsePaginationValue(
  raw: unknown,
  field: string,
  defaultValue: number,
  min: number,
  max?: number,
): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }
  if (typeof value !== "string") {
    throw new Error(`${field} must be an integer.`);
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${field} must be an integer.`);
  }
  if (parsed < min) {
    throw new Error(`${field} must be greater than or equal to ${min}.`);
  }
  if (max !== undefined && parsed > max) {
    throw new Error(`${field} must be less than or equal to ${max}.`);
  }

  return parsed;
}

function jsonError(res: Response, req: Request, statusCode: number, message: string) {
  res.status(statusCode).json({ error: message, requestId: req.requestId });
}

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw = String(value);
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function sendError(res: Response, req: Request, error: unknown, statusCode = 400) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  jsonError(res, req, statusCode, message);
}

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({
    service: "stellar-bounty-board-backend",
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

app.get("/worker/health", (_req: Request, res: Response) => {
  res.json({
    service: "stellar-bounty-board-worker",
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/bounties", async (req: Request, res: Response) => {
  const q = typeof req.query.q === "string" ? req.query.q : undefined;
  res.json({ data: await listBountiesCached({ q }) });
});

app.get("/api/leaderboard", (_req: Request, res: Response) => {
  res.json({ data: getLeaderboard() });
});

app.get("/api/bounties/:id/audit-logs", (req: Request, res: Response) => {
  try {
    const limit = parsePaginationValue(req.query.limit, "limit", 20, 1, 100);
    const offset = parsePaginationValue(req.query.offset, "offset", 0, 0);
    const page = listBountyAuditLogs(parseId(req.params.id), { limit, offset });
    res.json(page);
  } catch (error) {
    sendError(res, req, error);
  }
});

app.get("/api/bounties/released/export.csv", (req: Request, res: Response) => {
  try {
    const { repo, contributor, asset, issueNumber } = req.query;

    let released = listBounties().filter((bounty) => bounty.status === "released");

    if (typeof repo === "string" && repo.trim()) {
      const expected = repo.trim().toLowerCase();
      released = released.filter((bounty) => bounty.repo.toLowerCase() === expected);
    }

    if (typeof contributor === "string" && contributor.trim()) {
      const expected = contributor.trim();
      released = released.filter((bounty) => bounty.contributor === expected);
    }

    if (typeof asset === "string" && asset.trim()) {
      const expected = asset.trim().toUpperCase();
      released = released.filter((bounty) => bounty.tokenSymbol.toUpperCase() === expected);
    }

    if (typeof issueNumber === "string" && issueNumber.trim()) {
      const parsed = Number(issueNumber);
      if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
        jsonError(res, req, 400, "issueNumber must be a positive integer.");
        return;
      }
      released = released.filter((bounty) => bounty.issueNumber === parsed);
    }

    const header = ["repo", "issue_number", "contributor", "asset", "amount", "released_at"].join(",");
    const rows = released
      .sort((a, b) => (b.releasedAt ?? 0) - (a.releasedAt ?? 0))
      .map((bounty) => {
        const releasedAtIso = bounty.releasedAt
          ? new Date(bounty.releasedAt * 1000).toISOString()
          : "";
        return [
          escapeCsv(bounty.repo),
          escapeCsv(bounty.issueNumber),
          escapeCsv(bounty.contributor ?? ""),
          escapeCsv(bounty.tokenSymbol),
          escapeCsv(bounty.amount),
          escapeCsv(releasedAtIso),
        ].join(",");
      });

    const csv = [header, ...rows].join("\n");
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="released-payouts-${timestamp}.csv"`);
    res.status(200).send(`${csv}\n`);
  } catch (error) {
    sendError(res, req, error);
  }
});

app.post("/api/bounties", mutationLimiter, async (req: Request, res: Response) => {
  const parsed = createBountySchema.safeParse(req.body);
  if (!parsed.success) {
    jsonError(res, req, 400, zodErrorMessage(parsed.error));
    return;
  }

  try {
    const bounty = await createBounty(parsed.data);
    res.status(201).json({ data: bounty });
  } catch (error) {
    sendError(res, req, error);
  }
});

app.post("/api/bounties/:id/reserve", mutationLimiter, async (req: Request, res: Response) => {
  const parsedBody = reserveBountySchema.safeParse(req.body);
  if (!parsedBody.success) {
    jsonError(res, req, 400, zodErrorMessage(parsedBody.error));
    return;
  }

  try {
    const bounty = await reserveBounty(parseId(req.params.id), parsedBody.data.contributor, parsedBody.data.expectedVersion);
    res.json({ data: bounty });
  } catch (error) {
    sendError(res, req, error);
  }
});

app.post("/api/bounties/:id/submit", mutationLimiter, async (req: Request, res: Response) => {
  const parsedBody = submitBountySchema.safeParse(req.body);
  if (!parsedBody.success) {
    jsonError(res, req, 400, zodErrorMessage(parsedBody.error));
    return;
  }

  try {
    const bounty = await submitBounty(
      parseId(req.params.id),
      parsedBody.data.contributor,
      parsedBody.data.submissionUrl,
      parsedBody.data.notes,
    );
    res.json({ data: bounty });
  } catch (error) {
    sendError(res, req, error);
  }
});

app.post("/api/bounties/:id/release", mutationLimiter, async (req: Request, res: Response) => {
  const parsedBody = maintainerActionSchema.safeParse(req.body);
  if (!parsedBody.success) {
    jsonError(res, req, 400, zodErrorMessage(parsedBody.error));
    return;
  }

  try {
    const bounty = await releaseBounty(
      parseId(req.params.id),
      parsedBody.data.maintainer,
      parsedBody.data.transactionHash,
    );
    res.json({ data: bounty });
  } catch (error) {
    sendError(res, req, error);
  }
});

app.post("/api/bounties/:id/refund", mutationLimiter, async (req: Request, res: Response) => {
  const parsedBody = maintainerActionSchema.safeParse(req.body);
  if (!parsedBody.success) {
    jsonError(res, req, 400, zodErrorMessage(parsedBody.error));
    return;
  }

  try {
    const bounty = await refundBounty(
      parseId(req.params.id),
      parsedBody.data.maintainer,
      parsedBody.data.transactionHash,
    );
    res.json({ data: bounty });
  } catch (error) {
    sendError(res, req, error);
  }
});

app.post(
  "/api/webhooks/github",
  createGitHubWebhookSignatureMiddleware(() => process.env.GITHUB_WEBHOOK_SECRET),
  async (req: Request, res: Response) => {
    try {
      await handleGitHubPrEvent(req.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Webhook processing error";
      res.status(500).json({ error: message, requestId: req.requestId });
      return;
    }
    res.status(202).json({
      data: {
        authenticated: true,
        provider: "github",
        received: true,
      },
    });
  },
);

app.get("/api/open-issues", (_req: Request, res: Response) => {
  res.json({ data: listOpenIssues() });
});


app.get("/api/bounties/:id/events", (req: Request, res: Response) => {
  try {
    const events = getBountyEvents(parseId(req.params.id));
    res.json({ data: events });
  } catch (error) {
    sendError(res, req, error);
  }
});

app.get("/api/bounties/:id", (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    const bounties = listBounties();
    const bounty = bounties.find((b) => b.id === id);
    if (!bounty) {
      jsonError(res, req, 404, "Bounty not found.");
      return;
    }
    res.json({ data: bounty });
  } catch (error) {
    sendError(res, req, error, 400);
  }
});

app.get("/api/maintainers/:maintainer/metrics", (req: Request, res: Response) => {
  try {
    const { maintainer } = req.params;
    if (!maintainer || typeof maintainer !== "string") {
      jsonError(res, req, 400, "Maintainer address is required.");
      return;
    }
    const metrics = getMaintainerMetrics(maintainer);
    res.json({ data: metrics });
  } catch (error) {
    sendError(res, req, error);
  }
});

app.get("/api/metrics", (_req: Request, res: Response) => {
  try {
    const metrics = getGlobalMetrics();
    res.json({ data: metrics });
  } catch (error) {


  }
});

app.get("/api/leaderboard", (req: Request, res: Response) => {
  try {
    const limit = parsePaginationValue(req.query.limit, "limit", 10, 1, 100);
    const leaderboard = getLeaderboard(limit);
    res.json({ data: leaderboard });
  } catch (error) {
    sendError(res, req, error);
  }
});
