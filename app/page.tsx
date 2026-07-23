"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, Bell, Box, CalendarDays, ChevronDown, ChevronRight, Globe2,
  CircleDollarSign, ClipboardList, Gift, LayoutDashboard, Menu,
  PackageCheck, Plus, Search, Settings, ShoppingBag, Trash2, Truck,
  UserRound, UsersRound, X, Pencil, Download, Database, Save, AlertTriangle, LogOut, LockKeyhole,
} from "lucide-react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, updatePassword } from "firebase/auth";
import { collection, doc, getDoc, onSnapshot, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { auth, db } from "./firebase";

type GroupStatus = "待下單" | "待到貨" | "部分到貨" | "已到貨" | "出貨中" | "部分出貨" | "已出貨" | "已完成";
type Currency = "KRW" | "JPY" | "CNY" | "TWD";
type Product = { id: number; name: string; unitPrice: number };
type GiftRule = { id: number; threshold: number; giftName: string; cumulative: boolean };
type ProductPayer = "我代墊・需收款" | "朋友自行付清" | "我自行負擔";
type OrderLine = { productId: number; quantity: number; receivableTwd: number; productPayer?: ProductPayer; arrival?: "未到貨" | "運回中" | "已到貨"; deliveryRoute?: "寄到我這裡" | "直寄朋友" };
type PaymentStatus = "未付款" | "部分付款" | "已付款";
type ArrivalStatus = "未到貨" | "部分到貨" | "已到貨";
type ShippingStatus = "待到貨" | "待出貨" | "已出貨";
type Order = { id: number; code: string; friend: string; lines: OrderLine[]; receivableTwd: number; payment?: PaymentStatus; arrival?: ArrivalStatus; shipping?: ShippingStatus };
type Group = { id: number; name: string; saleDate: string; currency: Currency; status: GroupStatus; products: Product[]; giftRules: GiftRule[]; orders: Order[] };
type FriendPortalStatus = "尚未設定" | "已設定" | "已停用";
type Friend = { id: number; name: string; note: string; portalNote?: string; portalStatus?: FriendPortalStatus; lastLoginAt?: string; previousNames?: string[] };
type PaymentRecord = { id: number; friend: string; amount: number; date: string; method: string; note: string; orderIds: number[] };
type ExpenseRecord = { id: number; category: string; amount: number; date: string; group: string; note: string };
type DeliveryMethod = "面交" | "賣貨便";
type ParcelStatus = "待出貨" | "已出貨" | "已取貨";
type Parcel = { id: number; code: string; friend: string; orderIds: number[]; method: DeliveryMethod; shippingFee: number; tracking: string; date: string; note: string; status: ParcelStatus };
type WaybillItem = { groupId: number; orderId: number; weightG: number; receivableFreightTwd?: number };
type Waybill = { id: number; code: string; country: "韓國" | "日本" | "其他"; tracking: string; items: WaybillItem[]; totalWeightG: number; freightTwd: number; destination: "寄到我這裡" | "直寄朋友"; recipientFriend: string; status: "已申請運回" | "已到貨"; appliedDate: string; arrivedDate: string; note: string; freightPayer?: string; freightFriend?: string; freightReceivableTwd?: number };
type AppSettings = { siteName: string; adminName: string; orderPrefix: string; amountDisplay: "original" | "twd"; thousands: boolean; paymentMethods: string[]; deliveryMethods: DeliveryMethod[]; defaultShippingNote: string };

const currencyInfo: Record<Currency, { label: string; symbol: string }> = {
  KRW: { label: "韓幣 KRW", symbol: "₩" },
  JPY: { label: "日幣 JPY", symbol: "¥" },
  CNY: { label: "人民幣 CNY", symbol: "¥" },
  TWD: { label: "新台幣 TWD", symbol: "NT$" },
};
const initialFriends: Friend[] = [];
const initialPayments: PaymentRecord[] = [];
const initialExpenses: ExpenseRecord[] = [];
const initialParcels: Parcel[] = [];
const initialWaybills: Waybill[] = [];
const friends = initialFriends.map(friend => friend.name);
const initialGroups: Group[] = [];
const initialSettings: AppSettings = { siteName: "哈娜的小車車", adminName: "Jiin", orderPrefix: "ORDER", amountDisplay: "original", thousands: true, paymentMethods: ["銀行轉帳", "LINE Pay"], deliveryMethods: ["面交", "賣貨便"], defaultShippingNote: "" };
const navItems = [
  [LayoutDashboard, "總覽"], [UsersRound, "代購團"], [ClipboardList, "訂單明細"], [Globe2, "國際運單"],
  [UserRound, "朋友名單"], [CircleDollarSign, "款項紀錄"], [Truck, "出貨管理"], [Settings, "設定"],
] as const;
const groupStatuses: GroupStatus[] = ["待下單", "待到貨", "部分到貨", "已到貨", "出貨中", "部分出貨", "已出貨", "已完成"];
const statusClass: Record<GroupStatus, string> = { 待下單: "gray", 待到貨: "amber", 部分到貨: "coral", 已到貨: "mint", 出貨中: "blue", 部分出貨: "violet", 已出貨: "mint", 已完成: "gray" };
const normalizeGroupStatus = (value: string): GroupStatus => value === "收單中" ? "待下單" : value === "整理出貨" ? "已到貨" : groupStatuses.includes(value as GroupStatus) ? value as GroupStatus : "待下單";
const formatDate = (value: string) => value ? value.replaceAll("-", "/") : "未設定";
const dateInputValue = (value?: string) => value && value !== "未設定" ? value.replaceAll("/", "-") : "";
const todayInputValue = () => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};
const orderQuantity = (order: Order) => order.lines.reduce((sum, line) => sum + line.quantity, 0);
const orderTotal = (group: Group, order: Order) => order.lines.reduce((sum, line) => sum + (group.products.find(p => p.id === line.productId)?.unitPrice ?? 0) * line.quantity, 0);
const orderReceivable = (order: Order) => order.lines.reduce((sum, line) => sum + line.receivableTwd, 0);
const money = (value: number, currency: Currency) => `${currencyInfo[currency].symbol}${value.toLocaleString()}`;
const earnedGifts = (group: Group, total: number) => group.giftRules.flatMap(rule => {
  const count = rule.cumulative ? Math.floor(total / rule.threshold) : total >= rule.threshold ? 1 : 0;
  return count > 0 ? [{ ...rule, count }] : [];
});
const withoutUndefined = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const friendAuthApi = process.env.NEXT_PUBLIC_FRIEND_AUTH_API?.replace(/\/$/, "") ?? "";
const oneTimeFriendNameMigrations: Record<string, string> = { "我自己": "哈娜本人" };

function migrateFriendReferences(data: {
  groups: Group[];
  friends: Friend[];
  payments: PaymentRecord[];
  parcels: Parcel[];
  waybills: Waybill[];
}) {
  const aliases = new Map<string, string>(Object.entries(oneTimeFriendNameMigrations));
  data.friends.forEach(friend => (friend.previousNames ?? []).forEach(name => aliases.set(name, friend.name)));
  const currentNames = new Set(data.friends.map(friend => friend.name));
  const rename = (name: string) => {
    const target = aliases.get(name);
    return target && currentNames.has(target) ? target : name;
  };
  return {
    groups: data.groups.map(group => ({ ...group, orders: group.orders.map(order => ({ ...order, friend: rename(order.friend) })) })),
    friends: data.friends.map(friend => {
      const migratedFrom = Object.entries(oneTimeFriendNameMigrations)
        .filter(([, target]) => target === friend.name)
        .map(([source]) => source);
      return { ...friend, previousNames: Array.from(new Set([...(friend.previousNames ?? []), ...migratedFrom])) };
    }),
    payments: data.payments.map(record => ({ ...record, friend: rename(record.friend) })),
    parcels: data.parcels.map(parcel => ({ ...parcel, friend: rename(parcel.friend) })),
    waybills: data.waybills.map(waybill => ({
      ...waybill,
      recipientFriend: rename(waybill.recipientFriend),
      freightPayer: waybill.freightPayer ? rename(waybill.freightPayer) : waybill.freightPayer,
      freightFriend: waybill.freightFriend ? rename(waybill.freightFriend) : waybill.freightFriend,
    })),
  };
}

