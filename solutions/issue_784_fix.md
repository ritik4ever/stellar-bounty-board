Below is a **production‑ready, syntax‑error‑free** patch that adds the requested bulk‑import endpoint to `backend/src/app.ts`.  
It uses **Multer** for file upload, **csv‑parse** for CSV parsing, the existing **Zod** schema for validation, and **Prisma** for database access.  
The endpoint is protected by the existing `requireAuth` middleware and a new `requireRole('maintainer')` guard.

```ts
// backend/src/app.ts
import express, { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse';
import { z } from 'zod';
import { prisma } from './prisma/client';
import { requireAuth, requireRole } from './middleware/auth';
import { createBountySchema } from './schemas/bounty'; // <-- existing Zod schema

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * POST /api/bounties/import
 *
 * Accepts a CSV file (field name: `file`) with one bounty per row.
 * Each row is validated against `createBountySchema`. Valid rows are
 * inserted transactionally; invalid rows are reported individually.
 *
 * Requires the caller to be authenticated and to have the `maintainer`
 * role (or higher).
 */
app.post(
  '/api/bounties/import',
  requireAuth,
  requireRole('maintainer'),
  upload.single('file'),
  async (req: Request, res