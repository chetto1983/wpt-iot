'use client';

import { useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';

// PHASE 33 EXEMPTION: This is the topmost error boundary.
// Tailwind and CSS custom properties may not be loaded when this renders.
// Hardcoded hex values are intentional. Do NOT migrate to severity tokens.
// axe-core rule: ignore this file (see wpt-iot/scripts/cdp-validate-33-axe.mjs ignore list).
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { buttonRef.current?.focus(); }, []);

  return (
    <html lang="en">
      <body>
        <div style={{ display: 'flex', minHeight: '100vh', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', padding: '24px', fontFamily: 'Inter, system-ui, sans-serif', backgroundColor: '#1a1a1a', color: '#e5e5e5' }}>
          <AlertTriangle style={{ width: 40, height: 40, color: '#dc3545' }} />
          <h2 style={{ fontSize: '20px', fontWeight: 600 }}>Application Error</h2>
          <p style={{ fontSize: '14px', color: '#888', maxWidth: '28rem', textAlign: 'center' }}>A critical error occurred. Please reload the page.</p>
          {error.digest && <p style={{ fontSize: '12px', color: '#555' }}>{error.digest}</p>}
          <button ref={buttonRef} onClick={reset} style={{ padding: '8px 16px', fontSize: '14px', fontWeight: 500, backgroundColor: '#1ABC9C', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>Reload Page</button>
        </div>
      </body>
    </html>
  );
}
