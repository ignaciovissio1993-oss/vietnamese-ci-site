import { guard } from "../lib/_auth/guard";

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  const lowerPath = path.toLowerCase();

  if (
    path === "/login" ||
    path === "/auth" ||
    path.startsWith("/auth/") ||
    path.startsWith("/_auth/") ||
    path === "/not-a-member.html" ||
    path.startsWith("/assets/") ||
    path.startsWith("/captions/") ||
    path === "/favicon.ico" ||
    lowerPath.endsWith(".css") ||
    lowerPath.endsWith(".js") ||
    lowerPath.endsWith(".png") ||
    lowerPath.endsWith(".jpg") ||
    lowerPath.endsWith(".svg") ||
    lowerPath.endsWith(".webp") ||
    lowerPath.endsWith(".json") ||
    lowerPath.endsWith(".srt")
  ) {
    return next();
  }

  const guardResponse = await guard(context);
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
