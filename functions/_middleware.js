import { onRequest as guard } from "./_auth/guard";

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const path = url.pathname;

  // Allow auth routes (login/callback/logout) to work
  if (path.startsWith("/auth/")) return context.next();

  // Allow internal auth helpers if used
  if (path.startsWith("/_auth/")) return context.next();

  // Allow static assets so the site can render after login
  if (
    path.startsWith("/assets/") ||
    path.startsWith("/scripts/") ||
    path.startsWith("/images/") ||
    path === "/favicon.ico" ||
    path === "/robots.txt" ||
    path === "/sitemap.xml"
  ) {
    return context.next();
  }

  // EVERYTHING ELSE is protected
  return guard(context);
}