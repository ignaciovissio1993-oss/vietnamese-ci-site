import { guard } from "./_auth/guard";

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  if (url.pathname === "/members" || url.pathname.startsWith("/members/")) {
    return guard(context);
  }

  return context.next();
}
