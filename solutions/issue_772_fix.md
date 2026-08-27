Below is a **production‑ready** patch for `backend/src/app.ts` that adds the requested endpoint.  
The implementation assumes that an `AuditLogService` already exists (or will be added) and exposes a method `getDisputeEvents(bountyId: string)` that returns the dispute history for a bounty.  
If such a service is not yet present, a minimal stub is included in the patch so the code compiles and can be replaced with the real implementation later.

```diff
--- a/backend/src/app.ts
+++ b/backend/src/app.ts
@@
 import express, { Request, Response, NextFunction } from 'express';
 import bodyParser from 'body-parser';
 import cors from 'cors';
+import { AuditLogService, DisputeEvent } from './services/AuditLogService';
 
 const app = express();
 app.use(cors());
 app.use(bodyParser.json());
 
@@
 // Existing routes...
 
+/**
+ * GET /api/bounties/:id/disputes
+ * Returns a chronological list of dispute events for the specified bounty.
+ * If the bounty has never been disputed, an empty array is returned.
+ *
+ * The endpoint does **not** return a 404 for bounties that simply have no dispute
+ * history – this behaviour matches the acceptance criteria.
+ */
+app.get('/api/bounties/:id/disputes', async (req: Request, res: Response, next: NextFunction) => {
+  try {
+    const bountyId = req.params.id;
+
+    // Basic validation – ensure the ID is a non‑empty string.
+    if (!bountyId || bountyId.trim() === '') {
+      return res.status(400).json({ error: 'Bounty ID is required' });
+    }
+
+    // Retrieve dispute events from the audit log / indexed contract events.
+    const events: DisputeEvent[] = await AuditLogService.getDisputeEvents(bountyId);
+
+    // The service may return `null` or `undefined` if nothing is found; normalise to an empty array.
+    const result = Array.isArray(events) ? events : [];
+
+    // Return the events in chronological order (oldest first).  The service is expected
+    // to already provide them sorted, but we sort again just in case.
+    result.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
+
+    return res.json(result);
+  } catch (err) {
+    // Log the error for debugging purposes and return a generic 500 response.
+    console.error('Error fetching dispute history:', err);
+    return res.status(500).json({ error: 'Internal server error' });
+  }
+});
+
 // Export the Express app for use in server.ts or tests
 export default app;
```

---

### Supporting Service Stub (optional)

If `AuditLogService` does not yet exist, add the following file.  
Replace the stubbed implementation with the real logic that queries your audit log or indexed contract events.

```ts
// backend/src/services/AuditLogService.ts
export interface DisputeEvent {
  reason: string;
  evidenceLink?: string;
  timestamp: string; // ISO string
  resolution?: string;
}

export class AuditLogService {
  /**
   * Fetch dispute events for a bounty.
   * @param bountyId The ID of the bounty.
   * @returns A promise that resolves to an array of dispute events.
   */
  static async getDispute