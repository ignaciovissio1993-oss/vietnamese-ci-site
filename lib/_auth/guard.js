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

  if (isMembershipCacheValid(session, now, memberCacheSeconds) && hasCachedMembershipAccess(session)) {
    console.info("[membership-guard] membership detected", {
      membershipDetected: session.member_access_level,
      redirectingToNotAMember: session.member_access_level === "none"
    });

    if (session.member_access_level === "none") {
      return buildRedirectResponse("/not-a-member.html");
    }
    return context.next();
  }

  const refreshed = await ensureAccessToken(session, env);
  if (!refreshed) {
    return redirectToLogin(url, [clearCookie(SESSION_COOKIE)]);
  }

  const membershipAccess = await checkMembership(refreshed, env);
  refreshed.member_checked_at = now;
  refreshed.member_access_level = membershipAccess;
  refreshed.member_is_active = membershipAccess !== "none";
  const newSessionCookie = await signValue(env.SESSION_SECRET, refreshed);
  const sessionCookie = setCookie(SESSION_COOKIE, newSessionCookie, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/"
  });

  console.info("[membership-guard] membership detected", {
    membershipDetected: membershipAccess,
    redirectingToNotAMember: membershipAccess === "none"
  });

  if (membershipAccess === "none") {
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
  if (!env.PATREON_CAMPAIGN_ID) return "none";
  if (!session.access_token) return "none";

  const configuredCampaignId = String(env.PATREON_CAMPAIGN_ID);
  const url = `${PATREON_IDENTITY_URL}?include=memberships.campaign,memberships.currently_entitled_tiers&fields%5Bmember%5D=patron_status,currently_entitled_amount_cents`;

  try {
    const data = await fetchPatreonJson(url, {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        Accept: "application/json"
      }
    });
    const included = data.included || [];

    for (const item of included) {
      if (item.type !== "member") continue;
      const status = item.attributes?.patron_status;
      const campaignId = String(item.relationships?.campaign?.data?.id ?? "");
      const entitledAmountCents = Number(item.attributes?.currently_entitled_amount_cents ?? 0);
      const entitledTiers = item.relationships?.currently_entitled_tiers?.data || [];
      const normalizedEntitledAmountCents = Number.isFinite(entitledAmountCents)
        ? entitledAmountCents
        : 0;
      const hasMembership =
        status === "active_patron" ||
        (Array.isArray(entitledTiers) && entitledTiers.length > 0);
      const isPaidPatron =
        hasMembership && normalizedEntitledAmountCents > 0;
      const membershipAccess = hasMembership
        ? (isPaidPatron ? "paid" : "free")
        : "none";

      if (campaignId === configuredCampaignId) {
        console.info("[membership-guard] Patreon membership", {
          membershipExists: true,
          patronStatus: status || null,
          currentlyEntitledAmountCents: normalizedEntitledAmountCents,
          membershipAccess,
          isPaidPatron,
          isFreePatron: !isPaidPatron
        });
      }

      if (campaignId === configuredCampaignId) {
        return membershipAccess;
      }
    }
  } catch {
    return "none";
  }

  console.info("[membership-guard] Patreon membership", {
    membershipExists: false,
    patronStatus: null,
    currentlyEntitledAmountCents: 0,
    membershipAccess: "none",
    isPaidPatron: false,
    isFreePatron: false
  });
  return "none";
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

function hasCachedMembershipAccess(session) {
  return (
    session?.member_access_level === "paid" ||
    session?.member_access_level === "free" ||
    session?.member_access_level === "none"
  );
}
