import "server-only";
import { liveRequestSchema } from "@/shared/live";
import { authorize } from "../auth";
import { body, handle, json, sessionId } from "../http";
import { AppError } from "../errors";
import { LiveService, liveView } from "./service";
import type { ApiDependencies } from "../api";
import type { StructuredAI } from "../providers/anthropic";
export function createLiveApi(deps: ApiDependencies) {
  const ai: StructuredAI = {
    get model() {
      return deps.ai().model;
    },
    generate: (...args) => deps.ai().generate(...args),
  };
  const service = new LiveService(deps.db, ai);
  async function state(request: Request, id: string) {
    const snapshot = await authorize(deps.db, sessionId(id), request);
    if (!snapshot.session.audio_processing_consent)
      throw new AppError(
        "AUDIO_CONSENT_REQUIRED",
        403,
        "Live audio consent is required.",
      );
    return { snapshot, saved: await service.open(snapshot) };
  }
  return {
    get: (request: Request, id: string) =>
      handle(async () => {
        const { snapshot, saved } = await state(request, id);
        return json(liveView(saved, snapshot));
      }),
    turn: (request: Request, id: string) =>
      handle(async () => {
        const { snapshot } = await state(request, id);
        const input = await body(request, liveRequestSchema);
        for (const [key, limit] of [
          [`live:${id}`, 100],
          ["live:global", 2000],
        ] as const) {
          if (
            !(await deps.db.rpc("consume_rate", {
              p_key: key,
              p_limit: limit,
              p_seconds: 86400,
            }))
          )
            throw new AppError(
              "RATE_LIMITED",
              429,
              "Live conversation budget exceeded.",
              true,
            );
        }
        return json(await service.apply(snapshot, input));
      }),
    token: (request: Request, id: string) =>
      handle(async () => {
        const { snapshot, saved } = await state(request, id);
        if (saved.status !== "active" || snapshot.session.status !== "active")
          throw new AppError(
            "SESSION_INCOMPLETE",
            409,
            "This interview has ended.",
          );
        for (const [key, limit] of [
          [`realtime:${id}`, 6],
          ["realtime:global", 100],
        ] as const) {
          if (
            !(await deps.db.rpc("consume_rate", {
              p_key: key,
              p_limit: limit,
              p_seconds: 3600,
            }))
          )
            throw new AppError(
              "RATE_LIMITED",
              429,
              "Live connection budget exceeded.",
              true,
            );
        }
        return json(await deps.realtime(snapshot));
      }),
  };
}
