/* Typisierter Browser-Client für die Hauser-API.

   Routen kommen ausschließlich aus `contract.generated.ts`; ein Tippfehler im
   Pfad ist damit ein Typfehler. Pfadparameter (`:jobId`) werden aus dem
   Pfadmuster abgeleitet und beim Aufruf verlangt. Der Client kapselt nur das
   Nötigste: Pfadaufbau, JSON, ETag und einen einheitlichen Ergebnistyp — keine
   Retry-Logik, kein Cache (das ist Sache der Datenschicht in `src/lib/data`). */

import { API_ROUTES, type ApiMethod, type ApiResponse, type ApiRouteId, type ApiRoutePath } from './contract.generated.ts';

type ParamNames<Path extends string> =
  Path extends `${string}:${infer Param}/${infer Rest}` ? Param | ParamNames<`/${Rest}`>
    : Path extends `${string}:${infer Param}` ? Param
      : never;

export type ApiParams<Id extends ApiRouteId> = [ParamNames<ApiRoutePath<Id>>] extends [never]
  ? Record<string, never> | undefined
  : Record<ParamNames<ApiRoutePath<Id>>, string>;

export interface ApiRequestOptions<Id extends ApiRouteId> {
  method?: ApiMethod;
  params?: ApiParams<Id>;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  /** Sendet `If-Match`; der Server lehnt veraltete Stände mit 412/428 ab. */
  ifMatch?: string | null;
  signal?: AbortSignal;
  cache?: RequestCache;
  fetchImpl?: typeof fetch;
}

export type ApiResult<T> =
  | { ok: true; status: number; data: T; etag: string | null; response: Response }
  | { ok: false; status: number; data: unknown; etag: string | null; response: Response | null; error: string };

export function apiPath<Id extends ApiRouteId>(id: Id, params?: ApiParams<Id>, query?: ApiRequestOptions<Id>['query']): string {
  const route = API_ROUTES[id];
  let path: string = route.path;
  path = path.replace(/:([A-Za-z]+)/g, (_match, name: string) => {
    const value = (params as Record<string, string> | undefined)?.[name];
    if (value === undefined || value === '') throw new Error(`API-Route ${String(id)}: Parameter "${name}" fehlt.`);
    return encodeURIComponent(value);
  });
  if (query) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      search.set(key, String(value));
    }
    const rendered = search.toString();
    if (rendered) path += `?${rendered}`;
  }
  return path;
}

function defaultMethod(id: ApiRouteId): ApiMethod {
  const methods = API_ROUTES[id].methods as readonly ApiMethod[];
  return methods.includes('GET') ? 'GET' : methods[0];
}

export async function apiRequest<Id extends ApiRouteId, T = ApiResponse<Id>>(
  id: Id,
  options: ApiRequestOptions<Id> = {},
): Promise<ApiResult<T>> {
  const method = options.method ?? defaultMethod(id);
  const allowed = API_ROUTES[id].methods as readonly ApiMethod[];
  if (!allowed.includes(method)) throw new Error(`API-Route ${String(id)} erlaubt ${method} nicht.`);
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    if (options.body instanceof FormData || options.body instanceof Blob || typeof options.body === 'string') {
      body = options.body;
    } else {
      headers['content-type'] ??= 'application/json';
      body = JSON.stringify(options.body);
    }
  }
  if (options.ifMatch) headers['if-match'] = options.ifMatch;
  const doFetch = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(apiPath(id, options.params, options.query), {
      method,
      headers,
      body,
      signal: options.signal,
      cache: options.cache ?? (method === 'GET' ? 'no-store' : undefined),
    });
  } catch (error) {
    return { ok: false, status: 0, data: null, etag: null, response: null, error: error instanceof Error ? error.message : 'network' };
  }
  /* Kopfzeilen defensiv lesen: Test-Doubles liefern oft nur `ok` und `json()`. */
  const header = (name: string): string | null => {
    try { return response.headers?.get?.(name) ?? null; } catch { return null; }
  };
  const etag = header('etag');
  const contentType = header('content-type') ?? '';
  let data: unknown = null;
  if (method !== 'HEAD' && response.status !== 204) {
    if (contentType.includes('json') || (!contentType && typeof response.json === 'function')) {
      try { data = await response.json(); } catch { data = null; }
    } else if (typeof response.text === 'function') {
      try { data = await response.text(); } catch { data = null; }
    }
  }
  if (!response.ok) {
    const message = typeof data === 'object' && data && 'message' in data && typeof (data as { message: unknown }).message === 'string'
      ? (data as { message: string }).message
      : `HTTP ${response.status}`;
    return { ok: false, status: response.status, data, etag, response, error: message };
  }
  return { ok: true, status: response.status, data: data as T, etag, response };
}

/** Kurzform für Leserouten: liefert die Nutzdaten oder `null`. */
export async function apiGet<Id extends ApiRouteId>(id: Id, options: Omit<ApiRequestOptions<Id>, 'method' | 'body'> = {}): Promise<ApiResponse<Id> | null> {
  const result = await apiRequest(id, options);
  return result.ok ? result.data : null;
}
