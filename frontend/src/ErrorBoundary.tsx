import React from "react";
import { logError } from "./logger";

type Props = {
  children: React.ReactNode;
  componentName?: string;
};

type State = {
  hasError: boolean;
};

/** Inline SVG illustration — a stylised broken window with a wrench */
function ErrorIllustration() {
  return (
    <svg
      width="120"
      height="90"
      viewBox="0 0 120 90"
      fill="none"
      aria-hidden="true"
      className="error-boundary__illustration"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Window frame */}
      <rect
        x="10"
        y="10"
        width="100"
        height="70"
        rx="8"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        opacity="0.3"
      />
      {/* Window pane (cracked) */}
      <rect
        x="16"
        y="16"
        width="88"
        height="58"
        rx="4"
        fill="currentColor"
        fillOpacity="0.06"
      />
      {/* Crack line */}
      <path
        d="M30 16 L45 40 L38 42 L52 74"
        stroke="var(--rose)"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
      {/* Small fragments */}
      <path
        d="M42 38 L48 34 L46 40 Z"
        fill="var(--rose)"
        opacity="0.5"
      />
      <path
        d="M28 18 L34 22 L30 24 Z"
        fill="var(--rose)"
        opacity="0.4"
      />
      {/* Wrench icon */}
      <g transform="translate(70, 46)" opacity="0.8">
        <path
          d="M0 8 A8 8 0 1 1 8 0 L12 4 A4 4 0 0 1 12 10 L8 6 A4 4 0 0 0 4 10 L0 14 Z"
          fill="var(--mint)"
          stroke="var(--mint)"
          strokeWidth="0.5"
        />
        <rect x="3" y="12" width="3" height="8" rx="1" fill="var(--mint)" />
      </g>
    </svg>
  );
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
    this.handleRetry = this.handleRetry.bind(this);
    this.handleGoHome = this.handleGoHome.bind(this);
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    try {
      logError(this.props.componentName ?? "Unknown", error);
    } catch (e) {
      // swallow logging errors
      // eslint-disable-next-line no-console
      console.error("ErrorBoundary logging failed", e);
    }
  }

  handleRetry() {
    this.setState({ hasError: false });
  }

  handleGoHome() {
    window.history.pushState(null, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  render() {
    if (this.state.hasError) {
      return (
        <section className="panel error-panel">
          <div className="panel-header">
            <div>
              <span className="panel-kicker">Error</span>
              <h2>Something went wrong</h2>
            </div>
          </div>
          <div className="error-boundary__body">
            <ErrorIllustration />
            <p className="error-boundary__message">
              An unexpected error occurred while loading{" "}
              {this.props.componentName ?? "this section"}. The issue has been
              logged and the team will investigate.
            </p>
            <div className="error-boundary__actions">
              <button
                className="primary-button"
                type="button"
                onClick={this.handleRetry}
              >
                Try again
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={this.handleGoHome}
              >
                Go back home
              </button>
            </div>
          </div>
        </section>
      );
    }

    return this.props.children as any;
  }
}