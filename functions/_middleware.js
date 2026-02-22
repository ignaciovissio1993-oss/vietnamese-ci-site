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
    path === "/login.html" ||
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

  const guardResponse = await fetch(forwarded);
  const location = guardResponse.headers.get("Location");

  if (location) {
    const redirectUrl = new URL(location, url.origin);
    if (redirectUrl.pathname === "/auth/login") {
      const accept = request.headers.get("accept") || "";
      const isHtmlNav = accept.includes("text/html");

      const passthroughHeaders = new Headers();
      for (const [key, value] of guardResponse.headers) {
        if (key.toLowerCase() === "location") continue;
        passthroughHeaders.append(key, value);
      }

      if (isHtmlNav) {
        const loginUrl = new URL("/login.html", url.origin).toString();
        passthroughHeaders.set("Location", loginUrl);
        return new Response(null, { status: 302, headers: passthroughHeaders });
      }

      if (!passthroughHeaders.has("Content-Type")) {
        passthroughHeaders.set("Content-Type", "text/plain; charset=utf-8");
      }
      return new Response("Unauthorized", { status: 401, headers: passthroughHeaders });
    }
  }

  return guardResponse;
}
