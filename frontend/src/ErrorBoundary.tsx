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

  render() {
    if (this.state.hasError) {
      return (
        <section className="panel error-panel">
          <div className="empty-state" style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "3rem 1rem", textAlign: "center" }}>
            <svg
              width="120"
              height="120"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: "var(--text-secondary, #888)", marginBottom: "1.5rem" }}
            >
              <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"></polygon>
              <line x1="15" y1="9" x2="9" y2="15"></line>
              <line x1="9" y1="9" x2="15" y2="15"></line>
            </svg>
            <h2>Component Error</h2>
            <p style={{ maxWidth: "450px", margin: "1rem 0", color: "inherit" }}>
              A critical error occurred while rendering this specific component. 
              This is not a network issue, but a localized application crash.
            </p>
            <div style={{ display: "flex", gap: "1rem", marginTop: "1.5rem" }}>
              <button className="primary-button" type="button" onClick={() => window.location.reload()}>
                Reload page
              </button>
              <button className="secondary-button" style={{ padding: "0.5rem 1rem", border: "1px solid currentColor", borderRadius: "4px", background: "transparent", color: "inherit", cursor: "pointer" }} type="button" onClick={() => window.location.href = '/'}>
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
