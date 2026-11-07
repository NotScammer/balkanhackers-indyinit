/** Only known app destinations are allowed after an OAuth redirect. */
export function safeReturnPath(value: string | null | undefined): string {
  return value && /^\/(?:interview|results)\/[A-Za-z0-9_-]+$/.test(value)
    ? value
    : "/";
}
