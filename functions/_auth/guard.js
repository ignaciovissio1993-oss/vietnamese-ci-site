import {
  parseCookies,
  setCookie,
  clearCookie,
  signValue,
  verifyValue,
  buildRedirectResponse,
  fetchPatreonJson
} from "./utils";

const SESSION_COOKIE = "patreon_session";
const DEFAULT_MEMBER_CACHE_SECONDS = 300;
// Use Patreon API endpoints on www.patreon.com/api for token and v2 identity requests.
const PATREON_TOKEN_URL = "https://www.patreon.com/api/oauth2/token";
const PATREON_IDENTITY_URL = "https://www.patreon.com/api/oauth2/v2/identity";

export async function guard(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const cookies = parseCookies(request.headers.get("Cookie"));
  const memberCacheSeconds = getMemberCacheSeconds(env);

  if (!env.SESSION_SECRET) {
    return new Response("Missing SESSION_SECRET", { status: 500 });
  }

  const signedSession = cookies[SESSION_COOKIE];
  const session = await verifyValue(env.SESSION_SECRET, signedSession);

  if (!session) {
    return redirectToLogin(url);
  }

  const now = Math.floor(Date.now() / 1000);

  if (isMembershipCacheValid(session, now, memberCacheSeconds)) {
    if (session.member_is_active === false) {
      return buildRedirectResponse("/not-a-member.html");
    }
    return context.next();
  }

  const refreshed = await ensureAccessToken(session, env);
  if (!refreshed) {
    return redirectToLogin(url, [clearCookie(SESSION_COOKIE)]);
  }

  const memberOk = await checkMembership(refreshed, env);
  refreshed.member_checked_at = now;
  refreshed.member_is_active = memberOk;
  const newSessionCookie = await signValue(env.SESSION_SECRET, refreshed);
  const sessionCookie = setCookie(SESSION_COOKIE, newSessionCookie, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/"
  });

  if (!memberOk) {
    return buildRedirectResponse("/not-a-member.html", [sessionCookie]);
  }

  const response = await context.next();
  response.headers.append("Set-Cookie", sessionCookie);
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

  try {
    const data = await fetchPatreonJson(PATREON_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });

    if (!data?.access_token || typeof data.access_token !== "string") {
      return null;
    }

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token || session.refresh_token,
      expires_at: now + (data.expires_in || 0),
      scope: data.scope || session.scope,
      member_checked_at: session.member_checked_at,
      member_is_active: session.member_is_active
    };
  } catch {
    return null;
  }
}

async function checkMembership(session, env) {
  if (!env.PATREON_CAMPAIGN_ID) return false;
  if (!session.access_token) return false;

  const url = `${PATREON_IDENTITY_URL}?include=memberships&fields%5Bmember%5D=patron_status`;

  try {
    const data = await fetchPatreonJson(url, {
      headers: { Authorization: `Bearer ${session.access_token}` }
    });
    const included = data.included || [];

    for (const item of included) {
      if (item.type !== "member") continue;
      const status = item.attributes?.patron_status;
      const campaignId = item.relationships?.campaign?.data?.id;
      if (campaignId === env.PATREON_CAMPAIGN_ID && status === "active_patron") {
        return true;
      }
    }
  } catch {
    return false;
  }

  return false;
}

export async function onRequest(context) {
  return guard(context);
}

function getMemberCacheSeconds(env) {
  const configured = Number.parseInt(env.MEMBER_CACHE_SECONDS || "", 10);
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }
  return DEFAULT_MEMBER_CACHE_SECONDS;
}

function isMembershipCacheValid(session, now, memberCacheSeconds) {
  if (session.member_checked_at && now < session.member_checked_at + memberCacheSeconds) {
    return true;
  }

  if (session.member_valid_until && now < session.member_valid_until) {
    return true;
  }

  return false;
}
