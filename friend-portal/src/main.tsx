import { FormEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ChevronDown, ChevronLeft, ChevronUp, KeyRound, LogOut, PackageCheck, ReceiptText, Truck } from "lucide-react";
import { onAuthStateChanged, signInWithCustomToken, signOut, type User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "./firebase";
import "./styles.css";

type PortalStatus = "尚未設定" | "已設定" | "已停用";
type FriendOption = { id: string; name: string; status: PortalStatus };
type Product = { id: number; name: string; unitPrice: number };
type Line = { productId: number; quantity: number; receivableTwd: number; arrival?: string };
type Order = { id: number; code: string; friend: string; lines: Line[]; receivableTwd: number };
type Group = { id: number; name: string; currency: "KRW" | "JPY" | "TWD"; products: Product[]; orders: Order[] };
type Payment = { id: number; amount: number; date: string; method: string; orderIds: number[] };
type Waybill = { id: number; code: string; tracking: string; status: string; destination: string; items: Array<{ orderId: number; receivableFreightTwd?: number }> };
type Parcel = { id: number; code: string; orderIds: number[]; method: string; shippingFee: number; tracking: string; date: string; status: string };
type FriendView = { friendId: number; authUid: string; name: string; portalStatus: PortalStatus; portalNote: string; groups: Group[]; payments: Payment[]; waybills: Waybill[]; parcels: Parcel[] };
type PortalOrder = { group: Group; order: Order; productDue: number; freightDue: number; totalDue: number; paid: number; balance: number; paymentStatus: "未付款" | "部分付款" | "已付款"; arrival: string; shipping: string; parcel?: Parcel; waybill?: Waybill };

const api = (import.meta.env.VITE_FRIEND_AUTH_API as string | undefined)?.replace(/\/$/, "") ?? "";
const money = (value: number) => `NT$ ${Math.max(0, Math.round(value)).toLocaleString("zh-TW")}`;
async function request(path: string, init?: RequestInit) {
  if (!api) throw new Error("朋友端驗證服務尚未設定");
  const response = await fetch(`${api}${path}`, init);
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(body.error || "目前無法完成操作");
  return body;
}

function App() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<FriendView | null>(null);
  const [friends, setFriends] = useState<FriendOption[]>([]);
  const [selected, setSelected] = useState<FriendOption | null>(null);
  const [step, setStep] = useState<"choose" | "password">("choose");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"未付款" | "已付款">("未付款");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);

  useEffect(() => onAuthStateChanged(auth, async current => {
    setUser(current); setAuthReady(true);
    if (!current) { setView(null); return; }
    const friendId = current.uid.replace(/^friend-/, "");
    try {
      const snapshot = await getDoc(doc(db, "friendViews", friendId));
      if (!snapshot.exists()) throw new Error("找不到妳的訂單資料");
      setView(snapshot.data() as FriendView);
      const token = await current.getIdToken();
      void request(`/friends/${friendId}/last-login`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "無法載入訂單資料"); }
  }), []);

  useEffect(() => {
    if (user) return;
    request("/friends").then(result => setFriends((result as { friends: FriendOption[] }).friends)).catch(reason => setError(reason.message));
  }, [user]);

  const orders = useMemo<PortalOrder[]>(() => {
    if (!view) return [];
    const base = view.groups.flatMap(group => group.orders.map(order => {
      const waybill = view.waybills.find(item => item.items.some(line => line.orderId === order.id));
      const freightDue = view.waybills.flatMap(item => item.items).filter(item => item.orderId === order.id).reduce((sum, item) => sum + (item.receivableFreightTwd ?? 0), 0);
      const parcel = view.parcels.find(item => item.orderIds.includes(order.id));
      return { group, order, productDue: order.receivableTwd, freightDue, totalDue: order.receivableTwd + freightDue, parcel, waybill };
    }));
    const paid = new Map<number, number>();
    view.payments.forEach(payment => {
      const targets = base.filter(item => payment.orderIds.includes(item.order.id));
      const targetTotal = targets.reduce((sum, item) => sum + item.totalDue, 0);
      targets.forEach(item => paid.set(item.order.id, (paid.get(item.order.id) ?? 0) + (targetTotal ? payment.amount * item.totalDue / targetTotal : 0)));
    });
    return base.map(item => {
      const paidAmount = Math.min(item.totalDue, paid.get(item.order.id) ?? 0);
      const balance = Math.max(0, item.totalDue - paidAmount);
      const paymentStatus: PortalOrder["paymentStatus"] = balance < .5 ? "已付款" : paidAmount > .5 ? "部分付款" : "未付款";
      const arrivals = item.order.lines.map(line => line.arrival ?? "未到貨");
      const arrival = arrivals.every(value => value === "已到貨") ? "已到貨" : arrivals.some(value => value === "已到貨") ? "部分到貨" : item.waybill?.status ?? "未到貨";
      const shipping = item.parcel?.status ?? (arrival === "已到貨" ? "待出貨" : "待到貨");
      return { ...item, paid: paidAmount, balance, paymentStatus, arrival, shipping };
    }).sort((a, b) => b.order.id - a.order.id);
  }, [view]);

  const visibleOrders = orders.filter(item => tab === "已付款" ? item.paymentStatus === "已付款" : item.paymentStatus !== "已付款");
  const unpaidTotal = orders.reduce((sum, item) => sum + item.balance, 0);

  function choose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = String(new FormData(event.currentTarget).get("friend") || "");
    const option = friends.find(friend => friend.id === id) ?? null;
    if (!option) return setError("請先選擇妳是誰");
    if (option.status === "已停用") return setError("這個帳號目前無法登入，請聯絡 Jiin");
    setSelected(option); setStep("password"); setError("");
  }

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") || "");
    const confirm = String(form.get("confirm") || "");
    if (password.length < 4) return setError("密碼至少需要 4 個字元");
    if (selected.status === "尚未設定" && password !== confirm) return setError("兩次輸入的密碼不一致");
    setBusy(true); setError("");
    try {
      const result = await request(`/friends/${selected.id}/${selected.status === "尚未設定" ? "setup" : "login"}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      }) as { customToken: string };
      await signInWithCustomToken(auth, result.customToken);
    } catch (reason) {
      setError(reason instanceof Error
        ? reason.message
        : selected.status === "尚未設定"
          ? "設定失敗，請稍後再試一次"
          : "密碼不正確，請再試一次");
    }
    finally { setBusy(false); }
  }

  if (!authReady) return <main className="center"><div className="loader" /></main>;
  if (!user || !view) return <Login friends={friends} selected={selected} step={step} error={error} busy={busy} onChoose={choose} onAuth={authenticate} onBack={() => { setStep("choose"); setSelected(null); setError(""); }} />;

  return <main className="portal-shell">
    <header><Brand /><div className="account-wrap"><button className="avatar-button" onClick={() => setAccountOpen(value => !value)}>{view.name.slice(0, 1)}<ChevronDown size={15} /></button>{accountOpen && <AccountMenu view={view} user={user} onClose={() => setAccountOpen(false)} />}</div></header>
    <section className="welcome"><span>{view.name}，妳好</span><h1>{unpaidTotal > 0 ? <>目前尚有 <strong>{money(unpaidTotal)}</strong> 待付款</> : "目前沒有待付款項"}</h1>{view.portalNote && <p>{view.portalNote}</p>}</section>
    <nav className="tabs"><button className={tab === "未付款" ? "active" : ""} onClick={() => setTab("未付款")}>未付款 <b>{orders.filter(item => item.paymentStatus !== "已付款").length}</b></button><button className={tab === "已付款" ? "active" : ""} onClick={() => setTab("已付款")}>已付款 <b>{orders.filter(item => item.paymentStatus === "已付款").length}</b></button></nav>
    <section className="orders">{visibleOrders.length ? visibleOrders.map(item => <OrderCard key={item.order.id} item={item} open={expanded === item.order.id} onToggle={() => setExpanded(expanded === item.order.id ? null : item.order.id)} />) : <div className="empty"><PackageCheck size={34} /><strong>這裡目前沒有訂單</strong><span>有新資料時會顯示在這裡</span></div>}</section>
  </main>;
}

function Brand() { return <div className="brand"><span>H</span><div><strong>哈娜的小車車</strong><small>HANNNA&apos;S CART</small></div></div>; }

function Login({ friends, selected, step, error, busy, onChoose, onAuth, onBack }: { friends: FriendOption[]; selected: FriendOption | null; step: "choose" | "password"; error: string; busy: boolean; onChoose: (e: FormEvent<HTMLFormElement>) => void; onAuth: (e: FormEvent<HTMLFormElement>) => void; onBack: () => void }) {
  return <main className="login-shell"><section className="login-card"><Brand />{step === "choose" ? <form onSubmit={onChoose}><label>請選擇妳是誰<select name="friend" defaultValue=""><option value="" disabled>{friends.length ? "選擇名字" : "目前尚無可用的朋友帳號"}</option>{friends.map(friend => <option key={friend.id} value={friend.id}>{friend.name}</option>)}</select></label><button className="primary" disabled={!friends.length}>下一步</button></form> : <form onSubmit={onAuth}><button type="button" className="back" onClick={onBack}><ChevronLeft size={17} />重新選擇</button><div className="selected-person"><span>{selected?.name.slice(0, 1)}</span><div><small>妳選擇的是</small><strong>{selected?.name}</strong></div></div>{selected?.status === "尚未設定" ? <><label>設定密碼<input type="password" name="password" minLength={4} autoFocus placeholder="至少 4 個字元" /></label><label>再次確認密碼<input type="password" name="confirm" minLength={4} placeholder="再輸入一次" /></label></> : <label>請輸入密碼<input type="password" name="password" autoFocus placeholder="輸入密碼" /></label>}<button className="primary" disabled={busy}>{busy ? "處理中…" : selected?.status === "尚未設定" ? "設定並登入" : "登入"}</button>{selected?.status === "已設定" && <small className="help">忘記密碼時，請直接聯絡 Jiin 協助重設</small>}</form>}{error && <p className="error">{error}</p>}</section></main>;
}

function OrderCard({ item, open, onToggle }: { item: PortalOrder; open: boolean; onToggle: () => void }) {
  const products = item.order.lines.map(line => ({ line, product: item.group.products.find(product => product.id === line.productId) }));
  return <article className="order-card"><div className="order-top"><div><small>{item.order.code}</small><h2>{item.group.name}</h2></div><span className={`status ${item.paymentStatus === "已付款" ? "paid" : item.paymentStatus === "部分付款" ? "partial" : "unpaid"}`}>{item.paymentStatus}</span></div><div className="summary-row"><div><span>訂單總額</span><strong>{money(item.totalDue)}</strong></div><div><span>{item.paymentStatus === "已付款" ? "已付款" : "尚未付款"}</span><strong className={item.balance > 0 ? "coral" : "green"}>{item.paymentStatus === "已付款" ? money(item.paid) : money(item.balance)}</strong></div></div><div className="state-row"><span><ReceiptText size={15} />{products.reduce((sum, value) => sum + value.line.quantity, 0)} 件商品</span><span><Truck size={15} />{item.shipping}</span></div><button className="detail-toggle" onClick={onToggle}>{open ? "收起明細" : "查看明細"}{open ? <ChevronUp size={17} /> : <ChevronDown size={17} />}</button>{open && <div className="details"><section><h3>商品明細</h3>{products.map(({ line, product }, index) => <div className="product-line" key={`${line.productId}-${index}`}><div><strong>{product?.name ?? "商品"}</strong><small>{line.quantity} 件 · {line.arrival ?? "未到貨"}</small></div><b>{money(line.receivableTwd)}</b></div>)}</section><section className="fee-list"><div><span>商品款</span><strong>{money(item.productDue)}</strong></div><div><span>國際運費</span><strong>{money(item.freightDue)}</strong></div><div><span>已付款</span><strong className="green">{money(item.paid)}</strong></div><div className="balance"><span>尚未付款</span><strong>{money(item.balance)}</strong></div></section><section><h3>貨態資訊</h3><div className="timeline"><i className="done" /><span>訂單成立</span><i className={item.arrival !== "未到貨" ? "done" : ""} /><span>{item.arrival}</span><i className={item.shipping === "已出貨" || item.shipping === "已取貨" ? "done" : ""} /><span>{item.shipping}</span></div>{item.parcel?.tracking && <p className="tracking">追蹤碼：{item.parcel.tracking}</p>}</section></div>}</article>;
}

function AccountMenu({ view, user, onClose }: { view: FriendView; user: User; onClose: () => void }) {
  const [changing, setChanging] = useState(false); const [message, setMessage] = useState("");
  async function changePassword(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); const password = String(form.get("password") || ""); const confirm = String(form.get("confirm") || ""); if (password.length < 4 || password !== confirm) return setMessage("請確認密碼至少 4 個字元，且兩次輸入相同"); try { const token = await user.getIdToken(); await request(`/friends/${view.friendId}/password`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ password }) }); setMessage("密碼已更新"); setChanging(false); } catch (reason) { setMessage(reason instanceof Error ? reason.message : "更新失敗"); } }
  return <div className="account-menu"><button className="close-menu" onClick={onClose}>×</button><strong>{view.name}</strong><small>朋友帳號</small>{changing ? <form onSubmit={changePassword}><input name="password" type="password" minLength={4} placeholder="新密碼" /><input name="confirm" type="password" minLength={4} placeholder="再次輸入" /><button className="primary">儲存新密碼</button></form> : <button onClick={() => setChanging(true)}><KeyRound size={16} />更改密碼</button>}<button onClick={() => signOut(auth)}><LogOut size={16} />登出</button>{message && <p>{message}</p>}</div>;
}

createRoot(document.getElementById("root")!).render(<App />);
