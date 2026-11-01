export const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

export type Report = {
  id: string;
  publicCaseNumber: string;
  title: string;
  description: string;
  category: string;
  approximateLocation: string;
  currentStatus: string;
  createdAt: string;
  updatedAt: string;
  evidenceCount: number;
};

export type ReportPage = {
  data: Report[];
  page: number;
  pageSize: number;
  total: number;
};

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  token?: string
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers,
    cache: "no-store"
  });
  if (!response.ok) {
    const body = await response.json().catch(() => undefined) as { message?: string } | undefined;
    throw new Error(body?.message ?? `Request failed (${response.status}).`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export function getToken(): string | null {
  return typeof window === "undefined" ? null : window.sessionStorage.getItem("civicfix_token");
}
