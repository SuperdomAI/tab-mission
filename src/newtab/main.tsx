import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: 24,
            fontFamily: "monospace",
            color: "red",
            background: "#111",
          }}
        >
          <h2>Tab Mission crashed</h2>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>
            {(this.state.error as Error).message}
            {"\n"}
            {(this.state.error as Error).stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");
createRoot(root).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
