import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import BountyListLoading, { BOUNTY_CARD_SKELETON_COUNT } from "./BountyListLoading";

describe("BountyListLoading", () => {
  it("shows six skeleton cards before the bounty fetch resolves", async () => {
    const unresolvedFetch = new Promise(() => undefined);

    render(<BountyListLoading />);

    await expect(Promise.race([unresolvedFetch, Promise.resolve("pending")])).resolves.toBe(
      "pending",
    );

    const loadingGrid = screen.getByTestId("bounty-list-loading");
    expect(loadingGrid).toHaveAttribute("aria-busy", "true");
    expect(loadingGrid.querySelectorAll(".skeleton-card")).toHaveLength(
      BOUNTY_CARD_SKELETON_COUNT,
    );
  });
});