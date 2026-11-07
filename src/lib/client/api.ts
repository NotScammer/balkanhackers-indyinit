import type { InterviewApi } from "./contracts";
import { mockApi } from "../../mocks/interview";
export const isMock = process.env.NEXT_PUBLIC_USE_MOCK_API === "true";
export const tokenKey = (id: string) =>
  `token:${isMock ? "mock" : "real"}:${id}`;
export class RequestError extends Error {
  constructor(
    message: string,
    public code: string,
    public retryable: boolean,
    public retryAfter: number,
  ) {
    super(message);
  }
}
async function request<T>(
  path: string,
  init: RequestInit = {},
  id?: string,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  if (id) {
    const token = sessionStorage.getItem(tokenKey(id));
    if (!token)
      throw new RequestError(
        "Session unavailable in this tab. Start a new practice.",
        "SESSION_UNAVAILABLE",
        false,
        0,
      );
    headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(180000),
  });
  if (!response.ok) {
    let code = "REQUEST_FAILED",
      retryable = false;
    try {
      const data = await response.json();
      code = data.error?.code ?? code;
      retryable = data.error?.retryable === true;
    } catch {}
    const raw = response.headers.get("Retry-After");
    const delay = raw
      ? /^\d+$/.test(raw)
        ? Number(raw) * 1000
        : Math.max(0, Date.parse(raw) - Date.now())
      : 0;
    throw new RequestError(
      code === "SESSION_UNAVAILABLE"
        ? "Session expired or unavailable. Start a new practice."
        : `Request failed (${code}). Your draft is preserved.`,
      code,
      retryable,
      delay || 0,
    );
  }
  if (response.status === 204) return undefined as T;
  return (
    response.headers.get("Content-Type")?.includes("application/json")
      ? response.json()
      : response.blob()
  ) as Promise<T>;
}
const post = (data: unknown): RequestInit => ({
  method: "POST",
  body: JSON.stringify(data),
});
export const realApi: InterviewApi = {
  catalog: () => request("/catalog"),
  create: (s) => request("/sessions", post(s)),
  session: (id) => request(`/sessions/${id}`, {}, id),
  submit: (id, a) => request(`/sessions/${id}/answers`, post(a), id),
  report: (id) => request(`/sessions/${id}/report`, {}, id),
  speech: (id, questionId) =>
    request(`/sessions/${id}/speech`, post({ questionId }), id),
  transcribe: (id, questionId, audio) => {
    const form = new FormData();
    form.append("questionId", questionId);
    form.append(
      "audio",
      audio,
      `answer.${audio.type.includes("mp4") ? "m4a" : audio.type.includes("ogg") ? "ogg" : "webm"}`,
    );
    return request(
      `/sessions/${id}/transcriptions`,
      { method: "POST", body: form },
      id,
    );
  },
  delete: (id) => request(`/sessions/${id}`, { method: "DELETE" }, id),
};
export const api = isMock ? mockApi : realApi;
