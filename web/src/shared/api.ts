export class APIError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

// csrfToken comes from /me or a successful login and stays in React memory.
export async function requestJSON<T>(path: string, options: RequestInit = {}, csrfToken?: string): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set('Content-Type', 'application/json');
  if (csrfToken) headers.set('X-CSRF-Token', csrfToken);
  const response = await fetch(`/api/v1${path}`, { ...options, headers, credentials: 'same-origin' });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new APIError(response.status, payload?.error?.code || 'service_unavailable', payload?.error?.message || '服务暂不可用，请检查启动状态后重试。');
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function getJSON<T>(path: string, signal?: AbortSignal): Promise<T> {
  return requestJSON<T>(path, { signal });
}
