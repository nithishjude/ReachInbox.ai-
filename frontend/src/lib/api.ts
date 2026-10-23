import type {
  CampaignDetail,
  CampaignProgress,
  EmailItem,
  EmailStats,
  EmailStatus,
  ListKind,
  Paginated,
  ScheduleRequest,
  ScheduleResponse,
  SendersResponse,
  User,
} from "../types/email";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      credentials: "include",
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
      ...init,
    });
  } catch {
    throw new ApiError(0, "Cannot reach the server. Is the backend running?");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

/** Full-page navigation: the OAuth dance happens on the backend. */
export const GOOGLE_LOGIN_URL = "/api/auth/google";

export const api = {
  me: () => request<{ user: User }>("/auth/me").then((r) => r.user),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),

  listEmails: (kind: ListKind, params: { search?: string; status?: EmailStatus; page?: number; pageSize?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.search) qs.set("search", params.search);
    if (params.status) qs.set("status", params.status);
    if (params.page) qs.set("page", String(params.page));
    if (params.pageSize) qs.set("pageSize", String(params.pageSize));
    return request<Paginated<EmailItem>>(`/emails/${kind}?${qs}`);
  },
  stats: () => request<EmailStats>("/emails/stats"),
  getEmail: (id: string) => request<EmailItem>(`/emails/${id}`),
  schedule: (body: ScheduleRequest) =>
    request<ScheduleResponse>("/emails/schedule", { method: "POST", body: JSON.stringify(body) }),
  senders: () => request<SendersResponse>("/senders"),
  campaigns: (params: { search?: string; page?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.search) qs.set("search", params.search);
    if (params.page) qs.set("page", String(params.page));
    return request<Paginated<CampaignProgress>>(`/campaigns?${qs}`);
  },
  campaign: (id: string) => request<CampaignDetail>(`/campaigns/${id}`),
  deleteEmail: (id: string) => request<{ ok: true }>(`/emails/${id}`, { method: "DELETE" }),
  retry: (target: { ids: string[] } | { all: true }) =>
    request<{ retried: number }>("/emails/retry", { method: "POST", body: JSON.stringify(target) }),
};
