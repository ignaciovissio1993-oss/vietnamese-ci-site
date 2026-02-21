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
