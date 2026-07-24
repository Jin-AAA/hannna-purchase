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

async function firebasePassword(friendId: string, password: string) {
  if (password.length >= 6) return password;
  const bytes = new TextEncoder().encode(`hannna-short-password-v1:${friendId}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

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

function firestoreValue(value: unknown): FirestoreValue {
  if (value === null) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw Object.assign(new Error("資料包含無效數字"), { status: 400, code: "INVALID_NUMBER" });
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
  throw Object.assign(new Error("資料包含無法儲存的格式"), { status: 400, code: "INVALID_DATA" });
}

function documentFields(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .map(([key, item]) => [key, firestoreValue(item)]));
}

type SyncFriend = { id?: unknown; name?: unknown; portalNote?: unknown };
type SyncOrder = { id?: unknown; friend?: unknown };
type SyncGroup = { id?: unknown; name?: unknown; saleDate?: unknown; currency?: unknown; status?: unknown; products?: unknown; orders?: SyncOrder[] };
type SyncWaybill = { items?: Array<{ orderId?: unknown }>; [key: string]: unknown };
type SyncParcel = { orderIds?: unknown[]; [key: string]: unknown };
type SyncPayment = { friend?: unknown; [key: string]: unknown };

function friendViewsFromState(state: Record<string, unknown>) {
  const friends = Array.isArray(state.friends) ? state.friends as SyncFriend[] : [];
  const groups = Array.isArray(state.groups) ? state.groups as SyncGroup[] : [];
  const payments = Array.isArray(state.payments) ? state.payments as SyncPayment[] : [];
  const waybills = Array.isArray(state.waybills) ? state.waybills as SyncWaybill[] : [];
  const parcels = Array.isArray(state.parcels) ? state.parcels as SyncParcel[] : [];
  return friends.flatMap(friend => {
    if (typeof friend.id !== "number" || typeof friend.name !== "string") return [];
    const friendGroups = groups.flatMap(group => {
      const orders = Array.isArray(group.orders) ? group.orders.filter(order => order.friend === friend.name) : [];
      return orders.length ? [{ id: group.id, name: group.name, saleDate: group.saleDate, currency: group.currency, status: group.status, products: group.products, orders }] : [];
    });
    const orderIds = new Set(friendGroups.flatMap(group => group.orders.flatMap(order => typeof order.id === "number" ? [order.id] : [])));
    const publicWaybills = waybills.flatMap(waybill => {
      const items = Array.isArray(waybill.items) ? waybill.items.filter(item => typeof item.orderId === "number" && orderIds.has(item.orderId)) : [];
      if (!items.length) return [];
      const { items: _items, ...details } = waybill;
      return [{ ...details, items }];
    });
    const publicParcels = parcels.flatMap(parcel => {
      const ids = Array.isArray(parcel.orderIds) ? parcel.orderIds.filter(id => typeof id === "number" && orderIds.has(id)) : [];
      if (!ids.length) return [];
      const { orderIds: _orderIds, ...details } = parcel;
      return [{ ...details, orderIds: ids }];
    });
    return [{
      id: String(friend.id),
      data: {
        friendId: friend.id,
        authUid: friendUid(String(friend.id)),
        name: friend.name,
        portalNote: typeof friend.portalNote === "string" ? friend.portalNote : "",
        groups: friendGroups,
        payments: payments.filter(record => record.friend === friend.name),
        waybills: publicWaybills,
        parcels: publicParcels,
        updatedAt: new Date().toISOString(),
      },
    }];
  });
}

async function syncAdminState(env: Env, state: Record<string, unknown>) {
  const token = await accessToken(env);
  const root = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
  const writes = [
    {
      update: {
        name: `${root}/admin/state`,
        fields: documentFields({ ...state, updatedAt: Date.now() }),
      },
    },
    ...friendViewsFromState(state).map(friend => ({
      update: {
        name: `${root}/friendViews/${friend.id}`,
        fields: documentFields(friend.data),
      },
      updateMask: { fieldPaths: Object.keys(friend.data) },
    })),
  ];
  if (writes.length > 500) throw Object.assign(new Error("朋友筆數超過單次同步上限"), { status: 400, code: "TOO_MANY_WRITES" });
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents:commit`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ writes }),
  });
  if (!response.ok) {
    const result: { error?: { status?: string; message?: string } } =
      await response.json<{ error?: { status?: string; message?: string } }>().catch(() => ({}));
    throw Object.assign(new Error(result.error?.message ?? "Unable to sync data"), {
      status: response.status >= 500 ? 502 : response.status,
      code: result.error?.status ?? "FIRESTORE_SYNC_FAILED",
    });
  }
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

