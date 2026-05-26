#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const process = require("node:process");
const { execFileSync } = require("node:child_process");

const DEFAULT_DOCS_DIR = path.join(process.cwd(), "docs", "issues");

function parseArgs(argv) {
  const options = {
    docsDir: DEFAULT_DOCS_DIR,
    dryRun: false,
    owner: undefined,
    repo: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--dir" && next) {
      options.docsDir = path.resolve(next);
      index += 1;
      continue;
    }

    if (arg === "--owner" && next) {
      options.owner = next;
      index += 1;
      continue;
    }

    if (arg === "--repo" && next) {
      options.repo = next;
      index += 1;
    }
  }

  return options;
}

function inferRepository() {
  if (process.env.GITHUB_REPOSITORY) {
    const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");
    return { owner, repo };
  }

  try {
    const remoteUrl = execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/);
    if (match) {
      return { owner: match[1], repo: match[2] };
    }
  } catch {
    // Fall through to explicit argument validation.
  }

  return {};
}

function parseFrontmatter(markdown) {
  if (!markdown.startsWith("---\n")) {
    return { data: {}, content: markdown };
  }

  const endIndex = markdown.indexOf("\n---", 4);
  if (endIndex === -1) {
    return { data: {}, content: markdown };
  }

  const frontmatter = markdown.slice(4, endIndex).trim();
  const content = markdown.slice(endIndex + 4).replace(/^\s*\n/, "");
  const data = {};

  for (const line of frontmatter.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    data[key] = parseFrontmatterValue(rawValue);
  }

  return { data, content };
}

function parseFrontmatterValue(rawValue) {
  const trimmed = rawValue.trim();

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }

  if (trimmed === "[]") {
    return [];
  }

  return trimmed.replace(/^["']|["']$/g, "");
}

function parseLabels(content, frontmatterLabels) {
  if (Array.isArray(frontmatterLabels)) {
    return frontmatterLabels;
  }

  if (typeof frontmatterLabels === "string" && frontmatterLabels.trim()) {
    return [frontmatterLabels.trim()];
  }

  const labelsLine = content.match(/^Labels:\s*(.+)$/im);
  if (!labelsLine) {
    return [];
  }

  return labelsLine[1]
    .split(",")
    .map((label) => label.trim().replace(/^`|`$/g, ""))
    .filter(Boolean);
}

function parseIssue(markdown, filePath) {
  const { data, content } = parseFrontmatter(markdown);
  const heading = content.match(/^#\s+(.+)$/m);
  const title = (heading?.[1] || data.title || path.basename(filePath, ".md")).trim();
  const labels = parseLabels(content, data.labels);
  const body = content.trim();

  return { title, labels, body };
}

async function readIssueDrafts(docsDir) {
  const entries = await fs.readdir(docsDir, { withFileTypes: true });
  const markdownFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.join(docsDir, entry.name))
    .sort();

  return Promise.all(
    markdownFiles.map(async (filePath) => ({
      filePath,
      ...parseIssue(await fs.readFile(filePath, "utf8"), filePath),
    })),
  );
}

async function githubRequest(endpoint, token, options = {}) {
  const response = await fetch(`https://api.github.com${endpoint}`, {
    ...options,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
      ...options.headers,
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${endpoint} failed with ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function listExistingIssueTitles(owner, repo, token) {
  const titles = new Set();
  let page = 1;

  while (true) {
    const issues = await githubRequest(`/repos/${owner}/${repo}/issues?state=all&per_page=100&page=${page}`, token);
    for (const issue of issues) {
      if (!issue.pull_request) {
        titles.add(issue.title);
      }
    }

    if (issues.length < 100) {
      return titles;
    }
    page += 1;
  }
}

async function createIssue(owner, repo, token, issue) {
  return githubRequest(`/repos/${owner}/${repo}/issues`, token, {
    method: "POST",
    body: JSON.stringify({
      title: issue.title,
      body: issue.body,
      labels: issue.labels,
    }),
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const inferred = inferRepository();
  const owner = options.owner || inferred.owner;
  const repo = options.repo || inferred.repo;

  if (!owner || !repo) {
    throw new Error("Unable to infer GitHub repository. Pass --owner and --repo or set GITHUB_REPOSITORY.");
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token && !options.dryRun) {
    throw new Error("GITHUB_TOKEN is required unless --dry-run is used.");
  }

  const drafts = await readIssueDrafts(options.docsDir);
  const existingTitles = options.dryRun ? new Set() : await listExistingIssueTitles(owner, repo, token);

  for (const draft of drafts) {
    const relativePath = path.relative(process.cwd(), draft.filePath);
    if (existingTitles.has(draft.title)) {
      console.log(`skip existing: ${draft.title}`);
      continue;
    }

    if (options.dryRun) {
      console.log(`dry-run create: ${draft.title} (${draft.labels.join(", ") || "no labels"}) from ${relativePath}`);
      continue;
    }

    const issue = await createIssue(owner, repo, token, draft);
    existingTitles.add(draft.title);
    console.log(`created #${issue.number}: ${issue.html_url}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
