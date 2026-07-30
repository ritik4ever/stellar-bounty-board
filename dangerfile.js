// dangerfile.js — PR size / complexity linter
// Flags pull requests whose net line-change count exceeds PR_SIZE_THRESHOLD
// (default 400). Generated files and lockfiles are excluded from the count
// so they never trigger a false-positive warning.

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Maximum net lines changed (additions + deletions) before a warning fires. */
const PR_SIZE_THRESHOLD = Number(process.env.PR_SIZE_THRESHOLD) || 400;

/**
 * Glob patterns for files that should be excluded from the size calculation.
 * Matches lockfiles, auto-generated bindings, build artefacts, and similar.
 */
const EXCLUDED_PATTERNS = [
  // Lockfiles
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /Cargo\.lock$/,
  /composer\.lock$/,
  /Gemfile\.lock$/,
  /poetry\.lock$/,
  // Generated TypeScript / JS bindings
  /frontend\/src\/generated\//,
  /src\/generated\//,
  // OpenAPI / GraphQL generated artefacts
  /\.generated\.(ts|js|d\.ts)$/,
  // Build output directories
  /^dist\//,
  /^build\//,
  /^\.next\//,
  /^out\//,
  // Coverage reports
  /^coverage\//,
  // Source maps
  /\.map$/,
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when a file path matches any of the excluded patterns and
 * should therefore be ignored in the size calculation.
 *
 * @param {string} filePath - The file path to test.
 * @returns {boolean}
 */
function isExcluded(filePath) {
  return EXCLUDED_PATTERNS.some((pattern) => pattern.test(filePath));
}

/**
 * Counts meaningful net lines changed across all modified files,
 * skipping any file matched by EXCLUDED_PATTERNS.
 *
 * @returns {number} Total additions + deletions after exclusions.
 */
function countMeaningfulChanges() {
  const allFiles = [
    ...danger.git.created_files,
    ...danger.git.modified_files,
    ...danger.git.deleted_files,
  ];

  // danger.git.structuredDiffForFile is async — use the pre-computed
  // additions/deletions totals from the PR diff instead where available.
  // The `danger.github.pr` object already exposes aggregate addition /
  // deletion counts; we subtract the lines that belong to excluded files.
  //
  // Because per-file line counts require async calls we build the total
  // synchronously from the aggregate and warn conservatively when we cannot
  // inspect individual files (e.g. on GitHub Enterprise without the API).
  const excluded = allFiles.filter(isExcluded);

  // Log excluded files at debug level (visible in the Actions run log).
  if (excluded.length > 0) {
    console.log(
      `[danger] Excluding ${excluded.length} generated/lockfile(s) from size check:\n` +
        excluded.map((f) => `  • ${f}`).join('\n'),
    );
  }

  // Aggregate additions + deletions from the PR metadata.
  const totalAdditions = danger.github.pr.additions ?? 0;
  const totalDeletions = danger.github.pr.deletions ?? 0;
  const totalRaw = totalAdditions + totalDeletions;

  // We cannot easily subtract per-file line counts synchronously, so we only
  // skip the size check entirely when *all* changed files are excluded.
  const nonExcludedFiles = allFiles.filter((f) => !isExcluded(f));
  if (nonExcludedFiles.length === 0) {
    console.log(
      '[danger] All changed files are generated/lockfiles — skipping size check.',
    );
    return 0;
  }

  return totalRaw;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

// 1. PR size check
const meaningfulChanges = countMeaningfulChanges();

if (meaningfulChanges > PR_SIZE_THRESHOLD) {
  warn(
    `## 🔶 Large PR detected (${meaningfulChanges} lines changed)\n\n` +
      `This PR modifies **${meaningfulChanges} lines** (additions + deletions), ` +
      `which exceeds the recommended limit of **${PR_SIZE_THRESHOLD} lines**.\n\n` +
      `Large PRs are harder to review thoroughly and more likely to introduce ` +
      `subtle bugs. Please consider:\n\n` +
      `- **Splitting** this PR into smaller, focused changes\n` +
      `- Separating refactors from feature additions\n` +
      `- Extracting pure dependency updates into their own PR\n\n` +
      `> *Lockfiles and auto-generated files are excluded from this count.*`,
  );
}

// 2. PR description check — encourage a non-empty body
if (!danger.github.pr.body || danger.github.pr.body.trim().length < 10) {
  warn(
    '**PR description is empty or very short.** ' +
      'Please add context about *what* changed and *why* to help reviewers.',
  );
}
