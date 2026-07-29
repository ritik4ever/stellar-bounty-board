import { trace, context as otelContext, SpanStatusCode } from "@opentelemetry/api";
import type { Request, Response, NextFunction, RequestHandler } from "express";

const TRACER_NAME = "stellar-bounty-board";

export function traceRoute(
  spanName: string,
  handler: RequestHandler,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const tracer = trace.getTracer(TRACER_NAME);
    const span = tracer.startSpan(`route.${spanName}`, {
      attributes: {
        "http.method": req.method,
        ...(req.params?.id ? { "bounty.id": req.params.id } : {}),
      },
    });

    res.on("finish", () => {
      span.setAttribute("http.status_code", res.statusCode);
      if (res.statusCode >= 400) {
        span.setStatus({ code: SpanStatusCode.ERROR });
      }
      span.end();
    });

    otelContext.with(trace.setSpan(otelContext.active(), span), () => {
      try {
        const result = handler(req, res, next);
        if (result instanceof Promise) {
          result.catch(() => {});
        }
      } catch (err) {
        next(err);
      }
    });
  };
}
