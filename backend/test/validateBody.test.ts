import { describe, expect, it } from 'vitest';
import express, { Request, Response } from 'express';
import request from 'supertest';
import { z } from 'zod';
import { validateBody } from '../src/middleware/validateBody';

const schema = z.object({
  name: z.string().min(1),
  age: z.number().int().positive(),
});

function buildApp() {
  const app = express();
  app.use(express.json());
  app.post('/test', validateBody(schema), (req: Request, res: Response) => {
    res.json({ received: req.body });
  });
  return app;
}

describe('validateBody middleware', () => {
  it('passes valid body to next handler', async () => {
    const app = buildApp();
    const res = await request(app).post('/test').send({ name: 'Alice', age: 30 }).expect(200);
    expect(res.body.received).toEqual({ name: 'Alice', age: 30 });
  });

  it('returns 400 with standardized shape on missing field', async () => {
    const app = buildApp();
    const res = await request(app).post('/test').send({ age: 30 }).expect(400);
    expect(res.body.error).toBe('Validation failed');
    expect(Array.isArray(res.body.details)).toBe(true);
    const paths = res.body.details.map((d: { path: string[] }) => d.path.join('.'));
    expect(paths).toContain('name');
  });

  it('returns 400 with standardized shape on wrong type', async () => {
    const app = buildApp();
    const res = await request(app).post('/test').send({ name: 'Alice', age: 'not-a-number' }).expect(400);
    expect(res.body.error).toBe('Validation failed');
    expect(Array.isArray(res.body.details)).toBe(true);
    const paths = res.body.details.map((d: { path: string[] }) => d.path.join('.'));
    expect(paths).toContain('age');
  });

  it('strips extra fields not in schema', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/test')
      .send({ name: 'Alice', age: 25, extra: 'should-be-removed' })
      .expect(200);
    expect(res.body.received).not.toHaveProperty('extra');
    expect(res.body.received).toEqual({ name: 'Alice', age: 25 });
  });

  it('does not expose raw ZodError objects to clients', async () => {
    const app = buildApp();
    const res = await request(app).post('/test').send({}).expect(400);
    expect(res.body).not.toHaveProperty('issues');
    expect(res.body.error).toBe('Validation failed');
    expect(res.body.details).toBeDefined();
  });

  it('sets req.body to the parsed/transformed data', async () => {
    const trimSchema = z.object({ name: z.string().trim() });
    const trimApp = express();
    trimApp.use(express.json());
    trimApp.post('/trim', validateBody(trimSchema), (req: Request, res: Response) => {
      res.json({ name: req.body.name });
    });
    const res = await request(trimApp).post('/trim').send({ name: '  Alice  ' }).expect(200);
    expect(res.body.name).toBe('Alice');
  });
});
