#!/usr/bin/env node

/**
 * Compares two rollup-plugin-visualizer JSON stats files.
 *
 * Usage:
 *   node compare-bundles.js <pr-stats.json> <base-stats.json> [threshold-kb]
 *
 * Outputs:
 *   - Markdown report to stdout (for PR comment)
 *   - Exit code 1 if any chunk exceeds threshold
 */

const fs = require("fs");
const path = require("path");

const prFile = process.argv[2];
const baseFile = process.argv[3];
const thresholdKB = parseInt(process.argv[4] || "200", 10);

function parseStats(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw);

    // Handle rollup-plugin-visualizer v2 tree format
    const children = data.tree && data.tree.children ? data.tree.children : [];
    const parts = data.nodeParts || {};
    const chunks = {};

    if (!Array.isArray(children) || children.length === 0) {
      return chunks;
    }

    // Recursively sum renderedLength for all uids in a subtree
    function collectSum(node) {
      let sum = 0;
      if (!node) return sum;
      if (node.uid && parts[node.uid] && typeof parts[node.uid].renderedLength === "number") {
        sum += parts[node.uid].renderedLength;
      }
      if (Array.isArray(node.children)) {
        for (const child of node.children) {
          sum += collectSum(child);
        }
      }
      return sum;
    }

    for (const chunk of children) {
      if (chunk && typeof chunk.name === "string") {
        const nameWithoutExt = chunk.name.replace(/\.[^/.]+$/, "");
        chunks[nameWithoutExt] = collectSum(chunk);
      }
    }

    return chunks;
  } catch {
    return {};
  }
}

const prChunks = parseStats(prFile);
const baseChunks = parseStats(baseFile);

const allKeys = [...new Set([...Object.keys(prChunks), ...Object.keys(baseChunks)])].sort();

let totalDelta = 0;
const rows = [];
const increases = [];
const decreases = [];
const overThreshold = [];

for (const key of allKeys) {
  const prSize = prChunks[key] || 0;
  const baseSize = baseChunks[key] || 0;
  const delta = prSize - baseSize;
  totalDelta += delta;
  const sizeKB = (prSize / 1024).toFixed(1);
  const deltaKB = (delta / 1024).toFixed(1);
  const icon = delta > 1024 ? "🔴" : delta > 0 ? "🟡" : delta < 0 ? "🟢" : "⚪";

  if (prSize > thresholdKB * 1024) {
    overThreshold.push(`${key} (${sizeKB} KB)`);
  }
  if (delta > 0) increases.push({ key, delta, deltaKB });
  if (delta < 0) decreases.push({ key, delta, deltaKB });

  rows.push(
    `| ${key} | ${sizeKB} KB | ${delta >= 0 ? "+" : ""}${deltaKB} KB | ${icon} |`
  );
}

// ── Build report ──
const lines = [];

lines.push("## 📦 Bundle Size Report");
lines.push("");
lines.push("| Chunk | Size | Δ vs base | |");
lines.push("|-------|------|-----------|------|");
lines.push(...rows);
lines.push("");

lines.push(
  `**Total JS bundle delta:** ${totalDelta >= 0 ? "+" : ""}${(totalDelta / 1024).toFixed(1)} KB`
);
lines.push("");

if (increases.length > 0) {
  increases.sort((a, b) => b.delta - a.delta);
  lines.push("### 📈 Largest increases");
  for (const inc of increases.slice(0, 3)) {
    lines.push(`- ${inc.key}: +${inc.deltaKB} KB`);
  }
  lines.push("");
}

if (decreases.length > 0) {
  decreases.sort((a, b) => a.delta - b.delta);
  lines.push("### 📉 Largest decreases");
  for (const dec of decreases.slice(0, 3)) {
    lines.push(`- ${dec.key}: ${dec.deltaKB} KB`);
  }
  lines.push("");
}

if (overThreshold.length > 0) {
  lines.push(`### ⚠️ Over ${thresholdKB} KB threshold`);
  for (const chunk of overThreshold) {
    lines.push(`- ❌ ${chunk}`);
  }
  lines.push("");
} else {
  lines.push(`### ✅ All chunks under ${thresholdKB} KB threshold`);
  lines.push("");
}

// GitHub Actions artifact link placeholder — replaced by workflow
lines.push("📎 [View bundle analysis artifact](ARTIFACT_URL)");
lines.push("");

const report = lines.join("\n");

// Write report to stdout (captured by workflow)
process.stdout.write(report);

// Exit with error if threshold exceeded
if (overThreshold.length > 0) {
  process.exitCode = 1;
}
