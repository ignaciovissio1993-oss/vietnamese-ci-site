import { clearCookie, buildRedirectResponse } from "../../lib/_auth/utils";

const SESSION_COOKIE = "patreon_session";

export async function onRequest() {
  const cookie = clearCookie(SESSION_COOKIE);
  return buildRedirectResponse("/", [cookie]);
}
