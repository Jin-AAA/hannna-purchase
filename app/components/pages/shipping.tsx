"use client";

import { useState } from "react";
import { orderQuantity, orderTrack, productName, showDate } from "../../lib/model";
import { useApp } from "../../lib/store";
import { Empty, PageHeader, Panel, Segmented, StageTrack, Tag } from "../ui";

const tabs = ["可以出貨", "等待到貨", "包裹紀錄"] as const;

export function ShippingPage() {
  const { state, index, openDrawer } = useApp();
  const [tab, setTab] = useState<(typeof tabs)[number]>("可以出貨");
  const tracks = state.groups.flatMap(group => group.orders.map(order => ({ group, order, track: orderTrack(group, order, index) })))
    .filter(item => !index.friendById.get(item.order.friendId)?.isSelf);
  const ready = tracks.filter(item => item.track.needsParcel);
  const waiting = tracks.filter(item => !item.track.arrived && !item.track.out);
  const byFriend = new Map<number, typeof ready>();
  ready.forEach(item => byFriend.set(item.order.friendId, [...(byFriend.get(item.order.friendId) ?? []), item]));
  const parcels = [...state.parcels].sort((a, b) => b.id - a.id);
  const name = (id: number) => index.friendById.get(id)?.name ?? "未知";

  return <>
    <PageHeader title="出貨" description="已到貨的商品依朋友合併成包裹寄出或面交。直寄朋友與本人的訂單到貨後會自動算交付，不會出現在這裡。" actions={<button className="btn btn-primary" onClick={() => openDrawer({ kind: "parcel" })}>建立包裹</button>} />
    <Panel flush title={<Segmented label="出貨分類" value={tab} options={tabs} onChange={setTab} />} meta={tab === "可以出貨" ? `${byFriend.size} 位朋友，${ready.length} 筆訂單` : tab === "等待到貨" ? `${waiting.length} 筆訂單` : `${parcels.length} 個包裹`}>
      {tab === "可以出貨" && (byFriend.size ? <div className="friend-batches">{[...byFriend.entries()].map(([friendId, items]) => <article key={friendId} className="batch">
        <header><strong>{name(friendId)}</strong><span className="muted">{items.length} 筆訂單，{items.reduce((sum, item) => sum + orderQuantity(item.order), 0)} 件</span><button className="btn" onClick={() => openDrawer({ kind: "parcel", friendId })}>建立包裹</button></header>
        <ul>{items.map(({ group, order }) => <li key={order.id}><span>{group.name}</span><span className="muted wrap">{order.lines.map(line => `${productName(group, line.productId)} × ${line.quantity}`).join("、")}</span></li>)}</ul>
      </article>)}</div> : <Empty title="目前沒有可以出貨的訂單">國際運單標成「已到貨」後，訂單會出現在這裡。</Empty>)}

      {tab === "等待到貨" && (waiting.length ? <div className="table-scroll"><table className="table">
        <thead><tr><th>朋友</th><th>代購團</th><th className="r">件數</th><th>進度</th></tr></thead>
        <tbody>{waiting.map(({ group, order, track }) => <tr key={order.id} className="clickable" onClick={() => openDrawer({ kind: "order", groupId: group.id, orderId: order.id })}><td><strong>{name(order.friendId)}</strong><small>{order.code}</small></td><td>{group.name}</td><td className="r num">{orderQuantity(order)}</td><td><StageTrack stage={track.stage} /></td></tr>)}</tbody>
      </table></div> : <Empty title="沒有等待到貨的訂單" />)}

      {tab === "包裹紀錄" && (parcels.length ? <div className="table-scroll"><table className="table">
        <thead><tr><th>包裹</th><th>朋友</th><th>方式</th><th className="r">訂單</th><th>出貨／面交日</th><th>寄件編號</th><th>狀態</th></tr></thead>
        <tbody>{parcels.map(parcel => <tr key={parcel.id} className="clickable" onClick={() => openDrawer({ kind: "parcel", id: parcel.id })}>
          <td><strong>{parcel.code}</strong></td><td>{name(parcel.friendId)}</td><td>{parcel.method}</td><td className="r num">{parcel.orderIds.length}</td><td className="num">{showDate(parcel.date)}</td><td className="num">{parcel.tracking || <span className="muted">—</span>}</td><td><Tag>{parcel.status}</Tag></td>
        </tr>)}</tbody>
      </table></div> : <Empty title="還沒有包裹紀錄" />)}
    </Panel>
  </>;
}
