export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  if (path.startsWith("/auth/") || path.startsWith("/_auth/")) {
    return next();
  }

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

  const to = encodeURIComponent(path + url.search);
  const guardUrl = new URL(`/_auth/guard?to=${to}`, url.origin);

  const requestInit = {
    method: request.method,
    headers: request.headers
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    requestInit.body = request.body;
  }

  const guardResponse = await fetch(new Request(guardUrl.toString(), requestInit));
  const location = guardResponse.headers.get("Location");

  if (location) {
    const redirectUrl = new URL(location, url.origin);
    if (redirectUrl.pathname === "/auth/login") {
      const passthroughHeaders = new Headers();
      for (const [key, value] of guardResponse.headers) {
        if (key.toLowerCase() === "location") continue;
        passthroughHeaders.append(key, value);
      }

      if (isHtmlNavigation(request)) {
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

function isHtmlNavigation(request) {
  const accept = (request.headers.get("accept") || "").toLowerCase();
  const secFetchMode = (request.headers.get("sec-fetch-mode") || "").toLowerCase();
  const secFetchDest = (request.headers.get("sec-fetch-dest") || "").toLowerCase();

  if (secFetchMode === "navigate" || secFetchDest === "document") return true;
  if (!accept.includes("text/html")) return false;

  return (
    !accept.includes("application/json") &&
    !accept.includes("text/vtt") &&
    !accept.includes("text/plain")
  );
}
