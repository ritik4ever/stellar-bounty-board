import { Router, Request, Response } from "express";
import { errorHandler } from "../utils";

const router = Router();

/**
 * Example bounty route. In a real implementation these would call the Soroban
 * contract and throw ContractError variants on failure. This demonstrates the
 * error taxonomy middleware.
 */
router.get("/:id", (req: Request, res: Response) => {
  const { id } = req.params;

  if (id === "known-error") {
    throw new Error("ContractError::NotFound");
  }
  if (id === "unknown-error") {
    throw new Error("Unexpected database connection failure");
  }

  res.json({ id, status: "ok" });
});

// The error handler must be mounted last so it catches thrown errors.
router.use(errorHandler);

export default router;
