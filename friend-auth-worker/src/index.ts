import { SignJWT, importPKCS8, importX509, jwtVerify, type JWTPayload } from "jose";

interface Env {
  FIREBASE_PROJECT_ID: string;
  FIREBASE_WEB_API_KEY: string;
  FIREBASE_CLIENT_EMAIL: string;
  FIREBASE_PRIVATE_KEY: string;
  ADMIN_UID: string;
  ADMIN_ORIGIN: string;
  FRIEND_ORIGIN: string;
}

type PortalStatus = "尚未設定" | "已設定" | "已停用";
type FirebaseClaims = JWTPayload & { user_id?: string; sub: string };
type FirestoreValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { stringValue: string }
  | { timestampValue: string }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreValue> } };
type FirestoreDocument = { name: string; fields?: Record<string, FirestoreValue>; updateTime?: string };
type Failure = Error & { status?: number; code?: string; operation?: string; extra?: Record<string, unknown> };

const LOGIN_MAX_FAILURES = 5;
const LOGIN_LOCK_MINUTES = 15;

const fail = (status: number, message: string, code: string, extra?: Record<string, unknown>): Failure =>
  Object.assign(new Error(message), { status, code, extra });

const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });

function cors(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("origin") ?? "";
  const allowed = [env.ADMIN_ORIGIN, env.FRIEND_ORIGIN].filter(Boolean);
  return allowed.includes(origin) ? {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "vary": "Origin",
  } : {};
}

const validFriendId = (value: string) => /^\d{10,16}$/.test(value);
const validPassword = (value: unknown): value is string => typeof value === "string" && value.length >= 4 && value.length <= 72;
const friendUid = (friendId: string) => `friend-${friendId}`;
const friendEmail = (friendId: string) => `${friendUid(friendId)}@hannna-purchase.local`;

