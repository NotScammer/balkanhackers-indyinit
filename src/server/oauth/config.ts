import "server-only";
import { z } from "zod";
import { AppError } from "../errors";
const schema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  APP_URL: z.url().refine((value) => {
    try {
      const url = new URL(value);
      return (
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        url.pathname === "/" &&
        (url.protocol === "https:" ||
          (url.protocol === "http:" &&
            ["localhost", "127.0.0.1"].includes(url.hostname)))
      );
    } catch {
      return false;
    }
  }),
});
export function authConfigured() {
  return schema.safeParse(process.env).success;
}
export function authConfig() {
  const result = schema.safeParse(process.env);
  if (!result.success)
    throw new AppError(
      "NOT_CONFIGURED",
      503,
      "Sign-in is unavailable. Configure Supabase Auth and APP_URL.",
    );
  return {
    url: result.data.SUPABASE_URL,
    key: result.data.SUPABASE_PUBLISHABLE_KEY,
    origin: new URL(result.data.APP_URL).origin,
  };
}
export function authCookieOptions() {
  return {
    httpOnly: true,
    secure: authConfig().origin.startsWith("https:"),
    sameSite: "lax" as const,
    path: "/",
  };
}
