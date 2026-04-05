// Read from apps/frontend/.env — Next.js loads .env from its own app directory.
// Empty string would silently send requests to the frontend itself.
const API_BASE = process.env.NEXT_PUBLIC_API_URL || (() => {
  throw new Error('NEXT_PUBLIC_API_URL is not set. Create apps/frontend/.env with NEXT_PUBLIC_API_URL=http://localhost:3000');
})();

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { signal?: AbortSignal } = {},
): Promise<T> {
  const headers: Record<string, string> = { ...options.headers as Record<string, string> };
  // Only set Content-Type for requests with a body (POST/PUT/PATCH/DELETE).
  // GET requests with Content-Type: application/json trigger CORS preflight.
  if (options.body) {
    headers['Content-Type'] ??= 'application/json';
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers,
    signal: options.signal,
  });
  if (res.status === 401) {
    // Preserve current URL for post-login redirect
    const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
    // Dynamic import to avoid circular deps -- toast fires before redirect
    const { toast } = await import('sonner');
    toast.warning(
      // Fallback English -- i18n not available in this utility module
      'Your session has expired. Please log in again.',
    );
    // Delay redirect to let user see the toast
    setTimeout(() => {
      window.location.href = `/?expired=true&returnUrl=${returnUrl}`;
    }, 1500);
    throw new Error('Session expired');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as Record<string, string>).error ?? `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
