import type { FieldError } from "./types";

const BASE = "/api/v1";

export class ApiError extends Error {
  status: number;
  code: string;
  fields: FieldError[];
  hint?: string;

  constructor(
    status: number,
    payload: { code?: string; message?: string; fields?: FieldError[]; hint?: string },
  ) {
    super(payload.message ?? `Request failed (${status}).`);
    this.name = "ApiError";
    this.status = status;
    this.code = payload.code ?? "ERROR";
    this.fields = payload.fields ?? [];
    this.hint = payload.hint;
  }
}

function csrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)fdr_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function toApiError(response: Response): Promise<ApiError> {
  try {
    const data = await response.json();
    const error = data?.error;
    return new ApiError(response.status, {
      code: error?.code,
      message: error?.message ?? `Request failed (${response.status}).`,
      fields: error?.fields,
      hint: error?.hint,
    });
  } catch {
    return new ApiError(response.status, {
      message: `Request failed (${response.status}).`,
    });
  }
}

let refreshing: Promise<boolean> | null = null;

export async function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      const token = csrfToken();
      // No CSRF cookie means there is no session to refresh. Skipping avoids a
      // guaranteed 403 on every signed-out page load.
      if (!token) return false;
      const headers: Record<string, string> = { "X-CSRF-Token": token };
      try {
        const response = await fetch(`${BASE}/auth/refresh`, {
          method: "POST",
          credentials: "include",
          headers,
        });
        return response.ok;
      } catch {
        return false;
      }
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

type RequestOptions = Omit<RequestInit, "body"> & { body?: unknown };

async function request<T>(path: string, options: RequestOptions = {}, allowRefresh = true): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const headers = new Headers(options.headers);
  let body: BodyInit | undefined;

  if (options.body !== undefined) {
    if (options.body instanceof FormData) {
      body = options.body;
    } else {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(options.body);
    }
  }

  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const token = csrfToken();
    if (token) headers.set("X-CSRF-Token", token);
  }

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...options,
      method,
      headers,
      body,
      credentials: "include",
    });
  } catch {
    throw new ApiError(0, {
      code: "NETWORK_ERROR",
      message: "The server could not be reached. Check that the API is running.",
    });
  }

  if (response.status === 401 && allowRefresh && !path.startsWith("/auth/")) {
    if (await refreshSession()) {
      return request<T>(path, options, false);
    }
  }

  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return (await response.text()) as unknown as T;
  }
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: "POST", body: form }),
  logout: () => request<{ signed_out: boolean }>("/auth/logout", { method: "POST" }),
};

export interface LoginResponse {
  user: import("./types").User;
  csrf_token: string;
  access_expires_at: string;
}

export async function loginRequest(email: string, password: string): Promise<LoginResponse> {
  return request<LoginResponse>(
    "/auth/login",
    { method: "POST", body: { email, password } },
    false,
  );
}

export function toQuery(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export async function downloadCsv(
  path: string,
  params: Record<string, string | number | undefined | null>,
): Promise<{ rows: number; truncated: boolean }> {
  const url = `${BASE}${path}${toQuery(params)}`;
  const response = await fetch(url, { credentials: "include" });
  if (response.status === 401 && (await refreshSession())) {
    return downloadCsv(path, params);
  }
  if (!response.ok) throw await toApiError(response);

  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename = match?.[1] ?? "fdr-records.csv";
  const link = document.createElement("a");
  const objectUrl = URL.createObjectURL(blob);
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);

  return {
    rows: Number(response.headers.get("x-exported-rows") ?? "0"),
    truncated: response.headers.get("x-export-truncated") === "true",
  };
}
