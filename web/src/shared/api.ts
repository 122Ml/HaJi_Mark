export async function getJSON<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/v1${path}`, { signal, credentials: 'same-origin' });
  if (!response.ok) throw new Error('服务暂不可用，请检查启动状态后重试。');
  return response.json() as Promise<T>;
}
