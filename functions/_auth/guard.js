import {
  parseCookies,
  setCookie,
  clearCookie,
  signValue,
  verifyValue,
  buildRedirectResponse
} from "./utils";

const SESSION_COOKIE = "patreon_session";
const MEMBER_CACHE_SECONDS = 300;

export async function guard(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const cookies = parseCookies(request.headers.get("Cookie"));

  if (!env.SESSION_SECRET) {
    return new Response("Missing SESSION_SECRET", { status: 500 });
  }

  const signedSession = cookies[SESSION_COOKIE];
  const session = await verifyValue(env.SESSION_SECRET, signedSession);

  if (!session) {
    return redirectToLogin(url);
  }

  const now = Math.floor(Date.now() / 1000);

  if (session.member_valid_until && now < session.member_valid_until) {
    return context.next();
  }

  const refreshed = await ensureAccessToken(session, env);
  if (!refreshed) {
    return redirectToLogin(url, [clearCookie(SESSION_COOKIE)]);
  }

  const memberOk = await checkMembership(refreshed, env);
  if (!memberOk) {
    return buildRedirectResponse("/not-a-member.html", [clearCookie(SESSION_COOKIE)]);
  }

  refreshed.member_valid_until = now + MEMBER_CACHE_SECONDS;
  const newSessionCookie = await signValue(env.SESSION_SECRET, refreshed);

  const response = await context.next();
  response.headers.append(
    "Set-Cookie",
    setCookie(SESSION_COOKIE, newSessionCookie, {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/"
    })
  );
  return response;
}

function redirectToLogin(url, cookies = []) {
  const returnTo = encodeURIComponent(url.pathname + url.search);
  return buildRedirectResponse(`/auth/login?to=${returnTo}`, cookies);
}

async function ensureAccessToken(session, env) {
  const now = Math.floor(Date.now() / 1000);
  if (session.access_token && session.expires_at && session.expires_at > now + 60) {
    return session;
  }
  if (!session.refresh_token) return null;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: session.refresh_token,
    client_id: env.PATREON_CLIENT_ID || "",
    client_secret: env.PATREON_CLIENT_SECRET || ""
  });

  const resp = await fetch("https://www.patreon.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  if (!resp.ok) return null;
  const data = await resp.json();

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || session.refresh_token,
    expires_at: now + (data.expires_in || 0),
    scope: data.scope || session.scope
  };
}

async function checkMembership(session, env) {
  if (!env.PATREON_CAMPAIGN_ID) return false;

  const url =
    "https://www.patreon.com/api/oauth2/v2/identity" +
    "?include=memberships&fields%5Bmember%5D=patron_status";

  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${session.access_token}` }
  });

  if (!resp.ok) return false;
  const data = await resp.json();
  const included = data.included || [];

  for (const item of included) {
    if (item.type !== "member") continue;
    const status = item.attributes?.patron_status;
    const campaignId = item.relationships?.campaign?.data?.id;
    if (campaignId === env.PATREON_CAMPAIGN_ID && status === "active_patron") {
      return true;
    }
  }
  return false;
}

export async function onRequest(context) {
  return guard(context);
}