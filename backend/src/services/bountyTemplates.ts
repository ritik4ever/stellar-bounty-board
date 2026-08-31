import fs from "node:fs";
import path from "node:path";

export interface BountyTemplate {
  id: string;
  name: string;
  amount: number;
  labels: string[];
  deadlineDays: number;
  tokenSymbol: string;
}

const DEFAULT_TEMPLATES: BountyTemplate[] = [
  { id: "small-bug-fix", name: "Small bug fix", amount: 25, labels: ["bug"], deadlineDays: 7, tokenSymbol: "XLM" },
  { id: "feature", name: "Feature", amount: 100, labels: ["enhancement"], deadlineDays: 21, tokenSymbol: "XLM" },
  { id: "documentation", name: "Documentation", amount: 40, labels: ["documentation"], deadlineDays: 14, tokenSymbol: "XLM" },
];

function storePath(): string {
  if (process.env.BOUNTY_TEMPLATE_STORE_PATH?.trim()) {
    return path.resolve(process.env.BOUNTY_TEMPLATE_STORE_PATH.trim());
  }
  if (process.env.BOUNTY_STORE_PATH?.trim()) {
    return path.resolve(process.env.BOUNTY_STORE_PATH.trim().replace(/\.json$/i, ".templates.json"));
  }
  return path.resolve(__dirname, "../../data/bounty-templates.json");
}

function ensureStore(): void {
  const file = storePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file) || !fs.readFileSync(file, "utf8").trim()) {
    fs.writeFileSync(file, JSON.stringify(DEFAULT_TEMPLATES, null, 2));
  }
}

export function listBountyTemplates(): BountyTemplate[] {
  ensureStore();
  return JSON.parse(fs.readFileSync(storePath(), "utf8")) as BountyTemplate[];
}

export function getBountyTemplate(id: string): BountyTemplate {
  const template = listBountyTemplates().find((item) => item.id === id);
  if (!template) throw new Error("Bounty template not found.");
  return template;
}

export function applyBountyTemplate(input: Record<string, unknown>): Record<string, unknown> {
  if (typeof input.templateId !== "string" || !input.templateId.trim()) return input;
  const template = getBountyTemplate(input.templateId.trim());
  const { templateId: _templateId, ...overrides } = input;
  return {
    amount: template.amount,
    labels: template.labels,
    deadlineDays: template.deadlineDays,
    tokenSymbol: template.tokenSymbol,
    ...overrides,
  };
}
