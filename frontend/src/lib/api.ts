export const API_BASE = "/api/v1";

export class ApiError extends Error {
  status: number;
  code: string;
  details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function csrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)june_csrf=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

type RequestOptions = Omit<RequestInit, "body"> & { body?: unknown; raw?: boolean };

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, raw, headers, ...rest } = options;
  const method = (rest.method ?? "GET").toUpperCase();
  const finalHeaders = new Headers(headers);
  if (body !== undefined) finalHeaders.set("Content-Type", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const token = csrfToken();
    if (token) finalHeaders.set("X-CSRF-Token", token);
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...rest,
      method,
      headers: finalHeaders,
      credentials: "include",
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "network_error", "JUNE could not reach the control plane. Check that the backend is running.");
  }

  if (!response.ok) {
    let code = `http_${response.status}`;
    let message = response.statusText || "The request failed.";
    let details: unknown = null;
    try {
      const payload = (await response.json()) as { error?: { code?: string; message?: string; details?: unknown } };
      if (payload.error) {
        code = payload.error.code ?? code;
        message = payload.error.message ?? message;
        details = payload.error.details ?? null;
      } else if (payload && typeof payload === "object" && "detail" in payload) {
        message = String(payload.detail);
      } else if (response.status >= 500) {
        message = "The JUNE control plane did not answer correctly. It may be starting up — this request will retry automatically.";
      }
    } catch {
      if (response.status >= 500) {
        message = "The JUNE control plane did not answer correctly. It may be starting up — this request will retry automatically.";
      }
    }
    throw new ApiError(response.status, code, message, details);
  }

  if (response.status === 204) return undefined as T;
  if (raw) return response as unknown as T;
  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export function query(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const result = search.toString();
  return result ? `?${result}` : "";
}

export async function download(path: string, filename: string): Promise<void> {
  const response = await fetch(`${API_BASE}${path}`, { credentials: "include" });
  if (!response.ok) throw new ApiError(response.status, "download_failed", "The export could not be generated.");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function streamUrl(executionId: string, after = 0): string {
  return `${API_BASE}/executions/${executionId}/stream?after=${after}`;
}