async function verifyPassword(env: Env, friendId: string, password: string) {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: friendEmail(friendId),
      password: await firebasePassword(friendId, password),
      returnSecureToken: true,
    }),
  });
  const result = await response.json<{ localId?: string; error?: { message?: string } }>();
  if (!response.ok || result.localId !== friendUid(friendId)) {
    const code = result.error?.message?.split(" : ")[0] ?? "INVALID_LOGIN_CREDENTIALS";
    const disabled = code === "USER_DISABLED";
    throw Object.assign(new Error(disabled ? "這個帳號目前已暫停登入" : "密碼不正確，請再試一次"), {
      status: disabled ? 403 : 401,
      code,
      operation: "login",
    });
  }
}

type AuthMethod = "create" | "lookup" | "update";

async function authRequest(env: Env, method: AuthMethod, body: Record<string, unknown>) {
  const token = await accessToken(env);
  const operation = method === "create" ? "accounts" : `accounts:${method}`;
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/${operation}`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const result = await response.json<Record<string, unknown>>();
  if (!response.ok) {
    const apiError = result.error as { status?: string; message?: string } | undefined;
    throw Object.assign(new Error(apiError?.message ?? "Account operation failed"), {
      status: response.status,
      code: apiError?.status ?? "AUTH_ACCOUNT_OPERATION_FAILED",
      operation: method,
    });
  }
  return result;
}

async function accountExists(env: Env, uid: string) {
  const result = await authRequest(env, "lookup", { localId: [uid] });
  return Array.isArray(result.users) && result.users.length > 0;
}

type AuthUser = { localId?: string; disabled?: boolean; lastLoginAt?: string };

async function lookupAccounts(env: Env, localIds: string[]): Promise<AuthUser[]> {
  if (!localIds.length) return [];
  const result = await authRequest(env, "lookup", { localId: localIds });
  return Array.isArray(result.users) ? result.users as AuthUser[] : [];
}

async function accountState(env: Env, friendId: string) {
  const [user] = await lookupAccounts(env, [friendUid(friendId)]);
  return {
    portalStatus: !user ? "尚未設定" : user.disabled ? "已停用" : "已設定",
    lastLoginAt: user?.lastLoginAt ? new Date(Number(user.lastLoginAt)).toISOString() : undefined,
  } satisfies { portalStatus: PortalStatus; lastLoginAt?: string };
}

async function createAccount(env: Env, friendId: string, password: string) {
  if (await accountExists(env, friendUid(friendId))) throw Object.assign(new Error("Account is already configured"), { status: 409 });
  return authRequest(env, "create", { localId: friendUid(friendId), email: friendEmail(friendId), emailVerified: true, password, disabled: false });
}

async function setAccount(env: Env, friendId: string, values: { password?: string; disabled?: boolean }, createIfMissing = true) {
  const localId = friendUid(friendId);
  if (await accountExists(env, localId)) return authRequest(env, "update", { localId, ...values });
  if (!createIfMissing) throw Object.assign(new Error("Account is not configured"), { status: 409 });
  if (!values.password) throw Object.assign(new Error("Password is required for a new account"), { status: 409 });
  return authRequest(env, "create", { localId, email: friendEmail(friendId), emailVerified: true, password: values.password, disabled: values.disabled ?? false });
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
  return (await accountState(env, friendId)).portalStatus;
}

async function listFriends(env: Env) {
  const token = await accessToken(env);
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/friendViews?pageSize=200&mask.fieldPaths=friendId&mask.fieldPaths=name&mask.fieldPaths=portalStatus`, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error("Unable to read friend directory");
  const data = await response.json<{ documents?: Array<{ fields?: Record<string, { stringValue?: string; integerValue?: string }> }> }>();
  const friends = (data.documents ?? []).flatMap(document => {
    const fields = document.fields ?? {};
    const id = fields.friendId?.integerValue ?? fields.friendId?.stringValue;
    const name = fields.name?.stringValue;
    return id && name ? [{ id, name }] : [];
  });
  const users = await lookupAccounts(env, friends.map(friend => friendUid(friend.id)));
  const usersById = new Map(users.map(user => [user.localId, user]));
  return friends.map(friend => {
    const user = usersById.get(friendUid(friend.id));
    const status: PortalStatus = !user ? "尚未設定" : user.disabled ? "已停用" : "已設定";
    return { ...friend, status };
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
  const loginMatch = url.pathname.match(/^\/friends\/(\d+)\/login$/);
  const passwordMatch = url.pathname.match(/^\/friends\/(\d+)\/password$/);
  const lastLoginMatch = url.pathname.match(/^\/friends\/(\d+)\/last-login$/);

  if (request.method === "GET" && url.pathname === "/friends") {
    return json({ friends: await listFriends(env) });
  }

  if (request.method === "GET" && url.pathname === "/admin/friends/auth-state") {
    await requireAdmin(request, env);
    const friends = await listFriends(env);
    const users = await lookupAccounts(env, friends.map(friend => friendUid(friend.id)));
    const usersById = new Map(users.map(user => [user.localId, user]));
    return json({ friends: friends.map(friend => {
      const user = usersById.get(friendUid(friend.id));
      return {
        id: friend.id,
        portalStatus: !user ? "尚未設定" : user.disabled ? "已停用" : "已設定",
        lastLoginAt: user?.lastLoginAt ? new Date(Number(user.lastLoginAt)).toISOString() : undefined,
      };
    }) });
  }

  if (request.method === "POST" && url.pathname === "/admin/sync") {
    await requireAdmin(request, env);
    const body = await request.json<{ state?: unknown }>();
    if (!body.state || typeof body.state !== "object" || Array.isArray(body.state)) {
      return json({ error: "缺少可同步的後台資料", code: "INVALID_STATE" }, 400);
    }
    await syncAdminState(env, body.state as Record<string, unknown>);
    return json({ ok: true });
  }

  if (request.method === "GET" && statusMatch && validFriendId(statusMatch[1])) {
    return json({ status: await getStatus(env, statusMatch[1]) });
  }
  if (request.method === "POST" && setupMatch && validFriendId(setupMatch[1])) {
    const friendId = setupMatch[1];
    if (await getStatus(env, friendId) !== "尚未設定") return json({ error: "帳號已經設定完成" }, 409);
    const body = await request.json<{ password?: unknown }>();
    if (!validPassword(body.password)) return json({ error: "密碼需為 4～72 個字元" }, 400);
    if (await accountExists(env, friendUid(friendId))) {
      await verifyPassword(env, friendId, body.password);
    } else {
      await createAccount(env, friendId, await firebasePassword(friendId, body.password));
    }
    try { await updatePortalStatus(env, friendId, "已設定"); }
    catch (error) { console.error(JSON.stringify({ event: "friend-status-sync-warning", friendId, message: error instanceof Error ? error.message : "unknown" })); }
    return json({ ok: true, customToken: await customToken(env, friendId) });
  }
  if (request.method === "POST" && loginMatch && validFriendId(loginMatch[1])) {
    const friendId = loginMatch[1];
    const body = await request.json<{ password?: unknown }>();
    if (!validPassword(body.password)) return json({ error: "密碼需為 4～72 個字元" }, 400);
    await verifyPassword(env, friendId, body.password);
    return json({ ok: true, customToken: await customToken(env, friendId) });
  }
  if (request.method === "POST" && passwordMatch && validFriendId(passwordMatch[1])) {
    const friendId = passwordMatch[1];
    await requireFriend(request, env, friendId);
    const body = await request.json<{ password?: unknown }>();
    if (!validPassword(body.password)) return json({ error: "密碼需為 4～72 個字元" }, 400);
    await setAccount(env, friendId, { password: await firebasePassword(friendId, body.password) }, false);
    return json({ ok: true });
  }
  if (request.method === "POST" && lastLoginMatch && validFriendId(lastLoginMatch[1])) {
    const friendId = lastLoginMatch[1];
    await requireFriend(request, env, friendId);
    try { await updateLastLogin(env, friendId); }
    catch (error) { console.error(JSON.stringify({ event: "friend-login-time-sync-warning", friendId, message: error instanceof Error ? error.message : "unknown" })); }
    return json({ ok: true });
  }
  if (request.method === "POST" && adminMatch && validFriendId(adminMatch[1])) {
    await requireAdmin(request, env);
    const [friendId, action] = [adminMatch[1], adminMatch[2]];
    if (action === "password") {
      const body = await request.json<{ password?: unknown }>();
      if (!validPassword(body.password)) return json({ error: "密碼需為 4～72 個字元" }, 400);
      await setAccount(env, friendId, { password: await firebasePassword(friendId, body.password), disabled: false }, true);
      try { await updatePortalStatus(env, friendId, "已設定"); }
      catch (error) { console.error(JSON.stringify({ event: "friend-status-sync-warning", friendId, message: error instanceof Error ? error.message : "unknown" })); }
    } else {
      await setAccount(env, friendId, { disabled: action === "suspend" }, false);
      try { await updatePortalStatus(env, friendId, action === "suspend" ? "已停用" : "已設定"); }
      catch (error) { console.error(JSON.stringify({ event: "friend-status-sync-warning", friendId, message: error instanceof Error ? error.message : "unknown" })); }
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
      const failure = error as Error & { status?: number; code?: string; operation?: string };
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
      return json({ error: message, code: failure.code ?? "INTERNAL_ERROR" }, status, headers);
    }
  },
};
