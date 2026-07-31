import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ErrorBoundary from "./ErrorBoundary";
import * as logger from "./logger";

function Bomb() {
  throw new Error("boom");
}

test("shows fallback UI and logs error when child throws", async () => {
  const spy = vi.spyOn(logger, "logError");

  render(
    <ErrorBoundary componentName="TestComponent">
      <Bomb />
    </ErrorBoundary>,
  );

  expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
  const button = screen.getByRole("button", { name: /Try again/i });
  expect(button).toBeInTheDocument();
  expect(spy).toHaveBeenCalledWith("TestComponent", expect.any(Error));

  // Clicking try again should reset the error boundary
  await userEvent.click(button);
  // After retry, the thrown component still throws if re-rendered; ensure no crash during retry flow
});
