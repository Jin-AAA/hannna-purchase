import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFriendViews, buildIndex, buildLedger, groupStatus, loadState, orderMoney, orderTrack, removeOrders, selfSpending, suggestAllocations, type State } from "../app/lib/model.ts";

const legacy = {
  friends: [
    { id: 1700000000001, name: "小美", note: "", portalNote: "", previousNames: ["阿美"] },
    { id: 1700000000002, name: "哈娜本人", note: "", portalNote: "" },
    { id: 1700000000003, name: "小文", note: "", portalNote: "" },
  ],
  groups: [
    {
      id: 10, name: "ESON 8月周邊", saleDate: "2026/08/01", currency: "KRW", status: "部分到貨",
      products: [{ id: 101, name: "小卡", unitPrice: 5000 }, { id: 102, name: "手燈", unitPrice: 40000 }],
      giftRules: [{ id: 1, threshold: 50000, giftName: "海報", cumulative: true }],
      orders: [
        { id: 201, code: "ORDER 01", friend: "阿美", receivableTwd: 1300, lines: [{ productId: 101, quantity: 3, receivableTwd: 300, productPayer: "我代墊・需收款" }, { productId: 102, quantity: 1, receivableTwd: 1000, productPayer: "我代墊・需收款" }] },
        { id: 202, code: "ORDER 02", friend: "哈娜本人", receivableTwd: 500, lines: [{ productId: 102, quantity: 1, receivableTwd: 500 }] },
        { id: 203, code: "ORDER 04", friend: "小文", receivableTwd: 0, lines: [{ productId: 101, quantity: 2, receivableTwd: 0, productPayer: "朋友自行付清" }] },
      ],
    },
    { id: 11, name: "舊團", saleDate: "2026/05/01", currency: "JPY", status: "已完成", products: [{ id: 111, name: "T恤", unitPrice: 3000 }], giftRules: [], orders: [{ id: 301, code: "ORDER 01", friend: "小美", receivableTwd: 800, lines: [{ productId: 111, quantity: 1, receivableTwd: 800 }] }] },
  ],
  payments: [
    { id: 1, friend: "小美", amount: 1000, date: "2026/08/10", method: "銀行轉帳", note: "", orderIds: [201, -201] },
    { id: 2, friend: "小美", amount: 900, date: "2026/05/20", method: "LINE Pay", note: "", orderIds: [301] },
  ],
  waybills: [{ id: 50, code: "INTL-001", country: "韓國", tracking: "", items: [{ groupId: 10, orderId: 201, weightG: 300, receivableFreightTwd: 150 }, { groupId: 10, orderId: 202, weightG: 200, receivableFreightTwd: 80 }], totalWeightG: 500, freightTwd: 230, destination: "寄到我這裡", recipientFriend: "", status: "已到貨", appliedDate: "2026/08/05", arrivedDate: "2026/08/12", note: "" }],
  parcels: [],
  expenses: [{ id: 9, category: "包材", amount: 50, date: "2026/08/12", group: "ESON 8月周邊", note: "" }],
  settings: { siteName: "哈娜的小車車", adminName: "Jiin", orderPrefix: "ORDER", amountDisplay: "original", thousands: true, paymentMethods: ["銀行轉帳"], deliveryMethods: ["面交"], defaultShippingNote: "" },
};

const load = () => loadState(structuredClone(legacy), "2026-10-30");

test("舊資料轉換：朋友改用 ID、本人標記、單價換算", () => {
  const { state, migrated } = load();
  assert.equal(migrated, true);
  const order = state.groups[0].orders[0];
  assert.equal(order.friendId, 1700000000001, "舊名「阿美」對應到小美");
  assert.equal(order.lines[0].unitTwd, 100);
  assert.equal(state.friends.find(f => f.name === "哈娜本人")?.isSelf, true);
  assert.equal(state.groups[0].orderedAt, "2026-08-01");
  assert.equal(state.groups[1].completedAt, "2026-10-30");
  assert.equal(state.groups[0].nextOrderNo, 5);
  assert.equal(state.expenses[0].groupId, 10);
});

