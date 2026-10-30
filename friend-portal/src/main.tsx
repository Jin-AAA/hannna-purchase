import { FormEvent, StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ChevronDown, KeyRound, LogOut } from "lucide-react";
import { onAuthStateChanged, signInWithCustomToken, signOut, type User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "./firebase";
import "./styles.css";

type PortalStatus = "尚未設定" | "已設定" | "已停用";
type FriendOption = { id: string; name: string; status: PortalStatus };
type Stage = "待下單" | "已下單" | "運回中" | "待出貨" | "包裹處理中" | "已出貨" | "已交付";
type PaymentStatus = "未付款" | "部分付款" | "已付款" | "無應收" | "自用";
type ViewOrder = {
  id: number; code: string; groupName: string; currency: string; saleDate: string; stage: Stage;
  steps: { label: string; date: string; done: boolean }[];
  lines: { name: string; quantity: number; amount: number; payer: string }[];
  gifts: string[]; productDue: number; freightDue: number; due: number; paid: number; balance: number;
  paymentStatus: PaymentStatus; deliveryMethod: string; tracking: string;
};
type FriendView = {
  friendId: number; name: string; portalNote: string; mustChangePassword?: boolean;
  summary?: { due: number; paid: number; balance: number; credit: number };
  orders?: ViewOrder[];
  payments?: { id: number; date: string; amount: number; method: string; toCredit: number }[];
};

const api = (import.meta.env.VITE_FRIEND_AUTH_API as string | undefined)?.replace(/\/$/, "") ?? "";
const money = (value: number) => `NT$${Math.max(0, Math.round(value)).toLocaleString("en-US")}`;
const showDate = (value?: string) => (value ? value.replaceAll("-", "/") : "");
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!api) throw new Error("服務尚未設定，請聯絡哈娜");
  let response: Response;
  try { response = await fetch(`${api}${path}`, init); } catch { throw new Error("連線失敗，請確認網路後再試"); }
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(body.error || "目前無法完成操作，請稍後再試");
  return body as T;
}

function App() {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<FriendView | null>(null);
  const [loadError, setLoadError] = useState("");
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [dismissedPrompt, setDismissedPrompt] = useState(false);

  useEffect(() => onAuthStateChanged(auth, async current => {
    setUser(current);
    setReady(true);
    setView(null);
    setLoadError("");
    if (!current) return;
    const friendId = current.uid.replace(/^friend-/, "");
    try {
      const snapshot = await getDoc(doc(db, "friendViews", friendId));
      if (!snapshot.exists()) throw new Error("找不到妳的資料，請聯絡哈娜");
      setView(snapshot.data() as FriendView);
      const token = await current.getIdToken();
      void request(`/friends/${friendId}/last-login`, { method: "POST", headers: { authorization: `Bearer ${token}` } }).catch(() => undefined);
    } catch (reason) {
      setLoadError(reason instanceof Error && reason.message.includes("哈娜") ? reason.message : "無法載入資料，請重新整理再試一次");
    }
  }), []);

  if (!ready) return <main className="center"><span className="mark pulse">哈</span></main>;
  if (!user) return <Login />;
  if (loadError) return <main className="center"><div className="notice-card"><p>{loadError}</p><button className="btn" onClick={() => signOut(auth)}>登出</button></div></main>;
  if (!view) return <main className="center"><span className="mark pulse">哈</span></main>;

  return <div className="page">
    <header className="top">
      <div className="brand"><span className="mark">哈</span><strong>哈娜的小車車</strong></div>
      <div className="top-actions">
        <button className="icon-text" onClick={() => setPasswordOpen(true)}><KeyRound size={16} />改密碼</button>
        <button className="icon-text" onClick={() => signOut(auth)}><LogOut size={16} />登出</button>
      </div>
    </header>
    <main className="body">
      {view.mustChangePassword && !dismissedPrompt && <div className="prompt"><p>妳現在用的是哈娜給的初始密碼，建議改成只有妳知道的密碼。</p><div><button className="btn btn-primary" onClick={() => setPasswordOpen(true)}>改密碼</button><button className="btn btn-quiet" onClick={() => setDismissedPrompt(true)}>稍後</button></div></div>}
      {view.summary && view.orders ? <Dashboard view={view} /> : <div className="notice-card"><p>哈娜正在更新資料格式，請稍後再回來看看。</p></div>}
    </main>
    {passwordOpen && <PasswordSheet view={view} user={user} onClose={() => setPasswordOpen(false)} onDone={() => { setDismissedPrompt(true); setView({ ...view, mustChangePassword: false }); }} />}
  </div>;
}

