// Default to same-origin (empty string = relative URLs). The frontend is
// served through nginx in production and through Next.js dev rewrites in
// development, so /api/* resolves to the backend without cross-origin
// traffic. NEXT_PUBLIC_API_URL is retained as an optional override only.
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

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
    const body: unknown = await res.json().catch(() => ({}));
    const errorMessage =
      typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : typeof (body as { error?: { message?: unknown } }).error?.message === 'string'
          ? (body as { error: { message: string } }).error.message
          : `Request failed: ${res.status}`;
    throw new Error(errorMessage);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
