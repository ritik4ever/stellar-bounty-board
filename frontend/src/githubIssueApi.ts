export interface GithubIssueLabel {
  name: string;
  color: string;
}

export interface GithubIssueData {
  title: string;
  state: "open" | "closed";
  createdAt: string;
  labels: GithubIssueLabel[];
}

export type FetchGithubIssueResult =
  | { ok: true; data: GithubIssueData }
  | { ok: false; status: number; rateLimited: boolean };

export function githubIssueApiUrl(repo: string, issueNumber: number): string {
  return `https://api.github.com/repos/${repo}/issues/${issueNumber}`;
}

export async function fetchGithubIssue(
  repo: string,
  issueNumber: number,
): Promise<FetchGithubIssueResult> {
  const response = await fetch(githubIssueApiUrl(repo, issueNumber), {
    headers: { Accept: "application/vnd.github+json" },
  });

  if (!response.ok) {
    return { ok: false, status: response.status, rateLimited: response.status === 403 };
  }

  const body = (await response.json()) as {
    title: string;
    state: string;
    created_at: string;
    labels?: Array<{ name: string; color: string }>;
  };

  return {
    ok: true,
    data: {
      title: body.title,
      state: body.state === "closed" ? "closed" : "open",
      createdAt: body.created_at,
      labels: (body.labels ?? []).map((label) => ({
        name: label.name,
        color: label.color,
      })),
    },
  };
}
