import { parseCookies, verifyValue, fetchPatreonJson } from "../../lib/_auth/utils";

const SESSION_COOKIE = "patreon_session";
const PATREON_IDENTITY_URL =
  "https://www.patreon.com/api/oauth2/v2/identity?include=memberships.campaign,memberships.currently_entitled_tiers&fields[user]=full_name,email&fields[member]=patron_status,currently_entitled_amount_cents&fields[tier]=title";

export async function onRequest({ request, env }) {
  if (!env.SESSION_SECRET) {
    return json({ ok: false, reason: "missing_session_secret" }, 500);
  }

  const cookies = parseCookies(request.headers.get("Cookie"));
  const signedSession = cookies[SESSION_COOKIE];
  const session = await verifyValue(env.SESSION_SECRET, signedSession);

  if (!session || !session.access_token) {
    return json({ ok: false, reason: "no_session" }, 401);
  }

  try {
    const data = await fetchPatreonJson(PATREON_IDENTITY_URL, {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        Accept: "application/json"
      },
      redirect: "manual"
    });

    const userData = data?.data || {};
    const userAttrs = userData?.attributes || {};
    const user = { id: userData?.id || null };
    if (typeof userAttrs.full_name === "string") user.full_name = userAttrs.full_name;
    if (typeof userAttrs.email === "string") user.email = userAttrs.email;

    const included = Array.isArray(data?.included) ? data.included : [];
    const memberships = included.filter((item) => item?.type === "member");
    const configuredCampaignId = String(env.PATREON_CAMPAIGN_ID || "");
    let membership =
      memberships.find(
        (item) => String(item?.relationships?.campaign?.data?.id ?? "") === configuredCampaignId
      ) || memberships[0];

    if (membership) {
      const status = membership?.attributes?.patron_status || null;
      const entitledAmountCents = Number(
        membership?.attributes?.currently_entitled_amount_cents ?? 0
      );
      const normalizedEntitledAmountCents = Number.isFinite(entitledAmountCents)
        ? entitledAmountCents
        : 0;
      const hasActiveMembership = status === "active_patron";
      const isPaidPatron = hasActiveMembership && normalizedEntitledAmountCents > 0;
      const isFreePatron = !isPaidPatron;

      if (status) user.membership_status = status;
      user.membership_exists = true;
      user.membership_entitled_amount_cents = normalizedEntitledAmountCents;

      const tiers = membership?.relationships?.currently_entitled_tiers?.data || [];
      user.membership_type = isPaidPatron ? "paid" : "free";
      user.is_paid_supporter = isPaidPatron;
      user.is_free_member = isFreePatron;
      if (Array.isArray(tiers) && tiers.length > 0) {
        const tierId = String(tiers[0]?.id ?? "");
        const tier = included.find(
          (item) => item?.type === "tier" && String(item?.id ?? "") === tierId
        );
        if (tier?.attributes?.title) {
          user.membership_tier = tier.attributes.title;
        } else if (tierId) {
          user.membership_tier = tierId;
        }
      }

      console.info("[auth/me] Patreon membership", {
        membershipExists: true,
        patronStatus: status,
        currentlyEntitledAmountCents: normalizedEntitledAmountCents,
        isPaidPatron,
        isFreePatron
      });
    } else {
      user.membership_exists = false;
      user.membership_entitled_amount_cents = 0;
      user.membership_type = "none";
      user.is_paid_supporter = false;
      user.is_free_member = false;

      console.info("[auth/me] Patreon membership", {
        membershipExists: false,
        patronStatus: null,
        currentlyEntitledAmountCents: 0,
        isPaidPatron: false,
        isFreePatron: false
      });
    }

    return json({ ok: true, user });
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
