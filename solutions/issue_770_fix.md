Below is a **drop‑in replacement** for the `backend/src/app.ts` file (or the portion that contains the routing logic).  
It adds a fully‑typed, production‑ready `PATCH /api/bounties/:id` endpoint that satisfies every point in the issue description.

```ts
// backend/src/app.ts
import express, { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getBountyById, updateBounty } from './services/bountyService';
import { auditLog } from './services/auditLogService';
import { requireMaintainerAuth } from './middleware/auth';
import { isISODate } from './utils/date';

const app = express();
app.use(express.json());

// -----------------------------------------------------------------------------
// PATCH /api/bounties/:id
// -----------------------------------------------------------------------------
// 1️⃣  Zod schema – only the editable fields are allowed.
//     `strict()` guarantees that no other keys slip through.
const patchBountySchema = z
  .object({
    title: z.string().min(1).max(255).optional(),
    description: z.string().max(5000).optional(),
    labels: z.array(z.string().min(1)).optional(),
    deadline: z
      .string()
      .refine(isISODate, { message: 'Deadline must be a valid ISO‑8601 date' })
      .optional(),
  })
  .strict(); // ← rejects any immutable field (amount, status, contributor, …)

// 2️⃣  Route handler
app.patch(
  '/api/bounties/:id',
  requireMaintainerAuth, // ← ensures the user is authenticated & a maintainer
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // 3️⃣  Validate request body
      const parsed = patchBountySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'Validation failed',
          details: parsed.error.format(),
        });
      }

      const bountyId = req.params.id;
      const bounty = await getBountyById(bountyId);

      // 4️⃣  Bounty must exist
      if (!bounty) {
        return res.status(404).json({ error: 'Bounty not found' });
      }

      // 5️⃣  Only the bounty’s maintainer may edit it
      if (req.user.id !== bounty.maintainerId) {
        return res.status(403).json({ error: 'Forbidden: not your bounty' });
      }

      // 6️⃣  Compute the diff – only record fields that actually change
      const changes: Record<string, { old: any; new: any }> = {};
      for (const key of Object.keys(parsed.data) as Array<keyof typeof parsed.data>) {
        const oldValue = (bounty as any)[key];
        const newValue = parsed.data[key];
        // eslint-disable-next-line @typescript-eslint/no-unsafe-compare
        if (oldValue !== newValue) {
          changes[key] = { old: