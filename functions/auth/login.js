import {
  parseCookies,
  setCookie,
  signValue,
  buildRedirectResponse,
  isSafeReturnTo
} from "../_auth/utils";

const STATE_COOKIE = "patreon_oauth";

export async function onRequest({ request, env }) {
  if (!env.PATREON_CLIENT_ID || !env.PATREON_REDIRECT_URI || !env.SESSION_SECRET) {
    return new Response("Missing OAuth configuration", { status: 500 });
  }

  const url = new URL(request.url);
  const to = url.searchParams.get("to") || "/members/";
  const returnTo = isSafeReturnTo(to) ? to : "/members/";

  const state = cryptoRandomString();
  const payload = {
    state,
    return_to: returnTo,
    created_at: Date.now()
  };

  const signed = await signValue(env.SESSION_SECRET, payload);

  const authUrl = new URL("https://www.patreon.com/oauth2/authorize");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", env.PATREON_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", env.PATREON_REDIRECT_URI);
  authUrl.searchParams.set("scope", "identity identity.memberships");
  authUrl.searchParams.set("state", state);

  const cookie = setCookie(STATE_COOKIE, signed, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 600
  });

  return buildRedirectResponse(authUrl.toString(), [cookie]);
}

function cryptoRandomString() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
