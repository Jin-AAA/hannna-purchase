// 資料模型、舊資料轉換、帳款與進度計算。
// 這個檔案不依賴 React，後台畫面與朋友端資料都從這裡算出來，確保兩邊結果一致。

export type Currency = "KRW" | "JPY" | "CNY" | "TWD";
export type Payer = "我代墊・需收款" | "朋友自行付清" | "我自行負擔";
export type PortalStatus = "尚未設定" | "已設定" | "已停用";

export type Product = { id: number; name: string; unitPrice: number };
export type GiftRule = { id: number; threshold: number; giftName: string; cumulative: boolean };
/** unitTwd：每件的台幣金額。一般朋友是應收單價；本人訂單是自己的台幣成本。 */
export type OrderLine = { productId: number; quantity: number; unitTwd: number; payer: Payer };
export type Order = {
  id: number;
  code: string;
  friendId: number;
  lines: OrderLine[];
  note?: string;
  /** 舊版以「手動團狀態」標示到貨／出貨、但沒有對應運單或包裹的訂單，保留原本的狀態。 */
  legacyArrived?: boolean;
  legacyDelivered?: boolean;
};
export type Group = {
  id: number;
  name: string;
  saleDate: string;
  currency: Currency;
  orderedAt?: string;
  completedAt?: string;
  products: Product[];
  giftRules: GiftRule[];
  orders: Order[];
  nextOrderNo: number;
};
export type Friend = { id: number; name: string; note: string; portalNote: string; isSelf?: boolean };
export type ChargeKind = "product" | "freight";
export type Allocation = { orderId: number; kind: ChargeKind; amount: number };
export type Payment = { id: number; friendId: number; amount: number; date: string; method: string; note: string; allocations: Allocation[] };
export type ExpenseCategory = "商品款" | "國際運費" | "關稅" | "包材" | "其他";
export type Expense = { id: number; category: ExpenseCategory; amount: number; date: string; groupId: number | null; note: string };
export type WaybillItem = { groupId: number; orderId: number; weightG: number; freightTwd: number };
export type WaybillStatus = "已申請運回" | "已到貨";
export type Destination = "寄到我這裡" | "直寄朋友";
export type Waybill = {
  id: number;
  code: string;
  country: "韓國" | "日本" | "其他";
  tracking: string;
  items: WaybillItem[];
  totalWeightG: number;
  freightTwd: number;
  destination: Destination;
  recipientFriendId: number | null;
  status: WaybillStatus;
  appliedDate: string;
  arrivedDate: string;
  note: string;
};
export type ParcelStatus = "待出貨" | "已出貨" | "已取貨";
export type Parcel = { id: number; code: string; friendId: number; orderIds: number[]; method: string; tracking: string; date: string; note: string; status: ParcelStatus };
export type Settings = { siteName: string; adminName: string; orderPrefix: string; paymentMethods: string[]; deliveryMethods: string[]; defaultShippingNote: string };
export type State = {
  schemaVersion: 3;
  groups: Group[];
  friends: Friend[];
  payments: Payment[];
  expenses: Expense[];
  waybills: Waybill[];
  parcels: Parcel[];
  settings: Settings;
  counters: { waybill: number; parcel: number };
  migrationNotes: string[];
};

export const currencyInfo: Record<Currency, { label: string; symbol: string }> = {
  KRW: { label: "韓幣", symbol: "₩" },
  JPY: { label: "日幣", symbol: "¥" },
  CNY: { label: "人民幣", symbol: "¥" },
  TWD: { label: "新台幣", symbol: "NT$" },
};
export const payers: Payer[] = ["我代墊・需收款", "朋友自行付清", "我自行負擔"];
export const defaultSettings: Settings = {
  siteName: "哈娜的小車車",
  adminName: "Jiin",
  orderPrefix: "ORDER",
  paymentMethods: ["銀行轉帳", "LINE Pay"],
  deliveryMethods: ["面交", "賣貨便"],
  defaultShippingNote: "",
};
export const emptyState = (): State => ({
  schemaVersion: 3,
  groups: [],
  friends: [],
  payments: [],
  expenses: [],
  waybills: [],
  parcels: [],
  settings: { ...defaultSettings },
  counters: { waybill: 0, parcel: 0 },
  migrationNotes: [],
});

// ---------- 小工具 ----------

