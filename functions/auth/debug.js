import { parseCookies, verifyValue, fetchPatreonJson } from "../../lib/_auth/utils";

const SESSION_COOKIE = "patreon_session";
const PATREON_IDENTITY_DEBUG_URL =
  "https://www.patreon.com/api/oauth2/v2/identity?include=memberships,memberships.campaign,memberships.currently_entitled_tiers&fields[user]=full_name,email&fields[member]=patron_status&fields[campaign]=creation_name";

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");

  if (!env.DEBUG_KEY || key !== env.DEBUG_KEY) {
    return json({ ok: false, reason: "forbidden" }, 403);
  }

  if (!env.SESSION_SECRET) {
    return json({ ok: false, reason: "missing_session_secret" }, 500);
  }

  const cookies = parseCookies(request.headers.get("Cookie"));
  const signedSession = cookies[SESSION_COOKIE];
  const session = await verifyValue(env.SESSION_SECRET, signedSession);

  if (!session || !session.access_token) {
    return json({ ok: false, reason: "no_session" });
  }

  const envCampaignId = String(env.PATREON_CAMPAIGN_ID || "");

  try {
    const data = await fetchPatreonJson(PATREON_IDENTITY_DEBUG_URL, {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        Accept: "application/json"
      },
      redirect: "manual"
    });

    const included = Array.isArray(data?.included) ? data.included : [];
    const membershipsSummary = included
      .filter((item) => item?.type === "member")
      .map((item) => {
        const entitled = item?.relationships?.currently_entitled_tiers?.data;
        return {
          campaignId: String(item?.relationships?.campaign?.data?.id ?? ""),
          patron_status: item?.attributes?.patron_status || null,
          entitledTiersCount: Array.isArray(entitled) ? entitled.length : 0
        };
      });

    const campaignsSummary = included
      .filter((item) => item?.type === "campaign")
      .map((item) => ({
        id: String(item?.id ?? ""),
        creation_name: item?.attributes?.creation_name || null
      }));

    const memberOk = membershipsSummary.some(
      (item) =>
        item.campaignId === envCampaignId &&
        (item.patron_status === "active_patron" || item.entitledTiersCount > 0)
    );

    const userData = data?.data || {};
    const userAttrs = userData?.attributes || {};
    const user = { id: userData?.id || null };
    if (typeof userAttrs.full_name === "string") user.full_name = userAttrs.full_name;
    if (typeof userAttrs.email === "string") user.email = userAttrs.email;

    return json({
      ok: true,
      envCampaignId,
      user,
      membershipsSummary,
      campaignsSummary,
      decisionPreview: {
        memberOk,
        rule: "campaign matches AND (active_patron OR entitled tiers > 0)"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Patreon error";
    return json({ ok: false, reason: "patreon_fetch_failed", message }, 502);
  }
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
