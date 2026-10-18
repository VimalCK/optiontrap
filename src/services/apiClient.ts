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

async function readBody(response: Response): Promise<unknown> {
  if (isJsonResponse(response)) return response.json().catch(() => null);
  return response.text().catch(() => '');
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
  if (response.status === 401 || response.status === 403) {
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
    if (response.status === 401 || response.status === 403) {
      handleKiteAuthFailure();
      throw new ApiError('Session expired. Please login again.', response.status);
    }
    return response;
  },
};

