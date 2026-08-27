import type { Request, Response, NextFunction } from "express";
import { verifyMaintainerOwnership } from "../services/githubOwnership";
import { logger } from "../logger";

export interface GitHubOwnershipRequest extends Request {
  githubOwnership?: {
    verified: boolean;
    githubUsername?: string;
    githubUserId?: number;
    permission?: string;
  };
}

export function createRepoOwnershipMiddleware() {
  return async (req: GitHubOwnershipRequest, res: Response, next: NextFunction): Promise<void> => {
    if (process.env.NODE_ENV === "test") {
      next();
      return;
    }

    const githubToken = process.env.GITHUB_TOKEN?.trim() || process.env.GITHUB_APP_TOKEN?.trim();
    if (!githubToken) {
      logger.warn({
        operation: "repoOwnershipCheck",
        message: "GITHUB_TOKEN not configured — skipping ownership verification.",
      });
      next();
      return;
    }

    const { repo, maintainer } = req.body ?? {};

    if (!repo || typeof repo !== "string") {
      next();
      return;
    }

    if (!maintainer || typeof maintainer !== "string") {
      next();
      return;
    }

    try {
      const result = await verifyMaintainerOwnership(repo, maintainer);

      if (!result.verified) {
        logger.warn({
          operation: "repoOwnershipCheck",
          repo,
          maintainer,
          error: result.error,
        });

        res.status(403).json({
          error: result.error || "Repository ownership verification failed.",
          code: "OWNERSHIP_VERIFICATION_FAILED",
          requestId: req.requestId,
        });
        return;
      }

      req.githubOwnership = {
        verified: result.verified,
        githubUsername: result.githubUsername,
        githubUserId: result.githubUserId,
        permission: result.permission,
      };

      next();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logger.error({
        operation: "repoOwnershipCheck",
        repo,
        maintainer,
        error: message,
      });

      res.status(500).json({
        error: "Failed to verify repository ownership. Please try again later.",
        code: "OWNERSHIP_VERIFICATION_ERROR",
        requestId: req.requestId,
      });
    }
  };
}
