import {
  parseCookies,
  setCookie,
  clearCookie,
  verifyValue,
  signValue,
  buildRedirectResponse
} from "../_auth/utils";

const STATE_COOKIE = "patreon_oauth";
const SESSION_COOKIE = "patreon_session";

export async function onRequest({ request, env }) {
  if (!env.PATREON_CLIENT_ID || !env.PATREON_CLIENT_SECRET || !env.PATREON_REDIRECT_URI || !env.SESSION_SECRET) {
    return new Response("Missing OAuth configuration", { status: 500 });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state) {
    return new Response("Missing code or state", { status: 400 });
  }

  const cookies = parseCookies(request.headers.get("Cookie"));
  const signedState = cookies[STATE_COOKIE];
  const statePayload = await verifyValue(env.SESSION_SECRET, signedState);

  if (!statePayload || statePayload.state !== state) {
    return new Response("Invalid state", { status: 400 });
  }

  const tokenBody = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: env.PATREON_CLIENT_ID,
    client_secret: env.PATREON_CLIENT_SECRET,
    redirect_uri: env.PATREON_REDIRECT_URI
  });

  const tokenResp = await fetch("https://www.patreon.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenBody
  });

  if (!tokenResp.ok) {
    return new Response("Token exchange failed", { status: 400 });
  }

  const tokenData = await tokenResp.json();
  const now = Math.floor(Date.now() / 1000);

  const session = {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expires_at: now + (tokenData.expires_in || 0),
    scope: tokenData.scope || ""
  };

  const signedSession = await signValue(env.SESSION_SECRET, session);

  const sessionCookie = setCookie(SESSION_COOKIE, signedSession, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/"
  });

  const clearStateCookie = clearCookie(STATE_COOKIE);
  const returnTo = statePayload.return_to || "/members/";

  return buildRedirectResponse(returnTo, [sessionCookie, clearStateCookie]);
}