function Dashboard({ view }: { view: FriendView }) {
  const summary = view.summary!;
  const orders = view.orders!;
  const payments = view.payments ?? [];
  const active = orders.filter(order => order.stage !== "已交付" || order.balance > 0);
  const done = orders.filter(order => !active.includes(order));
  const [tab, setTab] = useState<"進行中" | "已完成" | "付款紀錄">(active.length || !orders.length ? "進行中" : "已完成");
  const list = tab === "進行中" ? active : done;

  return <>
    <section className="hello">
      <p>{view.name}，妳好</p>
      {summary.balance > 0
        ? <><h1><span className="label">尚未付款</span><span className="amount">{money(summary.balance)}</span></h1><p className="sub">已付 {money(summary.paid)}，共 {money(summary.due)}</p></>
        : <><h1><span className="label">目前沒有待付款項</span></h1>{summary.due > 0 && <p className="sub">已付清 {money(summary.paid)}</p>}</>}
      {summary.credit > 0 && <p className="credit">另有預付餘額 <strong>{money(summary.credit)}</strong>，之後的款項會自動扣抵。</p>}
      {view.portalNote && <p className="note">{view.portalNote}</p>}
    </section>

    <nav className="tabs" role="tablist">
      {(["進行中", "已完成", "付款紀錄"] as const).map(item => <button key={item} role="tab" aria-selected={tab === item} className={tab === item ? "on" : ""} onClick={() => setTab(item)}>{item}<b>{item === "進行中" ? active.length : item === "已完成" ? done.length : payments.length}</b></button>)}
    </nav>

    {tab === "付款紀錄" ? (payments.length ? <ul className="payments">{payments.map(payment => <li key={payment.id}><div><strong>{money(payment.amount)}</strong><small>{showDate(payment.date)}，{payment.method}</small></div>{payment.toCredit > 0 && <span className="pill">{money(payment.toCredit)} 存為預付</span>}</li>)}</ul> : <Empty text="還沒有付款紀錄" />)
      : list.length ? <div className="orders">{list.map(order => <OrderCard key={order.id} order={order} />)}</div> : <Empty text={tab === "進行中" ? "目前沒有進行中的訂單" : "還沒有已完成的訂單"} />}
    <p className="foot">資料由哈娜更新，有任何問題直接問她就好。</p>
  </>;
}

function OrderCard({ order }: { order: ViewOrder }) {
  const [open, setOpen] = useState(false);
  const statusTone = order.paymentStatus === "已付款" ? "green" : order.paymentStatus === "部分付款" ? "amber" : order.paymentStatus === "未付款" ? "red" : "gray";
  const current = useMemo(() => [...order.steps].reverse().find(step => step.done), [order.steps]);
  return <article className="card">
    <button className="card-head" onClick={() => setOpen(!open)} aria-expanded={open}>
      <div className="card-title"><strong>{order.groupName}</strong><small>{order.code}，{order.lines.reduce((sum, line) => sum + line.quantity, 0)} 件</small></div>
      <div className="card-money">
        {order.due > 0 ? <><span className={`tag tag-${statusTone}`}>{order.paymentStatus}</span><strong>{order.balance > 0 ? money(order.balance) : money(order.due)}</strong></> : <span className="tag tag-gray">不用付款</span>}
      </div>
    </button>
    <ol className="steps" aria-label="貨態">
      {order.steps.map(step => <li key={step.label} className={step.done ? "done" : ""}><i /><span>{step.label}</span>{step.done && step.date && <small>{showDate(step.date)}</small>}</li>)}
    </ol>
    {!current && <p className="waiting">哈娜還在等待下單</p>}
    {open && <div className="detail">
      <table className="lines"><tbody>{order.lines.map((line, i) => <tr key={i}><td>{line.name}<small>× {line.quantity}{line.payer === "朋友自行付清" ? "，妳已自行付款" : line.payer === "我自行負擔" ? "，哈娜請客" : ""}</small></td><td>{line.amount > 0 ? money(line.amount) : "—"}</td></tr>)}</tbody></table>
      {order.gifts.length > 0 && <p className="gifts">滿額贈：{order.gifts.join("、")}</p>}
      {order.due > 0 && <dl className="sum">
        <div><dt>商品款</dt><dd>{money(order.productDue)}</dd></div>
        {order.freightDue > 0 && <div><dt>國際運費</dt><dd>{money(order.freightDue)}</dd></div>}
        <div><dt>已付</dt><dd>{money(order.paid)}</dd></div>
        <div className="total"><dt>尚未付款</dt><dd>{money(order.balance)}</dd></div>
      </dl>}
      {(order.deliveryMethod || order.tracking) && <p className="ship">{order.deliveryMethod && <>交付方式：{order.deliveryMethod}</>}{order.tracking && <><br />寄件編號：<span className="mono">{order.tracking}</span></>}</p>}
    </div>}
    <button className="more" onClick={() => setOpen(!open)}>{open ? "收起明細" : "查看明細"}<ChevronDown size={16} className={open ? "flip" : ""} /></button>
  </article>;
}

