const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
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
  });
  if (res.status === 401) {
    window.location.href = '/?expired=true';
    throw new Error('Session expired');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as Record<string, string>).error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}
