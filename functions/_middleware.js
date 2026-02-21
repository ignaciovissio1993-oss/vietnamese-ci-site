export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // Allow auth routes + internal auth function
  if (path.startsWith("/auth/") || path.startsWith("/_auth/")) {
    return next();
  }

  // Allow static assets (adjust if your folders differ)
  if (
    path.startsWith("/assets/") ||
    path.startsWith("/scripts/") ||
    path.startsWith("/images/") ||
    path === "/favicon.ico" ||
    path === "/robots.txt" ||
    path === "/sitemap.xml"
  ) {
    return next();
  }

  // Everything else: send to existing guard function
  const to = encodeURIComponent(path + url.search);
  const guardUrl = new URL(`/_auth/guard?to=${to}`, url.origin);

  // Forward the same request method/headers; body only matters for POST (usually not needed for a static site)
  const forwarded = new Request(guardUrl.toString(), {
    method: request.method,
    headers: request.headers,
  });

  return fetch(forwarded);
}