test("舊收款：金額不足時留下未付差額，超過時記為預付", () => {
  const { state } = load();
  const index = buildIndex(state);
  const ledger = buildLedger(state, index);
  // 小美：ORDER 01 商品 1300 + 運費 150；舊團 800。付了 1000（勾 201 商品與運費）與 900（勾 301）。
  const old = orderMoney(state.groups[1].orders[0], ledger, index);
  assert.equal(old.status, "已付款");
  const current = orderMoney(state.groups[0].orders[0], ledger, index);
  // 1000 分給商品款；舊團多出的 100 預付自動扣到這單
  assert.equal(current.due, 1450);
  assert.equal(current.paid, 1100);
  assert.equal(current.status, "部分付款");
  assert.equal(ledger.friends.get(1700000000001)?.balance, 350);
  assert.equal(ledger.friends.get(1700000000001)?.credit, 0);
  assert.ok(state.migrationNotes.some(note => note.includes("少於勾選款項")));
});

test("本人訂單不產生應收，到貨後直接交付，計入自用開銷", () => {
  const { state } = load();
  const index = buildIndex(state);
  const ledger = buildLedger(state, index);
  const selfOrder = state.groups[0].orders[1];
  assert.equal(orderMoney(selfOrder, ledger, index).status, "自用");
  assert.equal(orderTrack(state.groups[0], selfOrder, index).stage, "已交付");
  const spending = selfSpending(state, index);
  assert.equal(spending.byGroup[0].productTwd, 500);
  assert.equal(spending.byGroup[0].freightTwd, 80);
  assert.equal(buildFriendViews(state).some(view => view.name === "哈娜本人"), false);
});

test("團狀態自動推算，已完成由手動標記", () => {
  const { state } = load();
  const index = buildIndex(state);
  // 201 在已到貨運單；203 沒有運單但舊狀態是部分到貨 → 未到
  assert.equal(groupStatus(state.groups[0], index), "部分出貨");
  assert.equal(groupStatus(state.groups[1], index), "已完成");
  const reopened: State = { ...state, groups: state.groups.map(g => g.id === 11 ? { ...g, completedAt: undefined } : g) };
  assert.equal(groupStatus(reopened.groups[1], buildIndex(reopened)), "已出貨");
});

test("預付餘額會自動扣抵之後的新款項", () => {
  const { state } = load();
  state.payments.push({ id: 3, friendId: 1700000000003, amount: 500, date: "2026-08-20", method: "現金", note: "", allocations: [] });
  let ledger = buildLedger(state);
  assert.equal(ledger.friends.get(1700000000003)?.credit, 500);
  state.groups[0].orders[2].lines[0] = { productId: 101, quantity: 2, unitTwd: 150, payer: "我代墊・需收款" };
  const index = buildIndex(state);
  ledger = buildLedger(state, index);
  assert.equal(orderMoney(state.groups[0].orders[2], ledger, index).status, "已付款");
  assert.equal(ledger.friends.get(1700000000003)?.credit, 200);
});

test("自動分配依時間先後，刪除訂單會清掉運單與分配", () => {
  const { state } = load();
  const ledger = buildLedger(state);
  const open = [...ledger.charges.values()].filter(c => c.friendId === 1700000000001 && c.balance > 0);
  assert.deepEqual(suggestAllocations(open, 200).map(a => [a.orderId, a.kind, a.amount]), [[201, "product", 200]]);
  const next = removeOrders(state, [201]);
  assert.equal(next.waybills[0].items.length, 1);
  assert.equal(next.payments[0].allocations.length, 0);
  // 原本分配的錢變成預付，扣到其他款項後剩下的仍是預付
  assert.ok((buildLedger(next).friends.get(1700000000001)?.credit ?? 0) > 0);
});

test("朋友端資料不含私人欄位", () => {
  const { state } = load();
  state.waybills[0].note = "直寄小文，私人備註";
  const json = JSON.stringify(buildFriendViews(state));
  assert.equal(json.includes("私人備註"), false);
  assert.equal(json.includes("freightTwd"), false);
});
