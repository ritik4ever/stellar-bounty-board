/** Run with: cd backend && npx tsx scripts/benchmark-bounty-archive.ts */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { archiveOldBounties } from '../src/services/archiveScheduler';
import { listBounties } from '../src/services/bountyStore';
import type { BountyRecord } from '../src/services/bountyStore';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bounty-archive-bench-'));
process.env.BOUNTY_STORE_PATH = path.join(directory, 'bounties.json');
const now = Math.floor(Date.now() / 1000);
const base = {
  repo: 'acme/repo',
  issueNumber: 1,
  title: 'Benchmark bounty',
  summary: 'Benchmark',
  maintainer: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  tokenSymbol: 'XLM',
  tokenAddress: 'token',
  amount: 1,
  labels: [],
  createdAt: now - 120 * 86400,
  deadlineAt: now + 86400,
  version: 1,
  events: [],
};
const old = Array.from({ length: 10_000 }, (_, i) => ({
  ...base,
  id: `BNT-${i + 1}`,
  status: 'released' as const,
  releasedAt: now - 100 * 86400,
}));
const active = Array.from({ length: 100 }, (_, i) => ({
  ...base,
  id: `BNT-${i + 10_001}`,
  status: 'open' as const,
}));

function measure(): number {
  const samples: number[] = [];
  for (let i = 0; i < 120; i++) {
    const start = performance.now();
    listBounties();
    if (i >= 20) samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

async function main(): Promise<void> {
  try {
    fs.writeFileSync(
      process.env.BOUNTY_STORE_PATH!,
      JSON.stringify([...old, ...active] satisfies BountyRecord[])
    );
    const beforeBytes = fs.statSync(process.env.BOUNTY_STORE_PATH!).size;
    const before = measure();
    await archiveOldBounties(90 * 86400);
    const afterBytes = fs.statSync(process.env.BOUNTY_STORE_PATH!).size;
    const after = measure();
    process.stdout.write(
      JSON.stringify({
        oldRecords: old.length,
        activeRecords: active.length,
        iterations: 100,
        beforeBytes,
        afterBytes,
        beforeMedianMs: before,
        afterMedianMs: after,
      }) + '\n'
    );
  } finally {
    delete process.env.BOUNTY_STORE_PATH;
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

void main();
