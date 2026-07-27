export class HmiDataError extends Error {}

export async function hmiDataRequest<T = void>(
  path: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET',
  payload?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      cache: 'no-store',
    });
  } catch {
    throw new HmiDataError('HMI-Backend nicht erreichbar');
  }
  const body = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok) throw new HmiDataError(body?.error ?? `HMI-Backend-Fehler (${response.status})`);
  return body as T;
}
