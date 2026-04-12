import Chat from './components/Chat';
import { ErrorBoundary } from './components/ErrorBoundary';
// Theme must be imported so its module-level initial apply runs before render.
import './lib/theme';

export default function App() {
  return (
    <ErrorBoundary>
      <Chat />
    </ErrorBoundary>
  );
}
