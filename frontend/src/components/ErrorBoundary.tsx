import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: 24,
            fontFamily: 'monospace',
            whiteSpace: 'pre-wrap',
            background: '#1a1a1a',
            color: '#ff8b8b',
            minHeight: '100vh',
          }}
        >
          <div style={{ fontSize: 18, marginBottom: 12, color: '#ffd1d1' }}>
            React crashed during render:
          </div>
          <div style={{ marginBottom: 8 }}>{this.state.error.message}</div>
          <div style={{ color: '#ff8b8b', fontSize: 12 }}>
            {this.state.error.stack || '(no stack)'}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
