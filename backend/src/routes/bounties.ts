import { Router, type Request, type Response } from "express";
import { eventBus, type StreamFilter } from "../services/eventBus";

const router = Router();

router.get("/stream", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const filters: StreamFilter = {};
  if (typeof req.query.bountyId === "string" && req.query.bountyId) {
    filters.bountyId = req.query.bountyId;
  }
  if (typeof req.query.maintainerAddress === "string" && req.query.maintainerAddress) {
    filters.maintainerAddress = req.query.maintainerAddress;
  }

  const lastEventIdHeader = req.headers["last-event-id"];
  const lastEventId =
    typeof lastEventIdHeader === "string"
      ? Number(lastEventIdHeader)
      : typeof req.query.lastEventId === "string"
        ? Number(req.query.lastEventId)
        : 0;
  const sinceId = Number.isFinite(lastEventId) && lastEventId > 0 ? lastEventId : 0;

  res.write(": connected\n\n");

  if (sinceId > 0) {
    const missedEvents = eventBus.getHistorySince(sinceId, filters);
    for (const ev of missedEvents) {
      res.write(`id: ${ev.id}\nevent: ${ev.event}\ndata: ${JSON.stringify(ev.payload)}\n\n`);
    }
  }

  const unsubscribe = eventBus.subscribe(filters, (chunk: string) => {
    res.write(chunk);
  });

  const heartbeat = setInterval(() => {
    res.write(": ping\n\n");
  }, 30000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
});

export default router;