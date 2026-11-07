import type { AuthenticatedUser } from "../src/server/oauth/identity";
export const testUser: AuthenticatedUser = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  email: "owner@example.invalid",
};
export const otherUser: AuthenticatedUser = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  email: "other@example.invalid",
};