let lastId = 0;
/** 以時間為基礎、保證遞增的 ID（朋友 ID 需為 10–16 位數字）。 */
export function newId() {
  const now = Date.now();
  lastId = now > lastId ? now : lastId + 1;
  return lastId;
}
export const todayIso = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};
/** 統一日期格式為 YYYY-MM-DD；無法辨識時回傳空字串。 */
export function normalizeDate(value: unknown): string {
  if (typeof value !== "string") return "";
  const match = value.trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (!match) return "";
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}
export const showDate = (value?: string) => (value ? value.replaceAll("-", "/") : "—");
export const twd = (value: number) => `NT$${Math.round(value).toLocaleString("en-US")}`;
export const foreign = (value: number, currency: Currency) => `${currencyInfo[currency].symbol}${value.toLocaleString("en-US")}`;
export const lineTwd = (line: OrderLine) => Math.round(line.unitTwd * line.quantity);
export const lineReceivable = (line: OrderLine) => (line.payer === "我代墊・需收款" ? lineTwd(line) : 0);
export const orderQuantity = (order: Order) => order.lines.reduce((sum, line) => sum + line.quantity, 0);
export const orderForeignTotal = (group: Group, order: Order) =>
  order.lines.reduce((sum, line) => sum + (group.products.find(p => p.id === line.productId)?.unitPrice ?? 0) * line.quantity, 0);
export const productName = (group: Group, productId: number) => group.products.find(p => p.id === productId)?.name ?? "已移除的商品";
export function earnedGifts(group: Group, total: number) {
  return group.giftRules.flatMap(rule => {
    const count = rule.cumulative ? Math.floor(total / rule.threshold) : total >= rule.threshold ? 1 : 0;
    return count > 0 ? [{ ...rule, count }] : [];
  });
}
export const formatOrderCode = (prefix: string, no: number) => `${prefix || "ORDER"} ${String(no).padStart(2, "0")}`;
export const selfFriend = (state: State) => state.friends.find(friend => friend.isSelf);

// ---------- 索引 ----------

export type Index = {
  friendById: Map<number, Friend>;
  groupByOrder: Map<number, Group>;
  orderById: Map<number, Order>;
  waybillByOrder: Map<number, Waybill>;
  waybillItemByOrder: Map<number, WaybillItem>;
  parcelByOrder: Map<number, Parcel>;
};
export function buildIndex(state: State): Index {
  const index: Index = { friendById: new Map(), groupByOrder: new Map(), orderById: new Map(), waybillByOrder: new Map(), waybillItemByOrder: new Map(), parcelByOrder: new Map() };
  state.friends.forEach(friend => index.friendById.set(friend.id, friend));
  state.groups.forEach(group => group.orders.forEach(order => { index.groupByOrder.set(order.id, group); index.orderById.set(order.id, order); }));
  state.waybills.forEach(waybill => waybill.items.forEach(item => { index.waybillByOrder.set(item.orderId, waybill); index.waybillItemByOrder.set(item.orderId, item); }));
  state.parcels.forEach(parcel => parcel.orderIds.forEach(id => index.parcelByOrder.set(id, parcel)));
  return index;
}

// ---------- 進度 ----------

export type Stage = "待下單" | "已下單" | "運回中" | "待出貨" | "包裹處理中" | "已出貨" | "已交付";
export const stageOrder: Stage[] = ["待下單", "已下單", "運回中", "待出貨", "包裹處理中", "已出貨", "已交付"];
export type Track = {
  stage: Stage;
  arrived: boolean;
  /** 商品已離開我手上（已出貨或已交付）。 */
  out: boolean;
  delivered: boolean;
  needsParcel: boolean;
  direct: boolean;
  waybill?: Waybill;
  parcel?: Parcel;
};
export function orderTrack(group: Group, order: Order, index: Index): Track {
  const waybill = index.waybillByOrder.get(order.id);
  const parcel = index.parcelByOrder.get(order.id);
  const self = Boolean(index.friendById.get(order.friendId)?.isSelf);
  const arrived = waybill ? waybill.status === "已到貨" : Boolean(order.legacyArrived || order.legacyDelivered);
  const moving = waybill?.status === "已申請運回";
  const direct = waybill?.destination === "直寄朋友";
  const delivered = Boolean(
    parcel?.status === "已取貨" ||
    (arrived && direct) ||
    (arrived && self && !parcel) ||
    (!parcel && order.legacyDelivered),
  );
  const shipped = parcel?.status === "已出貨";
  const stage: Stage = delivered ? "已交付" : shipped ? "已出貨" : parcel ? "包裹處理中" : arrived ? "待出貨" : moving ? "運回中" : group.orderedAt ? "已下單" : "待下單";
  return { stage, arrived, out: delivered || shipped, delivered, needsParcel: arrived && !direct && !self && !parcel && !delivered, direct, waybill, parcel };
}

