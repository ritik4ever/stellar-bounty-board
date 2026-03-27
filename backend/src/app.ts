import cors from "cors";
import express, { Request, Response } from "express";
import {
  createBounty,
  listBounties,
  refundBounty,
  releaseBounty,
  reserveBounty,
  submitBounty,
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
import { limiter } from "./utils";

export const app = express();

app.use(cors());
app.use(express.json());

function parseId(raw: string | string[] | undefined): string {
  return bountyIdSchema.parse(Array.isArray(raw) ? raw[0] : raw);
}

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw = String(value);
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replaceAll('"', '""')}"`;
  }
  return raw;
}

function sendError(res: Response, error: unknown, statusCode = 400) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  res.status(statusCode).json({ error: message });
}

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({
    service: "stellar-bounty-board-backend",
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/bounties", (_req: Request, res: Response) => {
  res.json({ data: listBounties() });
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
        res.status(400).json({ error: "issueNumber must be a positive integer." });
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
    const timestamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="released-payouts-${timestamp}.csv"`);
    res.status(200).send(`${csv}\n`);
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/bounties", limiter, (req: Request, res: Response) => {
  const parsed = createBountySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: zodErrorMessage(parsed.error) });
    return;
  }

  try {
    const bounty = createBounty(parsed.data);
    res.status(201).json({ data: bounty });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/bounties/:id/reserve", limiter, (req: Request, res: Response) => {
  const parsedBody = reserveBountySchema.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: zodErrorMessage(parsedBody.error) });
    return;
  }

  try {
    const bounty = reserveBounty(parseId(req.params.id), parsedBody.data.contributor);
    res.json({ data: bounty });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/bounties/:id/submit", limiter, (req: Request, res: Response) => {
  const parsedBody = submitBountySchema.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: zodErrorMessage(parsedBody.error) });
    return;
  }

  try {
    const bounty = submitBounty(
      parseId(req.params.id),
      parsedBody.data.contributor,
      parsedBody.data.submissionUrl,
      parsedBody.data.notes,
    );
    res.json({ data: bounty });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/bounties/:id/release", limiter, (req: Request, res: Response) => {
  const parsedBody = maintainerActionSchema.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: zodErrorMessage(parsedBody.error) });
    return;
  }

  try {
    const bounty = releaseBounty(parseId(req.params.id), parsedBody.data.maintainer);
    res.json({ data: bounty });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/bounties/:id/refund", limiter, (req: Request, res: Response) => {
  const parsedBody = maintainerActionSchema.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: zodErrorMessage(parsedBody.error) });
    return;
  }

  try {
    const bounty = refundBounty(parseId(req.params.id), parsedBody.data.maintainer);
    res.json({ data: bounty });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/open-issues", (_req: Request, res: Response) => {
  res.json({ data: listOpenIssues() });
});
