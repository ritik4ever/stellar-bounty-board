export type CsvRow = Record<string, string> & { __csvError?: string };

function parseLine(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      values.push(value.trim());
      value = "";
    } else {
      value += char;
    }
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted field.");
  values.push(value.trim());
  return values;
}

export function parseBountyCsv(csv: string): CsvRow[] {
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = parseLine(lines[0]);
  if (new Set(headers).size !== headers.length) throw new Error("CSV headers must be unique.");
  return lines.slice(1).map((line) => {
    const values = parseLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])) as CsvRow;
    if (values.length !== headers.length) row.__csvError = "CSV row has a different number of columns than the header.";
    return row;
  });
}

export function csvRowToBounty(row: CsvRow): Record<string, unknown> {
  return {
    repo: row.repo,
    issueNumber: row.issueNumber,
    title: row.title,
    summary: row.summary,
    maintainer: row.maintainer,
    tokenSymbol: row.tokenSymbol,
    amount: row.amount,
    deadlineDays: row.deadlineDays,
    labels: row.labels ? row.labels.split("|").map((label) => label.trim()).filter(Boolean) : [],
    ...(row.templateId ? { templateId: row.templateId } : {}),
  };
}
