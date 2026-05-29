#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) {
  console.error('GITHUB_TOKEN environment variable is required');
  process.exit(1);
}

const REPO = process.env.GITHUB_REPOSITORY || 'ritik4ever/stellar-bounty-board';
const API = 'https://api.github.com';
const ISSUES_DIR = path.resolve(__dirname, '..', 'docs', 'issues');

async function apiFetch(path, options = {}) {
  const url = `${API}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'stellar-bounty-board-script',
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status} for ${path}: ${body}`);
  }
  return res;
}

async function fetchAllIssues() {
  const issues = [];
  let page = 1;
  for (;;) {
    const res = await apiFetch(`/repos/${REPO}/issues?state=all&per_page=100&page=${page}`);
    const batch = await res.json();
    if (!batch.length) break;
    issues.push(...batch);
    page++;
  }
  return issues;
}

function parseLabels(raw) {
  if (!raw) return [];
  let line = raw.trim();

  const jsonMatch = line.match(/^\[.*\]$/);
  if (jsonMatch) {
    try {
      return JSON.parse(line).map((l) => l.replace(/^['"]|['"]$/g, ''));
    } catch {
      return [];
    }
  }

  const labels = [];
  const backtickRe = /`([^`]+)`/g;
  let m;
  while ((m = backtickRe.exec(line)) !== null) {
    labels.push(m[1]);
  }
  if (labels.length) return labels;

  return line.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

function parseFrontmatter(content) {
  const lines = content.split('\n');
  if (lines[0].trim() !== '---') return null;
  const fm = {};
  let i = 1;
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '---') break;
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim().toLowerCase();
    let value = line.slice(colonIdx + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    fm[key] = value;
  }
  const body = lines.slice(i + 1).join('\n').trim();
  return { fm, body, endIndex: i };
}

function parseIssueFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8').trim();
  const fmResult = parseFrontmatter(content);

  let title;
  let labels;
  let body;

  if (fmResult) {
    title = fmResult.fm.title || fmResult.fm.name || path.basename(filePath, '.md');
    labels = parseLabels(fmResult.fm.labels);
    body = fmResult.body;
    return { title, labels, body };
  }

  const lines = content.split('\n');
  const titleLine = lines.find((l) => l.startsWith('# '));
  title = titleLine ? titleLine.replace(/^# /, '').trim() : path.basename(filePath, '.md');

  const labelsLine = lines.find((l) => l.startsWith('Labels:'));
  labels = labelsLine ? parseLabels(labelsLine.replace(/^Labels:\s*/, '')) : [];

  const labelIndex = lines.findIndex((l) => l.startsWith('Labels:'));
  const titleIndex = lines.findIndex((l) => l.startsWith('# '));
  const bodyStart = Math.max(titleIndex === -1 ? 0 : titleIndex + 1, labelIndex === -1 ? 0 : labelIndex + 1);
  body = lines.slice(bodyStart).join('\n').trim();

  return { title, labels, body };
}

async function createIssue(title, labels, body) {
  const res = await apiFetch(`/repos/${REPO}/issues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, labels, body }),
  });
  return res.json();
}

async function main() {
  if (!fs.existsSync(ISSUES_DIR)) {
    console.error(`Directory not found: ${ISSUES_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(ISSUES_DIR).filter((f) => f.endsWith('.md'));
  if (!files.length) {
    console.log('No .md files found in docs/issues/. Nothing to do.');
    return;
  }

  console.log(`Reading ${files.length} issue draft(s) from ${ISSUES_DIR}...\n`);

  const existing = await fetchAllIssues();
  const existingTitles = new Set(existing.map((i) => i.title.trim().toLowerCase()));

  let created = 0;
  let skipped = 0;

  for (const file of files) {
    const filePath = path.join(ISSUES_DIR, file);
    const { title, labels, body } = parseIssueFile(filePath);

    if (existingTitles.has(title.trim().toLowerCase())) {
      console.log(`[SKIP] "${title}" — already exists`);
      skipped++;
      continue;
    }

    const issue = await createIssue(title, labels, body);
    console.log(`[CREATE] "${title}" → ${issue.html_url}`);
    created++;
  }

  console.log(`\nDone. ${created} created, ${skipped} skipped.`);
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
