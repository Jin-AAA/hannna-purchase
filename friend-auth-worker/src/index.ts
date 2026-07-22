import { SignJWT, importPKCS8, importX509, jwtVerify, type JWTPayload } from "jose";

interface Env {
  FIREBASE_PROJECT_ID: string;
  FIREBASE_CLIENT_EMAIL: string;
  FIREBASE_PRIVATE_KEY: string;
  ADMIN_UID: string;
  ADMIN_ORIGIN: string;
  FRIEND_ORIGIN: string;
}

type PortalStatus = "尚未設定" | "已設定" | "已停用";
type FirebaseClaims = JWTPayload & { user_id?: string; sub: string };

const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });

function cors(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("origin") ?? "";
  const allowed = [env.ADMIN_ORIGIN, env.FRIEND_ORIGIN].filter(Boolean);
  return allowed.includes(origin) ? {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "vary": "Origin",
  } : {};
}

function validFriendId(value: string) {
  return /^\d{10,16}$/.test(value);
}

function validPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 4 && value.length <= 72;
}

function friendUid(friendId: string) { return `friend-${friendId}`; }
function friendEmail(friendId: string) { return `${friendUid(friendId)}@hannna-purchase.local`; }

async function verifyFirebaseToken(token: string, env: Env): Promise<FirebaseClaims> {
  const header = JSON.parse(atob(token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/"))) as { kid?: string };
  if (!header.kid) throw new Error("Missing key id");
  const certs = await fetch("https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com").then(r => r.json<Record<string, string>>());
  const certificate = certs[header.kid];
  if (!certificate) throw new Error("Unknown signing key");
  const key = await importX509(certificate, "RS256");
  const { payload } = await jwtVerify(token, key, {
    algorithms: ["RS256"],
    audience: env.FIREBASE_PROJECT_ID,
    issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
  });
  return payload as FirebaseClaims;
}

async function requireAdmin(request: Request, env: Env) {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) throw new Response("Unauthorized", { status: 401 });
  const claims = await verifyFirebaseToken(authorization.slice(7), env);
  if ((claims.user_id ?? claims.sub) !== env.ADMIN_UID) throw new Response("Forbidden", { status: 403 });
}

async function requireFriend(request: Request, env: Env, friendId: string) {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) throw new Response("Unauthorized", { status: 401 });
  const claims = await verifyFirebaseToken(authorization.slice(7), env);
  if ((claims.user_id ?? claims.sub) !== friendUid(friendId)) throw new Response("Forbidden", { status: 403 });
}

async function accessToken(env: Env) {
  const now = Math.floor(Date.now() / 1000);
  const privateKey = await importPKCS8(env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"), "RS256");
  const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/datastore" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(env.FIREBASE_CLIENT_EMAIL).setSubject(env.FIREBASE_CLIENT_EMAIL)
    .setAudience("https://oauth2.googleapis.com/token").setIssuedAt(now).setExpirationTime(now + 3600).sign(privateKey);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!response.ok) throw new Error("Unable to authorize account service");
  return (await response.json<{ access_token: string }>()).access_token;
}

async function authRequest(env: Env, method: string, body: Record<string, unknown>) {
  const token = await accessToken(env);
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/accounts:${method}`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const result = await response.json<Record<string, unknown>>();
  if (!response.ok) throw Object.assign(new Error("Account operation failed"), { status: response.status, details: result });
  return result;
}

async function accountExists(env: Env, uid: string) {
  const result = await authRequest(env, "lookup", { localId: [uid] });
  return Array.isArray(result.users) && result.users.length > 0;
}

async function createAccount(env: Env, friendId: string, password: string) {
  if (await accountExists(env, friendUid(friendId))) throw Object.assign(new Error("Account is already configured"), { status: 409 });
  return authRequest(env, "signUp", { localId: friendUid(friendId), email: friendEmail(friendId), emailVerified: true, password, disabled: false });
}

async function setAccount(env: Env, friendId: string, values: { password?: string; disabled?: boolean }, createIfMissing = true) {
  const localId = friendUid(friendId);
  if (await accountExists(env, localId)) return authRequest(env, "update", { localId, ...values });
  if (!createIfMissing) throw Object.assign(new Error("Account is not configured"), { status: 409 });
  if (!values.password) throw Object.assign(new Error("Password is required for a new account"), { status: 409 });
  return authRequest(env, "signUp", { localId, email: friendEmail(friendId), emailVerified: true, password: values.password, disabled: values.disabled ?? false });
}

async function updatePortalStatus(env: Env, friendId: string, portalStatus: PortalStatus) {
  const token = await accessToken(env);
  const url = new URL(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/friendViews/${friendId}`);
  url.searchParams.append("updateMask.fieldPaths", "portalStatus");
  url.searchParams.append("updateMask.fieldPaths", "authUid");
  const response = await fetch(url, { method: "PATCH", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ fields: { portalStatus: { stringValue: portalStatus }, authUid: { stringValue: friendUid(friendId) } } }) });
  if (!response.ok) throw new Error("Unable to update friend status");
}

