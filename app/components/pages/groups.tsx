"use client";

import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import { currencyInfo, earnedGifts, foreign, groupStatus, groupStatuses, orderForeignTotal, orderMoney, orderQuantity, orderTrack, productName, showDate, todayIso, type GroupStatus } from "../../lib/model";
import { useApp } from "../../lib/store";
import { Empty, Figures, GroupTag, Money, PageHeader, Panel, PayTag, StageTrack } from "../ui";

export function GroupsPage() {
  const { state, index, ledger, go, openDrawer } = useApp();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"進行中" | "全部" | GroupStatus>("進行中");
  const rows = state.groups
    .map(group => ({ group, status: groupStatus(group, index), balance: group.orders.reduce((sum, order) => sum + orderMoney(order, ledger, index).balance, 0) }))
    .filter(row => row.group.name.toLowerCase().includes(query.trim().toLowerCase()))
    .filter(row => filter === "全部" || (filter === "進行中" ? row.status !== "已完成" : row.status === filter))
    .sort((a, b) => (b.group.saleDate || "").localeCompare(a.group.saleDate || "") || b.group.id - a.group.id);

  return <>
    <PageHeader title="代購團" description="每一團記錄商品、單價與滿額贈，團內再為每位朋友建立訂單。" actions={<button className="btn btn-primary" onClick={() => openDrawer({ kind: "group" })}>新增代購團</button>} />
    <Panel flush title={`${rows.length} 個代購團`} actions={<div className="toolbar">
      <input className="input search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜尋團名" aria-label="搜尋團名" />
      <select className="input" value={filter} onChange={event => setFilter(event.target.value as typeof filter)} aria-label="狀態"><option>進行中</option><option>全部</option>{groupStatuses.map(status => <option key={status}>{status}</option>)}</select>
    </div>}>
      {rows.length ? <div className="table-scroll"><table className="table">
        <thead><tr><th>代購團</th><th>開賣日</th><th>下單日</th><th className="r">訂單</th><th>狀態</th><th className="r">尚未收款</th></tr></thead>
        <tbody>{rows.map(({ group, status, balance }) => <tr key={group.id} className="clickable" onClick={() => go({ page: "groups", groupId: group.id })}>
          <td><strong>{group.name}</strong><small>{currencyInfo[group.currency].label}，{group.products.length} 個品項</small></td>
          <td className="num">{showDate(group.saleDate)}</td>
          <td className="num">{showDate(group.orderedAt)}</td>
          <td className="r num">{group.orders.length}</td>
          <td><GroupTag status={status} /></td>
          <td className="r">{balance > 0 ? <Money value={balance} /> : <span className="muted">—</span>}</td>
        </tr>)}</tbody>
      </table></div> : <Empty title={state.groups.length ? "沒有符合條件的代購團" : "還沒有代購團"} action={state.groups.length ? undefined : <button className="btn btn-primary" onClick={() => openDrawer({ kind: "group" })}>新增代購團</button>}>{state.groups.length ? "調整搜尋文字或狀態篩選。" : "先建立一團，填好商品和單價，就能開始記錄朋友的訂單。"}</Empty>}
    </Panel>
  </>;
}

