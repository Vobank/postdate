export class ApiError extends Error {
  constructor(
    public code: string,
    public field?: string,
    public detail?: string,
  ) {
    super(code);
  }
}

let onSignedOut: () => void = () => {};

/** Registers what to do when the server says the session is gone. */
export function whenSignedOut(handler: () => void): void {
  onSignedOut = handler;
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        'x-postdate': '1',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('network');
  }

  let data: Record<string, unknown> = {};
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch {
    // An empty or non-JSON reply is handled by the status check below.
  }
  if (!response.ok) {
    const code = typeof data.error === 'string' ? data.error : 'unknown';
    if (code === 'unauthorized') onSignedOut();
    throw new ApiError(
      code,
      typeof data.field === 'string' ? data.field : undefined,
      typeof data.detail === 'string' ? data.detail : undefined,
    );
  }
  return data as T;
}
