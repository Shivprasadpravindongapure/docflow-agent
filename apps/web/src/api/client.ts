export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:4000'
).replace(/\/$/, '');

export interface ApplicationSummary {
  id: string;
  status: string;
}

interface ApiError {
  error?: string;
}

function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof value.error === 'string'
  );
}

async function readError(response: Response): Promise<string> {
  const body: unknown = await response.json();
  if (isApiError(body) && body.error) return body.error;
  return `Request failed with status ${response.status}.`;
}

export async function register(email: string, password: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(await readError(response));
}

export async function login(email: string, password: string): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(await readError(response));

  const body: unknown = await response.json();
  if (
    typeof body !== 'object' ||
    body === null ||
    !('token' in body) ||
    typeof body.token !== 'string'
  ) {
    throw new Error('The API returned an invalid sign-in response.');
  }
  return body.token;
}

export async function listApplications(token: string): Promise<ApplicationSummary[]> {
  const response = await fetch(`${API_BASE_URL}/applications`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(await readError(response));

  const body: unknown = await response.json();
  if (
    !Array.isArray(body) ||
    !body.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        'id' in item &&
        typeof item.id === 'string' &&
        'status' in item &&
        typeof item.status === 'string',
    )
  ) {
    throw new Error('The API returned an invalid applications response.');
  }
  return body;
}
