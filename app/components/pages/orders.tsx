"use client";

import { useState } from "react";
import { foreign, orderForeignTotal, orderMoney, orderQuantity, orderTrack, productName, stageOrder, type PaymentStatus, type Stage } from "../../lib/model";
import { useApp } from "../../lib/store";
import { Empty, Money, PageHeader, Panel, PayTag, StageTrack } from "../ui";

const paymentFilters: (PaymentStatus | "全部付款狀態" | "尚未付清")[] = ["全部付款狀態", "尚未付清", "未付款", "部分付款", "已付款", "無應收", "自用"];

export function OrdersPage() {
  const { state, index, ledger, openDrawer } = useApp();
  const [query, setQuery] = useState("");
  const [friendId, setFriendId] = useState("all");
  const [groupId, setGroupId] = useState("all");
  const [pay, setPay] = useState<(typeof paymentFilters)[number]>("全部付款狀態");
  const [stage, setStage] = useState<Stage | "全部進度" | "未交付">("未交付");

  const all = state.groups.flatMap(group => group.orders.map(order => ({ group, order, track: orderTrack(group, order, index), money: orderMoney(order, ledger, index) })));
  const q = query.trim().toLowerCase();
  const rows = all.filter(({ group, order, track, money }) => {
    const friend = index.friendById.get(order.friendId)?.name ?? "";
    if (q && ![friend, group.name, order.code, ...order.lines.map(line => productName(group, line.productId))].some(text => text.toLowerCase().includes(q))) return false;
    if (friendId !== "all" && order.friendId !== Number(friendId)) return false;
    if (groupId !== "all" && group.id !== Number(groupId)) return false;
    if (pay === "尚未付清" ? money.balance <= 0 : pay !== "全部付款狀態" && money.status !== pay) return false;
    if (stage === "未交付" ? track.stage === "已交付" : stage !== "全部進度" && track.stage !== stage) return false;
    return true;
  }).sort((a, b) => b.order.id - a.order.id);

  return <>
    <PageHeader title="訂單" description="所有代購團的訂單集中在這裡，方便跨團查詢與對帳。" />
    <Panel flush title={`${rows.length} 筆訂單`} meta={rows.length !== all.length ? `共 ${all.length} 筆` : undefined} actions={<div className="toolbar">
      <input className="input search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜尋朋友、團名、商品" aria-label="搜尋訂單" />
      <select className="input" value={friendId} onChange={event => setFriendId(event.target.value)} aria-label="朋友"><option value="all">全部朋友</option>{state.friends.map(friend => <option key={friend.id} value={friend.id}>{friend.name}</option>)}</select>
      <select className="input" value={groupId} onChange={event => setGroupId(event.target.value)} aria-label="代購團"><option value="all">全部代購團</option>{state.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select>
      <select className="input" value={pay} onChange={event => setPay(event.target.value as typeof pay)} aria-label="付款狀態">{paymentFilters.map(option => <option key={option}>{option}</option>)}</select>
      <select className="input" value={stage} onChange={event => setStage(event.target.value as typeof stage)} aria-label="進度"><option>未交付</option><option>全部進度</option>{stageOrder.map(option => <option key={option}>{option}</option>)}</select>
    </div>}>
      {rows.length ? <div className="table-scroll"><table className="table">
        <thead><tr><th>朋友</th><th>代購團</th><th className="r">件數</th><th className="r">原幣</th><th className="r">應收</th><th className="r">尚未收款</th><th>付款</th><th>進度</th></tr></thead>
        <tbody>{rows.map(({ group, order, track, money }) => <tr key={order.id} className="clickable" onClick={() => openDrawer({ kind: "order", groupId: group.id, orderId: order.id })}>
          <td><strong>{index.friendById.get(order.friendId)?.name ?? "未知"}</strong><small>{order.code}</small></td>
          <td>{group.name}</td>
          <td className="r num">{orderQuantity(order)}</td>
          <td className="r num">{foreign(orderForeignTotal(group, order), group.currency)}</td>
          <td className="r">{money.due > 0 ? <Money value={money.due} /> : <span className="muted">—</span>}</td>
          <td className="r">{money.balance > 0 ? <Money value={money.balance} strong /> : <span className="muted">—</span>}</td>
          <td><PayTag status={money.status} /></td>
          <td><StageTrack stage={track.stage} /></td>
        </tr>)}</tbody>
      </table></div> : <Empty title="沒有符合條件的訂單">調整搜尋文字或篩選條件。</Empty>}
    </Panel>
  </>;
}
