"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LogOut, Menu, X } from "lucide-react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "./firebase";
import { buildFriendViews, buildIndex, buildLedger, emptyState, loadState, type State } from "./lib/model";
import { Ctx, pageTitles, parseHash, routeHash, type AppContext, type DrawerState, type FriendAction, type PageKey, type PortalInfo, type Route } from "./lib/store";
import { ConfirmDialog, type ConfirmRequest } from "./components/ui";
import { OverviewPage } from "./components/pages/overview";
import { GroupDetailPage, GroupsPage } from "./components/pages/groups";
import { OrdersPage } from "./components/pages/orders";
import { WaybillsPage } from "./components/pages/waybills";
import { ShippingPage } from "./components/pages/shipping";
import { PaymentsPage } from "./components/pages/payments";
import { SpendingPage } from "./components/pages/spending";
import { FriendsPage } from "./components/pages/friends";
import { SettingsPage } from "./components/pages/settings";
import { GroupForm } from "./components/forms/group-form";
import { OrderForm } from "./components/forms/order-form";
import { WaybillForm } from "./components/forms/waybill-form";
import { ParcelForm } from "./components/forms/parcel-form";
import { PaymentForm } from "./components/forms/payment-form";
import { ExpenseForm } from "./components/forms/expense-form";
import { FriendForm } from "./components/forms/friend-form";

const api = process.env.NEXT_PUBLIC_FRIEND_AUTH_API?.replace(/\/$/, "") ?? "";
const localKey = "hannna-purchase-admin-v3";
type LocalCopy = { state: State; baseRevision: number; dirty: boolean };
type CloudStatus = { kind: "saved" | "saving" | "error" | "conflict" | "loading"; message?: string };

const readLocal = (): LocalCopy | null => {
  try {
    const value = JSON.parse(window.localStorage.getItem(localKey) ?? "null") as LocalCopy | null;
    return value && value.state && typeof value.baseRevision === "number" ? value : null;
  } catch { return null; }
};
const writeLocal = (copy: LocalCopy) => { try { window.localStorage.setItem(localKey, JSON.stringify(copy)); } catch { /* 空間不足時只依賴雲端 */ } };

async function fetchRemote() {
  const snapshot = await getDoc(doc(db, "admin", "state"));
  const raw = snapshot.exists() ? snapshot.data() : {};
  return { raw, revision: typeof raw.revision === "number" ? raw.revision : 0 };
}

const nav: { group: string; items: PageKey[] }[] = [
  { group: "營運", items: ["overview", "groups", "orders"] },
  { group: "物流", items: ["waybills", "shipping"] },
  { group: "帳務", items: ["payments", "spending"] },
  { group: "管理", items: ["friends", "settings"] },
];

