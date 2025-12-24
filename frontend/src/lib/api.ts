let csrfToken: string | null = null;

export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

export function getCsrfToken() {
  return csrfToken;
}

export async function apiFetch<T>(
  path: string,
  opts: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  } = {}
): Promise<T> {
  const method = (opts.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = {
    ...(opts.headers ?? {})
  };

  const isJson = opts.body !== undefined;
  if (isJson) headers["content-type"] = "application/json";

  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    if (csrfToken) headers["x-csrf-token"] = csrfToken;
  }

  const res = await fetch(path, {
    method,
    credentials: "include",
    headers,
    body: isJson ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal
  });

  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;

  if (!res.ok) {
    const err = new Error((data as any)?.error ?? `http_${res.status}`);
    (err as any).status = res.status;
    (err as any).data = data;
    throw err;
  }

  return data as T;
}

