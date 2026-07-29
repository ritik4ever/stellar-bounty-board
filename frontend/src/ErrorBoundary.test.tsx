import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ErrorBoundary from "./ErrorBoundary";
import * as logger from "./logger";

function Bomb() {
  throw new Error("boom");
}

function SafeChild() {
  return <p>Safe content</p>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

test("shows fallback UI and logs error when child throws", async () => {
  const spy = vi.spyOn(logger, "logError");

  render(
    <ErrorBoundary componentName="TestComponent">
      <Bomb />
    </ErrorBoundary>,
  );

  expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
  // Component name is shown in the message
  expect(screen.getByText(/TestComponent/i)).toBeInTheDocument();
  // Both action buttons are present
  expect(
    screen.getByRole("button", { name: /Try again/i }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: /Go back home/i }),
  ).toBeInTheDocument();
  // SVG illustration is rendered
  expect(document.querySelector(".error-boundary__illustration svg")).toBeInTheDocument();
  // Kicker is shown
  expect(screen.getByText("Error")).toBeInTheDocument();
  // Logger was called
  expect(spy).toHaveBeenCalledWith("TestComponent", expect.any(Error));

  // Clicking try again should reset the error boundary
  await userEvent.click(screen.getByRole("button", { name: /Try again/i }));
});

test("renders children when no error", () => {
  render(
    <ErrorBoundary>
      <SafeChild />
    </ErrorBoundary>,
  );

  expect(screen.getByText("Safe content")).toBeInTheDocument();
  expect(screen.queryByText(/Something went wrong/i)).not.toBeInTheDocument();
});

test("shows generic message when componentName is not provided", async () => {
  vi.spyOn(logger, "logError");

  render(
    <ErrorBoundary>
      <Bomb />
    </ErrorBoundary>,
  );

  expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
  // Generic message (no component name)
  expect(
    screen.getByText(/has been logged for investigation/i),
  ).toBeInTheDocument();
  // Should not render a specific component name
  expect(screen.queryByText(/strong/i)).not.toBeInTheDocument();
});

test("logs error with Unknown when componentName is omitted", () => {
  const spy = vi.spyOn(logger, "logError");

  render(
    <ErrorBoundary>
      <Bomb />
    </ErrorBoundary>,
  );

  expect(spy).toHaveBeenCalledWith("Unknown", expect.any(Error));
});

test("go back home button navigates to root", async () => {
  const pushState = vi.spyOn(window.history, "pushState");
  const dispatchEvent = vi.spyOn(window, "dispatchEvent");

  render(
    <ErrorBoundary componentName="Test">
      <Bomb />
    </ErrorBoundary>,
  );

  await userEvent.click(
    screen.getByRole("button", { name: /Go back home/i }),
  );

  expect(pushState).toHaveBeenCalledWith({}, "", "/");
  expect(dispatchEvent).toHaveBeenCalledWith(expect.any(PopStateEvent));
});