export type GroupStatus = "待下單" | "已下單" | "運回中" | "部分到貨" | "已到貨" | "部分出貨" | "已出貨" | "已完成";
export const groupStatuses: GroupStatus[] = ["待下單", "已下單", "運回中", "部分到貨", "已到貨", "部分出貨", "已出貨", "已完成"];
export function groupStatus(group: Group, index: Index): GroupStatus {
  if (group.completedAt) return "已完成";
  const tracks = group.orders.map(order => orderTrack(group, order, index));
  if (!tracks.length) return group.orderedAt ? "已下單" : "待下單";
  const out = tracks.filter(track => track.out).length;
  const arrived = tracks.filter(track => track.arrived).length;
  if (out === tracks.length) return "已出貨";
  if (out > 0) return "部分出貨";
  if (arrived === tracks.length) return "已到貨";
  if (arrived > 0) return "部分到貨";
  if (tracks.some(track => track.stage === "運回中")) return "運回中";
  return group.orderedAt ? "已下單" : "待下單";
}

// ---------- 帳款 ----------

export type Charge = { key: string; orderId: number; groupId: number; friendId: number; kind: ChargeKind; amount: number; sortKey: string };
export type ChargeState = Charge & { paid: number; balance: number };
export type FriendAccount = { friendId: number; due: number; paid: number; balance: number; received: number; credit: number };
export type OrderMoney = { productDue: number; freightDue: number; due: number; paid: number; balance: number; status: PaymentStatus };
export type PaymentStatus = "未付款" | "部分付款" | "已付款" | "無應收" | "自用";
export type Ledger = {
  charges: Map<string, ChargeState>;
  friends: Map<number, FriendAccount>;
  /** 每筆收款：實際分配到款項的金額，以及剩餘轉成預付的金額。 */
  payments: Map<number, { applied: number; toCredit: number }>;
};
export const chargeKey = (orderId: number, kind: ChargeKind) => `${orderId}:${kind}`;

export function buildCharges(state: State, index = buildIndex(state)): Charge[] {
  const charges: Charge[] = [];
  state.groups.forEach(group => group.orders.forEach(order => {
    if (index.friendById.get(order.friendId)?.isSelf) return;
    const sortKey = `${group.saleDate || "9999"}-${String(order.id).padStart(16, "0")}`;
    const product = order.lines.reduce((sum, line) => sum + lineReceivable(line), 0);
    if (product > 0) charges.push({ key: chargeKey(order.id, "product"), orderId: order.id, groupId: group.id, friendId: order.friendId, kind: "product", amount: product, sortKey: `${sortKey}-a` });
    const freight = Math.round(index.waybillItemByOrder.get(order.id)?.freightTwd ?? 0);
    if (freight > 0) charges.push({ key: chargeKey(order.id, "freight"), orderId: order.id, groupId: group.id, friendId: order.friendId, kind: "freight", amount: freight, sortKey: `${sortKey}-b` });
  }));
  return charges.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}

/**
 * 1. 先套用每筆收款指定的分配（超過款項金額的部分轉為預付）。
 * 2. 收款中沒有指定分配的金額成為預付餘額。
 * 3. 預付餘額自動依時間先後扣抵尚未付清的款項。
 */
export function buildLedger(state: State, index = buildIndex(state)): Ledger {
  const charges = new Map<string, ChargeState>(buildCharges(state, index).map(charge => [charge.key, { ...charge, paid: 0, balance: charge.amount }]));
  const pool = new Map<number, number>();
  const received = new Map<number, number>();
  const paymentInfo = new Map<number, { applied: number; toCredit: number }>();
  [...state.payments].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id).forEach(payment => {
    received.set(payment.friendId, (received.get(payment.friendId) ?? 0) + payment.amount);
    let remaining = payment.amount;
    let applied = 0;
    payment.allocations.forEach(allocation => {
      const charge = charges.get(chargeKey(allocation.orderId, allocation.kind));
      if (!charge || charge.friendId !== payment.friendId) return;
      const amount = Math.max(0, Math.min(allocation.amount, charge.balance, remaining));
      charge.paid += amount;
      charge.balance -= amount;
      remaining -= amount;
      applied += amount;
    });
    paymentInfo.set(payment.id, { applied, toCredit: Math.max(0, remaining) });
    pool.set(payment.friendId, (pool.get(payment.friendId) ?? 0) + Math.max(0, remaining));
  });
  // 預付餘額自動扣抵，舊的款項先扣。
  [...charges.values()].forEach(charge => {
    const credit = pool.get(charge.friendId) ?? 0;
    if (credit <= 0 || charge.balance <= 0) return;
    const amount = Math.min(credit, charge.balance);
    charge.paid += amount;
    charge.balance -= amount;
    pool.set(charge.friendId, credit - amount);
  });
  const friends = new Map<number, FriendAccount>();
  state.friends.forEach(friend => friends.set(friend.id, { friendId: friend.id, due: 0, paid: 0, balance: 0, received: received.get(friend.id) ?? 0, credit: pool.get(friend.id) ?? 0 }));
  charges.forEach(charge => {
    const account = friends.get(charge.friendId);
    if (!account) return;
    account.due += charge.amount;
    account.paid += charge.paid;
    account.balance += charge.balance;
  });
  return { charges, friends, payments: paymentInfo };
}

