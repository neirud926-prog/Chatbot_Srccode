import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

try {
  const rootEl = document.getElementById('root');
  if (!rootEl) {
    document.body.innerHTML =
      '<pre style="padding:20px;color:#ff8b8b;font-family:monospace">main.tsx: #root not found in DOM</pre>';
  } else {
    createRoot(rootEl).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  }
} catch (e) {
  const msg = e instanceof Error ? `${e.message}\n\n${e.stack ?? ''}` : String(e);
  document.body.innerHTML =
    '<pre style="padding:20px;color:#ff8b8b;background:#1a1a1a;min-height:100vh;font-family:monospace;white-space:pre-wrap">main.tsx crashed:\n\n' +
    msg.replace(/</g, '&lt;') +
    '</pre>';
}