export default function Home() {
  const [user, setUser] = useState<"checking" | "out" | "in">("checking");
  const [loginError, setLoginError] = useState("");
  const [state, setState] = useState<State | null>(null);
  const [cloud, setCloud] = useState<CloudStatus>({ kind: "loading" });
  const [conflictCopy, setConflictCopy] = useState<State | null>(null);
  const [route, setRoute] = useState<Route>({ page: "overview" });
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const [toast, setToast] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [portal, setPortal] = useState<Record<number, PortalInfo>>({});
  const revision = useRef(0);
  const pushed = useRef("");
  const pushing = useRef(false);
  const toastTimer = useRef<number | undefined>(undefined);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 3200);
  }, []);

  // ---------- 登入與載入 ----------
  const loadFromCloud = useCallback(async () => {
    const remote = await fetchRemote();
    const { state: remoteState, migrated } = loadState(remote.raw);
    revision.current = remote.revision;
    const local = readLocal();
    if (local?.dirty && local.baseRevision === remote.revision) {
      pushed.current = "";
      setState(loadState(local.state).state);
      setCloud({ kind: "saving", message: "正在補上這台裝置尚未同步的變更" });
      return;
    }
    if (local?.dirty) setConflictCopy(loadState(local.state).state);
    pushed.current = migrated ? "" : JSON.stringify(remoteState);
    setState(remoteState);
    setCloud(migrated ? { kind: "saving", message: "正在升級資料格式" } : { kind: "saved" });
    if (migrated) notify("資料已升級為新版格式，舊版內容已在雲端另存備份");
  }, [notify]);

  useEffect(() => onAuthStateChanged(auth, async current => {
    if (!current) { setUser("out"); setState(null); return; }
    setUser("in");
    try { await loadFromCloud(); }
    catch { setCloud({ kind: "error", message: "無法讀取雲端資料，請確認網路後重新整理" }); }
  }), [loadFromCloud]);

  useEffect(() => {
    const sync = () => { setRoute(parseHash(window.location.hash)); setDrawer(null); setConfirmRequest(null); };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  // ---------- 雲端同步 ----------
  const push = useCallback(async (force = false) => {
    if (pushing.current || !state) return;
    const json = JSON.stringify(state);
    if (!force && json === pushed.current) return;
    if (!api || !auth.currentUser) { setCloud({ kind: "error", message: "同步服務尚未設定" }); return; }
    pushing.current = true;
    setCloud({ kind: "saving" });
    try {
      const token = await auth.currentUser.getIdToken();
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 20_000);
      const response = await fetch(`${api}/admin/sync`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ state, views: buildFriendViews(state), baseRevision: revision.current, force }),
        signal: controller.signal,
      }).finally(() => window.clearTimeout(timer));
      const result = await response.json().catch(() => ({})) as { revision?: number; error?: string; code?: string };
      if (response.status === 409) {
        setConflictCopy(state);
        setCloud({ kind: "conflict", message: result.error });
        return;
      }
      if (!response.ok) throw new Error(result.error ?? `同步失敗（${response.status}）`);
      revision.current = result.revision ?? revision.current + 1;
      pushed.current = json;
      writeLocal({ state, baseRevision: revision.current, dirty: false });
      setConflictCopy(null);
      setCloud({ kind: "saved" });
    } catch (error) {
      setCloud({ kind: "error", message: error instanceof Error && error.name !== "AbortError" ? error.message : "連線逾時" });
    } finally {
      pushing.current = false;
    }
  }, [state]);

  useEffect(() => {
    if (!state || cloud.kind === "conflict") return;
    const json = JSON.stringify(state);
    if (json === pushed.current) return;
    writeLocal({ state, baseRevision: revision.current, dirty: true });
    setCloud({ kind: "saving" });
    const timer = window.setTimeout(() => void push(), 700);
    return () => window.clearTimeout(timer);
  }, [state, push, cloud.kind]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (state && JSON.stringify(state) !== pushed.current) event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state]);

  async function loadCloudVersion() {
    setConflictCopy(null);
    writeLocal({ state: state ?? emptyState(), baseRevision: -1, dirty: false });
    await loadFromCloud();
  }
  async function keepThisDevice() {
    setCloud({ kind: "saving" });
    await push(true);
  }

  // ---------- 朋友帳號 ----------
  const refreshPortal = useCallback(async () => {
    if (!api || !auth.currentUser) return;
    try {
      const token = await auth.currentUser.getIdToken();
      const response = await fetch(`${api}/admin/friends/auth-state`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (!response.ok) return;
      const result = await response.json() as { friends?: Array<{ id: string; portalStatus: PortalInfo["status"]; lastLoginAt?: string }> };
      setPortal(Object.fromEntries((result.friends ?? []).map(friend => [Number(friend.id), { status: friend.portalStatus, lastLoginAt: friend.lastLoginAt }])));
    } catch { /* 下次再試 */ }
  }, []);
  useEffect(() => {
    if (user !== "in" || !state) return;
    void refreshPortal();
    const timer = window.setInterval(() => void refreshPortal(), 60_000);
    return () => window.clearInterval(timer);
  }, [user, state === null, refreshPortal]); // eslint-disable-line react-hooks/exhaustive-deps

  const friendAccount = useCallback(async (friendId: number, action: FriendAction) => {
    if (!api || !auth.currentUser) { notify("朋友登入服務尚未設定"); return false; }
    try {
      const token = await auth.currentUser.getIdToken();
      const path = action.kind === "delete" ? `/admin/friends/${friendId}` : `/admin/friends/${friendId}/${action.kind}`;
      const response = await fetch(`${api}${path}`, {
        method: action.kind === "delete" ? "DELETE" : "POST",
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: action.kind === "password" ? JSON.stringify({ password: action.password }) : action.kind === "delete" ? undefined : "{}",
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { notify(result.error ?? "帳號操作失敗，請稍後再試"); return false; }
      await refreshPortal();
      return true;
    } catch { notify("連線失敗，請確認網路後再試"); return false; }
  }, [notify, refreshPortal]);

  // ---------- Context ----------
  const index = useMemo(() => buildIndex(state ?? emptyState()), [state]);
  const ledger = useMemo(() => buildLedger(state ?? emptyState(), index), [state, index]);
  const go = useCallback((next: Route) => { window.location.hash = routeHash(next); setMenuOpen(false); window.scrollTo({ top: 0 }); }, []);
  const update = useCallback((recipe: (current: State) => State) => setState(current => (current ? recipe(current) : current)), []);
  const closeDrawer = useCallback(() => setDrawer(null), []);
  const closeConfirm = useCallback(() => setConfirmRequest(null), []);
  const context: AppContext | null = state ? { state, update, index, ledger, route, go, notify, confirm: setConfirmRequest, openDrawer: setDrawer, closeDrawer, portal, friendAccount } : null;

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const username = String(form.get("username") || "").trim().toLowerCase();
    try {
      setLoginError("");
      if (username !== "hannna") throw new Error();
      await signInWithEmailAndPassword(auth, `${username}@hannna-purchase.local`, String(form.get("password") || ""));
    } catch { setLoginError("帳號或密碼不正確"); }
  }

  if (user === "checking" || (user === "in" && !context && cloud.kind !== "error")) return <main className="boot"><span className="boot-mark">哈</span></main>;
  if (user === "out") return <LoginPage onSubmit={login} error={loginError} />;
  if (!context) return <main className="boot"><p className="boot-error">{cloud.message}</p></main>;

  const page = route.page;
  return <Ctx.Provider value={context}>
    <div className="shell">
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <div className="sidebar-brand"><span className="brand-mark">哈</span><strong>{state!.settings.siteName}</strong><button className="icon-btn sidebar-close" onClick={() => setMenuOpen(false)} aria-label="關閉選單"><X size={18} /></button></div>
        <nav>{nav.map(section => <div key={section.group} className="nav-section"><span>{section.group}</span>{section.items.map(key => <a key={key} href={routeHash({ page: key })} className={page === key ? "on" : ""} aria-current={page === key ? "page" : undefined} onClick={() => setMenuOpen(false)}>{pageTitles[key]}</a>)}</div>)}</nav>
        <div className="sidebar-foot">
          <CloudBadge status={cloud} onRetry={() => void push()} />
          <div className="sidebar-user"><span>{state!.settings.adminName}</span><button className="icon-btn" onClick={() => signOut(auth)} aria-label="登出" title="登出"><LogOut size={16} /></button></div>
        </div>
      </aside>
      {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} />}
      <main className="main">
        <div className="mobile-bar"><button className="icon-btn" onClick={() => setMenuOpen(true)} aria-label="開啟選單"><Menu size={20} /></button><strong>{pageTitles[page]}</strong><CloudBadge status={cloud} onRetry={() => void push()} compact /></div>
        {cloud.kind === "conflict" && <div className="banner banner-warn"><div><strong>雲端資料已在其他裝置更新</strong><p>這台裝置的變更還沒存到雲端。請選擇要保留哪一份。</p></div><div className="banner-actions"><button className="btn" onClick={() => void loadCloudVersion()}>改用雲端版本</button><button className="btn btn-primary" onClick={() => void keepThisDevice()}>用這台的版本覆蓋</button></div></div>}
        {conflictCopy && cloud.kind !== "conflict" && <div className="banner banner-warn"><div><strong>這台裝置有一份較舊、尚未同步的資料</strong><p>目前顯示的是雲端版本。若要改用這台裝置的資料，雲端上較新的變更會被覆蓋。</p></div><div className="banner-actions"><button className="btn" onClick={() => { setConflictCopy(null); writeLocal({ state: state!, baseRevision: revision.current, dirty: false }); }}>保留雲端版本</button><button className="btn btn-primary" onClick={() => { const copy = conflictCopy; setConflictCopy(null); setState(copy); setCloud({ kind: "conflict" }); }}>改用這台的資料</button></div></div>}
        <div className="content">
          {page === "overview" && <OverviewPage />}
          {page === "groups" && (route.groupId && state!.groups.some(group => group.id === route.groupId) ? <GroupDetailPage groupId={route.groupId} /> : <GroupsPage />)}
          {page === "orders" && <OrdersPage />}
          {page === "waybills" && <WaybillsPage />}
          {page === "shipping" && <ShippingPage />}
          {page === "payments" && <PaymentsPage />}
          {page === "spending" && <SpendingPage />}
          {page === "friends" && <FriendsPage />}
          {page === "settings" && <SettingsPage storageBytes={JSON.stringify(state).length} />}
        </div>
      </main>
    </div>
    {drawer?.kind === "group" && <GroupForm id={drawer.id} />}
    {drawer?.kind === "order" && <OrderForm groupId={drawer.groupId} orderId={drawer.orderId} />}
    {drawer?.kind === "waybill" && <WaybillForm id={drawer.id} />}
    {drawer?.kind === "parcel" && <ParcelForm id={drawer.id} friendId={drawer.friendId} />}
    {drawer?.kind === "payment" && <PaymentForm id={drawer.id} friendId={drawer.friendId} />}
    {drawer?.kind === "expense" && <ExpenseForm id={drawer.id} />}
    {drawer?.kind === "friend" && <FriendForm id={drawer.id} />}
    {confirmRequest && <ConfirmDialog request={confirmRequest} onClose={closeConfirm} />}
    {toast && <div className="toast" role="status">{toast}</div>}
  </Ctx.Provider>;
}

