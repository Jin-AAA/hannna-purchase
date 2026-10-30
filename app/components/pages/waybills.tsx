"use client";

import { useState } from "react";
import { showDate } from "../../lib/model";
import { useApp } from "../../lib/store";
import { Empty, Figures, Money, PageHeader, Panel, Segmented, Tag } from "../ui";

const tabs = ["運回中", "已到貨", "全部"] as const;

export function WaybillsPage() {
  const { state, index, openDrawer } = useApp();
  const [tab, setTab] = useState<(typeof tabs)[number]>("運回中");
  const rows = state.waybills
    .filter(waybill => tab === "全部" || (tab === "運回中" ? waybill.status === "已申請運回" : waybill.status === "已到貨"))
    .sort((a, b) => (b.appliedDate || "").localeCompare(a.appliedDate || "") || b.id - a.id);
  const sumFreight = state.waybills.reduce((sum, waybill) => sum + waybill.freightTwd, 0);
  const sumCharged = state.waybills.reduce((sum, waybill) => sum + waybill.items.reduce((s, item) => s + (index.friendById.get(index.orderById.get(item.orderId)?.friendId ?? 0)?.isSelf ? 0 : item.freightTwd), 0), 0);

  return <>
    <PageHeader title="國際運單" description="把不同代購團的訂單合併成一張運單寄回台灣，運單到貨後訂單會自動變成已到貨。" actions={<button className="btn btn-primary" onClick={() => openDrawer({ kind: "waybill" })}>建立運單</button>} />
    <Figures items={[
      { label: "運回中", value: `${state.waybills.filter(w => w.status === "已申請運回").length} 張` },
      { label: "已到貨", value: `${state.waybills.filter(w => w.status === "已到貨").length} 張` },
      { label: "實付國際運費", value: <Money value={sumFreight} /> },
      { label: "向朋友收的運費", value: <Money value={sumCharged} />, hint: "不含本人分攤" },
    ]} />
    <Panel flush title={<Segmented label="運單狀態" value={tab} options={tabs} onChange={setTab} />}>
      {rows.length ? <div className="table-scroll"><table className="table">
        <thead><tr><th>運單</th><th>內容</th><th className="r">重量</th><th className="r">實付運費</th><th className="r">向朋友收</th><th>收貨地</th><th>申請日</th><th>狀態</th></tr></thead>
        <tbody>{rows.map(waybill => {
          const groups = Array.from(new Set(waybill.items.map(item => index.groupByOrder.get(item.orderId)?.name).filter(Boolean)));
          const charged = waybill.items.reduce((sum, item) => sum + (index.friendById.get(index.orderById.get(item.orderId)?.friendId ?? 0)?.isSelf ? 0 : item.freightTwd), 0);
          return <tr key={waybill.id} className="clickable" onClick={() => openDrawer({ kind: "waybill", id: waybill.id })}>
            <td><strong>{waybill.code}</strong><small>{waybill.country}{waybill.tracking ? `，${waybill.tracking}` : "，未填物流單號"}</small></td>
            <td className="wrap">{waybill.items.length} 筆訂單<small>{groups.join("、")}</small></td>
            <td className="r num">{waybill.totalWeightG.toLocaleString()} g</td>
            <td className="r"><Money value={waybill.freightTwd} /></td>
            <td className="r">{charged ? <Money value={charged} /> : <span className="muted">—</span>}</td>
            <td>{waybill.destination === "直寄朋友" ? `直寄 ${index.friendById.get(waybill.recipientFriendId ?? 0)?.name ?? ""}` : "寄到我這裡"}</td>
            <td className="num">{showDate(waybill.appliedDate)}</td>
            <td><Tag>{waybill.status}</Tag>{waybill.arrivedDate && <small>{showDate(waybill.arrivedDate)}</small>}</td>
          </tr>;
        })}</tbody>
      </table></div> : <Empty title={tab === "運回中" ? "沒有運回中的運單" : "沒有運單"} action={<button className="btn btn-primary" onClick={() => openDrawer({ kind: "waybill" })}>建立運單</button>} />}
    </Panel>
  </>;
}
