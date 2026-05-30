#!/usr/bin/env node
/**
 * Reads Markdown files from docs/issues/ and creates GitHub issues via the API.
 * Skips issues whose title already exists.
 *
 * Usage:
 *   GITHUB_TOKEN=ghp_xxx node scripts/create-issues-from-docs.js
 *
 * Environment variables:
 *   GITHUB_TOKEN   - GitHub personal access token (required)
 *   GH_REPO        - Target repo, default "ritik4ever/stellar-bounty-board"
 */

const fs = require("fs");
const path = require("path");

const ISSUES_DIR = path.resolve(__dirname, "..", "docs", "issues");
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GH_REPO = process.env.GH_REPO || "ritik4ever/stellar-bounty-board";
const API_BASE = `https://api.github.com/repos/${GH_REPO}/issues`;

if (!GITHUB_TOKEN) {
  console.error("Error: GITHUB_TOKEN environment variable is required.");
  process.exit(1);
}

if (!fs.existsSync(ISSUES_DIR)) {
  console.error(`Error: Issues directory not found: ${ISSUES_DIR}`);
  process.exit(1);
}

async function getExistingIssueTitles() {
  const titles = new Set();
  let page = 1;
  while (true) {
    const res = await fetch(`${API_BASE}?state=all&per_page=100&page=${page}`, {
      headers: { Authorization: `token ${GITHUB_TOKEN}` },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch issues: ${res.status} ${res.statusText}`);
    }
    const issues = await res.json();
    if (issues.length === 0) break;
    for (const issue of issues) {
      if (!issue.pull_request) {
        titles.add(issue.title);
      }
    }
    page++;
  }
  return titles;
}

function parseMdFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split("\n");

  // Extract title from first # heading
  let title = "";
  let labels = [];
  let bodyLines = [];
  let inFrontmatter = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for frontmatter
    if (i === 0 && line.trim() === "---") {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter) {
      if (line.trim() === "---") {
        inFrontmatter = false;
        continue;
      }
      const labelMatch = line.match(/^labels:\s*\[(.+)\]/);
      if (labelMatch) {
        labels = labelMatch[1].split(",").map((l) => l.trim().replace(/"/g, ""));
      }
      continue;
    }

    // First # heading is the title
    const headingMatch = line.match(/^#\s+(.+)/);
    if (headingMatch && !title) {
      title = headingMatch[1].trim();
      continue;
    }

    bodyLines.push(line);
  }

  if (!title) {
    title = path.basename(filePath, ".md").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  return { title, labels, body: bodyLines.join("\n").trim() };
}

async function createIssue({ title, labels, body }) {
  const res = await fetch(API_BASE, {
    method: "POST",
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title, labels: labels.length > 0 ? labels : ["documentation"], body }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Failed to create issue "${title}": ${res.status} ${errBody}`);
  }

  const issue = await res.json();
  return issue;
}

async function main() {
  const files = fs.readdirSync(ISSUES_DIR).filter((f) => f.endsWith(".md"));

  if (files.length === 0) {
    console.log("No Markdown files found in docs/issues/.");
    return;
  }

  console.log(`Found ${files.length} issue drafts in docs/issues/`);

  const existingTitles = await getExistingIssueTitles();
  console.log(`Existing issues: ${existingTitles.size}`);

  let created = 0;
  let skipped = 0;

  for (const file of files) {
    const filePath = path.join(ISSUES_DIR, file);
    const { title, labels, body } = parseMdFile(filePath);

    if (existingTitles.has(title)) {
      console.log(`⏭️  Skipped (already exists): "${title}"`);
      skipped++;
      continue;
    }

    console.log(`Creating issue: "${title}" with labels: ${labels.join(", ") || "(default: documentation)"}`);
    const issue = await createIssue({ title, labels, body });
    console.log(`✅ Created: ${issue.html_url}`);
    created++;
  }

  console.log(`\nDone: ${created} created, ${skipped} skipped`);
}

main().catch((err) => {
  console.error("Script failed:", err.message);
  process.exit(1);
});
