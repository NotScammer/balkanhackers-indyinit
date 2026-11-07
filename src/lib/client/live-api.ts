import { request } from "./api";
import type { LiveRequest, LiveView } from "@/shared/live";
export const liveApi = {
  get: (id: string) => request<LiveView>(`/sessions/${id}/live`, {}, id),
  turn: (id: string, input: LiveRequest) =>
    request<LiveView>(
      `/sessions/${id}/live`,
      { method: "POST", body: JSON.stringify(input) },
      id,
    ),
  token: (id: string, purpose: "interview" | "recap" = "interview") =>
    request<{ clientSecret: string; expiresAt: string }>(
      `/sessions/${id}/live/token`,
      { method: "POST", body: JSON.stringify({ purpose }) },
      id,
    ),
  end: (id: string) => request(`/sessions/${id}/end`, { method: "POST" }, id),
};
