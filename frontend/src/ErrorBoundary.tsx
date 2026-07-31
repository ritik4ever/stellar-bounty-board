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
          <div className="panel-header">
            <div>
              <span className="panel-kicker">Error</span>
              <h2>Something went wrong</h2>
            </div>
          </div>
          <div className="empty-state">
            <p>There was a problem loading this part of the app. Try again to continue.</p>
            <button className="primary-button" type="button" onClick={this.handleRetry}>
              Try again
            </button>
          </div>
        </section>
      );
    }

    return this.props.children as any;
  }
}
