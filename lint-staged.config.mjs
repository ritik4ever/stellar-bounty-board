const quote = (file) => `"${file.replaceAll('"', '\\"')}"`;
const files = (stagedFiles) => stagedFiles.map(quote).join(" ");

export default {
  "frontend/src/**/*.{ts,tsx}": (stagedFiles) => [
    "npm exec --prefix frontend -- tsc --noEmit -p frontend/tsconfig.json",
    `eslint --fix ${files(stagedFiles)}`,
    `prettier --write ${files(stagedFiles)}`,
  ],
  "backend/src/**/*.ts": (stagedFiles) => [
    "npm exec --prefix backend -- tsc --noEmit -p backend/tsconfig.json",
    `eslint --fix ${files(stagedFiles)}`,
    `prettier --write ${files(stagedFiles)}`,
  ],
  "*.{js,jsx}": (stagedFiles) => [
    `eslint --fix ${files(stagedFiles)}`,
    `prettier --write ${files(stagedFiles)}`,
  ],
  "*.{json,md,yaml,yml}": (stagedFiles) =>
    `prettier --write ${files(stagedFiles)}`,
  "*.rs": (stagedFiles) => `rustfmt ${files(stagedFiles)}`,
};