export function orderMoney(order: Order, ledger: Ledger, index: Index): OrderMoney {
  const product = ledger.charges.get(chargeKey(order.id, "product"));
  const freight = ledger.charges.get(chargeKey(order.id, "freight"));
  const due = (product?.amount ?? 0) + (freight?.amount ?? 0);
  const paid = (product?.paid ?? 0) + (freight?.paid ?? 0);
  const balance = due - paid;
  const self = Boolean(index.friendById.get(order.friendId)?.isSelf);
  const status: PaymentStatus = self ? "自用" : due <= 0 ? "無應收" : balance <= 0 ? "已付款" : paid > 0 ? "部分付款" : "未付款";
  return { productDue: product?.amount ?? 0, freightDue: freight?.amount ?? 0, due, paid, balance, status };
}

/** 依時間先後把金額分配到尚未付清的款項（新增收款時的「自動分配」）。 */
export function suggestAllocations(open: ChargeState[], amount: number): Allocation[] {
  let remaining = Math.max(0, amount);
  return open.flatMap(charge => {
    if (remaining <= 0 || charge.balance <= 0) return [];
    const value = Math.min(remaining, charge.balance);
    remaining -= value;
    return [{ orderId: charge.orderId, kind: charge.kind, amount: value }];
  });
}

// ---------- 自用開銷 ----------

export function selfSpending(state: State, index = buildIndex(state)) {
  const self = selfFriend(state);
  const byGroup = state.groups.flatMap(group => {
    const orders = group.orders.filter(order => self && order.friendId === self.id);
    if (!orders.length) return [];
    const productTwd = orders.reduce((sum, order) => sum + order.lines.reduce((s, line) => s + lineTwd(line), 0), 0);
    const freightTwd = orders.reduce((sum, order) => sum + Math.round(index.waybillItemByOrder.get(order.id)?.freightTwd ?? 0), 0);
    const foreignTotal = orders.reduce((sum, order) => sum + orderForeignTotal(group, order), 0);
    const quantity = orders.reduce((sum, order) => sum + orderQuantity(order), 0);
    return [{ group, orders, productTwd, freightTwd, foreignTotal, quantity, month: (group.orderedAt || group.saleDate || "").slice(0, 7) }];
  });
  const absorbed = state.groups.flatMap(group => group.orders.flatMap(order => {
    if (self && order.friendId === self.id) return [];
    return order.lines.filter(line => line.payer === "我自行負擔" && line.unitTwd > 0).map(line => ({ group, order, line, amount: lineTwd(line) }));
  }));
  return { byGroup, absorbed };
}

// ---------- 朋友端資料 ----------

export type FriendViewOrder = {
  id: number;
  code: string;
  groupName: string;
  currency: Currency;
  saleDate: string;
  stage: Stage;
  steps: { label: string; date: string; done: boolean }[];
  lines: { name: string; quantity: number; amount: number; payer: Payer }[];
  gifts: string[];
  productDue: number;
  freightDue: number;
  due: number;
  paid: number;
  balance: number;
  paymentStatus: PaymentStatus;
  deliveryMethod: string;
  tracking: string;
};
export type FriendView = {
  friendId: number;
  name: string;
  portalNote: string;
  summary: { due: number; paid: number; balance: number; credit: number };
  orders: FriendViewOrder[];
  payments: { id: number; date: string; amount: number; method: string; toCredit: number }[];
};