const Empty = ({ text }: { text: string }) => <div className="empty">{text}</div>;

function Login() {
  const [friends, setFriends] = useState<FriendOption[] | null>(null);
  const [friendId, setFriendId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { request<{ friends: FriendOption[] }>("/friends").then(result => setFriends(result.friends)).catch(reason => { setFriends([]); setError(reason.message); }); }, []);
  const selected = friends?.find(friend => friend.id === friendId);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected) return setError("請先選擇妳的名字");
    if (selected.status === "已停用") return setError("這個帳號目前暫停使用，請聯絡哈娜");
    if (password.length < 4) return setError("密碼至少 4 個字元");
    setBusy(true); setError("");
    try {
      const result = await request<{ customToken: string }>(`/friends/${selected.id}/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
      await signInWithCustomToken(auth, result.customToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登入失敗，請再試一次");
    } finally { setBusy(false); }
  }

  return <main className="center">
    <form className="login" onSubmit={submit}>
      <span className="mark large">哈</span>
      <h1>哈娜的小車車</h1>
      <p className="lead">查看妳的訂單、貨態與付款狀況</p>
      <label className="field"><span>妳是誰</span>
        <select value={friendId} onChange={event => { setFriendId(event.target.value); setError(""); }} disabled={!friends?.length}>
          <option value="">{friends === null ? "載入中…" : friends.length ? "選擇妳的名字" : "目前沒有可登入的帳號"}</option>
          {friends?.map(friend => <option key={friend.id} value={friend.id}>{friend.name}</option>)}
        </select>
      </label>
      <label className="field"><span>密碼</span><input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" disabled={!selected} /></label>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn btn-primary btn-block" disabled={busy || !selected}>{busy ? "登入中…" : "登入"}</button>
      <p className="hint">名單裡沒有妳，或忘記密碼時，請跟哈娜說一聲，她會幫妳設定密碼。</p>
    </form>
  </main>;
}

function PasswordSheet({ view, user, onClose, onDone }: { view: FriendView; user: User; onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < 4) return setMessage({ ok: false, text: "密碼至少 4 個字元" });
    if (password !== confirm) return setMessage({ ok: false, text: "兩次輸入的密碼不一樣" });
    setBusy(true);
    try {
      const token = await user.getIdToken();
      await request(`/friends/${view.friendId}/password`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ password }) });
      setMessage({ ok: true, text: "密碼已更新，下次請用新密碼登入" });
      setPassword(""); setConfirm("");
      onDone();
    } catch (reason) { setMessage({ ok: false, text: reason instanceof Error ? reason.message : "更新失敗" }); }
    finally { setBusy(false); }
  }
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; document.addEventListener("keydown", onKey); return () => document.removeEventListener("keydown", onKey); }, [onClose]);
  return <div className="sheet-layer" onMouseDown={onClose}>
    <form className="sheet" onSubmit={submit} onMouseDown={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="改密碼">
      <h2>改密碼</h2>
      <label className="field"><span>新密碼</span><input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" autoFocus /></label>
      <label className="field"><span>再輸入一次</span><input type="password" value={confirm} onChange={event => setConfirm(event.target.value)} autoComplete="new-password" /></label>
      {message && <p className={message.ok ? "ok" : "error"} role="status">{message.text}</p>}
      <div className="sheet-actions"><button type="button" className="btn btn-quiet" onClick={onClose}>{message?.ok ? "完成" : "取消"}</button><button className="btn btn-primary" disabled={busy}>{busy ? "更新中…" : "儲存新密碼"}</button></div>
    </form>
  </div>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
