export class APIError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

// csrfToken comes from /me or a successful login and stays in React memory.
export async function requestJSON<T>(path: string, options: RequestInit = {}, csrfToken?: string): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (csrfToken) headers.set('X-CSRF-Token', csrfToken);
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, { ...options, headers, credentials: 'same-origin' });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new APIError(0, 'network_error', '网络连接失败，请检查网络或服务状态后重试。');
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const fallback =
      response.status === 413
        ? '上传或提交内容超过大小上限，请精简后重试。'
        : response.status === 429
          ? '请求过于频繁，请稍后重试。'
          : '服务暂不可用，请检查启动状态后重试。';
    throw new APIError(response.status, payload?.error?.code || 'service_unavailable', payload?.error?.message || fallback);
  }
  if (response.status === 204) return undefined as T;
  try {
    return (await response.json()) as T;
  } catch {
    throw new APIError(
      response.status,
      'invalid_response',
      '服务响应格式异常，请刷新页面或检查反向代理配置后重试。',
    );
  }
}

export function getJSON<T>(path: string, signal?: AbortSignal): Promise<T> {
  return requestJSON<T>(path, { signal });
}
