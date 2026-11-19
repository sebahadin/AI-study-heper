import type { FieldErrors } from '../types';

export class ApiError extends Error {
  constructor(message: string, public status: number, public fields: FieldErrors = {}) { super(message); }
}

export async function api<T>(path: string, options: Omit<RequestInit, 'body'> & { body?: unknown } = {}): Promise<T> {
  const { body, ...init } = options;
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      credentials: 'same-origin',
      headers: { ...(body !== undefined && { 'Content-Type': 'application/json' }), ...init.headers },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError('Could not reach the server. Please try again.', 0);
  }
  if (response.status === 204) { return undefined as T; }
  const data = await response.json().catch(() => ({ error: 'The server returned an unexpected response.' }));
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/')) {
      window.dispatchEvent(new Event('classmate:unauthenticated'));
    }
    throw new ApiError(data.error || 'The request failed.', response.status, data.fields);
  }
  return data as T;
}

export const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';