function CloudBadge({ status, onRetry, compact }: { status: CloudStatus; onRetry: () => void; compact?: boolean }) {
  const label = status.kind === "saved" ? "已同步" : status.kind === "saving" ? "同步中" : status.kind === "conflict" ? "版本衝突" : status.kind === "loading" ? "載入中" : "未同步";
  return <div className={`cloud cloud-${status.kind} ${compact ? "compact" : ""}`} title={status.message ?? label}>
    <i />{!compact && <span>{label}</span>}
    {status.kind === "error" && !compact && <button className="link-btn" onClick={onRetry}>重試</button>}
    {status.kind === "error" && !compact && status.message && <small>{status.message}，變更已暫存在這台裝置</small>}
  </div>;
}

function LoginPage({ onSubmit, error }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void; error: string }) {
  return <main className="login">
    <form className="login-card" onSubmit={onSubmit}>
      <span className="brand-mark large">哈</span>
      <h1>哈娜的小車車</h1>
      <p>代購管理後台</p>
      <label className="field"><span className="field-label">帳號</span><input name="username" autoComplete="username" required autoFocus /></label>
      <label className="field"><span className="field-label">密碼</span><input name="password" type="password" autoComplete="current-password" required /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="btn btn-primary btn-block" type="submit">登入</button>
    </form>
  </main>;
}
