export function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const [name, ...rest] = part.trim().split("=");
    if (!name) continue;
    cookies[name] = rest.join("=");
  }
  return cookies;
}

export function setCookie(name, value, options = {}) {
  const parts = [`${name}=${value}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  parts.push(`Path=${options.path || "/"}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  return parts.join("; ");
}

export function clearCookie(name) {
  return setCookie(name, "", { maxAge: 0, path: "/" });
}

export function base64UrlEncode(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlDecode(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function hmacSign(secret, data) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return base64UrlEncode(new Uint8Array(sig));
}

export async function signValue(secret, payloadObj) {
  const enc = new TextEncoder();
  const payloadJson = JSON.stringify(payloadObj);
  const payloadB64 = base64UrlEncode(enc.encode(payloadJson));
  const sig = await hmacSign(secret, payloadB64);
  return `${payloadB64}.${sig}`;
}

export async function verifyValue(secret, signedValue) {
  if (!signedValue || !signedValue.includes(".")) return null;
  const [payloadB64, sig] = signedValue.split(".");
  const expected = await hmacSign(secret, payloadB64);
  if (!timingSafeEqual(sig, expected)) return null;
  const payloadBytes = base64UrlDecode(payloadB64);
  const payloadJson = new TextDecoder().decode(payloadBytes);
  try {
    return JSON.parse(payloadJson);
  } catch {
    return null;
  }
}

export function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export function buildRedirectResponse(location, cookies = []) {
  const headers = new Headers({ Location: location });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}

export function isSafeReturnTo(path) {
  return typeof path === "string" && path.startsWith("/") && !path.startsWith("//");
}

export class PatreonApiError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = "PatreonApiError";
    this.status = status;
  }
}

// Patreon occasionally returns bot-check or HTML pages when requests are blocked.
// We treat any HTML-like response as an API failure and never pass it through.
function looksLikeHtmlOrBotCheck(contentType, bodyText) {
  const ct = (contentType || "").toLowerCase();
  const text = (bodyText || "").slice(0, 2048).toLowerCase();

  if (ct.includes("text/html")) return true;
  if (text.includes("<!doctype html") || text.includes("<html")) return true;
  if (text.includes("/cdn-cgi/challenge-platform")) return true;
  if (text.includes("cf-browser-verification")) return true;
  if (text.includes("captcha")) return true;

  return false;
}

function extractPatreonErrorMessage(data) {
  if (!data || typeof data !== "object") return null;
  if (typeof data.error_description === "string" && data.error_description) return data.error_description;
  if (typeof data.error === "string" && data.error) return data.error;
  if (Array.isArray(data.errors) && data.errors.length > 0) {
    const first = data.errors[0];
    if (typeof first?.detail === "string" && first.detail) return first.detail;
    if (typeof first?.title === "string" && first.title) return first.title;
    if (typeof first?.code === "string" && first.code) return first.code;
  }
  return null;
}

// Server-side-only helper for Patreon API calls.
// Enforces JSON contract and blocks HTML/bot-check bodies from being surfaced.
export async function fetchPatreonJson(url, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");

  const resp = await fetch(url, { ...options, headers });
  const contentType = resp.headers.get("Content-Type") || "";
  const bodyText = await resp.text();

  if (looksLikeHtmlOrBotCheck(contentType, bodyText)) {
    throw new PatreonApiError("Patreon returned HTML or bot-check content", resp.status || 502);
  }

  // Require JSON content type for API responses to avoid silently processing wrong payloads.
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new PatreonApiError("Patreon returned a non-JSON API response", resp.status || 502);
  }

  let data;
  try {
    data = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    throw new PatreonApiError("Patreon returned invalid JSON", resp.status || 502);
  }

  if (!resp.ok) {
    const details = extractPatreonErrorMessage(data);
    const suffix = details ? `: ${details}` : "";
    throw new PatreonApiError(`Patreon API error (${resp.status})${suffix}`, resp.status);
  }

  return data;
}