async function firebasePassword(friendId: string, password: string) {
  if (password.length >= 6) return password;
  const bytes = new TextEncoder().encode(`hannna-short-password-v1:${friendId}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

// ---------- 驗證 ----------

async function verifyFirebaseToken(token: string, env: Env): Promise<FirebaseClaims> {
  const header = JSON.parse(atob(token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/"))) as { kid?: string };
  if (!header.kid) throw fail(401, "Unauthorized", "MISSING_KEY_ID");
  const certs = await fetch("https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com").then(r => r.json<Record<string, string>>());
  const certificate = certs[header.kid];
  if (!certificate) throw fail(401, "Unauthorized", "UNKNOWN_SIGNING_KEY");
  const key = await importX509(certificate, "RS256");
  const { payload } = await jwtVerify(token, key, {
    algorithms: ["RS256"],
    audience: env.FIREBASE_PROJECT_ID,
    issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
  });
  return payload as FirebaseClaims;
}

async function requireUid(request: Request, env: Env, uid: string) {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) throw fail(401, "Unauthorized", "UNAUTHORIZED");
  let claims: FirebaseClaims;
  try { claims = await verifyFirebaseToken(authorization.slice(7), env); }
  catch { throw fail(401, "登入已過期，請重新登入", "INVALID_TOKEN"); }
  if ((claims.user_id ?? claims.sub) !== uid) throw fail(403, "Forbidden", "FORBIDDEN");
}
const requireAdmin = (request: Request, env: Env) => requireUid(request, env, env.ADMIN_UID);
const requireFriend = (request: Request, env: Env, friendId: string) => requireUid(request, env, friendUid(friendId));

let cachedToken: { value: string; expiresAt: number } | null = null;
async function accessToken(env: Env) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
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
  const value = (await response.json<{ access_token: string }>()).access_token;
  cachedToken = { value, expiresAt: Date.now() + 3500_000 };
  return value;
}

// ---------- Firestore REST ----------

function firestoreValue(value: unknown): FirestoreValue {
  if (value === null) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw fail(400, "資料包含無效數字", "INVALID_NUMBER");
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === "string") return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: value.length ? { values: value.map(firestoreValue) } : {} };
  if (typeof value === "object") {
    const fields = Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, firestoreValue(item)]));
    return { mapValue: Object.keys(fields).length ? { fields } : {} };
  }
  throw fail(400, "資料包含無法儲存的格式", "INVALID_DATA");
}
const documentFields = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value)
  .filter(([, item]) => item !== undefined)
  .map(([key, item]) => [key, firestoreValue(item)]));
const readInt = (value?: FirestoreValue) => (value && "integerValue" in value ? Number(value.integerValue) : value && "doubleValue" in value ? value.doubleValue : undefined);
const readString = (value?: FirestoreValue) => (value && "stringValue" in value ? value.stringValue : undefined);

const rootPath = (env: Env) => `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
const apiBase = (env: Env) => `https://firestore.googleapis.com/v1/${rootPath(env)}`;

async function getDocument(env: Env, path: string, mask?: string[]): Promise<FirestoreDocument | null> {
  const url = new URL(`${apiBase(env)}/${path}`);
  mask?.forEach(field => url.searchParams.append("mask.fieldPaths", field));
  const response = await fetch(url, { headers: { authorization: `Bearer ${await accessToken(env)}` } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Unable to read ${path}`);
  return response.json<FirestoreDocument>();
}

async function patchDocument(env: Env, path: string, values: Record<string, unknown>) {
  const url = new URL(`${apiBase(env)}/${path}`);
  Object.keys(values).forEach(field => url.searchParams.append("updateMask.fieldPaths", field));
  const response = await fetch(url, {
    method: "PATCH",
    headers: { authorization: `Bearer ${await accessToken(env)}`, "content-type": "application/json" },
    body: JSON.stringify({ fields: documentFields(values) }),
  });
  if (!response.ok) throw new Error(`Unable to update ${path}`);
}

async function deleteDocument(env: Env, path: string) {
  const response = await fetch(`${apiBase(env)}/${path}`, { method: "DELETE", headers: { authorization: `Bearer ${await accessToken(env)}` } });
  if (!response.ok && response.status !== 404) throw new Error(`Unable to delete ${path}`);
}

async function listDocuments(env: Env, collection: string, mask: string[]): Promise<FirestoreDocument[]> {
  const documents: FirestoreDocument[] = [];
  let pageToken = "";
  do {
    const url = new URL(`${apiBase(env)}/${collection}`);
    url.searchParams.set("pageSize", "300");
    mask.forEach(field => url.searchParams.append("mask.fieldPaths", field));
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetch(url, { headers: { authorization: `Bearer ${await accessToken(env)}` } });
    if (!response.ok) throw new Error(`Unable to list ${collection}`);
    const page = await response.json<{ documents?: FirestoreDocument[]; nextPageToken?: string }>();
    documents.push(...(page.documents ?? []));
    pageToken = page.nextPageToken ?? "";
  } while (pageToken);
  return documents;
}

const docId = (document: FirestoreDocument) => document.name.split("/").pop() ?? "";

async function commit(env: Env, writes: unknown[]) {
  for (let i = 0; i < writes.length; i += 500) {
    const response = await fetch(`${apiBase(env)}:commit`, {
      method: "POST",
      headers: { authorization: `Bearer ${await accessToken(env)}`, "content-type": "application/json" },
      body: JSON.stringify({ writes: writes.slice(i, i + 500) }),
    });
    if (!response.ok) {
      const result: { error?: { status?: string; message?: string } } = await response.json<{ error?: { status?: string; message?: string } }>().catch(() => ({}));
      if (result.error?.status === "FAILED_PRECONDITION") throw fail(409, "雲端資料已在其他裝置更新", "REVISION_CONFLICT");
      throw fail(response.status >= 500 ? 502 : response.status, result.error?.message ?? "Unable to sync data", result.error?.status ?? "FIRESTORE_SYNC_FAILED");
    }
  }
}

// ---------- 後台同步 ----------

type SyncBody = { state?: unknown; views?: unknown; baseRevision?: unknown; force?: unknown };
const VIEW_FIELDS = ["friendId", "name", "portalNote", "summary", "orders", "payments"] as const;
/** v2 朋友端資料使用過、現在要清掉的欄位。 */
const LEGACY_VIEW_FIELDS = ["groups", "waybills", "parcels", "portalStatus"];

async function syncAdminState(env: Env, body: SyncBody) {
  if (!body.state || typeof body.state !== "object" || Array.isArray(body.state)) throw fail(400, "缺少可同步的後台資料", "INVALID_STATE");
  if (typeof body.baseRevision !== "number") throw fail(409, "後台版本過舊，請重新整理頁面後再操作", "CLIENT_OUTDATED");
  const state = body.state as Record<string, unknown>;
  const views = Array.isArray(body.views) ? body.views as Array<Record<string, unknown>> : [];

  const current = await getDocument(env, "admin/state", ["revision", "schemaVersion"]);
  const currentRevision = readInt(current?.fields?.revision) ?? 0;
  if (body.force !== true && body.baseRevision !== currentRevision) {
    throw fail(409, "雲端資料已在其他裝置更新", "REVISION_CONFLICT", { revision: currentRevision });
  }
  const revision = currentRevision + 1;
  const root = rootPath(env);
  const writes: unknown[] = [];

  // 資料格式升級前，先把整份舊資料另存一份備份。
  if (current && readInt(current.fields?.schemaVersion) !== readInt(firestoreValue(state.schemaVersion))) {
    const full = await getDocument(env, "admin/state");
    if (full?.fields) writes.push({ update: { name: `${root}/adminBackups/before-v${String(state.schemaVersion)}-${Date.now()}`, fields: full.fields } });
  }

  writes.push({
    update: { name: `${root}/admin/state`, fields: documentFields({ ...state, revision, updatedAt: Date.now() }) },
    currentDocument: body.force === true ? undefined : current?.updateTime ? { updateTime: current.updateTime } : { exists: false },
  });

  const keep = new Set<string>();
  views.forEach(view => {
    const id = String(view.friendId ?? "");
    if (!validFriendId(id)) return;
    keep.add(id);
    const data: Record<string, unknown> = Object.fromEntries(VIEW_FIELDS.map(field => [field, view[field]]));
    data.authUid = friendUid(id);
    data.updatedAt = new Date().toISOString();
    writes.push({
      update: { name: `${root}/friendViews/${id}`, fields: documentFields(data) },
      updateMask: { fieldPaths: [...Object.keys(data), ...LEGACY_VIEW_FIELDS] },
    });
  });
  // 不在名單上的朋友（已刪除或是本人）不再保留朋友端資料。
  (await listDocuments(env, "friendViews", ["friendId"])).forEach(document => {
    if (!keep.has(docId(document))) writes.push({ delete: document.name });
  });

  await commit(env, writes);
  return revision;
}

// ---------- 朋友帳號 ----------

type AuthMethod = "create" | "lookup" | "update" | "delete";
async function authRequest(env: Env, method: AuthMethod, body: Record<string, unknown>) {
  const operation = method === "create" ? "accounts" : `accounts:${method}`;
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/${operation}`, {
    method: "POST", headers: { authorization: `Bearer ${await accessToken(env)}`, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const result = await response.json<Record<string, unknown>>();
  if (!response.ok) {
    const apiError = result.error as { status?: string; message?: string } | undefined;
    throw Object.assign(fail(response.status, apiError?.message ?? "Account operation failed", apiError?.status ?? "AUTH_ACCOUNT_OPERATION_FAILED"), { operation: method });
  }
  return result;
}

type AuthUser = { localId?: string; disabled?: boolean; lastLoginAt?: string };
async function lookupAccounts(env: Env, localIds: string[]): Promise<AuthUser[]> {
  const users: AuthUser[] = [];
  for (let i = 0; i < localIds.length; i += 100) {
    const result = await authRequest(env, "lookup", { localId: localIds.slice(i, i + 100) });
    if (Array.isArray(result.users)) users.push(...result.users as AuthUser[]);
  }
  return users;
}
const statusOf = (user?: AuthUser): PortalStatus => (!user ? "尚未設定" : user.disabled ? "已停用" : "已設定");

async function setAccount(env: Env, friendId: string, values: { password?: string; disabled?: boolean }, createIfMissing: boolean) {
  const localId = friendUid(friendId);
  const [existing] = await lookupAccounts(env, [localId]);
  if (existing) return authRequest(env, "update", { localId, ...values });
  if (!createIfMissing || !values.password) throw fail(409, "這位朋友還沒有設定密碼", "ACCOUNT_NOT_CONFIGURED");
  return authRequest(env, "create", { localId, email: friendEmail(friendId), emailVerified: true, password: values.password, disabled: values.disabled ?? false });
}

async function friendDirectory(env: Env) {
  const documents = await listDocuments(env, "friendViews", ["friendId", "name"]);
  const friends = documents.flatMap(document => {
    const id = docId(document);
    const name = readString(document.fields?.name);
    return validFriendId(id) && name ? [{ id, name }] : [];
  });
  const users = await lookupAccounts(env, friends.map(friend => friendUid(friend.id)));
  const usersById = new Map(users.map(user => [user.localId, user]));
  return friends.map(friend => {
    const user = usersById.get(friendUid(friend.id));
    return { ...friend, status: statusOf(user), lastLoginAt: user?.lastLoginAt ? new Date(Number(user.lastLoginAt)).toISOString() : undefined };
  }).sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
}

// ---------- 登入保護 ----------

async function checkLock(env: Env, friendId: string) {
  const guard = await getDocument(env, `loginGuards/${friendId}`);
  const lockedUntil = Number(readString(guard?.fields?.lockedUntil) ? Date.parse(readString(guard?.fields?.lockedUntil)!) : 0);
  if (lockedUntil > Date.now()) {
    const minutes = Math.ceil((lockedUntil - Date.now()) / 60_000);
    throw fail(429, `密碼錯誤次數過多，請 ${minutes} 分鐘後再試`, "LOGIN_LOCKED");
  }
  return readInt(guard?.fields?.failures) ?? 0;
}
async function recordFailure(env: Env, friendId: string, failures: number) {
  const next = failures + 1;
  if (next >= LOGIN_MAX_FAILURES) {
    await patchDocument(env, `loginGuards/${friendId}`, { failures: 0, lockedUntil: new Date(Date.now() + LOGIN_LOCK_MINUTES * 60_000).toISOString() });
    return 0;
  }
  await patchDocument(env, `loginGuards/${friendId}`, { failures: next, lockedUntil: "" });
  return LOGIN_MAX_FAILURES - next;
}

async function verifyPassword(env: Env, friendId: string, password: string) {
  const failures = await checkLock(env, friendId);
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: friendEmail(friendId), password: await firebasePassword(friendId, password), returnSecureToken: true }),
  });
  const result = await response.json<{ localId?: string; error?: { message?: string } }>();
  if (response.ok && result.localId === friendUid(friendId)) {
    if (failures > 0) await deleteDocument(env, `loginGuards/${friendId}`);
    return;
  }
  const code = result.error?.message?.split(" : ")[0] ?? "INVALID_LOGIN_CREDENTIALS";
  if (code === "USER_DISABLED") throw fail(403, "這個帳號目前已暫停登入", code);
  const left = await recordFailure(env, friendId, failures);
  throw fail(401, left > 0 ? `密碼不正確，還可以再試 ${left} 次` : `密碼錯誤次數過多，請 ${LOGIN_LOCK_MINUTES} 分鐘後再試`, code);
}

async function customToken(env: Env, friendId: string) {
  const now = Math.floor(Date.now() / 1000);
  const privateKey = await importPKCS8(env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"), "RS256");
  return new SignJWT({ uid: friendUid(friendId) })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(env.FIREBASE_CLIENT_EMAIL)
    .setSubject(env.FIREBASE_CLIENT_EMAIL)
    .setAudience("https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey);
}

const warn = (event: string, friendId: string, error: unknown) =>
  console.error(JSON.stringify({ event, friendId, message: error instanceof Error ? error.message : "unknown" }));

// ---------- 路由 ----------

async function readJson<T>(request: Request): Promise<T> {
  try { return await request.json<T>(); } catch { throw fail(400, "請求格式不正確", "INVALID_JSON"); }
}

async function route(request: Request, env: Env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const friendRoute = path.match(/^\/friends\/(\d+)\/(setup|login|password|last-login)$/);
  const adminFriendRoute = path.match(/^\/admin\/friends\/(\d+)(?:\/(password|suspend|resume))?$/);

  if (request.method === "GET" && path === "/friends") {
    // 只列出已經由哈娜開通的帳號。
    const friends = (await friendDirectory(env)).filter(friend => friend.status !== "尚未設定").map(({ id, name, status }) => ({ id, name, status }));
    return json({ friends });
  }

  if (request.method === "GET" && path === "/admin/friends/auth-state") {
    await requireAdmin(request, env);
    const friends = await friendDirectory(env);
    return json({ friends: friends.map(({ id, status, lastLoginAt }) => ({ id, portalStatus: status, lastLoginAt })) });
  }

  if (request.method === "POST" && path === "/admin/sync") {
    await requireAdmin(request, env);
    const revision = await syncAdminState(env, await readJson<SyncBody>(request));
    return json({ ok: true, revision });
  }

  if (friendRoute && validFriendId(friendRoute[1])) {
    const [, friendId, action] = friendRoute;
    if (request.method !== "POST") return json({ error: "Not found" }, 404);
    if (action === "setup") return json({ error: "請向哈娜索取初始密碼後再登入", code: "SETUP_DISABLED" }, 410);
    if (action === "login") {
      const body = await readJson<{ password?: unknown }>(request);
      if (!validPassword(body.password)) return json({ error: "密碼需為 4～72 個字元" }, 400);
      await verifyPassword(env, friendId, body.password);
      return json({ ok: true, customToken: await customToken(env, friendId) });
    }
    if (action === "password") {
      await requireFriend(request, env, friendId);
      const body = await readJson<{ password?: unknown }>(request);
      if (!validPassword(body.password)) return json({ error: "密碼需為 4～72 個字元" }, 400);
      await setAccount(env, friendId, { password: await firebasePassword(friendId, body.password) }, false);
      try { await patchDocument(env, `friendViews/${friendId}`, { mustChangePassword: false }); } catch (error) { warn("friend-password-flag-warning", friendId, error); }
      return json({ ok: true });
    }
    await requireFriend(request, env, friendId);
    try { await patchDocument(env, `friendViews/${friendId}`, { lastLoginAt: new Date().toISOString() }); } catch (error) { warn("friend-login-time-sync-warning", friendId, error); }
    return json({ ok: true });
  }

  if (adminFriendRoute && validFriendId(adminFriendRoute[1])) {
    await requireAdmin(request, env);
    const [, friendId, action] = adminFriendRoute;
    if (request.method === "DELETE" && !action) {
      const [existing] = await lookupAccounts(env, [friendUid(friendId)]);
      if (existing) await authRequest(env, "delete", { localId: friendUid(friendId) });
      await deleteDocument(env, `friendViews/${friendId}`);
      await deleteDocument(env, `loginGuards/${friendId}`);
      return json({ ok: true });
    }
    if (request.method !== "POST" || !action) return json({ error: "Not found" }, 404);
    if (action === "password") {
      const body = await readJson<{ password?: unknown }>(request);
      if (!validPassword(body.password)) return json({ error: "密碼需為 4～72 個字元" }, 400);
      await setAccount(env, friendId, { password: await firebasePassword(friendId, body.password), disabled: false }, true);
      await deleteDocument(env, `loginGuards/${friendId}`);
      try { await patchDocument(env, `friendViews/${friendId}`, { mustChangePassword: true, authUid: friendUid(friendId) }); } catch (error) { warn("friend-password-flag-warning", friendId, error); }
    } else {
      await setAccount(env, friendId, { disabled: action === "suspend" }, false);
    }
    return json({ ok: true, portalStatus: action === "suspend" ? "已停用" : "已設定" });
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
      const failure = error as Failure;
      const status = failure.status ?? 500;
      console.error(JSON.stringify({
        event: "friend-auth-error",
        method: request.method,
        path: new URL(request.url).pathname,
        status,
        code: failure.code ?? "INTERNAL_ERROR",
        operation: failure.operation,
        message: failure.message,
      }));
      const message = status >= 500 ? "服務暫時無法使用，請稍後再試" : failure.message;
      return json({ error: message, code: failure.code ?? "INTERNAL_ERROR", ...(failure.extra ?? {}) }, status, { ...headers, "cache-control": "no-store" });
    }
  },
};
