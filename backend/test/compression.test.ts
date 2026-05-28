import http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validCreateBody } from "./fixtures";

let storeFile: string;

beforeEach(() => {
  storeFile = path.join(os.tmpdir(), `bounty-compression-${randomUUID()}.json`);
  fs.writeFileSync(storeFile, "[]", "utf8");
  process.env.BOUNTY_STORE_PATH = storeFile;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.BOUNTY_STORE_PATH;
  for (const file of [storeFile, storeFile.replace(/\.json$/i, ".audit.json")]) {
    try {
      fs.unlinkSync(file);
    } catch {
      /* best-effort cleanup */
    }
  }
});

async function getApp() {
  const { app } = await import("../src/app");
  return app;
}

function listen(app: http.RequestListener): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, () => resolve(server));
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function gzipRequest(port: number): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        port,
        path: "/api/bounties",
        headers: {
          "Accept-Encoding": "gzip",
        },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("response compression", () => {
  it("gzip-compresses API responses larger than 1KB", async () => {
    const app = await getApp();

    for (let i = 0; i < 20; i += 1) {
      await request(app)
        .post("/api/bounties")
        .send({
          ...validCreateBody,
          issueNumber: 10_000 + i,
        })
        .expect(201);
    }

    const uncompressed = await request(app).get("/api/bounties").expect(200);
    expect(Buffer.byteLength(uncompressed.text)).toBeGreaterThan(1024);

    const server = await listen(app);
    try {
      const address = server.address();
      if (typeof address !== "object" || address === null) {
        throw new Error("Expected server to listen on a TCP port");
      }

      const res = await gzipRequest(address.port);
      expect(res.headers["content-encoding"]).toBe("gzip");
    } finally {
      await close(server);
    }
  });
});