export function GroupDetailPage({ groupId }: { groupId: number }) {
  const { state, index, ledger, go, openDrawer, update, confirm, notify } = useApp();
  const group = state.groups.find(item => item.id === groupId)!;
  const [orderDate, setOrderDate] = useState(todayIso());
  const status = groupStatus(group, index);
  const rows = group.orders.map(order => ({ order, track: orderTrack(group, order, index), money: orderMoney(order, ledger, index), total: orderForeignTotal(group, order) }));
  const due = rows.reduce((sum, row) => sum + row.money.due, 0);
  const balance = rows.reduce((sum, row) => sum + row.money.balance, 0);
  const setGroup = (patch: Partial<typeof group>) => update(current => ({ ...current, groups: current.groups.map(item => (item.id === group.id ? { ...item, ...patch } : item)) }));

  function complete() {
    const unpaid = rows.filter(row => row.money.balance > 0);
    const pending = rows.filter(row => !row.track.out);
    confirm({
      title: "把這團標記為已完成？",
      confirm: "標記為已完成",
      body: unpaid.length || pending.length ? <>
        <p>這團還有沒處理完的事：</p>
        <ul className="bullets">
          {unpaid.length > 0 && <li>{unpaid.length} 筆訂單尚未收齊，共 <Money value={unpaid.reduce((sum, row) => sum + row.money.balance, 0)} /></li>}
          {pending.length > 0 && <li>{pending.length} 筆訂單還沒出貨或交付</li>}
        </ul>
        <p>標記完成後，這些款項和訂單仍會照常顯示在款項與出貨頁。</p>
      </> : <p>所有訂單都已收款並交付。</p>,
      onConfirm: () => { setGroup({ completedAt: todayIso() }); notify(`「${group.name}」已標記為完成`); },
    });
  }

  return <>
    <PageHeader
      back={<button className="back-link" onClick={() => go({ page: "groups" })}><ChevronLeft size={16} />代購團</button>}
      title={group.name}
      description={`${currencyInfo[group.currency].label}，開賣日 ${showDate(group.saleDate)}`}
      actions={<><button className="btn" onClick={() => openDrawer({ kind: "group", id: group.id })}>編輯代購團</button><button className="btn btn-primary" onClick={() => openDrawer({ kind: "order", groupId: group.id })}>新增訂單</button></>}
    />

    <section className="status-strip">
      <div className="status-now"><span>目前狀態</span><GroupTag status={status} /></div>
      <div className="status-control">
        {group.orderedAt
          ? <label className="inline-field"><span>下單日</span><input className="input" type="date" value={group.orderedAt} max={todayIso()} onChange={event => setGroup({ orderedAt: event.target.value || undefined })} /></label>
          : <div className="inline-field"><span>還沒下單</span><input className="input" type="date" value={orderDate} onChange={event => setOrderDate(event.target.value)} aria-label="下單日" /><button className="btn" onClick={() => { setGroup({ orderedAt: orderDate || todayIso() }); notify("已記錄下單日"); }}>記錄下單</button></div>}
      </div>
      <div className="status-control end">
        {group.completedAt
          ? <><span className="muted">{showDate(group.completedAt)} 標記完成</span><button className="btn btn-ghost" onClick={() => setGroup({ completedAt: undefined })}>取消完成</button></>
          : <button className="btn" onClick={complete}>標記為已完成</button>}
      </div>
    </section>

    <Figures items={[
      { label: "訂單", value: `${group.orders.length} 筆`, hint: `${rows.reduce((sum, row) => sum + orderQuantity(row.order), 0)} 件商品` },
      { label: "商品原幣合計", value: foreign(rows.reduce((sum, row) => sum + row.total, 0), group.currency) },
      { label: "應收合計", value: <Money value={due} />, hint: "商品款加國際運費" },
      { label: "尚未收款", value: <Money value={balance} />, tone: balance > 0 ? "warn" : undefined },
    ]} />

    <Panel flush title="訂單" meta="點一下查看或編輯" actions={<button className="btn" onClick={() => openDrawer({ kind: "order", groupId: group.id })}>新增訂單</button>}>
      {rows.length ? <div className="table-scroll"><table className="table">
        <thead><tr><th>訂單</th><th>商品</th><th className="r">原幣</th><th className="r">應收</th><th className="r">尚未收款</th><th>付款</th><th>進度</th></tr></thead>
        <tbody>{rows.map(({ order, track, money, total }) => {
          const gifts = earnedGifts(group, total);
          return <tr key={order.id} className="clickable" onClick={() => openDrawer({ kind: "order", groupId: group.id, orderId: order.id })}>
            <td><strong>{index.friendById.get(order.friendId)?.name ?? "未知"}</strong><small>{order.code}</small></td>
            <td className="wrap">{order.lines.map(line => `${productName(group, line.productId)} × ${line.quantity}`).join("、")}{gifts.length > 0 && <small>贈 {gifts.map(gift => `${gift.giftName} × ${gift.count}`).join("、")}</small>}</td>
            <td className="r num">{foreign(total, group.currency)}</td>
            <td className="r">{money.due > 0 ? <Money value={money.due} /> : <span className="muted">—</span>}</td>
            <td className="r">{money.balance > 0 ? <Money value={money.balance} strong /> : <span className="muted">—</span>}</td>
            <td><PayTag status={money.status} /></td>
            <td><StageTrack stage={track.stage} /></td>
          </tr>;
        })}</tbody>
      </table></div> : <Empty title="這團還沒有訂單" action={<button className="btn btn-primary" onClick={() => openDrawer({ kind: "order", groupId: group.id })}>新增第一筆訂單</button>} />}
    </Panel>

    <div className="split">
      <Panel flush title="商品與單價">
        <table className="table compact"><thead><tr><th>商品</th><th className="r">單價</th><th className="r">已登記</th></tr></thead>
          <tbody>{group.products.map(product => <tr key={product.id}><td>{product.name}</td><td className="r num">{foreign(product.unitPrice, group.currency)}</td><td className="r num">{group.orders.reduce((sum, order) => sum + order.lines.filter(line => line.productId === product.id).reduce((s, line) => s + line.quantity, 0), 0)}</td></tr>)}</tbody>
        </table>
      </Panel>
      <Panel flush title="滿額贈">
        {group.giftRules.length ? <table className="table compact"><thead><tr><th>門檻</th><th>贈品</th><th>計算</th></tr></thead>
          <tbody>{group.giftRules.map(rule => <tr key={rule.id}><td className="num">滿 {foreign(rule.threshold, group.currency)}</td><td>{rule.giftName}</td><td className="muted">{rule.cumulative ? "累贈" : "不累贈"}</td></tr>)}</tbody>
        </table> : <Empty title="這團沒有滿額贈" />}
      </Panel>
    </div>
  </>;
}
