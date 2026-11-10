import { handleKiteAuthFailure } from './authSession';

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/** True when a request was cancelled via its AbortSignal (e.g. the page unmounted). */
export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export type ApiRequestOptions = Omit<RequestInit, 'body'> & {
  body?: BodyInit | object | null;
};

function getErrorMessage(body: unknown, status: number): string {
  if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string') {
    return body.message;
  }
  return `Request failed (${status})`;
}

function isJsonResponse(response: Response): boolean {
  return response.headers.get('content-type')?.includes('application/json') === true;
}

function serializeBody(body: ApiRequestOptions['body'], headers: Headers): BodyInit | undefined {
  if (body == null || typeof body === 'string' || body instanceof FormData || body instanceof URLSearchParams || body instanceof Blob) {
    return body as BodyInit | undefined;
  }
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return JSON.stringify(body);
}

/**
 * Whether a 401/403 means the Kite login has ended. Kite also answers 403 for
 * a call this Kite app isn't allowed (PermissionException, e.g. quotes without
 * market-data access): that is an ordinary error, not a reason to log out.
 */
export function isLoginEnded(status: number, body: unknown): boolean {
  if (status === 401) return true;
  if (status !== 403) return false;
  return !(body && typeof body === 'object' && 'error_type' in body && body.error_type === 'PermissionException');
}

async function readBody(response: Response): Promise<unknown> {
  if (isJsonResponse(response)) return response.json().catch(() => null);
  return response.text().catch(() => '');
}

/** The server's error message from a failed response, for callers of `apiClient.raw`. */
export async function responseErrorMessage(response: Response): Promise<string> {
  return getErrorMessage(await readBody(response), response.status);
}

async function request<T>(url: string, options: ApiRequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const { body, ...requestOptions } = options;
  const response = await fetch(url, {
    ...requestOptions,
    headers,
    credentials: requestOptions.credentials ?? 'include',
    body: serializeBody(body, headers),
  });

  const parsedBody = await readBody(response);
  if (isLoginEnded(response.status, parsedBody)) {
    handleKiteAuthFailure();
    throw new ApiError('Session expired. Please login again.', response.status, parsedBody);
  }

  if (!response.ok) {
    throw new ApiError(getErrorMessage(parsedBody, response.status), response.status, parsedBody);
  }

  if (parsedBody && typeof parsedBody === 'object' && 'data' in parsedBody) {
    return parsedBody.data as T;
  }
  return parsedBody as T;
}

/** Request a JSON API response and return its decoded body. */
export const apiClient = {
  get: <T>(url: string, options?: ApiRequestOptions) => request<T>(url, { ...options, method: 'GET' }),
  post: <T>(url: string, body?: ApiRequestOptions['body'], options?: ApiRequestOptions) => request<T>(url, { ...options, method: 'POST', body }),
  put: <T>(url: string, body?: ApiRequestOptions['body'], options?: ApiRequestOptions) => request<T>(url, { ...options, method: 'PUT', body }),
  patch: <T>(url: string, body?: ApiRequestOptions['body'], options?: ApiRequestOptions) => request<T>(url, { ...options, method: 'PATCH', body }),
  delete: <T>(url: string, options?: ApiRequestOptions) => request<T>(url, { ...options, method: 'DELETE' }),
  raw: async (url: string, options: ApiRequestOptions = {}): Promise<Response> => {
    const headers = new Headers(options.headers);
    const { body, ...requestOptions } = options;
    const response = await fetch(url, {
      ...requestOptions,
      headers,
      credentials: requestOptions.credentials ?? 'include',
      body: serializeBody(body, headers),
    });
    const errorBody = response.status === 403 ? await readBody(response.clone()) : null;
    if (isLoginEnded(response.status, errorBody)) {
      handleKiteAuthFailure();
      throw new ApiError('Session expired. Please login again.', response.status);
    }
    return response;
  },
};