async function getStatus(env: Env, friendId: string): Promise<PortalStatus> {
  const token = await accessToken(env);
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/friendViews/${friendId}?mask.fieldPaths=portalStatus`, { headers: { authorization: `Bearer ${token}` } });
  if (response.status === 404) throw Object.assign(new Error("Friend not found"), { status: 404 });
  if (!response.ok) throw new Error("Unable to read friend status");
  const data = await response.json<{ fields?: { portalStatus?: { stringValue?: PortalStatus } } }>();
  return data.fields?.portalStatus?.stringValue ?? "尚未設定";
}

async function listFriends(env: Env) {
  const token = await accessToken(env);
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/friendViews?pageSize=200&mask.fieldPaths=friendId&mask.fieldPaths=name&mask.fieldPaths=portalStatus`, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error("Unable to read friend directory");
  const data = await response.json<{ documents?: Array<{ fields?: Record<string, { stringValue?: string; integerValue?: string }> }> }>();
  return (data.documents ?? []).flatMap(document => {
    const fields = document.fields ?? {};
    const id = fields.friendId?.integerValue ?? fields.friendId?.stringValue;
    const name = fields.name?.stringValue;
    const status = fields.portalStatus?.stringValue as PortalStatus | undefined;
    return id && name ? [{ id, name, status: status ?? "尚未設定" }] : [];
  }).sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
}

async function updateLastLogin(env: Env, friendId: string) {
  const token = await accessToken(env);
  const url = new URL(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/friendViews/${friendId}`);
  url.searchParams.append("updateMask.fieldPaths", "lastLoginAt");
  const response = await fetch(url, { method: "PATCH", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ fields: { lastLoginAt: { timestampValue: new Date().toISOString() } } }) });
  if (!response.ok) throw new Error("Unable to update login time");
}

async function route(request: Request, env: Env) {
  const url = new URL(request.url);
  const adminMatch = url.pathname.match(/^\/admin\/friends\/(\d+)\/(password|suspend|resume)$/);
  const statusMatch = url.pathname.match(/^\/friends\/(\d+)\/status$/);
  const setupMatch = url.pathname.match(/^\/friends\/(\d+)\/setup$/);
  const passwordMatch = url.pathname.match(/^\/friends\/(\d+)\/password$/);
  const lastLoginMatch = url.pathname.match(/^\/friends\/(\d+)\/last-login$/);

  if (request.method === "GET" && url.pathname === "/friends") {
    return json({ friends: await listFriends(env) });
  }

  if (request.method === "GET" && statusMatch && validFriendId(statusMatch[1])) {
    return json({ status: await getStatus(env, statusMatch[1]) });
  }
  if (request.method === "POST" && setupMatch && validFriendId(setupMatch[1])) {
    const friendId = setupMatch[1];
    if (await getStatus(env, friendId) !== "尚未設定") return json({ error: "帳號已經設定完成" }, 409);
    const body = await request.json<{ password?: unknown }>();
    if (!validPassword(body.password)) return json({ error: "密碼需為 4～72 個字元" }, 400);
    await createAccount(env, friendId, body.password);
    await updatePortalStatus(env, friendId, "已設定");
    return json({ ok: true, email: friendEmail(friendId) });
  }
  if (request.method === "POST" && passwordMatch && validFriendId(passwordMatch[1])) {
    const friendId = passwordMatch[1];
    await requireFriend(request, env, friendId);
    const body = await request.json<{ password?: unknown }>();
    if (!validPassword(body.password)) return json({ error: "密碼需為 4～72 個字元" }, 400);
    await setAccount(env, friendId, { password: body.password }, false);
    return json({ ok: true });
  }
  if (request.method === "POST" && lastLoginMatch && validFriendId(lastLoginMatch[1])) {
    const friendId = lastLoginMatch[1];
    await requireFriend(request, env, friendId);
    await updateLastLogin(env, friendId);
    return json({ ok: true });
  }
  if (request.method === "POST" && adminMatch && validFriendId(adminMatch[1])) {
    await requireAdmin(request, env);
    const [friendId, action] = [adminMatch[1], adminMatch[2]];
    if (action === "password") {
      const body = await request.json<{ password?: unknown }>();
      if (!validPassword(body.password)) return json({ error: "密碼需為 4～72 個字元" }, 400);
      await setAccount(env, friendId, { password: body.password, disabled: false }, true);
      await updatePortalStatus(env, friendId, "已設定");
    } else {
      await setAccount(env, friendId, { disabled: action === "suspend" }, false);
      await updatePortalStatus(env, friendId, action === "suspend" ? "已停用" : "已設定");
    }
    return json({ ok: true });
  }
  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const headers = cors(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    try {
      const response = await route(request, env);
      Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      response.headers.set("cache-control", "no-store");
      return response;
    } catch (error) {
      if (error instanceof Response) return new Response(error.body, { status: error.status, headers });
      const status = (error as { status?: number }).status ?? 500;
      return json({ error: status >= 500 ? "服務暫時無法使用" : (error as Error).message }, status, headers);
    }
  },
};
