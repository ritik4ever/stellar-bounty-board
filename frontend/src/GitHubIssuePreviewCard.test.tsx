import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import GitHubIssuePreviewCard from "./GitHubIssuePreviewCard";
import { githubIssueApiUrl } from "./githubIssueApi";

function mockFetchJson(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const { ok = true, status = 200 } = init;
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  });
}

describe("GitHubIssuePreviewCard", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a loading skeleton while fetching issue data", () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => undefined));

    render(<GitHubIssuePreviewCard repo="ritik4ever/stellar-bounty-board" issueNumber={287} />);

    expect(screen.getByTestId("github-issue-preview-loading")).toBeInTheDocument();
    expect(screen.getByLabelText("Loading GitHub issue preview")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("fetches live issue data and renders the title and labels", async () => {
    vi.mocked(fetch).mockImplementation(
      mockFetchJson({
        title: "Add GitHubIssuePreviewCard live data fetch",
        state: "open",
        created_at: "2026-01-15T10:00:00Z",
        labels: [
          { name: "enhancement", color: "84b6eb" },
          { name: "good first issue", color: "7057ff" },
        ],
      }),
    );

    render(<GitHubIssuePreviewCard repo="ritik4ever/stellar-bounty-board" issueNumber={287} />);

    await waitFor(() => {
      expect(screen.getByText("Add GitHubIssuePreviewCard live data fetch")).toBeInTheDocument();
    });

    expect(fetch).toHaveBeenCalledWith(
      githubIssueApiUrl("ritik4ever/stellar-bounty-board", 287),
      { headers: { Accept: "application/vnd.github+json" } },
    );
    expect(screen.getByText("enhancement")).toBeInTheDocument();
    expect(screen.getByText("good first issue")).toBeInTheDocument();
    expect(screen.getByText("open")).toBeInTheDocument();
  });

  it("shows an error state with a GitHub link when the fetch fails", async () => {
    vi.mocked(fetch).mockImplementation(mockFetchJson({}, { ok: false, status: 404 }));

    render(<GitHubIssuePreviewCard repo="ritik4ever/stellar-bounty-board" issueNumber={999} />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/could not load issue details/i);
    });

    const link = screen.getByRole("link", { name: /view issue on github/i });
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/ritik4ever/stellar-bounty-board/issues/999",
    );
  });

  it("shows a rate-limit note when GitHub returns 403", async () => {
    vi.mocked(fetch).mockImplementation(mockFetchJson({}, { ok: false, status: 403 }));

    render(<GitHubIssuePreviewCard repo="ritik4ever/stellar-bounty-board" issueNumber={287} />);

    await waitFor(() => {
      expect(screen.getByText(/unauthenticated api requests are rate-limited/i)).toBeInTheDocument();
    });
  });

  it("does not fetch when the repo or issue number is invalid", () => {
    render(<GitHubIssuePreviewCard repo="not-a-valid-repo" issueNumber={0} />);

    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByTestId("github-issue-preview-loading")).not.toBeInTheDocument();
  });

  describe("Accessibility (a11y)", () => {
    it("has zero accessibility violations in the loaded state", async () => {
      vi.mocked(fetch).mockImplementation(
        mockFetchJson({
          title: "Add GitHubIssuePreviewCard live data fetch",
          state: "open",
          created_at: "2026-01-15T10:00:00Z",
          labels: [
            { name: "enhancement", color: "84b6eb" },
            { name: "good first issue", color: "7057ff" },
          ],
        }),
      );

      const { container } = render(
        <main>
          <GitHubIssuePreviewCard repo="ritik4ever/stellar-bounty-board" issueNumber={287} />
        </main>,
      );

      await waitFor(() => {
        expect(screen.getByText("Add GitHubIssuePreviewCard live data fetch")).toBeInTheDocument();
      });

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it("has zero accessibility violations in the loading skeleton state", async () => {
      vi.mocked(fetch).mockReturnValue(new Promise(() => undefined));

      const { container } = render(
        <main>
          <GitHubIssuePreviewCard repo="ritik4ever/stellar-bounty-board" issueNumber={287} />
        </main>,
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it("has zero accessibility violations in the error state", async () => {
      vi.mocked(fetch).mockImplementation(mockFetchJson({}, { ok: false, status: 404 }));

      const { container } = render(
        <main>
          <GitHubIssuePreviewCard repo="ritik4ever/stellar-bounty-board" issueNumber={999} />
        </main>,
      );

      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeInTheDocument();
      });

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it("has zero accessibility violations in the disabled state", async () => {
      const { container } = render(
        <main>
          <GitHubIssuePreviewCard repo="not-a-valid-repo" issueNumber={0} />
        </main>,
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it("supports keyboard navigation with tab focus", async () => {
      const user = userEvent.setup();
      vi.mocked(fetch).mockImplementation(
        mockFetchJson({
          title: "Keyboard navigable issue",
          state: "open",
          created_at: "2026-01-15T10:00:00Z",
          labels: [],
        }),
      );

      render(<GitHubIssuePreviewCard repo="ritik4ever/stellar-bounty-board" issueNumber={287} />);

      await waitFor(() => {
        expect(screen.getByText("Keyboard navigable issue")).toBeInTheDocument();
      });

      const cardLink = screen.getByRole("link");
      expect(cardLink).toHaveAttribute(
        "href",
        "https://github.com/ritik4ever/stellar-bounty-board/issues/287",
      );

      await user.tab();
      expect(cardLink).toHaveFocus();
    });
  });
});
