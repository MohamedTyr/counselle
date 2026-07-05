/**
 * MessagesErrorBoundary — catches a render throw anywhere in the chat honesty
 * surface (timeline / cards / sources / clarify / citation providers) and shows
 * an honest "this part couldn't be shown" panel instead of white-screening the
 * whole conversation (FE-H5). Honesty rule: we never fabricate the answer; we
 * say plainly that a piece failed to render.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
  /** Optional custom fallback; defaults to the honest inline panel. */
  fallback?: ReactNode;
};
type State = { hasError: boolean };

export default class MessagesErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Diagnostic only — this is an unexpected render failure, not a normal path.
    // (Routed through console deliberately; the logger seam is Phase 5/FE-CONSOLE-WARN.)
    console.error('[chat] a message failed to render', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div
            role="alert"
            className="not-prose my-3 rounded-xl border border-border-light bg-surface-primary-alt px-4 py-3 text-sm text-text-secondary"
          >
            Something in this conversation couldn’t be displayed. The rest of your
            chat is unaffected — try reloading if it persists.
          </div>
        )
      );
    }
    return this.props.children;
  }
}