export default function Home() {
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [groups, setGroups] = useState(initialGroups);
  const [friendList, setFriendList] = useState(initialFriends);
  const [activeNav, setActiveNav] = useState("代購團");
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("全部狀態");
  const [orderFriend, setOrderFriend] = useState("全部朋友");
  const [orderGroup, setOrderGroup] = useState("全部代購團");
  const [paymentFilter, setPaymentFilter] = useState("全部付款狀態");
  const [arrivalFilter, setArrivalFilter] = useState("全部到貨狀態");
  const [shippingFilter, setShippingFilter] = useState("全部出貨狀態");
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState(false);
  const [editingOrderId, setEditingOrderId] = useState<number | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [notice, setNotice] = useState("");
  const [productRows, setProductRows] = useState([{ id: 0, name: "", unitPrice: "" }]);
  const [giftRows, setGiftRows] = useState([{ id: -1, threshold: "", giftName: "", cumulative: true }]);
  const [orderLines, setOrderLines] = useState<Record<number, number>>({});
  const [lineReceivables, setLineReceivables] = useState<Record<number, number>>({});
  const [linePayers, setLinePayers] = useState<Record<number, ProductPayer>>({});
  const [transferTargets, setTransferTargets] = useState<Record<number, string>>({});
  const [friendModalOpen, setFriendModalOpen] = useState(false);
  const [editingFriendId, setEditingFriendId] = useState<number | null>(null);
  const [payments, setPayments] = useState(initialPayments);
  const [expenses, setExpenses] = useState(initialExpenses);
  const [paymentTab, setPaymentTab] = useState<"應收款項" | "收款紀錄" | "支出紀錄">("應收款項");
  const [paymentModal, setPaymentModal] = useState<"income" | "expense" | null>(null);
  const [paymentFriend, setPaymentFriend] = useState("");
  const [paymentOrders, setPaymentOrders] = useState<number[]>([]);
  const [parcels, setParcels] = useState(initialParcels);
  const [parcelModalOpen, setParcelModalOpen] = useState(false);
  const [editingParcelId, setEditingParcelId] = useState<number | null>(null);
  const [parcelFriend, setParcelFriend] = useState("");
  const [parcelOrders, setParcelOrders] = useState<number[]>([]);
  const [shippingTab, setShippingTab] = useState<"待到齊" | "可出貨" | "包裹紀錄">("可出貨");
  const [waybills, setWaybills] = useState(initialWaybills);
  const [waybillModalOpen, setWaybillModalOpen] = useState(false);
  const [editingWaybillId, setEditingWaybillId] = useState<number | null>(null);
  const [waybillItems, setWaybillItems] = useState<Record<string, { checked: boolean; weightG: number; receivableFreightTwd: number }>>({});
  const [waybillDestination, setWaybillDestination] = useState<Waybill["destination"]>("寄到我這裡");
  const [settings, setSettings] = useState<AppSettings>(initialSettings);

  useEffect(() => {
    return onAuthStateChanged(auth, async user => {
      setIsAuthenticated(Boolean(user));
      setAuthChecked(true);
      if (!user) { setDataLoaded(false); return; }
      try {
        const snapshot = await getDoc(doc(db, "admin", "state"));
        if (snapshot.exists()) {
          const data = snapshot.data();
          const migrated = migrateFriendReferences({
            groups: ((data.groups as Group[]) ?? []).map(group => ({ ...group, status: normalizeGroupStatus(String(group.status)) })),
            friends: (data.friends as Friend[]) ?? [],
            payments: (data.payments as PaymentRecord[]) ?? [],
            parcels: (data.parcels as Parcel[]) ?? [],
            waybills: (data.waybills as Waybill[]) ?? [],
          });
          setGroups(migrated.groups);
          setFriendList(migrated.friends);
          setPayments(migrated.payments);
          setExpenses((data.expenses as ExpenseRecord[]) ?? []);
          setParcels(migrated.parcels);
          setWaybills(migrated.waybills);
          setSettings({ ...initialSettings, ...((data.settings as Partial<AppSettings>) ?? {}) });
        }
        setDataLoaded(true);
      } catch {
        setLoginError("無法讀取雲端資料，請確認網路後重新整理");
      }
    });
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !dataLoaded) return;
    return onSnapshot(collection(db, "friendViews"), snapshot => {
      const portalState = new Map(snapshot.docs.map(item => {
        const data = item.data();
        const rawLastLogin = data.lastLoginAt as { toDate?: () => Date } | string | undefined;
        const lastLoginAt = typeof rawLastLogin === "string"
          ? rawLastLogin
          : rawLastLogin?.toDate?.().toISOString();
        return [Number(item.id), {
          portalStatus: data.portalStatus as FriendPortalStatus | undefined,
          lastLoginAt,
        }] as const;
      }));
      setFriendList(current => current.map(friend => {
        const remote = portalState.get(friend.id);
        if (!remote) return friend;
        const portalStatus = remote.portalStatus ?? friend.portalStatus ?? "尚未設定";
        const lastLoginAt = remote.lastLoginAt ?? friend.lastLoginAt;
        return portalStatus === friend.portalStatus && lastLoginAt === friend.lastLoginAt
          ? friend
          : { ...friend, portalStatus, lastLoginAt };
      }));
    }, () => showNotice("朋友登入狀態同步失敗，請稍後重新整理"));
  }, [isAuthenticated, dataLoaded]);

  useEffect(() => {
    if (!isAuthenticated || !dataLoaded || !friendAuthApi || !auth.currentUser) return;
    let cancelled = false;
    const syncAuthState = async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;
        const response = await fetch(`${friendAuthApi}/admin/friends/auth-state`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (!response.ok) throw new Error("request failed");
        const result = await response.json() as { friends?: Array<{ id: string; portalStatus: FriendPortalStatus; lastLoginAt?: string }> };
        if (cancelled) return;
        const remote = new Map((result.friends ?? []).map(friend => [Number(friend.id), friend]));
        setFriendList(current => current.map(friend => {
          const state = remote.get(friend.id);
          if (!state) return friend;
          return friend.portalStatus === state.portalStatus && friend.lastLoginAt === state.lastLoginAt
            ? friend
            : { ...friend, portalStatus: state.portalStatus, lastLoginAt: state.lastLoginAt };
        }));
      } catch {
        // Firestore snapshot remains available as a fallback; retry on the next interval.
      }
    };
    void syncAuthState();
    const timer = window.setInterval(() => void syncAuthState(), 15000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [isAuthenticated, dataLoaded]);

  useEffect(() => {
    if (!isAuthenticated || !dataLoaded) return;
    const timer = window.setTimeout(() => {
      void setDoc(doc(db, "admin", "state"), {
        ...withoutUndefined({ groups, friends: friendList, payments, expenses, parcels, waybills, settings }),
        updatedAt: serverTimestamp(),
      }).catch(() => showNotice("雲端儲存失敗，請確認網路連線"));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [groups, friendList, payments, expenses, parcels, waybills, settings, isAuthenticated, dataLoaded]);

  useEffect(() => {
    if (!isAuthenticated || !dataLoaded) return;
    const timer = window.setTimeout(() => {
      friendList.forEach(friend => {
        const friendOrders = groups.flatMap(group => {
          const orders = group.orders.filter(order => order.friend === friend.name);
          return orders.length ? [{ id: group.id, name: group.name, saleDate: group.saleDate, currency: group.currency, status: group.status, products: group.products, orders }] : [];
        });
        const orderIds = new Set(friendOrders.flatMap(group => group.orders.map(order => order.id)));
        const publicWaybills = waybills.flatMap(waybill => {
          const items = waybill.items.filter(item => orderIds.has(item.orderId));
          return items.length ? [{ id: waybill.id, code: waybill.code, country: waybill.country, tracking: waybill.tracking, items, destination: waybill.destination, status: waybill.status, appliedDate: waybill.appliedDate, arrivedDate: waybill.arrivedDate }] : [];
        });
        const publicParcels = parcels.flatMap(parcel => {
          const orderIdsForFriend = parcel.orderIds.filter(orderId => orderIds.has(orderId));
          return orderIdsForFriend.length ? [{ id: parcel.id, code: parcel.code, orderIds: orderIdsForFriend, method: parcel.method, shippingFee: parcel.shippingFee, tracking: parcel.tracking, date: parcel.date, status: parcel.status }] : [];
        });
        const publicPayments = payments.filter(record => record.friend === friend.name).map(({ id, amount, date, method, orderIds: paidOrderIds }) => ({ id, amount, date, method, orderIds: paidOrderIds }));
        void setDoc(doc(db, "friendViews", String(friend.id)), withoutUndefined({ friendId: friend.id, authUid: `friend-${friend.id}`, name: friend.name, portalNote: friend.portalNote ?? "", groups: friendOrders, payments: publicPayments, waybills: publicWaybills, parcels: publicParcels, updatedAt: new Date().toISOString() }), { merge: true })
          .catch(() => showNotice("朋友端資料同步失敗，請稍後再試"));
      });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [groups, friendList, payments, parcels, waybills, isAuthenticated, dataLoaded]);

  const selectedGroup = groups.find(group => group.id === selectedGroupId) ?? null;
  const visibleGroups = useMemo(() => groups.filter(group =>
    group.name.toLowerCase().includes(query.toLowerCase()) && (status === "全部狀態" || group.status === status)
  ), [groups, query, status]);
  const totalOrders = groups.reduce((sum, group) => sum + group.orders.length, 0);
  const totalProducts = groups.reduce((sum, group) => sum + group.products.length, 0);
  const totalPurchased = groups.flatMap(group => group.orders).reduce((sum, order) => sum + orderQuantity(order), 0);
  const draftTotal = selectedGroup ? selectedGroup.products.reduce((sum, product) => sum + product.unitPrice * (orderLines[product.id] || 0), 0) : 0;
  const paidByOrder = new Map<number, number>();
  const settledProductOrderIds = new Set(payments.flatMap(record => record.orderIds.filter(id => id > 0)));
  payments.forEach(record => {
    const selected = groups.flatMap(group => group.orders).filter(order => record.orderIds.includes(order.id));
    const selectedFreight = waybills.flatMap(waybill => waybill.items).filter(item => record.orderIds.includes(-item.orderId));
    const total = selected.reduce((sum, order) => sum + order.receivableTwd, 0) + selectedFreight.reduce((sum, item) => sum + (item.receivableFreightTwd ?? 0), 0);
    selected.forEach(order => {
      const allocated = total > 0 ? record.amount * order.receivableTwd / total : 0;
      paidByOrder.set(order.id, (paidByOrder.get(order.id) ?? 0) + allocated);
    });
  });
  const allOrders = groups.flatMap(group => group.orders.map(order => {
    const paid = paidByOrder.get(order.id) ?? 0;
    const payment: PaymentStatus = order.receivableTwd <= 0 || settledProductOrderIds.has(order.id) || paid >= order.receivableTwd - 0.5 ? "已付款" : paid > 0 ? "部分付款" : "未付款";
    const lineArrival: ArrivalStatus = order.lines.every(line => line.arrival === "已到貨") ? "已到貨" : order.lines.some(line => line.arrival === "已到貨") ? "部分到貨" : "未到貨";
    const arrival: ArrivalStatus = ["已到貨", "出貨中", "部分出貨", "已出貨", "已完成"].includes(group.status) ? "已到貨" : group.status === "部分到貨" ? (lineArrival === "未到貨" ? "部分到貨" : lineArrival) : lineArrival;
    const parcel = parcels.find(item => item.orderIds.includes(order.id));
    const shipping: ShippingStatus = parcel ? (parcel.status === "待出貨" ? "待出貨" : "已出貨") : ["已出貨", "已完成"].includes(group.status) ? "已出貨" : ["已到貨", "出貨中", "部分出貨"].includes(group.status) ? "待出貨" : "待到貨";
    return { group, order, payment, arrival, shipping };
  }));
  const visibleOrders = allOrders.filter(({ group, order, payment, arrival, shipping }) =>
    (order.friend.toLowerCase().includes(query.toLowerCase()) || group.name.toLowerCase().includes(query.toLowerCase()) || order.code.toLowerCase().includes(query.toLowerCase())) &&
    (orderFriend === "全部朋友" || order.friend === orderFriend) && (orderGroup === "全部代購團" || group.name === orderGroup) &&
    (paymentFilter === "全部付款狀態" || payment === paymentFilter) && (arrivalFilter === "全部到貨狀態" || arrival === arrivalFilter) &&
    (shippingFilter === "全部出貨狀態" || shipping === shippingFilter)
  );
  const freightCharges = waybills.flatMap(waybill => waybill.items.flatMap(item => {
    const order = groups.find(group => group.id === item.groupId)?.orders.find(order => order.id === item.orderId);
    return order && (item.receivableFreightTwd ?? 0) > 0 ? [{ waybill, item, order }] : [];
  }));
  const occupiedWaybillOrderKeys = new Set(
    waybills
      .filter(waybill => waybill.id !== editingWaybillId)
      .flatMap(waybill => waybill.items.map(item => `${item.groupId}-${item.orderId}`))
  );
  const availableWaybillGroups = groups
    .map(group => ({ ...group, orders: group.orders.filter(order => !occupiedWaybillOrderKeys.has(`${group.id}-${order.id}`)) }))
    .filter(group => group.orders.length > 0);

  function showNotice(message: string) { setNotice(message); window.setTimeout(() => setNotice(""), 2600); }
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const username = String(form.get("username") || "").trim().toLowerCase();
    const password = String(form.get("password") || "");
    if (username !== "hannna") return setLoginError("帳號或密碼不正確，請再確認一次");
    try {
      setLoginError("");
      await signInWithEmailAndPassword(auth, `${username}@hannna-purchase.local`, password);
    } catch {
      setLoginError("帳號或密碼不正確，請再確認一次");
    }
  }
  async function logout() {
    await signOut(auth);
  }
  async function savePassword(password: string) {
    if (!auth.currentUser) return;
    try { await updatePassword(auth.currentUser, password); showNotice("登入密碼已更新"); }
    catch { showNotice("密碼更新失敗，請先重新登入後再試一次"); }
  }
  function openGroupModal() {
    setEditingGroup(false);
    setProductRows([{ id: Date.now(), name: "", unitPrice: "" }]);
    setGiftRows([{ id: Date.now() + 1, threshold: "", giftName: "", cumulative: true }]);
    setGroupModalOpen(true);
  }
  function openEditGroupModal() {
    if (!selectedGroup) return;
    setEditingGroup(true);
    setProductRows(selectedGroup.products.map(product => ({ ...product, unitPrice: String(product.unitPrice) })));
    setGiftRows(selectedGroup.giftRules.length ? selectedGroup.giftRules.map(rule => ({ ...rule, threshold: String(rule.threshold) })) : [{ id: Date.now(), threshold: "", giftName: "", cumulative: true }]);
    setGroupModalOpen(true);
  }
  function openOrderModal(orderId: number | null = null) {
    if (!selectedGroup) return;
    const order = orderId ? selectedGroup.orders.find(item => item.id === orderId) : null;
    setEditingOrderId(orderId);
    setOrderLines(Object.fromEntries(selectedGroup.products.map(product => [product.id, order?.lines.find(line => line.productId === product.id)?.quantity ?? 0])));
    setLineReceivables(Object.fromEntries(selectedGroup.products.map(product => [product.id, order?.lines.find(line => line.productId === product.id)?.receivableTwd ?? 0])));
    setLinePayers(Object.fromEntries(selectedGroup.products.map(product => [product.id, order?.lines.find(line => line.productId === product.id)?.productPayer ?? "我代墊・需收款"])));
    setTransferTargets({});
    setOrderModalOpen(true);
  }
  function addGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "未命名代購團");
    const currency = String(form.get("currency") || "KRW") as Currency;
    const products = productRows.filter(row => row.name.trim() && Number(row.unitPrice) >= 0).map(row => ({ id: row.id, name: row.name.trim(), unitPrice: Number(row.unitPrice) }));
    const giftRules = giftRows.filter(row => row.giftName.trim() && Number(row.threshold) > 0).map(row => ({ id: row.id, threshold: Number(row.threshold), giftName: row.giftName.trim(), cumulative: row.cumulative }));
    if (!products.length) return showNotice("請至少新增一個商品品項");
    if (editingGroup && selectedGroup) {
      const removedInUse = selectedGroup.products.some(product => !products.some(item => item.id === product.id) && selectedGroup.orders.some(order => order.lines.some(line => line.productId === product.id)));
      if (removedInUse) return showNotice("無法刪除已有訂單使用的商品品項");
      setGroups(current => current.map(group => group.id === selectedGroup.id ? { ...group, name, saleDate: formatDate(String(form.get("saleDate") || "")), currency, products, giftRules } : group));
      setGroupModalOpen(false); showNotice(`已儲存「${name}」的代購團設定`);
    } else {
      setGroups(current => [{ id: Date.now(), name, saleDate: formatDate(String(form.get("saleDate") || "")), currency, status: "待下單", products, giftRules, orders: [] }, ...current]);
      setGroupModalOpen(false); showNotice(`已新增「${name}」，共 ${products.length} 個品項`);
    }
  }
  function addOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedGroup) return;
    const form = new FormData(event.currentTarget);
    const lines = selectedGroup.products.map(product => ({ productId: product.id, quantity: orderLines[product.id] || 0, receivableTwd: linePayers[product.id] === "我代墊・需收款" ? (lineReceivables[product.id] || 0) : 0, productPayer: linePayers[product.id] ?? "我代墊・需收款", arrival: "未到貨" as const })).filter(line => line.quantity > 0);
    if (!lines.length) return showNotice("請至少選擇一個商品數量");
    const friend = String(form.get("friend") || "未指定");
    setGroups(current => current.map(group => group.id !== selectedGroup.id ? group : ({
      ...group, orders: editingOrderId ? applyOrderEditsAndTransfers(group, editingOrderId, friend, lines, transferTargets) : [...group.orders, { id: Date.now(), code: `${settings.orderPrefix || "ORDER"} ${String(group.orders.length + 1).padStart(2, "0")}`, friend, lines, receivableTwd: orderReceivable({ lines } as Order) }],
    })));
    setOrderModalOpen(false); if (activeNav === "訂單明細") setSelectedGroupId(null); showNotice(`${editingOrderId ? "已更新" : "已新增"} ${friend} 的訂單，總計 ${money(draftTotal, selectedGroup.currency)}`);
  }
  function applyOrderEditsAndTransfers(group: Group, sourceId: number, friend: string, lines: OrderLine[], targets: Record<number, string>) {
    const moving = lines.filter(line => targets[line.productId] && targets[line.productId] !== friend);
    let orders = group.orders.map(order => order.id === sourceId ? { ...order, friend, lines: lines.filter(line => !targets[line.productId] || targets[line.productId] === friend) } : order);
    moving.forEach((line, index) => {
      const targetFriend = targets[line.productId];
      const target = orders.find(order => order.id !== sourceId && order.friend === targetFriend);
      if (target) orders = orders.map(order => order.id !== target.id ? order : ({ ...order, lines: order.lines.some(item => item.productId === line.productId) ? order.lines.map(item => item.productId === line.productId ? { ...item, quantity: item.quantity + line.quantity, receivableTwd: item.receivableTwd + line.receivableTwd } : item) : [...order.lines, line] }));
      else orders.push({ id: Date.now() + index, code: `${settings.orderPrefix || "ORDER"} ${String(orders.length + 1).padStart(2, "0")}`, friend: targetFriend, lines: [line], receivableTwd: line.receivableTwd });
    });
    return orders.filter(order => order.id !== sourceId || order.lines.length > 0).map(order => ({ ...order, receivableTwd: orderReceivable(order) }));
  }
  function deleteOrder() {
    if (!selectedGroup || !editingOrderId) return;
    setGroups(current => current.map(group => group.id === selectedGroup.id ? { ...group, orders: group.orders.filter(order => order.id !== editingOrderId) } : group));
    setOrderModalOpen(false); if (activeNav === "訂單明細") setSelectedGroupId(null); showNotice("已刪除這筆個別訂單");
  }
  function updateGroupStatus(value: GroupStatus) {
    if (!selectedGroup) return;
    setGroups(current => current.map(group => group.id === selectedGroup.id ? { ...group, status: value } : group));
    showNotice(`代購團狀態已更新為「${value}」`);
  }
  function changeNav(label: string) { setActiveNav(label); setSelectedGroupId(null); setMobileNav(false); }
  function openOrderFromList(group: Group, order: Order) {
    setSelectedGroupId(group.id);
    setEditingOrderId(order.id);
    setOrderLines(Object.fromEntries(group.products.map(product => [product.id, order.lines.find(line => line.productId === product.id)?.quantity ?? 0])));
    setLineReceivables(Object.fromEntries(group.products.map(product => [product.id, order.lines.find(line => line.productId === product.id)?.receivableTwd ?? 0])));
    setLinePayers(Object.fromEntries(group.products.map(product => [product.id, order.lines.find(line => line.productId === product.id)?.productPayer ?? "我代墊・需收款"])));
    setOrderModalOpen(true);
  }
  function openFriendModal(friendId: number | null = null) { setEditingFriendId(friendId); setFriendModalOpen(true); }
  function openPaymentModal(friend = friendList[0]?.name ?? "") { setPaymentFriend(friend); setPaymentOrders([]); setPaymentModal("income"); }
  function saveFriend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const existing = friendList.find(friend => friend.id === editingFriendId);
    const nextName = String(form.get("friendName") || "未命名");
    const value: Friend = {
      id: editingFriendId ?? Date.now(),
      name: nextName,
      note: String(form.get("note") || ""),
      portalNote: String(form.get("portalNote") || ""),
      portalStatus: existing?.portalStatus ?? "尚未設定",
      lastLoginAt: existing?.lastLoginAt,
      previousNames: Array.from(new Set([
        ...(existing?.previousNames ?? []),
        ...(existing && existing.name !== nextName ? [existing.name] : []),
      ])),
    };
    const previousName = existing?.name;
    if (previousName && previousName !== value.name) {
      setGroups(current => current.map(group => ({
        ...group,
        orders: group.orders.map(order => order.friend === previousName ? { ...order, friend: value.name } : order),
      })));
      setPayments(current => current.map(record => record.friend === previousName ? { ...record, friend: value.name } : record));
      setParcels(current => current.map(parcel => parcel.friend === previousName ? { ...parcel, friend: value.name } : parcel));
      setWaybills(current => current.map(waybill => ({
        ...waybill,
        recipientFriend: waybill.recipientFriend === previousName ? value.name : waybill.recipientFriend,
        freightPayer: waybill.freightPayer === previousName ? value.name : waybill.freightPayer,
        freightFriend: waybill.freightFriend === previousName ? value.name : waybill.freightFriend,
      })));
      setOrderFriend(current => current === previousName ? value.name : current);
      setPaymentFriend(current => current === previousName ? value.name : current);
      setParcelFriend(current => current === previousName ? value.name : current);
    }
    setFriendList(current => editingFriendId ? current.map(friend => friend.id === editingFriendId ? value : friend) : [value, ...current]);
    setFriendModalOpen(false); showNotice(`${editingFriendId ? "已更新" : "已新增"}朋友「${value.name}」`);
  }
  async function manageFriendAccount(friendId: number, action: "password" | "suspend" | "resume", password?: string) {
    if (!friendAuthApi || !auth.currentUser) return showNotice("朋友登入驗證服務尚未設定，正式啟用前會完成串接");
    try {
      const token = await auth.currentUser.getIdToken();
      const response = await fetch(`${friendAuthApi}/admin/friends/${friendId}/${action}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(password ? { password } : {}) });
      if (!response.ok) throw new Error("request failed");
      const nextStatus: FriendPortalStatus = action === "suspend" ? "已停用" : "已設定";
      setFriendList(current => current.map(friend => friend.id === friendId ? { ...friend, portalStatus: nextStatus } : friend));
      showNotice(action === "password" ? "朋友密碼已重新設定" : action === "suspend" ? "已暫停朋友登入" : "已恢復朋友登入");
    } catch { showNotice("帳號設定失敗，請確認網路後再試一次"); }
  }
  function savePayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    if (!paymentOrders.length) return showNotice("請至少勾選一筆這次支付的訂單");
    setPayments(current => [{ id: Date.now(), friend: paymentFriend, amount: Number(form.get("amount")), date: formatDate(String(form.get("date"))), method: String(form.get("method")), note: String(form.get("note") || ""), orderIds: paymentOrders }, ...current]);
    setPaymentModal(null); showNotice("已新增一筆收款紀錄");
  }
  function saveExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    setExpenses(current => [{ id: Date.now(), category: String(form.get("category")), amount: Number(form.get("amount")), date: formatDate(String(form.get("date"))), group: String(form.get("group")), note: String(form.get("note") || "") }, ...current]);
    setPaymentModal(null); showNotice("已新增一筆支出紀錄");
  }
  function deleteFriend() {
    if (!editingFriendId) return;
    const target = friendList.find(friend => friend.id === editingFriendId);
    if (groups.some(group => group.orders.some(order => order.friend === target?.name))) return showNotice("這位朋友已有訂單，暫時無法刪除");
    setFriendList(current => current.filter(friend => friend.id !== editingFriendId)); setFriendModalOpen(false); showNotice("已刪除這位朋友");
  }
  function openParcelModal(friend = "", parcelId: number | null = null) {
    const parcel = parcelId ? parcels.find(item => item.id === parcelId) : null;
    setEditingParcelId(parcelId);
    setParcelFriend(parcel?.friend ?? friend);
    setParcelOrders(parcel?.orderIds ?? []);
    setParcelModalOpen(true);
  }
  function saveParcel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    if (!parcelOrders.length) return showNotice("請至少選擇一筆要放入包裹的訂單");
    const existing = editingParcelId ? parcels.find(item => item.id === editingParcelId) : null;
    const value: Parcel = { id: existing?.id ?? Date.now(), code: existing?.code ?? `SHIP-${String(parcels.length + 1).padStart(3,"0")}`, friend: parcelFriend, orderIds: parcelOrders, method: String(form.get("method")) as DeliveryMethod, shippingFee: Number(form.get("shippingFee") || 0), tracking: String(form.get("tracking") || ""), date: formatDate(String(form.get("date") || "")), note: String(form.get("note") || ""), status: String(form.get("status") || "待出貨") as ParcelStatus };
    setParcels(current => existing ? current.map(item => item.id === existing.id ? value : item) : [value, ...current]);
    setParcelModalOpen(false); setEditingParcelId(null);
    showNotice(existing ? `已儲存 ${parcelFriend} 的包裹變更` : `已建立 ${parcelFriend} 的出貨包裹`);
  }
  function openWaybillModal(waybillId: number | null = null) {
    const item = waybillId ? waybills.find(waybill => waybill.id === waybillId) : null;
    setEditingWaybillId(waybillId);
    setWaybillItems(item ? Object.fromEntries(item.items.map(ref => [`${ref.groupId}-${ref.orderId}`, { checked: true, weightG: ref.weightG, receivableFreightTwd: ref.receivableFreightTwd ?? 0 }])) : {});
    setWaybillDestination(item?.destination ?? "寄到我這裡");
    setWaybillModalOpen(true);
  }
  async function saveWaybill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const existing = editingWaybillId !== null ? waybills.find(item => item.id === editingWaybillId) : null;
    const items = Object.entries(waybillItems).filter(([,value]) => value.checked).map(([key,value]) => { const [groupId,orderId] = key.split("-").map(Number); return { groupId, orderId, weightG: value.weightG, receivableFreightTwd: value.receivableFreightTwd || 0 }; });
    if (!items.length) return showNotice("請至少選擇一份要運回的訂單");
    const rawAppliedDate = String(form.get("appliedDate") || "");
    const rawTotalWeightG = String(form.get("totalWeightG") || "");
    const rawFreightTwd = String(form.get("freightTwd") || "");
    if (!existing && !rawAppliedDate) return showNotice("請填寫申請運回日期");
    if (!existing && rawTotalWeightG === "") return showNotice("請填寫運單總重量");
    if (!existing && rawFreightTwd === "") return showNotice("請填寫本次國際運費");
    const status = String(form.get("status")) as Waybill["status"];
    const rawArrivedDate = String(form.get("arrivedDate") || "");
    const destination = waybillDestination;
    const appliedDate = rawAppliedDate
      ? formatDate(rawAppliedDate)
      : existing?.appliedDate || "未設定";
    const arrivedDate = status === "已到貨"
      ? formatDate(rawArrivedDate || dateInputValue(existing?.arrivedDate) || todayInputValue())
      : "";
    const value: Waybill = { id: existing?.id ?? Date.now(), code: existing?.code ?? `INTL-${String(waybills.length + 1).padStart(3,"0")}`, country: String(form.get("country")) as Waybill["country"], tracking: String(form.get("tracking")||""), items, totalWeightG: rawTotalWeightG === "" ? existing?.totalWeightG ?? 0 : Number(rawTotalWeightG), freightTwd: rawFreightTwd === "" ? existing?.freightTwd ?? 0 : Number(rawFreightTwd), destination, recipientFriend: destination === "直寄朋友" ? String(form.get("recipientFriend")||"") : "", status, appliedDate, arrivedDate, note: String(form.get("note")||"") };
    const effectiveWaybills = [...waybills.filter(item => item.id !== existing?.id), value];
    const nextWaybills = existing ? waybills.map(item => item.id === existing.id ? value : item) : [value,...waybills];
    const nextGroups = groups.map(group => { const orders=group.orders.map(order => { const refs=effectiveWaybills.filter(waybill=>waybill.items.some(item=>item.groupId===group.id&&item.orderId===order.id)); const arrived=refs.find(waybill=>waybill.status==="已到貨"); const moving=refs.find(waybill=>waybill.status==="已申請運回"); const active=arrived??moving; const lines=order.lines.map(line => active ? {...line, arrival: arrived ? "已到貨" as const : "運回中" as const, deliveryRoute: active.destination} : withoutUndefined({...line,arrival:undefined,deliveryRoute:undefined})); return withoutUndefined({...order, lines, arrival: arrived ? "已到貨" as const : "未到貨" as const}); }); const lines=orders.flatMap(order=>order.lines); const arrivedCount=lines.filter(line=>line.arrival==="已到貨").length; const movingCount=lines.filter(line=>line.arrival==="運回中").length; const groupStatus:GroupStatus=arrivedCount===lines.length&&lines.length?"已到貨":arrivedCount>0?"部分到貨":movingCount>0?"待到貨":group.status; return {...group,orders,status:groupStatus}; });
    try {
      await updateDoc(doc(db, "admin", "state"), {
        groups: withoutUndefined(nextGroups),
        waybills: withoutUndefined(nextWaybills),
        updatedAt: serverTimestamp(),
      });
      setGroups(nextGroups);
      setWaybills(nextWaybills);
      setWaybillModalOpen(false); setEditingWaybillId(null);
      showNotice(existing ? "已更新國際運單並儲存至雲端" : status === "已到貨" ? `已建立運單，並同步更新 ${items.length} 份訂單為已到貨` : "已建立國際運單並儲存至雲端");
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
      showNotice(code ? `運單儲存失敗（${code}），請稍後再試一次` : "運單儲存失敗，請稍後再試一次");
    }
  }

  if (!authChecked || (isAuthenticated && !dataLoaded)) return <main className="login-screen" />;
  if (!isAuthenticated) return <LoginPage onSubmit={login} error={loginError} />;
  return <main className="app-shell">
    <aside className={`sidebar ${mobileNav ? "mobile-open" : ""}`}>
      <div className="brand"><ShoppingBag size={24} /><span>{settings.siteName}</span></div>
      <button className="close-nav" onClick={() => setMobileNav(false)} aria-label="關閉選單"><X /></button>
      <nav>{navItems.map(([Icon, label]) => <button key={label} className={activeNav === label ? "active" : ""} onClick={() => changeNav(label)}><Icon size={21} strokeWidth={1.8} /><span>{label}</span></button>)}</nav>
      <div className="sidebar-note"><div className="avatar">{settings.adminName.slice(0,1).toUpperCase()}</div><div><strong>{settings.adminName}</strong><span>管理員</span></div></div>
    </aside>
    <section className="workspace">
      <header>
        <div className="header-greeting"><button className="menu-button" onClick={() => setMobileNav(true)} aria-label="開啟選單"><Menu /></button><div><h1>2026 年 7 月 22 日・星期三</h1></div></div>
        <div className="header-actions"><button className="logout-button" onClick={logout}><LogOut size={18} />登出</button>{activeNav === "朋友名單" ? <button className="primary-button" onClick={() => openFriendModal()}><Plus size={20} />新增朋友</button> : activeNav === "款項紀錄" ? <button className="primary-button" onClick={() => openPaymentModal()}><Plus size={20} />新增收款</button> : activeNav === "國際運單" ? <button className="primary-button" onClick={openWaybillModal}><Plus size={20} />建立運單</button> : activeNav === "出貨管理" ? <button className="primary-button" onClick={() => openParcelModal()}><Plus size={20} />建立包裹</button> : activeNav === "代購團" && <button className="primary-button" onClick={selectedGroup ? () => openOrderModal() : openGroupModal}><Plus size={20} />{selectedGroup ? "新增個別訂單" : "新增代購團"}</button>}</div>
      </header>
      <div className="content">
        {activeNav === "總覽" ? <DashboardPage groups={groups} orders={allOrders} payments={payments} parcels={parcels} onNavigate={changeNav} onOpenGroup={group => { setSelectedGroupId(group.id); setActiveNav("代購團"); }} /> : activeNav === "朋友名單" ? <FriendsPage friends={friendList} groups={groups} query={query} setQuery={setQuery} onAdd={() => openFriendModal()} onEdit={openFriendModal} /> : activeNav === "款項紀錄" ? <PaymentsPage friends={friendList} groups={groups} waybills={waybills} payments={payments} expenses={expenses} tab={paymentTab} setTab={setPaymentTab} onIncome={openPaymentModal} onExpense={() => setPaymentModal("expense")} /> : activeNav === "國際運單" ? <WaybillsPage waybills={waybills} groups={groups} onCreate={openWaybillModal} /> : activeNav === "出貨管理" ? <ShippingPage orders={allOrders.map(item=>({...item,order:{...item.order,lines:item.order.lines.filter(line=>line.deliveryRoute!=="直寄朋友")}})).filter(item=>item.order.lines.length>0)} parcels={parcels} tab={shippingTab} setTab={setShippingTab} onCreate={openParcelModal} onEdit={parcelId => openParcelModal("", parcelId)} /> : activeNav === "訂單明細" && !selectedGroup ? <OrdersPage orders={visibleOrders} groups={groups} query={query} setQuery={setQuery} filters={{orderFriend,orderGroup,paymentFilter,arrivalFilter,shippingFilter}} setters={{setOrderFriend,setOrderGroup,setPaymentFilter,setArrivalFilter,setShippingFilter}} onOpen={openOrderFromList} /> : selectedGroup ? <GroupDetail group={selectedGroup} onBack={() => { setSelectedGroupId(null); }} onAddOrder={() => openOrderModal()} onEditGroup={openEditGroupModal} onEditOrder={openOrderModal} onStatusChange={updateGroupStatus} /> : <>
          <div className="section-heading"><div><span className="eyebrow">PURCHASE GROUPS</span><h2>代購團</h2><p>先建立代購團與商品品項，再進入團內新增個別訂單</p></div><button className="mobile-add" onClick={openGroupModal}><Plus size={18} />新增</button></div>
          <section className="stats-grid">
            <StatCard icon={<UsersRound />} tone="ice" label="代購團" value={String(groups.length)} note="每團獨立管理訂單" />
            <StatCard icon={<ClipboardList />} tone="mint" label="個別訂單" value={String(totalOrders)} note="建立後自動加總" />
            <StatCard icon={<Box />} tone="amber" label="開團商品品項" value={String(totalProducts)} note="不包含下單數量" />
            <StatCard icon={<PackageCheck />} tone="lilac" label="已登記商品數量" value={String(totalPurchased)} note="依各訂單數量加總" />
          </section>
          <section className="groups-section">
            <div className="table-toolbar"><div><h3>目前代購團</h3><span>{visibleGroups.length} 個項目</span></div><div className="filters"><label className="search"><Search size={18} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜尋代購團" /></label><label className="select-wrap"><select value={status} onChange={e => setStatus(e.target.value)}><option>全部狀態</option>{groupStatuses.map(item => <option key={item}>{item}</option>)}</select><ChevronDown size={16} /></label></div></div>
            <div className="table-wrap"><table className="groups-table"><thead><tr><th>代購團名稱</th><th>開賣日</th><th>訂單數</th><th>商品品項</th><th>狀態</th><th /></tr></thead><tbody>
              {visibleGroups.map(group => <tr key={group.id} className="clickable-row" onClick={() => { setSelectedGroupId(group.id); setActiveNav("代購團"); }}><td><strong>{group.name}</strong><small>#{String(group.id).slice(-4)}</small></td><td>{group.saleDate}</td><td><strong>{group.orders.length}</strong><small>筆個別訂單</small></td><td><strong>{group.products.length}</strong><small>個開團品項</small></td><td><span className={`status ${statusClass[group.status]}`}>{group.status}</span></td><td><button className="open-detail" aria-label={`進入${group.name}`}><ChevronRight /></button></td></tr>)}
            </tbody></table>{visibleGroups.length === 0 && <div className="empty-state"><Search /><strong>找不到符合的代購團</strong><span>請調整搜尋文字或狀態篩選</span></div>}</div>
            <div className="table-footer">點選任一代購團，進入新增個別訂單</div>
          </section>
        </>}
        {activeNav === "設定" && <div className="settings-overlay"><SettingsPage groups={groups} friends={friendList} payments={payments} expenses={expenses} parcels={parcels} settings={settings} onSave={value => { setSettings(value); showNotice("設定已儲存"); }} onSavePassword={savePassword} onNotice={showNotice} /></div>}
      </div>
    </section>

    {groupModalOpen && <Modal onClose={() => setGroupModalOpen(false)} eyebrow={editingGroup ? "EDIT GROUP" : "NEW GROUP"} title={editingGroup ? "編輯代購團" : "新增代購團"} wide><form onSubmit={addGroup}>
      <div className="form-row three"><label>團名<input name="name" required placeholder="例如：ESON 8月周邊" autoFocus defaultValue={editingGroup ? selectedGroup?.name : ""} /></label><label>開賣日<input name="saleDate" type="date" required defaultValue={editingGroup ? selectedGroup?.saleDate.replaceAll("/", "-") : ""} /></label><label>商品幣別<select name="currency" required defaultValue={editingGroup ? selectedGroup?.currency : "KRW"}>{(Object.keys(currencyInfo) as Currency[]).map(code => <option key={code} value={code}>{currencyInfo[code].label}</option>)}</select></label></div>
      <div className="product-builder"><div className="builder-head"><div><strong>商品品項及單價</strong><span>可以新增多個開團品項</span></div><button type="button" className="secondary-add" onClick={() => setProductRows(rows => [...rows, { id: Date.now() + rows.length, name: "", unitPrice: "" }])}><Plus size={16} />新增品項</button></div>
        <div className="builder-labels"><span>商品品項</span><span>單價</span><span /></div>
        {productRows.map((row, index) => <div className="product-row" key={row.id}><input aria-label={`商品品項 ${index + 1}`} value={row.name} onChange={e => setProductRows(rows => rows.map(item => item.id === row.id ? { ...item, name: e.target.value } : item))} placeholder={`商品品項 ${index + 1}`} required /><input aria-label={`商品單價 ${index + 1}`} value={row.unitPrice} onChange={e => setProductRows(rows => rows.map(item => item.id === row.id ? { ...item, unitPrice: e.target.value } : item))} type="number" min="0" placeholder="0" required /><button type="button" aria-label="刪除品項" disabled={productRows.length === 1} onClick={() => setProductRows(rows => rows.filter(item => item.id !== row.id))}><Trash2 size={18} /></button></div>)}
      </div>
      <div className="gift-builder"><div className="builder-head"><div><strong>滿額贈品設定</strong><span>可新增多個門檻；沒有滿額贈時可留空</span></div><button type="button" className="secondary-add" onClick={() => setGiftRows(rows => [...rows, { id: Date.now() + rows.length, threshold: "", giftName: "", cumulative: true }])}><Plus size={16} />新增滿額贈品</button></div>
        <div className="gift-labels"><span>滿額門檻</span><span>贈品</span><span>計算方式</span><span /></div>
        {giftRows.map((row, index) => <div className="gift-row" key={row.id}><input aria-label={`滿額門檻 ${index + 1}`} value={row.threshold} onChange={e => setGiftRows(rows => rows.map(item => item.id === row.id ? { ...item, threshold: e.target.value } : item))} type="number" min="1" placeholder="金額" /><input aria-label={`滿額贈品 ${index + 1}`} value={row.giftName} onChange={e => setGiftRows(rows => rows.map(item => item.id === row.id ? { ...item, giftName: e.target.value } : item))} placeholder={`贈品 ${index + 1}`} /><select aria-label={`贈品計算方式 ${index + 1}`} value={row.cumulative ? "yes" : "no"} onChange={e => setGiftRows(rows => rows.map(item => item.id === row.id ? { ...item, cumulative: e.target.value === "yes" } : item))}><option value="yes">累贈</option><option value="no">不累贈</option></select><button type="button" aria-label="刪除滿額贈品" onClick={() => setGiftRows(rows => rows.length === 1 ? [{ ...rows[0], threshold: "", giftName: "" }] : rows.filter(item => item.id !== row.id))}><Trash2 size={18} /></button></div>)}
      </div>
      <p className="form-hint">幣別與開賣日會套用到整個代購團；累贈會依門檻倍數計算份數，不累贈最多取得 1 份。已有訂單使用的商品不能直接刪除。</p><ModalActions onCancel={() => setGroupModalOpen(false)} submit={editingGroup ? "儲存代購團設定" : "建立代購團"} />
    </form></Modal>}

    {orderModalOpen && selectedGroup && <Modal onClose={() => { setOrderModalOpen(false); if (activeNav === "訂單明細") setSelectedGroupId(null); }} eyebrow={editingOrderId ? selectedGroup.orders.find(order => order.id === editingOrderId)?.code ?? selectedGroup.name : selectedGroup.name} title={editingOrderId ? "查看與編輯訂單" : "新增個別訂單"} wide><form onSubmit={addOrder}>
      <label>這一單屬於誰<select name="friend" required autoFocus defaultValue={editingOrderId ? selectedGroup.orders.find(order => order.id === editingOrderId)?.friend : friendList[0]?.name}>{friendList.map(friend => <option key={friend.id}>{friend.name}</option>)}</select></label>
      <div className="inherited-info"><span>本團開賣日 <strong>{selectedGroup.saleDate}</strong></span><span>商品幣別 <strong>{currencyInfo[selectedGroup.currency].label}</strong></span></div>
      <div className={`order-picker ${editingOrderId ? "has-transfer" : ""}`}><div className="picker-head"><span>商品品項</span><span>單價</span><span>數量</span><span>商品款／應收</span>{editingOrderId && <span>讓單給</span>}</div>{selectedGroup.products.map(product => { const qty = orderLines[product.id] || 0; const owner = selectedGroup.orders.find(order => order.id === editingOrderId)?.friend; const payer=linePayers[product.id]??"我代墊・需收款"; return <div className="picker-row" key={product.id}><strong>{product.name}<small>{money(product.unitPrice * qty, selectedGroup.currency)}</small></strong><span>{money(product.unitPrice, selectedGroup.currency)}</span><input aria-label={`${product.name}數量`} type="number" min="0" value={qty} onChange={e => setOrderLines(lines => ({ ...lines, [product.id]: Math.max(0, Number(e.target.value)) }))} /><div className="payer-receivable"><select value={payer} disabled={!qty} onChange={e=>setLinePayers(current=>({...current,[product.id]:e.target.value as ProductPayer}))}><option>我代墊・需收款</option><option>朋友自行付清</option><option>我自行負擔</option></select><div className="line-receivable"><span>NT$</span><input aria-label={`${product.name}應收台幣`} type="number" min="0" value={payer === "我代墊・需收款" ? (lineReceivables[product.id] || "") : ""} disabled={!qty||payer!=="我代墊・需收款"} placeholder={payer==="我代墊・需收款"?"0":"不列入應收"} onChange={e => setLineReceivables(current => ({...current,[product.id]:Math.max(0,Number(e.target.value))}))}/></div></div>{editingOrderId && <div className="transfer-control"><select aria-label={`${product.name}讓單對象`} value={transferTargets[product.id] || ""} disabled={!qty} onChange={e => setTransferTargets(current => ({...current,[product.id]:e.target.value}))}><option value="">不讓單</option>{friendList.filter(friend => friend.name !== owner).map(friend => <option key={friend.id}>{friend.name}</option>)}</select></div>}</div>; })}</div>
      <div className="order-total"><span>這一單總金額</span><strong>{money(draftTotal, selectedGroup.currency)}</strong></div>
      <div className="receivable-input"><strong>商品款應收合計：NT${Object.entries(orderLines).reduce((sum,[id,qty])=>sum+(qty && (linePayers[Number(id)]??"我代墊・需收款")==="我代墊・需收款" ? (lineReceivables[Number(id)]||0) : 0),0).toLocaleString()}</strong><small>只有「我代墊・需收款」會加入款項紀錄；付款人選擇不會影響商品後續寄到哪裡。</small></div>
      {selectedGroup.giftRules.length > 0 && <div className="earned-gifts"><div><Gift size={18} /><strong>這一單可獲得的滿額贈品</strong></div>{earnedGifts(selectedGroup, draftTotal).length > 0 ? <ul>{earnedGifts(selectedGroup, draftTotal).map(gift => <li key={gift.id}><span>{gift.giftName}</span><b>× {gift.count}</b></li>)}</ul> : <p>目前尚未達到滿額贈品門檻</p>}</div>}
      <p className="form-hint">編輯時可先替多個品項選擇讓單對象；按下「儲存訂單變更」後，系統才會一次完成轉移，並將各品項的應收台幣一起轉給新購買人。</p><div className="edit-order-actions">{editingOrderId && <button type="button" className="danger-button" onClick={deleteOrder}><Trash2 size={16} />刪除這筆訂單</button>}<ModalActions onCancel={() => setOrderModalOpen(false)} submit={editingOrderId ? "儲存訂單變更" : "建立個別訂單"} /></div>
    </form></Modal>}
    {friendModalOpen && <Modal onClose={() => setFriendModalOpen(false)} eyebrow={editingFriendId ? "EDIT FRIEND" : "NEW FRIEND"} title={editingFriendId ? "編輯朋友資料" : "新增朋友"} wide><FriendForm friend={friendList.find(friend => friend.id === editingFriendId)} onSubmit={saveFriend} onCancel={() => setFriendModalOpen(false)} onDelete={editingFriendId ? deleteFriend : undefined} onAccountAction={editingFriendId ? (action, password) => manageFriendAccount(editingFriendId, action, password) : undefined} /></Modal>}
    {waybillModalOpen && <Modal onClose={()=>{setWaybillModalOpen(false);setEditingWaybillId(null);}} eyebrow="INTERNATIONAL WAYBILL" title={editingWaybillId ? "查看與編輯國際運單" : "建立國際運單"} wide><form onSubmit={saveWaybill} noValidate>
      <div className="form-row three"><label>出貨國家<select name="country" defaultValue={waybills.find(item=>item.id===editingWaybillId)?.country}><option>韓國</option><option>日本</option><option>其他</option></select></label><label>物流單號<input name="tracking" placeholder="可稍後補上" defaultValue={waybills.find(item=>item.id===editingWaybillId)?.tracking}/></label><label>運單狀態<select name="status" defaultValue={waybills.find(item=>item.id===editingWaybillId)?.status}><option>已申請運回</option><option>已到貨</option></select></label></div>
      <div className="waybill-picker"><div className="waybill-picker-head"><div><strong>選擇這次一起運回的個別訂單</strong><span>僅顯示尚未加入其他運單的訂單；應收運費留空即代表不向該朋友收款</span></div></div>{availableWaybillGroups.map(group=><div className="waybill-group" key={group.id}><h4>{group.name}<small>{currencyInfo[group.currency].label}</small></h4>{group.orders.map(order=>{const key=`${group.id}-${order.id}`;const value=waybillItems[key]??{checked:false,weightG:0,receivableFreightTwd:0};return <label className="waybill-line order-level" key={key}><input type="checkbox" checked={value.checked} onChange={e=>setWaybillItems(current=>({...current,[key]:{...value,checked:e.target.checked}}))}/><span><b>{order.code}・{order.friend}</b><small>{order.lines.map(line=>`${group.products.find(product=>product.id===line.productId)?.name} × ${line.quantity}`).join("、")}</small></span><em>訂單包裹重量<input aria-label={`${order.code}包裹重量`} type="number" min="0" value={value.weightG||""} placeholder="g" disabled={!value.checked} onChange={e=>setWaybillItems(current=>({...current,[key]:{...value,weightG:Number(e.target.value)}}))}/></em><em>該訂單的應收運費（NT$）<input aria-label={`${order.code}應收運費`} type="number" min="0" value={value.receivableFreightTwd||""} placeholder="不收款可留空" disabled={!value.checked} onChange={e=>setWaybillItems(current=>({...current,[key]:{...value,receivableFreightTwd:Number(e.target.value)}}))}/></em></label>})}</div>)}{availableWaybillGroups.length===0&&<div className="waybill-empty"><PackageCheck size={22}/><strong>目前沒有尚未運回的訂單</strong><span>已加入其他運單的訂單不會重複顯示</span></div>}</div>
      <div className="form-row"><label>運單總重量（g）<input name="totalWeightG" type="number" min="0" required defaultValue={waybills.find(item=>item.id===editingWaybillId)?.totalWeightG}/><small>由妳自行填寫，不會用上方重量強制加總</small></label><label>本次國際運費（NT$）<input name="freightTwd" type="number" min="0" required defaultValue={waybills.find(item=>item.id===editingWaybillId)?.freightTwd}/></label></div>
      <div className="split-rule-card"><strong>商品實際寄到哪裡？</strong><div className={`form-row ${waybillDestination==="直寄朋友"?"":"one"}`}><label>收貨目的地<select name="destination" value={waybillDestination} onChange={e=>setWaybillDestination(e.target.value as Waybill["destination"])}><option>寄到我這裡</option><option>直寄朋友</option></select></label>{waybillDestination==="直寄朋友"&&<label>直寄收貨朋友<select name="recipientFriend" required defaultValue={waybills.find(item=>item.id===editingWaybillId)?.recipientFriend}><option value="">請選擇朋友</option>{friendList.map(friend=><option key={friend.id}>{friend.name}</option>)}</select></label>}</div><small>直寄朋友的訂單到貨後會直接標示已交付，不會再進入出貨管理。</small></div>
      <div className="form-row"><label>申請運回日期<input name="appliedDate" type="date" defaultValue={dateInputValue(waybills.find(item=>item.id===editingWaybillId)?.appliedDate)}/></label><label>到貨日期<input name="arrivedDate" type="date" defaultValue={dateInputValue(waybills.find(item=>item.id===editingWaybillId)?.arrivedDate)}/></label></div><label>備註<input name="note" placeholder="例如：集運倉合箱、直寄小文" defaultValue={waybills.find(item=>item.id===editingWaybillId)?.note}/></label><ModalActions onCancel={()=>{setWaybillModalOpen(false);setEditingWaybillId(null);}} submit={editingWaybillId ? "儲存運單變更" : "建立國際運單"}/>
    </form></Modal>}
    {paymentModal === "income" && <Modal onClose={() => setPaymentModal(null)} eyebrow="NEW PAYMENT" title="新增收款紀錄" wide><form onSubmit={savePayment}><label>付款人<select required value={paymentFriend} onChange={e => { setPaymentFriend(e.target.value); setPaymentOrders([]); }}>{friendList.map(friend => <option key={friend.id}>{friend.name}</option>)}</select></label><div className="payment-order-picker"><strong>勾選這次支付的商品款或國際運費</strong>{groups.flatMap(group => group.orders.filter(order => order.friend === paymentFriend && !payments.some(record => record.orderIds.includes(order.id))).map(order => ({group,order}))).map(({group,order}) => <label key={order.id}><input type="checkbox" checked={paymentOrders.includes(order.id)} onChange={e => setPaymentOrders(current => e.target.checked ? [...current,order.id] : current.filter(id => id !== order.id))}/><span><b>商品款・{group.name}</b><small>{order.code}・應收 NT${order.receivableTwd.toLocaleString()}</small></span></label>)}{freightCharges.filter(charge=>charge.order.friend===paymentFriend && !payments.some(record=>record.orderIds.includes(-charge.order.id))).map(({waybill,item,order})=><label key={`freight-${waybill.id}-${order.id}`}><input type="checkbox" checked={paymentOrders.includes(-order.id)} onChange={e=>setPaymentOrders(current=>e.target.checked?[...current,-order.id]:current.filter(id=>id!==-order.id))}/><span><b>國際運費・{waybill.code}</b><small>{order.code}・應收 NT${(item.receivableFreightTwd??0).toLocaleString()}</small></span></label>)}</div><div className="selected-payment-total"><span>已勾選款項應收合計</span><strong>NT${(groups.flatMap(group=>group.orders).filter(order=>paymentOrders.includes(order.id)).reduce((sum,order)=>sum+order.receivableTwd,0)+freightCharges.filter(charge=>paymentOrders.includes(-charge.order.id)).reduce((sum,charge)=>sum+(charge.item.receivableFreightTwd??0),0)).toLocaleString()}</strong></div><div className="form-row"><label>本次實收金額（NT$）<input name="amount" type="number" min="0" required /></label><label>收款日期<input name="date" type="date" required /></label></div><label>付款方式<select name="method">{settings.paymentMethods.map(method=><option key={method}>{method}</option>)}</select></label><label>備註<input name="note" placeholder="例如：商品款與國際運費一起支付" /></label><ModalActions onCancel={() => setPaymentModal(null)} submit="儲存收款" /></form></Modal>}
    {paymentModal === "expense" && <Modal onClose={() => setPaymentModal(null)} eyebrow="NEW EXPENSE" title="新增支出紀錄"><form onSubmit={saveExpense}><div className="form-row"><label>支出類別<select name="category"><option>商品款</option><option>國際運費</option><option>關稅</option><option>包材</option><option>其他</option></select></label><label>金額（NT$）<input name="amount" type="number" min="1" required /></label></div><label>所屬代購團<select name="group"><option>不指定代購團</option>{groups.map(group => <option key={group.id}>{group.name}</option>)}</select></label><label>支出日期<input name="date" type="date" required /></label><label>備註<input name="note" /></label><ModalActions onCancel={() => setPaymentModal(null)} submit="儲存支出" /></form></Modal>}
    {parcelModalOpen && <Modal onClose={() => {setParcelModalOpen(false);setEditingParcelId(null);}} eyebrow={editingParcelId ? "EDIT PARCEL" : "NEW PARCEL"} title={editingParcelId ? "查看與編輯包裹" : "建立出貨包裹"} wide><form onSubmit={saveParcel}>
      <label>朋友<select required value={parcelFriend} onChange={e => { setParcelFriend(e.target.value); setParcelOrders([]); }}><option value="">請選擇朋友</option>{friendList.map(friend => <option key={friend.id}>{friend.name}</option>)}</select></label>
      <div className="parcel-order-picker"><strong>選擇要合併出貨的訂單</strong>{allOrders.filter(item => item.order.friend === parcelFriend && item.arrival === "已到貨" && (!parcels.some(parcel => parcel.id !== editingParcelId && parcel.orderIds.includes(item.order.id)))).map(({group,order}) => <label key={order.id}><input type="checkbox" checked={parcelOrders.includes(order.id)} onChange={e => setParcelOrders(current => e.target.checked ? [...current, order.id] : current.filter(id => id !== order.id))} /><span><b>{group.name}・{order.code}</b><small>{orderQuantity(order)} 件商品</small></span></label>)}{parcelFriend && !allOrders.some(item => item.order.friend === parcelFriend && item.arrival === "已到貨" && !parcels.some(parcel => parcel.id !== editingParcelId && parcel.orderIds.includes(item.order.id))) && <p>目前沒有可加入包裹的已到貨訂單</p>}</div>
      <div className="form-row"><label>寄送方式<select name="method" defaultValue={parcels.find(item=>item.id===editingParcelId)?.method}>{settings.deliveryMethods.map(method=><option key={method}>{method}</option>)}</select></label><label>包裹狀態<select name="status" defaultValue={parcels.find(item=>item.id===editingParcelId)?.status ?? "待出貨"}><option>待出貨</option><option>已出貨</option><option>已取貨</option></select></label></div><div className="form-row"><label>台灣運費（NT$）<input name="shippingFee" type="number" min="0" defaultValue={parcels.find(item=>item.id===editingParcelId)?.shippingFee ?? 0} /></label><label>預計出貨／面交日<input name="date" type="date" defaultValue={dateInputValue(parcels.find(item=>item.id===editingParcelId)?.date)} /></label></div><label>寄件編號<input name="tracking" placeholder="面交可留空" defaultValue={parcels.find(item=>item.id===editingParcelId)?.tracking}/></label><label>備註<input name="note" defaultValue={parcels.find(item=>item.id===editingParcelId)?.note ?? settings.defaultShippingNote} placeholder="例如：與下一團一起寄出" /></label><p className="form-hint">只有已到貨、尚未加入其他包裹的訂單會出現在清單中；同一位朋友可跨代購團合併出貨。</p><ModalActions onCancel={() => {setParcelModalOpen(false);setEditingParcelId(null);}} submit={editingParcelId ? "儲存包裹變更" : "建立包裹"} />
    </form></Modal>}
    {notice && <div className="toast"><PackageCheck size={19} />{notice}</div>}
  </main>;
}

function GroupDetail({ group, onBack, onAddOrder, onEditGroup, onEditOrder, onStatusChange }: { group: Group; onBack: () => void; onAddOrder: () => void; onEditGroup: () => void; onEditOrder: (id: number) => void; onStatusChange: (status: GroupStatus) => void }) {
  const purchased = group.orders.reduce((sum, order) => sum + orderQuantity(order), 0);
  return <>
    <button className="back-button" onClick={onBack}><ArrowLeft size={18} />返回代購團列表</button>
    <div className="detail-heading"><div><span className="eyebrow">PURCHASE GROUP</span><h2>{group.name}</h2><p>從既有商品中選擇品項，為不同朋友建立個別訂單</p></div><div className="detail-actions"><button className="secondary-add" onClick={onEditGroup}><Pencil size={16} />編輯代購團</button><button className="mobile-add detail-add" onClick={onAddOrder}><Plus size={18} />新增訂單</button></div></div>
    <section className="group-control-card compact"><div className="group-meta"><div className="meta-icon"><CalendarDays /></div><div><span>開賣日</span><strong>{group.saleDate}</strong></div></div><div className="group-meta"><div className="meta-icon"><CircleDollarSign /></div><div><span>商品幣別</span><strong>{currencyInfo[group.currency].label}</strong></div></div><label className="status-control"><span>代購團狀態</span><div className="status-select"><select value={group.status} onChange={e => onStatusChange(e.target.value as GroupStatus)}>{groupStatuses.map(item => <option key={item}>{item}</option>)}</select><ChevronDown size={16} /></div><small>狀態只在此操作介面更改</small></label></section>
    <section className="mini-stats"><article><span>個別訂單數</span><strong>{group.orders.length}</strong><small>每位朋友分開記錄</small></article><article><span>開團品項數</span><strong>{group.products.length}</strong><small>以商品清單計算</small></article><article><span>已登記商品數</span><strong>{purchased}</strong><small>依訂單數量加總</small></article></section>
    <section className="catalog-card"><div className="table-toolbar"><div><h3>本團商品品項</h3><span>新增訂單時會直接讀取這份清單</span></div></div><div className="catalog-grid">{group.products.map(product => <div key={product.id}><span>{product.name}</span><strong>{money(product.unitPrice, group.currency)}</strong></div>)}</div></section>
    <section className="gift-rules-card"><div className="table-toolbar"><div><h3>本團滿額贈品</h3><span>{group.giftRules.length ? `共 ${group.giftRules.length} 個滿額門檻` : "這一團沒有設定滿額贈品"}</span></div><Gift size={21} /></div>{group.giftRules.length > 0 && <div className="gift-rule-list">{group.giftRules.map(rule => <div key={rule.id}><span>滿 {money(rule.threshold, group.currency)}</span><strong>{rule.giftName}</strong><em>{rule.cumulative ? "累贈" : "不累贈"}</em></div>)}</div>}</section>
    <section className="groups-section orders-section"><div className="table-toolbar"><div><h3>團內個別訂單</h3><span>目前共 {group.orders.length} 筆</span></div><button className="secondary-add" onClick={onAddOrder}><Plus size={17} />新增個別訂單</button></div><div className="order-grid">{group.orders.map(order => { const total = orderTotal(group, order); const gifts = earnedGifts(group, total); return <article className="order-card" key={order.id}><div className="order-card-head"><div><span>{order.code}</span><h3>{order.friend}</h3></div><span className="currency-badge">{group.currency}</span></div><dl><div><dt>商品總額</dt><dd>{money(total, group.currency)}</dd></div><div><dt>應收台幣</dt><dd className="money-value">NT${order.receivableTwd.toLocaleString()}</dd></div><div className="order-products"><dt>商品明細</dt><dd>{order.lines.map(line => `${group.products.find(product => product.id === line.productId)?.name ?? "商品"} × ${line.quantity}`).join("、")}</dd></div>{gifts.length > 0 && <div className="order-products order-gifts"><dt>滿額贈品</dt><dd>{gifts.map(gift => `${gift.giftName} × ${gift.count}`).join("、")}</dd></div>}</dl><button className="order-action" onClick={() => onEditOrder(order.id)}>查看與編輯訂單 <ChevronRight size={17} /></button></article>; })}{group.orders.length === 0 && <div className="empty-state order-empty"><ClipboardList /><strong>這個團還沒有個別訂單</strong><span>建立第一筆訂單後，總表的訂單數會自動更新</span><button className="primary-button" onClick={onAddOrder}><Plus size={17} />新增第一筆訂單</button></div>}</div></section>
  </>;
}

type OrderView = { group: Group; order: Order; payment: PaymentStatus; arrival: ArrivalStatus; shipping: ShippingStatus };
function DashboardPage({ groups, orders, payments, parcels, onNavigate, onOpenGroup }: { groups: Group[]; orders: OrderView[]; payments: PaymentRecord[]; parcels: Parcel[]; onNavigate: (page: string) => void; onOpenGroup: (group: Group) => void }) {
  const activeGroups = groups.filter(group => group.status !== "已完成");
  const unpaid = orders.filter(item => item.payment !== "已付款");
  const waiting = orders.filter(item => item.arrival !== "已到貨");
  const shippedIds = new Set(parcels.flatMap(parcel => parcel.orderIds));
  const ready = orders.filter(item => item.arrival === "已到貨" && !shippedIds.has(item.order.id));
  const readyFriends = new Set(ready.map(item => item.order.friend));
  const recentGroups = [...groups].sort((a,b) => b.saleDate.localeCompare(a.saleDate)).slice(0,3);
  const tasks = [
    { icon: <CircleDollarSign/>, tone: "amber", title: `${unpaid.length} 筆訂單尚未付清`, text: "前往款項紀錄確認應收、已收與尚欠金額", page: "款項紀錄" },
    { icon: <Box/>, tone: "lilac", title: `${waiting.length} 筆訂單尚未全數到貨`, text: "查看各筆訂單目前的到貨進度", page: "訂單明細" },
    { icon: <Truck/>, tone: "mint", title: `${readyFriends.size} 位朋友可安排出貨`, text: `${ready.length} 筆已到貨訂單可合併建立包裹`, page: "出貨管理" },
  ];
  return <>
    <div className="section-heading dashboard-heading"><div><span className="eyebrow">OVERVIEW</span><h2>總覽</h2><p>快速掌握目前的代購進度與接下來要處理的事情</p></div><span className="today-chip"><CalendarDays size={16}/>2026 / 07 / 21</span></div>
    <section className="stats-grid dashboard-stats">
      <StatCard icon={<UsersRound/>} tone="ice" label="進行中代購團" value={String(activeGroups.length)} note={`全部共 ${groups.length} 團`} />
      <StatCard icon={<CircleDollarSign/>} tone="amber" label="尚未付清訂單" value={String(unpaid.length)} note={`${payments.length} 筆收款已登記`} />
      <StatCard icon={<Box/>} tone="lilac" label="尚未全數到貨" value={String(waiting.length)} note="包含未到貨與部分到貨" />
      <StatCard icon={<Truck/>} tone="mint" label="可安排出貨" value={String(readyFriends.size)} note={`${ready.length} 筆訂單商品已到齊`} />
    </section>
    <div className="dashboard-grid">
      <section className="groups-section dashboard-panel"><div className="dashboard-panel-head"><div><span className="eyebrow">TO DO</span><h3>待辦提醒</h3></div><span>{tasks.length} 個重點</span></div><div className="task-list">{tasks.map(item => <button key={item.page} onClick={() => onNavigate(item.page)}><span className={`task-icon ${item.tone}`}>{item.icon}</span><span><strong>{item.title}</strong><small>{item.text}</small></span><ChevronRight size={18}/></button>)}</div></section>
      <section className="groups-section dashboard-panel"><div className="dashboard-panel-head"><div><span className="eyebrow">QUICK ACCESS</span><h3>快速前往</h3></div></div><div className="quick-grid"><button onClick={() => onNavigate("代購團")}><UsersRound/><span><strong>代購團</strong><small>建立與管理團內訂單</small></span></button><button onClick={() => onNavigate("訂單明細")}><ClipboardList/><span><strong>訂單明細</strong><small>跨團查詢所有訂單</small></span></button><button onClick={() => onNavigate("款項紀錄")}><CircleDollarSign/><span><strong>款項紀錄</strong><small>確認收款與支出</small></span></button><button onClick={() => onNavigate("出貨管理")}><Truck/><span><strong>出貨管理</strong><small>整理合併包裹</small></span></button></div></section>
    </div>
    <section className="groups-section dashboard-recent"><div className="dashboard-panel-head"><div><span className="eyebrow">RECENT GROUPS</span><h3>最近的代購團</h3></div><button onClick={() => onNavigate("代購團")}>查看全部 <ChevronRight size={16}/></button></div><div className="recent-group-list">{recentGroups.map(group => <button key={group.id} onClick={() => onOpenGroup(group)}><span className={`recent-group-icon ${statusClass[group.status]}`}><ShoppingBag size={19}/></span><span className="recent-group-name"><strong>{group.name}</strong><small>{group.saleDate}・{currencyInfo[group.currency].label}</small></span><span><strong>{group.orders.length}</strong><small>筆訂單</small></span><span><strong>{group.products.length}</strong><small>個品項</small></span><OrderState value={group.status}/><ChevronRight size={18}/></button>)}</div></section>
  </>;
}
function FriendsPage({ friends, groups, query, setQuery, onAdd, onEdit }: { friends: Friend[]; groups: Group[]; query: string; setQuery: (value: string) => void; onAdd: () => void; onEdit: (id: number) => void }) {
  const visible = friends.filter(friend => [friend.name, friend.note, friend.portalNote ?? ""].some(value => value.toLowerCase().includes(query.toLowerCase())));
  const details = friends.map(friend => {
    const orders = groups.flatMap(group => group.orders.map(order => ({ group, order }))).filter(item => item.order.friend === friend.name);
    return { friend, orders, groups: new Set(orders.map(item => item.group.id)).size };
  });
  const withOrders = details.filter(item => item.orders.length > 0).length;
  const waiting = details.filter(item => item.orders.some(({ order }) => (order.shipping ?? "待到貨") !== "已出貨")).length;
  return <>
    <div className="section-heading"><div><span className="eyebrow">FRIENDS</span><h2>朋友名單</h2><p>建立常跟團的朋友名稱，新增訂單時即可直接選取</p></div><button className="mobile-add" onClick={onAdd}><Plus size={18} />新增</button></div>
    <section className="stats-grid friends-stats">
      <StatCard icon={<UserRound />} tone="ice" label="朋友總數" value={String(friends.length)} note="新增訂單時可直接選取" />
      <StatCard icon={<ShoppingBag />} tone="mint" label="目前有訂單" value={String(withOrders)} note="至少參加一個代購團" />
      <StatCard icon={<PackageCheck />} tone="amber" label="尚有商品待處理" value={String(waiting)} note="包含待到貨與待出貨" />
      <StatCard icon={<CircleDollarSign />} tone="lilac" label="有未結款訂單" value={String(details.filter(item => item.orders.length > 0).length)} note="款項於款項紀錄管理" />
    </section>
    <section className="groups-section friends-section">
      <div className="orders-toolbar"><div><h3>全部朋友</h3><span>目前顯示 {visible.length} 位</span></div><label className="search order-search"><Search size={18} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜尋朋友名稱或備註" /></label></div>
      <div className="friend-grid">{visible.map(friend => { const item = details.find(detail => detail.friend.id === friend.id)!; const portalStatus=friend.portalStatus??"尚未設定"; return <article className="friend-card" key={friend.id} onClick={() => onEdit(friend.id)}><div className="friend-card-head"><div className="friend-avatar">{friend.name.slice(0,1).toUpperCase()}</div><div><h3>{friend.name}</h3><span>{friend.note || "尚未新增備註"}</span></div><button aria-label={`編輯${friend.name}`}><Pencil size={17} /></button></div><div className="friend-portal-state"><span className={`portal-badge ${portalStatus==="已設定"?"ready":portalStatus==="已停用"?"disabled":"new"}`}>{portalStatus}</span><small>{friend.lastLoginAt ? `最後登入 ${friend.lastLoginAt}` : "尚無登入紀錄"}</small></div><div className="friend-summary simple"><div><span>參加代購團</span><strong>{item.groups}</strong></div><div><span>個別訂單</span><strong>{item.orders.length}</strong></div></div>{friend.portalNote && <dl><div><dt>給朋友看的備註</dt><dd>{friend.portalNote}</dd></div></dl>}<div className="friend-action">查看與管理朋友帳號 <ChevronRight size={17} /></div></article>; })}</div>
      {visible.length === 0 && <div className="empty-state"><Search /><strong>找不到符合條件的朋友</strong><span>請調整搜尋文字或新增朋友</span></div>}
    </section>
  </>;
}
function FriendForm({ friend, onSubmit, onCancel, onDelete, onAccountAction }: { friend?: Friend; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onCancel: () => void; onDelete?: () => void; onAccountAction?: (action: "password" | "suspend" | "resume", password?: string) => void }) {
  const [password, setPassword] = useState("");
  const portalStatus=friend?.portalStatus??"尚未設定";
  return <form onSubmit={onSubmit}><div className="form-row"><label>姓名／暱稱<input name="friendName" required autoFocus defaultValue={friend?.name} placeholder="訂單中顯示的名稱" /></label><label>朋友端狀態<input value={portalStatus} readOnly /></label></div><label>後台私人備註<input name="note" defaultValue={friend?.note} placeholder="只有妳自己會看到" /></label><label>給朋友看的備註<textarea name="portalNote" defaultValue={friend?.portalNote} placeholder="例如：這批商品預計下週抵台" /></label>{friend && <section className="friend-account-box"><div><strong>朋友登入設定</strong><span>{friend.lastLoginAt ? `最後登入：${friend.lastLoginAt}` : "目前尚無登入紀錄"}</span></div><label>設定／重設密碼<input type="text" value={password} minLength={4} onChange={event=>setPassword(event.target.value)} placeholder="至少 4 個字元，例如 0000 或 abcd" /></label><div className="friend-account-actions"><button type="button" className="secondary-button" disabled={password.length<4} onClick={()=>{onAccountAction?.("password",password);setPassword("");}}>儲存新密碼</button><button type="button" className={portalStatus==="已停用"?"secondary-button":"danger-button"} onClick={()=>onAccountAction?.(portalStatus==="已停用"?"resume":"suspend")}>{portalStatus==="已停用"?"恢復登入":"暫停登入"}</button></div><small>密碼不會寫入後台資料；妳可以重設，但無法查看朋友原本的密碼。</small></section>}<p className="form-hint">聯絡方式與收件資料不會保存在朋友名單。朋友端只會同步自己的訂單、款項、貨態與上方公開備註。</p><div className="edit-order-actions">{onDelete && <button type="button" className="danger-button" onClick={onDelete}><Trash2 size={16} />刪除朋友</button>}<ModalActions onCancel={onCancel} submit={friend ? "儲存朋友資料" : "新增朋友"} /></div></form>;
}

function PaymentsPage({ friends, groups, waybills, payments, expenses, tab, setTab, onIncome, onExpense }: { friends: Friend[]; groups: Group[]; waybills: Waybill[]; payments: PaymentRecord[]; expenses: ExpenseRecord[]; tab: "應收款項" | "收款紀錄" | "支出紀錄"; setTab: (tab: "應收款項" | "收款紀錄" | "支出紀錄") => void; onIncome: (friend?: string) => void; onExpense: () => void }) {
  const freightCharges = waybills.flatMap(waybill => waybill.items.flatMap(item => { const order=groups.find(group=>group.id===item.groupId)?.orders.find(order=>order.id===item.orderId); return order&&(item.receivableFreightTwd??0)>0?[{waybill,item,order}]:[]; }));
  const isSettled = (id: number) => payments.some(record => record.orderIds.includes(id));
  const receivables = friends.map(friend => { const orders = groups.flatMap(group => group.orders.filter(order => order.friend === friend.name && !isSettled(order.id)).map(order => ({group,order}))); const freight=freightCharges.filter(charge=>charge.order.friend===friend.name&&!isSettled(-charge.order.id)); const due = orders.reduce((sum,{order}) => sum + order.receivableTwd, 0)+freight.reduce((sum,charge)=>sum+(charge.item.receivableFreightTwd??0),0); return { friend, orders, freight, due }; }).filter(item => item.orders.length > 0||item.freight.length>0);
  const totalDue = receivables.reduce((sum,item) => sum + item.due,0); const totalPaid = payments.reduce((sum,item) => sum + item.amount,0); const totalExpense = expenses.reduce((sum,item) => sum + item.amount,0);
  return <><div className="section-heading"><div><span className="eyebrow">PAYMENTS</span><h2>款項紀錄</h2><p>分開管理朋友應付金額、實際收款與代購支出</p></div><button className="mobile-add" onClick={() => onIncome()}><Plus size={18}/>新增收款</button></div>
    <section className="stats-grid payment-stats"><StatCard icon={<ClipboardList/>} tone="ice" label="待收總額" value={`NT$${totalDue.toLocaleString()}`} note="尚未核銷的商品款與國際運費"/><StatCard icon={<CircleDollarSign/>} tone="mint" label="已收款" value={`NT$${totalPaid.toLocaleString()}`} note={`${payments.length} 筆實際收款`}/><StatCard icon={<Bell/>} tone="amber" label="尚未收款" value={`NT$${totalDue.toLocaleString()}`} note={`${receivables.length} 位朋友待結清`}/><StatCard icon={<ShoppingBag/>} tone="lilac" label="已記錄支出" value={`NT$${totalExpense.toLocaleString()}`} note={`${expenses.length} 筆支出紀錄`}/></section>
    <section className="groups-section payments-section"><div className="payment-tabs">{(["應收款項","收款紀錄","支出紀錄"] as const).map(item=><button key={item} className={tab===item?"active":""} onClick={()=>setTab(item)}>{item}</button>)}</div>
      <div className="payment-panel-head"><div><h3>{tab}</h3><span>{tab==="應收款項"?"查看每位朋友目前的結款進度":tab==="收款紀錄"?"保留每一次實際收到款項的日期與方式":"記錄商品款、國際運費、關稅與其他支出"}</span></div><button className="secondary-add" onClick={() => tab==="支出紀錄" ? onExpense() : onIncome()}><Plus size={16}/>{tab==="支出紀錄"?"新增支出":"新增收款"}</button></div>
      {tab==="應收款項" ? <div className="receivable-grid">{receivables.map(item=><article key={item.friend.id}><div className="receivable-head"><div className="friend-avatar">{item.friend.name.slice(0,1)}</div><div><h3>{item.friend.name}</h3><span>{item.orders.length} 筆商品款・{item.freight.length} 筆國際運費</span></div><OrderState value="未付款"/></div><div className="receivable-orders grouped">{item.orders.map(({group,order})=>{const orderFreight=item.freight.filter(charge=>charge.order.id===order.id);return <section className="receivable-order-group" key={`${group.id}-${order.id}`}><div className="receivable-order-head"><span><b>{order.code}</b><small>{group.name}</small></span><strong>尚待收款　NT${order.receivableTwd.toLocaleString()}</strong></div><div className="receivable-order-line"><span><b>商品款</b><small>{group.name}</small></span><strong>NT${order.receivableTwd.toLocaleString()}</strong></div>{orderFreight.map(({waybill,item:fee})=><div className="receivable-order-line" key={`freight-${waybill.id}-${order.id}`}><span><b>國際運費</b><small>{waybill.code}・{waybill.country}</small></span><strong>NT${(fee.receivableFreightTwd??0).toLocaleString()}</strong></div>)}</section>})}{item.freight.filter(charge=>!item.orders.some(({order})=>order.id===charge.order.id)).map(({waybill,item:fee,order})=><section className="receivable-order-group" key={`freight-only-${waybill.id}-${order.id}`}><div className="receivable-order-line"><span><b>國際運費</b><small>{order.code}・{waybill.code}</small></span><strong>NT${(fee.receivableFreightTwd??0).toLocaleString()}</strong></div></section>)}</div><div className="amount-row"><span>尚待收款<strong className="unpaid">NT${item.due.toLocaleString()}</strong></span></div><button onClick={()=>onIncome(item.friend.name)}>新增這位朋友的收款 <ChevronRight size={16}/></button></article>)}</div> : <div className="table-wrap"><table className="payment-table"><thead><tr>{tab==="收款紀錄"?<><th>收款日期</th><th>付款人</th><th>支付款項</th><th>付款方式／備註</th><th>收款金額</th></>:<><th>支出日期</th><th>類別</th><th>所屬代購團</th><th>備註</th><th>支出金額</th></>}</tr></thead><tbody>{tab==="收款紀錄"?payments.map(record=><tr key={record.id}><td>{record.date}</td><td><strong>{record.friend}</strong></td><td>{[...groups.flatMap(group=>group.orders.filter(order=>record.orderIds.includes(order.id)).map(()=>`商品款・${group.name}`)),...freightCharges.filter(charge=>record.orderIds.includes(-charge.order.id)).map(charge=>`國際運費・${charge.waybill.code}・${charge.order.code}`)].join("、")||"—"}</td><td>{record.method}{record.note?`・${record.note}`:""}</td><td><strong className="income-money">+ NT${record.amount.toLocaleString()}</strong></td></tr>):expenses.map(record=><tr key={record.id}><td>{record.date}</td><td><span className="expense-category">{record.category}</span></td><td>{record.group}</td><td>{record.note||"—"}</td><td><strong className="expense-money">− NT${record.amount.toLocaleString()}</strong></td></tr>)}</tbody></table></div>}
      <div className="table-footer">應收金額來自各訂單的商品款與應收運費；未填寫應收運費的訂單不會列入</div></section></>;
}
function WaybillsPage({waybills,groups,onCreate}:{waybills:Waybill[];groups:Group[];onCreate:(waybillId?:number|null)=>void}) {
  const moving=waybills.filter(item=>item.status==="已申請運回"), arrived=waybills.filter(item=>item.status==="已到貨");
  const receivable=waybills.reduce((sum,waybill)=>sum+waybill.items.reduce((itemSum,item)=>itemSum+(item.receivableFreightTwd??0),0),0);
  return <><div className="section-heading"><div><span className="eyebrow">INTERNATIONAL WAYBILLS</span><h2>國際運單</h2><p>管理韓國／日本集運回台灣的合併運單、重量、運費與實際收貨地</p></div><button className="mobile-add" onClick={onCreate}><Plus size={18}/>建立運單</button></div>
    <section className="stats-grid"><StatCard icon={<Globe2/>} tone="ice" label="國際運單" value={String(waybills.length)} note="可跨代購團合併"/><StatCard icon={<Truck/>} tone="amber" label="運回中" value={String(moving.length)} note="已申請、尚未抵達"/><StatCard icon={<PackageCheck/>} tone="mint" label="已到貨" value={String(arrived.length)} note="同步更新訂單貨態"/><StatCard icon={<CircleDollarSign/>} tone="lilac" label="運費待收" value={`NT$${receivable.toLocaleString()}`} note="依各訂單應收運費加總"/></section>
    <section className="groups-section waybill-section"><div className="payment-panel-head"><div><h3>運單紀錄</h3><span>整包實付運費與各訂單應收運費分開記錄</span></div><button className="secondary-add" onClick={()=>onCreate()}><Plus size={16}/>建立運單</button></div><div className="waybill-grid">{waybills.map(item=>{const names=Array.from(new Set(item.items.map(ref=>groups.find(group=>group.id===ref.groupId)?.name).filter(Boolean)));const itemReceivable=item.items.reduce((sum,ref)=>sum+(ref.receivableFreightTwd??0),0);return <article key={item.id}><div className="parcel-head"><div><span>{item.code}・{item.country}</span><h3>{item.tracking||"尚未填物流單號"}</h3></div><OrderState value={item.status}/></div><div className="waybill-route"><span>{item.destination}</span>{item.recipientFriend&&<b>收貨：{item.recipientFriend}</b>}</div><ul><li><span>包含內容</span><strong>{names.join("、")}・{item.items.length} 份訂單</strong></li><li><span>申報總重量</span><strong>{item.totalWeightG.toLocaleString()} g</strong></li><li><span>本次國際運費</span><strong>NT${item.freightTwd.toLocaleString()}</strong></li><li><span>訂單應收運費合計</span><strong className={itemReceivable?"income-money":""}>NT${itemReceivable.toLocaleString()}</strong></li></ul><button onClick={()=>onCreate(item.id)}>查看與編輯運單 <ChevronRight size={16}/></button></article>})}</div><div className="table-footer">運單到貨會更新所選個別訂單；只有填寫應收運費的訂單會進入款項紀錄</div></section></>;
}
function ShippingPage({ orders, parcels, tab, setTab, onCreate, onEdit }: { orders: OrderView[]; parcels: Parcel[]; tab: "待到齊" | "可出貨" | "包裹紀錄"; setTab: (tab: "待到齊" | "可出貨" | "包裹紀錄") => void; onCreate: (friend?: string) => void; onEdit: (parcelId: number) => void }) {
  const shippedIds = new Set(parcels.flatMap(parcel => parcel.orderIds));
  const waiting = orders.filter(item => item.arrival !== "已到貨" && !shippedIds.has(item.order.id));
  const ready = orders.filter(item => item.arrival === "已到貨" && !shippedIds.has(item.order.id));
  const readyFriends = Array.from(new Set(ready.map(item => item.order.friend)));
  return <><div className="section-heading"><div><span className="eyebrow">SHIPPING</span><h2>出貨管理</h2><p>依朋友整理已到貨商品，跨代購團合併成實際出貨包裹</p></div><button className="mobile-add" onClick={() => onCreate()}><Plus size={18}/>建立包裹</button></div>
    <section className="stats-grid shipping-stats"><StatCard icon={<Box/>} tone="amber" label="尚未到齊" value={String(waiting.length)} note="等待商品抵達的訂單"/><StatCard icon={<PackageCheck/>} tone="mint" label="可安排出貨" value={String(readyFriends.length)} note={`${ready.length} 筆已到貨訂單`}/><StatCard icon={<ShoppingBag/>} tone="ice" label="已建立包裹" value={String(parcels.length)} note="包含待出貨與已出貨"/><StatCard icon={<Truck/>} tone="lilac" label="已完成寄出" value={String(parcels.filter(parcel => parcel.status !== "待出貨").length)} note="已出貨或已取貨"/></section>
    <section className="groups-section shipping-section"><div className="payment-tabs">{(["待到齊","可出貨","包裹紀錄"] as const).map(item => <button key={item} className={tab===item?"active":""} onClick={() => setTab(item)}>{item}</button>)}</div><div className="payment-panel-head"><div><h3>{tab}</h3><span>{tab==="待到齊"?"查看還有哪些訂單正在等待商品到貨":tab==="可出貨"?"依朋友合併不同代購團的已到貨商品":"追蹤已建立的面交或賣貨便包裹"}</span></div>{tab==="可出貨"&&<button className="secondary-add" onClick={() => onCreate()}><Plus size={16}/>建立包裹</button>}</div>
      {tab==="可出貨" ? <div className="ship-friend-grid">{readyFriends.map(friend => { const items=ready.filter(item=>item.order.friend===friend); return <article key={friend}><div className="ship-card-head"><div className="friend-avatar">{friend.slice(0,1)}</div><div><h3>{friend}</h3><span>{items.length} 筆訂單・{items.reduce((sum,item)=>sum+orderQuantity(item.order),0)} 件商品</span></div><OrderState value="待出貨"/></div><ul>{items.map(({group,order})=><li key={order.id}><span><b>{group.name}</b><small>{order.lines.map(line=>`${group.products.find(p=>p.id===line.productId)?.name} × ${line.quantity}`).join("、")}</small></span><em>{order.code}</em></li>)}</ul><button onClick={()=>onCreate(friend)}>選擇商品並建立包裹 <ChevronRight size={16}/></button></article>; })}</div> : tab==="待到齊" ? <div className="table-wrap"><table className="payment-table shipping-table"><thead><tr><th>朋友</th><th>代購團／訂單</th><th>商品</th><th>到貨狀態</th></tr></thead><tbody>{waiting.map(({group,order,arrival})=><tr key={order.id}><td><strong>{order.friend}</strong></td><td>{group.name}<small>{order.code}</small></td><td>{orderQuantity(order)} 件</td><td><OrderState value={arrival}/></td></tr>)}</tbody></table></div> : <div className="parcel-grid">{parcels.map(parcel=><article key={parcel.id}><div className="parcel-head"><div><span>{parcel.code}</span><h3>{parcel.friend}</h3></div><OrderState value={parcel.status}/></div><dl><div><dt>交付方式</dt><dd>{parcel.method}</dd></div><div><dt>包裹內容</dt><dd>{parcel.orderIds.length} 筆訂單</dd></div><div><dt>台灣運費</dt><dd>NT${parcel.shippingFee.toLocaleString()}</dd></div><div><dt>寄件／面交日</dt><dd>{parcel.date}</dd></div></dl>{parcel.tracking&&<p>寄件編號　<strong>{parcel.tracking}</strong></p>}<button onClick={()=>onEdit(parcel.id)}>查看與編輯包裹 <ChevronRight size={16}/></button></article>)}</div>}
      <div className="table-footer">寄送方式只在建立包裹時選擇，不會保存於朋友資料中</div></section></>;
}
function OrdersPage({ orders, groups, query, setQuery, filters, setters, onOpen }: { orders: OrderView[]; groups: Group[]; query: string; setQuery: (value: string) => void; filters: { orderFriend: string; orderGroup: string; paymentFilter: string; arrivalFilter: string; shippingFilter: string }; setters: { setOrderFriend: (value: string) => void; setOrderGroup: (value: string) => void; setPaymentFilter: (value: string) => void; setArrivalFilter: (value: string) => void; setShippingFilter: (value: string) => void }; onOpen: (group: Group, order: Order) => void }) {
  const everyOrder = groups.flatMap(group => group.orders);
  const friendOptions = Array.from(new Set(everyOrder.map(order => order.friend)));
  const unpaid = orders.filter(item => item.payment !== "已付款").length;
  const notArrived = orders.filter(item => item.arrival !== "已到貨").length;
  const readyToShip = orders.filter(item => item.shipping === "待出貨").length;
  return <>
    <div className="section-heading"><div><span className="eyebrow">ALL ORDERS</span><h2>訂單明細</h2><p>集中查看所有代購團的個別訂單，快速搜尋、對帳與追蹤進度</p></div></div>
    <section className="stats-grid order-stats">
      <StatCard icon={<ClipboardList />} tone="ice" label="全部訂單" value={String(everyOrder.length)} note="跨代購團集中顯示" />
      <StatCard icon={<CircleDollarSign />} tone="amber" label="尚未付清" value={String(unpaid)} note="包含未付款與部分付款" />
      <StatCard icon={<Box />} tone="lilac" label="尚未全數到貨" value={String(notArrived)} note="包含未到貨與部分到貨" />
      <StatCard icon={<Truck />} tone="mint" label="待安排出貨" value={String(readyToShip)} note="商品已到齊，可建立包裹" />
    </section>
    <section className="groups-section orders-list-section">
      <div className="orders-toolbar"><div><h3>全部訂單</h3><span>目前顯示 {orders.length} 筆</span></div><label className="search order-search"><Search size={18} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜尋訂單、朋友或代購團" /></label></div>
      <div className="order-filters">
        <FilterSelect value={filters.orderFriend} onChange={setters.setOrderFriend} options={["全部朋友", ...friendOptions]} />
        <FilterSelect value={filters.orderGroup} onChange={setters.setOrderGroup} options={["全部代購團", ...groups.map(group => group.name)]} />
        <FilterSelect value={filters.paymentFilter} onChange={setters.setPaymentFilter} options={["全部付款狀態", "未付款", "部分付款", "已付款"]} />
        <FilterSelect value={filters.arrivalFilter} onChange={setters.setArrivalFilter} options={["全部到貨狀態", "未到貨", "部分到貨", "已到貨"]} />
        <FilterSelect value={filters.shippingFilter} onChange={setters.setShippingFilter} options={["全部出貨狀態", "待到貨", "待出貨", "已出貨"]} />
      </div>
      <div className="table-wrap"><table className="orders-table"><thead><tr><th>訂單</th><th>代購團</th><th>購買人</th><th>商品摘要</th><th>訂單金額</th><th>付款</th><th>到貨</th><th>出貨</th><th /></tr></thead><tbody>{orders.map(({group,order,payment,arrival,shipping}) => <tr key={`${group.id}-${order.id}`} className="clickable-row" onClick={() => onOpen(group, order)}><td><strong>{order.code}</strong><small>#{String(group.id).slice(-4)}-{String(order.id).slice(-3)}</small></td><td><strong>{group.name}</strong><small>{currencyInfo[group.currency].label}</small></td><td>{order.friend}</td><td><strong>{orderQuantity(order)} 件商品</strong><small>{order.lines.slice(0,2).map(line => group.products.find(product => product.id === line.productId)?.name).join("、")}{order.lines.length > 2 ? "…" : ""}</small></td><td><strong className="order-list-money">{money(orderTotal(group,order),group.currency)}</strong></td><td><OrderState value={payment} /></td><td><OrderState value={arrival} /></td><td><OrderState value={shipping} /></td><td><button className="open-detail" aria-label="查看訂單"><ChevronRight /></button></td></tr>)}</tbody></table>{orders.length === 0 && <div className="empty-state"><Search /><strong>找不到符合條件的訂單</strong><span>請調整搜尋文字或篩選條件</span></div>}</div>
      <div className="table-footer">點選任一筆訂單，可直接查看與編輯商品數量及滿額贈品</div>
    </section>
  </>;
}
function LoginPage({ onSubmit, error }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void; error: string }) {
  return <main className="login-screen"><section className="login-card">
    <div className="login-mark"><ShoppingBag size={27}/></div>
    <span className="eyebrow">PRIVATE ADMIN</span><h1>哈娜的小車車</h1><p>請登入後繼續管理代購資料</p>
    <form onSubmit={onSubmit}><label>帳號<input name="username" autoComplete="username" placeholder="請輸入帳號" autoFocus required /></label><label>密碼<input name="password" type="password" autoComplete="current-password" placeholder="請輸入密碼" required /></label>{error && <div className="login-error">{error}</div>}<button type="submit"><LockKeyhole size={18}/>登入</button></form>
    <small>登入狀態會在此瀏覽器保留 1 小時</small>
  </section></main>;
}
function SettingsPage({ groups, friends, payments, expenses, parcels, settings, onSave, onSavePassword, onNotice }: { groups: Group[]; friends: Friend[]; payments: PaymentRecord[]; expenses: ExpenseRecord[]; parcels: Parcel[]; settings: AppSettings; onSave: (settings: AppSettings) => void; onSavePassword: (password: string) => Promise<void>; onNotice: (message: string) => void }) {
  const [adminName, setAdminName] = useState(settings.adminName);
  const [siteName, setSiteName] = useState(settings.siteName);
  const [password, setPassword] = useState("");
  const [orderPrefix, setOrderPrefix] = useState(settings.orderPrefix);
  const [amountDisplay, setAmountDisplay] = useState(settings.amountDisplay);
  const [thousands, setThousands] = useState(settings.thousands);
  const [paymentMethods, setPaymentMethods] = useState(settings.paymentMethods);
  const [deliveryMethods, setDeliveryMethods] = useState<string[]>(settings.deliveryMethods);
  const [defaultShippingNote, setDefaultShippingNote] = useState(settings.defaultShippingNote);
  const toggle = (value: string, values: string[], setter: (items: string[]) => void) => setter(values.includes(value) ? values.filter(item => item !== value) : [...values, value]);
  const orderCount = groups.reduce((sum, group) => sum + group.orders.length, 0);
  const records = groups.length + orderCount + friends.length + payments.length + expenses.length + parcels.length;
  return <>
    <div className="section-heading settings-heading"><div><span className="eyebrow">SETTINGS</span><h2>設定</h2><p>管理後台顯示、常用選項與資料備份</p></div><button className="primary-button settings-save" onClick={() => onSave({ siteName: siteName.trim() || "哈娜的小車車", adminName: adminName.trim() || "Jiin", orderPrefix: orderPrefix.trim().toUpperCase() || "ORDER", amountDisplay, thousands, paymentMethods, deliveryMethods: deliveryMethods as DeliveryMethod[], defaultShippingNote })}><Save size={18}/>儲存設定</button></div>
    <div className="settings-layout">
      <div className="settings-main">
        <SettingsCard icon={<Settings/>} title="基本設定" note="調整後台中顯示的名稱">
          <div className="settings-form two"><label>後台名稱<input value={siteName} onChange={e=>setSiteName(e.target.value)}/></label><label>管理者顯示名稱<input value={adminName} onChange={e=>setAdminName(e.target.value)}/></label></div>
        </SettingsCard>
        <SettingsCard icon={<LockKeyhole/>} title="登入與安全" note="Firebase 安全驗證與管理員專用權限">
          <div className="settings-form two"><label>登入帳號<input value="hannna" readOnly autoComplete="username"/></label><label>新密碼<input value={password} onChange={e=>setPassword(e.target.value)} type="password" minLength={6} placeholder="至少 6 個字元" autoComplete="new-password"/></label></div>
          <button className="credential-save" onClick={()=> password.length >= 6 ? void onSavePassword(password).then(()=>setPassword("")) : onNotice("新密碼至少需要 6 個字元")}><Save size={16}/>更新登入密碼</button>
          <p className="security-note">帳密由 Firebase Authentication 驗證；雲端資料僅限此管理員帳號讀寫。</p>
        </SettingsCard>
        <SettingsCard icon={<CircleDollarSign/>} title="款項與顯示格式" note="設定新增收款時使用的常用選項">
          <div className="settings-form two"><label>訂單編號前綴<input value={orderPrefix} onChange={e=>setOrderPrefix(e.target.value.toUpperCase())}/><small>預覽：{orderPrefix || "ORDER"} 01</small></label><label>金額顯示<select value={amountDisplay} onChange={e=>setAmountDisplay(e.target.value as AppSettings["amountDisplay"])}><option value="original">依代購團原幣顯示</option><option value="twd">統一顯示新台幣</option></select></label></div>
          <div className="setting-option-row"><div><strong>金額使用千分位</strong><span>例如：NT$12,800</span></div><button className={`switch ${thousands?"on":""}`} onClick={()=>setThousands(!thousands)} aria-label="切換金額千分位"><i/></button></div>
          <ChoiceChips label="常用付款方式" options={["銀行轉帳","LINE Pay","現金","其他"]} values={paymentMethods} onToggle={value=>toggle(value,paymentMethods,setPaymentMethods)}/>
        </SettingsCard>
        <SettingsCard icon={<Truck/>} title="出貨選項" note="建立包裹時顯示的交付方式">
          <ChoiceChips label="可選擇的交付方式" options={["面交","賣貨便"]} values={deliveryMethods} onToggle={value=>toggle(value,deliveryMethods,setDeliveryMethods)}/>
          <label className="full-setting-label">預設出貨備註<input value={defaultShippingNote} onChange={e=>setDefaultShippingNote(e.target.value)} placeholder="例如：商品寄出後請留意取件通知"/></label>
        </SettingsCard>
      </div>
      <aside className="settings-side">
        <section className="data-summary"><div className="settings-card-title"><span><Database/></span><div><h3>目前資料</h3><p>Firestore 雲端資料摘要</p></div></div><div className="data-count-grid"><div><strong>{groups.length}</strong><span>代購團</span></div><div><strong>{orderCount}</strong><span>訂單</span></div><div><strong>{friends.length}</strong><span>朋友</span></div><div><strong>{parcels.length}</strong><span>包裹</span></div></div><p className="record-total">共 {records} 筆相關紀錄</p></section>
        <section className="export-card"><div className="settings-card-title"><span><Download/></span><div><h3>資料匯出與備份</h3><p>下載目前後台資料</p></div></div><button onClick={()=>onNotice("已準備匯出 JSON 示範檔")}><Download size={17}/>匯出 JSON</button><button onClick={()=>onNotice("已準備匯出 CSV 示範檔")}><Download size={17}/>匯出 CSV</button><small>正式串接資料庫後，匯出檔才會包含實際建立的完整資料。</small></section>
        <section className="danger-zone"><div className="settings-card-title"><span><AlertTriangle/></span><div><h3>資料安全</h3><p>正式資料已啟用雲端同步</p></div></div><small>為避免誤刪，第一階段暫不提供一鍵清除全部資料。</small></section>
      </aside>
    </div>
  </>;
}
function SettingsCard({ icon, title, note, children }: { icon: React.ReactNode; title: string; note: string; children: React.ReactNode }) { return <section className="settings-card"><div className="settings-card-title"><span>{icon}</span><div><h3>{title}</h3><p>{note}</p></div></div>{children}</section>; }
function ChoiceChips({ label, options, values, onToggle }: { label: string; options: string[]; values: string[]; onToggle: (value: string) => void }) { return <div className="choice-block"><strong>{label}</strong><div>{options.map(option=><button key={option} className={values.includes(option)?"selected":""} onClick={()=>onToggle(option)}>{values.includes(option)?"✓ ":""}{option}</button>)}</div></div>; }
function FilterSelect({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: string[] }) { return <label className="select-wrap"><select value={value} onChange={e => onChange(e.target.value)}>{options.map(option => <option key={option}>{option}</option>)}</select><ChevronDown size={16} /></label>; }
function OrderState({ value }: { value: string }) { const tone = value.includes("已") && !value.includes("未") ? "mint" : value.includes("部分") ? "coral" : value === "待出貨" ? "blue" : "amber"; return <span className={`status ${tone}`}>{value}</span>; }

function Modal({ onClose, eyebrow, title, children, wide = false }: { onClose: () => void; eyebrow: string; title: string; children: React.ReactNode; wide?: boolean }) { return <div className="modal-backdrop" onMouseDown={onClose}><div className={`modal ${wide ? "modal-wide" : ""}`} onMouseDown={e => e.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div><button type="button" onClick={onClose}><X /></button></div>{children}</div></div>; }
function ModalActions({ onCancel, submit }: { onCancel: () => void; submit: string }) { return <div className="modal-actions"><button type="button" className="secondary-button" onClick={onCancel}>取消</button><button className="primary-button" type="submit">{submit}</button></div>; }
function StatCard({ icon, tone, label, value, note }: { icon: React.ReactNode; tone: string; label: string; value: string; note: string }) { return <article className="stat-card"><div className={`stat-icon ${tone}`}>{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{note}</small></div></article>; }