export function buildFriendViews(state: State): FriendView[] {
  const index = buildIndex(state);
  const ledger = buildLedger(state, index);
  return state.friends.filter(friend => !friend.isSelf).map(friend => {
    const orders = state.groups.flatMap(group => group.orders.filter(order => order.friendId === friend.id).map(order => {
      const track = orderTrack(group, order, index);
      const money = orderMoney(order, ledger, index);
      const reached = (stage: Stage) => stageOrder.indexOf(track.stage) >= stageOrder.indexOf(stage);
      const steps = [
        { label: "已下單", date: group.orderedAt ?? "", done: reached("已下單") },
        { label: track.direct ? "運回中・直寄" : "運回中", date: track.waybill?.appliedDate ?? "", done: reached("運回中") },
        { label: "已到貨", date: track.waybill?.arrivedDate ?? "", done: track.arrived },
        { label: track.direct ? "已交付" : track.parcel?.status === "已取貨" ? "已取貨" : "已出貨", date: track.parcel?.date ?? (track.direct ? track.waybill?.arrivedDate ?? "" : ""), done: track.out },
      ];
      return {
        id: order.id,
        code: order.code,
        groupName: group.name,
        currency: group.currency,
        saleDate: group.saleDate,
        stage: track.stage,
        steps,
        lines: order.lines.map(line => ({ name: productName(group, line.productId), quantity: line.quantity, amount: lineReceivable(line), payer: line.payer })),
        gifts: earnedGifts(group, orderForeignTotal(group, order)).map(gift => `${gift.giftName} × ${gift.count}`),
        productDue: money.productDue,
        freightDue: money.freightDue,
        due: money.due,
        paid: money.paid,
        balance: money.balance,
        paymentStatus: money.status,
        deliveryMethod: track.direct ? "直寄" : track.parcel?.method ?? "",
        tracking: track.parcel?.tracking ?? "",
      } satisfies FriendViewOrder;
    })).sort((a, b) => b.id - a.id);
    const account = ledger.friends.get(friend.id);
    return {
      friendId: friend.id,
      name: friend.name,
      portalNote: friend.portalNote,
      summary: { due: account?.due ?? 0, paid: account?.paid ?? 0, balance: account?.balance ?? 0, credit: account?.credit ?? 0 },
      orders,
      payments: state.payments.filter(payment => payment.friendId === friend.id)
        .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
        .map(payment => ({ id: payment.id, date: payment.date, amount: payment.amount, method: payment.method, toCredit: ledger.payments.get(payment.id)?.toCredit ?? 0 })),
    };
  });
}

// ---------- 刪除時的連帶清理 ----------

export function removeOrders(state: State, orderIds: number[]): State {
  const ids = new Set(orderIds);
  return {
    ...state,
    groups: state.groups.map(group => ({ ...group, orders: group.orders.filter(order => !ids.has(order.id)) })),
    waybills: state.waybills.map(waybill => ({ ...waybill, items: waybill.items.filter(item => !ids.has(item.orderId)) })).filter(waybill => waybill.items.length > 0),
    parcels: state.parcels.map(parcel => ({ ...parcel, orderIds: parcel.orderIds.filter(id => !ids.has(id)) })).filter(parcel => parcel.orderIds.length > 0),
    payments: state.payments.map(payment => ({ ...payment, allocations: payment.allocations.filter(allocation => !ids.has(allocation.orderId)) })),
  };
}

// ---------- 舊資料轉換（v2 → v3） ----------

type Raw = Record<string, unknown>;
const arr = (value: unknown): Raw[] => (Array.isArray(value) ? (value.filter(item => item && typeof item === "object") as Raw[]) : []);
const num = (value: unknown, fallback = 0) => (typeof value === "number" && Number.isFinite(value) ? value : Number.isFinite(Number(value)) && value !== "" && value !== null ? Number(value) : fallback);
const str = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
const strList = (value: unknown, fallback: string[]) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : fallback);
const currencies: Currency[] = ["KRW", "JPY", "CNY", "TWD"];

