import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { authConfig, authCookieOptions } from "./config";
/** Per-request Auth client using the publishable key; never the service-role key. */
export async function authClient() {
  const config = authConfig();
  const store = await cookies();
  return createServerClient(config.url, config.key, {
    cookieOptions: authCookieOptions(),
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(10000) }),
    },
    cookies: {
      getAll: () => store.getAll(),
      setAll: (values) => {
        for (const { name, value, options } of values)
          store.set(name, value, options);
      },
    },
  });
}
