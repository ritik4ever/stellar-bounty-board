import React from "react";
import { logError } from "./logger";

type Props = {
  children: React.ReactNode;
  componentName?: string;
};

type State = {
  hasError: boolean;
};

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
    window.history.pushState({}, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  render() {
    if (this.state.hasError) {
      const name = this.props.componentName;
      return (
        <section className="error-boundary">
          <div className="error-boundary__illustration" aria-hidden="true">
            <svg
              width="160"
              height="140"
              viewBox="0 0 160 140"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              {/* Window frame */}
              <rect
                x="20"
                y="10"
                width="120"
                height="100"
                rx="8"
                stroke="currentColor"
                strokeWidth="2"
                fill="var(--surface)"
              />
              {/* Window cross */}
              <line
                x1="80"
                y1="10"
                x2="80"
                y2="110"
                stroke="currentColor"
                strokeWidth="2"
                opacity="0.3"
              />
              <line
                x1="20"
                y1="60"
                x2="140"
                y2="60"
                stroke="currentColor"
                strokeWidth="2"
                opacity="0.3"
              />
              {/* Crack lines */}
              <path
                d="M60 45 L75 70 L68 85"
                stroke="var(--rose)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
              <path
                d="M75 70 L95 60"
                stroke="var(--rose)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
                opacity="0.7"
              />
              <path
                d="M68 85 L58 95"
                stroke="var(--rose)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
                opacity="0.5"
              />
              {/* Wrench icon below */}
              <g transform="translate(60, 118)">
                <rect
                  x="0"
                  y="0"
                  width="40"
                  height="8"
                  rx="4"
                  fill="var(--mint)"
                />
                <path
                  d="M8 8 L8 18 C8 20 12 20 12 18 L12 8"
                  fill="var(--mint)"
                />
                <path
                  d="M28 8 L28 18 C28 20 32 20 32 18 L32 8"
                  fill="var(--mint)"
                />
                <rect
                  x="14"
                  y="14"
                  width="12"
                  height="4"
                  rx="2"
                  fill="var(--mint)"
                />
              </g>
            </svg>
          </div>
          <div className="error-boundary__content">
            <span className="error-boundary__kicker">Error</span>
            <h2 className="error-boundary__heading">Something went wrong</h2>
            <p className="error-boundary__message">
              {name ? (
                <>
                  <strong>{name}</strong> encountered an unexpected error and
                  has been logged for investigation.
                </>
              ) : (
                "There was a problem loading this part of the app. The error has been logged for investigation."
              )}
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