function normalizeV3(raw: Raw): State {
  const base = emptyState();
  const settings = (raw.settings ?? {}) as Raw;
  return {
    schemaVersion: 3,
    groups: arr(raw.groups).map(group => ({
      id: num(group.id),
      name: str(group.name, "未命名代購團"),
      saleDate: normalizeDate(group.saleDate),
      currency: currencies.includes(group.currency as Currency) ? (group.currency as Currency) : "KRW",
      orderedAt: normalizeDate(group.orderedAt) || undefined,
      completedAt: normalizeDate(group.completedAt) || undefined,
      products: arr(group.products).map(p => ({ id: num(p.id), name: str(p.name), unitPrice: num(p.unitPrice) })),
      giftRules: arr(group.giftRules).map(r => ({ id: num(r.id), threshold: num(r.threshold), giftName: str(r.giftName), cumulative: r.cumulative !== false })),
      orders: arr(group.orders).map(order => ({
        id: num(order.id),
        code: str(order.code),
        friendId: num(order.friendId),
        note: str(order.note) || undefined,
        legacyArrived: order.legacyArrived === true || undefined,
        legacyDelivered: order.legacyDelivered === true || undefined,
        lines: arr(order.lines).map(line => ({ productId: num(line.productId), quantity: num(line.quantity), unitTwd: num(line.unitTwd), payer: payers.includes(line.payer as Payer) ? (line.payer as Payer) : "我代墊・需收款" as Payer })).filter(line => line.quantity > 0),
      })),
      nextOrderNo: Math.max(1, num(group.nextOrderNo, 1)),
    })),
    friends: arr(raw.friends).map(friend => ({ id: num(friend.id), name: str(friend.name), note: str(friend.note), portalNote: str(friend.portalNote), isSelf: friend.isSelf === true || undefined })),
    payments: arr(raw.payments).map(payment => ({
      id: num(payment.id),
      friendId: num(payment.friendId),
      amount: num(payment.amount),
      date: normalizeDate(payment.date),
      method: str(payment.method),
      note: str(payment.note),
      allocations: arr(payment.allocations).map(a => ({ orderId: num(a.orderId), kind: a.kind === "freight" ? "freight" : "product", amount: num(a.amount) })),
    })),
    expenses: arr(raw.expenses).map(expense => ({ id: num(expense.id), category: str(expense.category, "其他") as ExpenseCategory, amount: num(expense.amount), date: normalizeDate(expense.date), groupId: expense.groupId == null ? null : num(expense.groupId), note: str(expense.note) })),
    waybills: arr(raw.waybills).map(waybill => ({
      id: num(waybill.id),
      code: str(waybill.code),
      country: (["韓國", "日本", "其他"].includes(str(waybill.country)) ? waybill.country : "其他") as Waybill["country"],
      tracking: str(waybill.tracking),
      items: arr(waybill.items).map(item => ({ groupId: num(item.groupId), orderId: num(item.orderId), weightG: num(item.weightG), freightTwd: num(item.freightTwd) })),
      totalWeightG: num(waybill.totalWeightG),
      freightTwd: num(waybill.freightTwd),
      destination: waybill.destination === "直寄朋友" ? "直寄朋友" : "寄到我這裡",
      recipientFriendId: waybill.recipientFriendId == null ? null : num(waybill.recipientFriendId),
      status: waybill.status === "已到貨" ? "已到貨" : "已申請運回",
      appliedDate: normalizeDate(waybill.appliedDate),
      arrivedDate: normalizeDate(waybill.arrivedDate),
      note: str(waybill.note),
    })),
    parcels: arr(raw.parcels).map(parcel => ({
      id: num(parcel.id),
      code: str(parcel.code),
      friendId: num(parcel.friendId),
      orderIds: Array.isArray(parcel.orderIds) ? parcel.orderIds.map(id => num(id)) : [],
      method: str(parcel.method, "面交"),
      tracking: str(parcel.tracking),
      date: normalizeDate(parcel.date),
      note: str(parcel.note),
      status: (["待出貨", "已出貨", "已取貨"].includes(str(parcel.status)) ? parcel.status : "待出貨") as ParcelStatus,
    })),
    settings: {
      siteName: str(settings.siteName, base.settings.siteName) || base.settings.siteName,
      adminName: str(settings.adminName, base.settings.adminName) || base.settings.adminName,
      orderPrefix: str(settings.orderPrefix, base.settings.orderPrefix) || base.settings.orderPrefix,
      paymentMethods: strList(settings.paymentMethods, base.settings.paymentMethods),
      deliveryMethods: strList(settings.deliveryMethods, base.settings.deliveryMethods),
      defaultShippingNote: str(settings.defaultShippingNote),
    },
    counters: { waybill: num((raw.counters as Raw | undefined)?.waybill), parcel: num((raw.counters as Raw | undefined)?.parcel) },
    migrationNotes: strList(raw.migrationNotes, []),
  };
}

const legacyStatusMap: Record<string, string> = { 收單中: "待下單", 整理出貨: "已到貨" };
const arrivedStatuses = ["已到貨", "出貨中", "部分出貨", "已出貨", "已完成"];
const deliveredStatuses = ["已出貨", "已完成"];
const selfNames = ["哈娜本人", "我自己"];

/** 讀取任何版本的雲端資料，回傳 v3 資料與是否經過轉換。 */
export function loadState(raw: unknown, today = todayIso()): { state: State; migrated: boolean } {
  const data = raw && typeof raw === "object" ? (raw as Raw) : {};
  if (data.schemaVersion === 3) return { state: normalizeV3(data), migrated: false };
  if (!Array.isArray(data.groups) && !Array.isArray(data.friends)) return { state: emptyState(), migrated: false };
  return { state: migrateV2(data, today), migrated: true };
}

