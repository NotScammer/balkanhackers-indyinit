// Account previews never create an authenticated identity or store an email.
export const accountPreview = {
  continueAsGuest() {
    sessionStorage.setItem("talk-to-future:entry", "guest");
  },
  async requestEmailLink(email: string) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      throw Error("Enter a valid email address.");
    return {
      status: "preview" as const,
      message:
        "This is an account preview. No email was sent and no account was created. You can continue as a guest.",
    };
  },
};
export function safeReturnPath(value: string | null) {
  return value && /^\/(?:interview|results)\/[A-Za-z0-9_-]+$/.test(value)
    ? value
    : "/";
}
