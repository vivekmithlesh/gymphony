import { Component, type ErrorInfo, type ReactNode } from "react";

type DashboardErrorBoundaryProps = {
  children: ReactNode;
};

type DashboardErrorBoundaryState = {
  hasError: boolean;
  errorMessage: string | null;
};

export class DashboardErrorBoundary extends Component<DashboardErrorBoundaryProps, DashboardErrorBoundaryState> {
  state: DashboardErrorBoundaryState = {
    hasError: false,
    errorMessage: null,
  };

  static getDerivedStateFromError(error: Error): DashboardErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error.message || "Dashboard rendering failed.",
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Dashboard render error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-white">
          <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-white/5 p-8 text-center shadow-2xl backdrop-blur-xl">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10 text-red-400">
              <span className="text-2xl font-bold">!</span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Dashboard Error</h1>
            <p className="mt-3 text-sm text-slate-300">
              A database or render error was detected, so the dashboard was stopped to prevent flicker and reload loops.
            </p>
            {this.state.errorMessage && (
              <div className="mt-6 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-left text-sm text-red-100">
                {this.state.errorMessage}
              </div>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