function migrateV2(data: Raw, today: string): State {
  const notes: string[] = [];
  const friends: Friend[] = arr(data.friends).map(friend => ({ id: num(friend.id, newId()), name: str(friend.name, "未命名").trim() || "未命名", note: str(friend.note), portalNote: str(friend.portalNote) }));
  // 名稱 → 朋友 ID（含曾經用過的名字）
  const byName = new Map<string, number>();
  arr(data.friends).forEach((friend, i) => strList(friend.previousNames, []).forEach(name => byName.set(name, friends[i].id)));
  friends.forEach(friend => byName.set(friend.name, friend.id));
  const selfCandidate = friends.find(friend => friend.name === "哈娜本人") ?? friends.find(friend => selfNames.includes(friend.name));
  if (selfCandidate) {
    selfCandidate.isSelf = true;
    selfNames.forEach(name => { if (!byName.has(name)) byName.set(name, selfCandidate.id); });
  }
  const friendIdFor = (name: unknown): number => {
    const key = str(name).trim() || "未指定";
    const found = byName.get(key);
    if (found) return found;
    const created: Friend = { id: newId(), name: key, note: "舊資料轉換時自動建立", portalNote: "" };
    friends.push(created);
    byName.set(key, created.id);
    notes.push(`訂單或紀錄中的「${key}」不在朋友名單，已自動建立這位朋友。`);
    return created.id;
  };

  const rawWaybills = arr(data.waybills);
  const rawParcels = arr(data.parcels);
  const onWaybill = new Set(rawWaybills.flatMap(waybill => arr(waybill.items).map(item => num(item.orderId))));
  const inParcel = new Set(rawParcels.flatMap(parcel => (Array.isArray(parcel.orderIds) ? parcel.orderIds.map(id => num(id)) : [])));

  const groups: Group[] = arr(data.groups).map(group => {
    const rawStatus = str(group.status, "待下單");
    const status = legacyStatusMap[rawStatus] ?? rawStatus;
    const saleDate = normalizeDate(group.saleDate);
    const orders = arr(group.orders).map(order => {
      const id = num(order.id, newId());
      const rawLines = arr(order.lines);
      const lineArrived = rawLines.length > 0 && rawLines.every(line => line.arrival === "已到貨");
      const lines: OrderLine[] = rawLines.map(line => {
        const quantity = Math.max(0, num(line.quantity));
        const receivable = num(line.receivableTwd);
        const payer = payers.includes(line.productPayer as Payer) ? (line.productPayer as Payer) : "我代墊・需收款";
        return { productId: num(line.productId), quantity, unitTwd: quantity > 0 ? receivable / quantity : 0, payer };
      }).filter(line => line.quantity > 0);
      const legacyArrived = !onWaybill.has(id) && (arrivedStatuses.includes(status) || lineArrived);
      const legacyDelivered = !inParcel.has(id) && deliveredStatuses.includes(status);
      return { id, code: str(order.code), friendId: friendIdFor(order.friend), lines, legacyArrived: legacyArrived || undefined, legacyDelivered: legacyDelivered || undefined } as Order;
    });
    const maxNo = orders.reduce((max, order) => Math.max(max, Number(order.code.match(/(\d+)\s*$/)?.[1] ?? 0)), 0);
    return {
      id: num(group.id, newId()),
      name: str(group.name, "未命名代購團"),
      saleDate,
      currency: currencies.includes(group.currency as Currency) ? (group.currency as Currency) : "KRW",
      orderedAt: status !== "待下單" ? saleDate || today : undefined,
      completedAt: status === "已完成" ? today : undefined,
      products: arr(group.products).map(p => ({ id: num(p.id), name: str(p.name), unitPrice: num(p.unitPrice) })),
      giftRules: arr(group.giftRules).map(r => ({ id: num(r.id), threshold: num(r.threshold), giftName: str(r.giftName), cumulative: r.cumulative !== false })),
      orders,
      nextOrderNo: Math.max(maxNo, orders.length) + 1,
    };
  });
  const groupNotes = groups.filter(group => group.orderedAt && group.orderedAt === group.saleDate).length;
  if (groupNotes) notes.push(`${groupNotes} 個代購團原本已不是「待下單」，下單日先以開賣日代入，可在代購團頁修改。`);

  const waybills: Waybill[] = rawWaybills.map((waybill, i) => ({
    id: num(waybill.id, newId()),
    code: str(waybill.code, `INTL-${String(i + 1).padStart(3, "0")}`),
    country: (["韓國", "日本", "其他"].includes(str(waybill.country)) ? waybill.country : "其他") as Waybill["country"],
    tracking: str(waybill.tracking),
    items: arr(waybill.items).map(item => ({ groupId: num(item.groupId), orderId: num(item.orderId), weightG: num(item.weightG), freightTwd: num(item.receivableFreightTwd) })),
    totalWeightG: num(waybill.totalWeightG),
    freightTwd: num(waybill.freightTwd),
    destination: waybill.destination === "直寄朋友" ? "直寄朋友" : "寄到我這裡",
    recipientFriendId: waybill.destination === "直寄朋友" && str(waybill.recipientFriend) ? friendIdFor(waybill.recipientFriend) : null,
    status: waybill.status === "已到貨" ? "已到貨" : "已申請運回",
    appliedDate: normalizeDate(waybill.appliedDate),
    arrivedDate: normalizeDate(waybill.arrivedDate),
    note: str(waybill.note),
  }));
  const parcels: Parcel[] = rawParcels.map((parcel, i) => ({
    id: num(parcel.id, newId()),
    code: str(parcel.code, `SHIP-${String(i + 1).padStart(3, "0")}`),
    friendId: friendIdFor(parcel.friend),
    orderIds: Array.isArray(parcel.orderIds) ? parcel.orderIds.map(id => num(id)) : [],
    method: str(parcel.method, "面交"),
    tracking: str(parcel.tracking),
    date: normalizeDate(parcel.date),
    note: str(parcel.note),
    status: (["待出貨", "已出貨", "已取貨"].includes(str(parcel.status)) ? parcel.status : "待出貨") as ParcelStatus,
  }));

  const state: State = {
    ...emptyState(),
    groups,
    friends,
    waybills,
    parcels,
    expenses: arr(data.expenses).map(expense => ({
      id: num(expense.id, newId()),
      category: (["商品款", "國際運費", "關稅", "包材", "其他"].includes(str(expense.category)) ? expense.category : "其他") as ExpenseCategory,
      amount: num(expense.amount),
      date: normalizeDate(expense.date),
      groupId: groups.find(group => group.name === str(expense.group))?.id ?? null,
      note: str(expense.note),
    })),
    counters: { waybill: waybills.length, parcel: parcels.length },
  };
  const settings = (data.settings ?? {}) as Raw;
  state.settings = {
    siteName: str(settings.siteName) || defaultSettings.siteName,
    adminName: str(settings.adminName) || defaultSettings.adminName,
    orderPrefix: str(settings.orderPrefix) || defaultSettings.orderPrefix,
    paymentMethods: strList(settings.paymentMethods, defaultSettings.paymentMethods),
    deliveryMethods: strList(settings.deliveryMethods, defaultSettings.deliveryMethods),
    defaultShippingNote: str(settings.defaultShippingNote),
  };

  // 舊收款：「勾選即付清」轉成「依金額分配」。
  const index = buildIndex(state);
  const chargeAmounts = new Map(buildCharges(state, index).map(charge => [charge.key, charge.amount]));
  const used = new Map<string, number>();
  const self = selfFriend(state);
  state.payments = arr(data.payments).map(payment => {
    const friendId = friendIdFor(payment.friend);
    const amount = num(payment.amount);
    const date = normalizeDate(payment.date);
    const targets = (Array.isArray(payment.orderIds) ? payment.orderIds.map(id => num(id)) : []).map(id => (id < 0 ? chargeKey(-id, "freight") : chargeKey(id, "product")));
    let remaining = amount;
    let targetTotal = 0;
    const allocations: Allocation[] = targets.flatMap(key => {
      const open = (chargeAmounts.get(key) ?? 0) - (used.get(key) ?? 0);
      targetTotal += Math.max(0, open);
      const value = Math.max(0, Math.min(open, remaining));
      if (value <= 0) return [];
      remaining -= value;
      used.set(key, (used.get(key) ?? 0) + value);
      const [orderId, kind] = key.split(":");
      return [{ orderId: Number(orderId), kind: kind as ChargeKind, amount: value }];
    });
    const name = friends.find(friend => friend.id === friendId)?.name ?? "";
    if (self && friendId === self.id) notes.push(`${showDate(date)} 本人的收款 ${twd(amount)} 保留在紀錄中；本人訂單不再計算應收。`);
    else if (amount < targetTotal) notes.push(`${showDate(date)} ${name} 的收款 ${twd(amount)} 少於勾選款項 ${twd(targetTotal)}，差額 ${twd(targetTotal - amount)} 現在會顯示為未付。若是折讓，請編輯訂單金額。`);
    else if (remaining > 0) notes.push(`${showDate(date)} ${name} 的收款比勾選款項多 ${twd(remaining)}，已記為她的預付餘額。`);
    return { id: num(payment.id, newId()), friendId, amount, date, method: str(payment.method), note: str(payment.note), allocations };
  });
  if (self) {
    const selfReceivable = groups.flatMap(group => group.orders).filter(order => order.friendId === self.id && order.lines.some(line => line.payer === "我代墊・需收款" && line.unitTwd > 0)).length;
    if (selfReceivable) notes.push(`「${self.name}」已設為本人。她的 ${selfReceivable} 筆訂單原本填的應收台幣，現在當作自用的台幣成本計入自用開銷。`);
    const selfParcels = parcels.filter(parcel => parcel.friendId === self.id).length;
    if (selfParcels) notes.push(`本人有 ${selfParcels} 個舊包裹紀錄，保留不動；之後本人的訂單到貨後會直接算已交付。`);
  }
  state.migrationNotes = notes;
  return state;
}
