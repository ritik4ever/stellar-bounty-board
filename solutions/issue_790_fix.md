Below is a **drop‑in patch** for `backend/src/app.ts`.  
It adds a production‑ready Server‑Sent Events (SSE) stream for bounty status updates, wires the stream to the existing mutation logic via an exported helper, and supports filtering, reconnection, and back‑fill.

```ts
// backend/src/app.ts
import express, { Request, Response, NextFunction } from 'express';
import { EventEmitter } from 'events';
import cors from 'cors';
import bodyParser from 'body-parser';

// -----------------------------------------------------------------------------
// Existing app setup (unchanged)
// -----------------------------------------------------------------------------
const app = express();
app.use(cors());
app.use(bodyParser.json());

// ... (other routes, middleware, etc.)

// -----------------------------------------------------------------------------
// SSE / WebSocket push channel for bounty status updates
// -----------------------------------------------------------------------------

/**
 * Event payload for a bounty status change.
 */
interface BountyStatusEvent {
  id: number;          // monotonically increasing event id
  bountyId: string;    // id of the bounty that changed
  status: string;      // new status
  maintainer: string;  // maintainer address
  timestamp: number;   // epoch ms
}

/**
 *