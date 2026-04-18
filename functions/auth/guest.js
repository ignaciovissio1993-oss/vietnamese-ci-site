import {
  setCookie,
  buildRedirectResponse,
  isSafeReturnTo
} from "../../lib/_auth/utils";

const GUEST_COOKIE = "guest_access";

export async function onRequest({ request }) {
  const url = new URL(request.url);
  const to = url.searchParams.get("to") || "/";
  const returnTo = isSafeReturnTo(to) ? to : "/";

  const guestCookie = setCookie(GUEST_COOKIE, "1", {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  });

  return buildRedirectResponse(returnTo, [guestCookie]);
}
