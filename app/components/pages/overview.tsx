"use client";

import { groupStatus, orderMoney, orderTrack, showDate, todayIso, twd } from "../../lib/model";
import { useApp } from "../../lib/store";
import { Empty, Figures, GroupTag, Money, PageHeader, Panel } from "../ui";

export function OverviewPage() {
  const { state, index, ledger, go, openDrawer } = useApp();
  const accounts = [...ledger.friends.values()];
  const owing = accounts.filter(account => account.balance > 0).sort((a, b) => b.balance - a.balance);
  const credit = accounts.reduce((sum, account) => sum + account.credit, 0);
  const tracks = state.groups.flatMap(group => group.orders.map(order => ({ group, order, track: orderTrack(group, order, index) })));
  const readyByFriend = new Map<number, number>();
  tracks.filter(item => item.track.needsParcel).forEach(item => readyByFriend.set(item.order.friendId, (readyByFriend.get(item.order.friendId) ?? 0) + 1));
  const moving = tracks.filter(item => item.track.stage === "運回中").length;
  const active = state.groups.filter(group => !group.completedAt).sort((a, b) => (b.saleDate || "").localeCompare(a.saleDate || ""));
  const name = (id: number) => index.friendById.get(id)?.name ?? "未知";

  return <>
    <PageHeader title="總覽" description={showDate(todayIso())} actions={<>
      <button className="btn" onClick={() => openDrawer({ kind: "payment" })}>記錄收款</button>
      <button className="btn btn-primary" onClick={() => openDrawer({ kind: "group" })}>新增代購團</button>
    </>} />

    {state.migrationNotes.length > 0 && <div className="banner banner-info"><div><strong>資料已升級為新版格式</strong><p>轉換時有 {state.migrationNotes.length} 件事需要妳看一下，詳細內容在「設定 › 資料檢查」。</p></div><div className="banner-actions"><button className="btn" onClick={() => go({ page: "settings" })}>查看</button></div></div>}

    <Figures items={[
      { label: "待收款", value: twd(owing.reduce((sum, account) => sum + account.balance, 0)), hint: `${owing.length} 位朋友`, tone: owing.length ? "warn" : undefined },
      { label: "預付餘額", value: twd(credit), hint: "會自動扣抵之後的款項" },
      { label: "可以出貨", value: `${[...readyByFriend.values()].reduce((a, b) => a + b, 0)} 筆`, hint: `${readyByFriend.size} 位朋友` },
      { label: "運回中", value: `${moving} 筆`, hint: "已申請國際運送" },
    ]} />

    <div className="split">
      <Panel title="待收款" meta="點一下直接記錄收款" flush>
        {owing.length ? <ul className="rows">{owing.slice(0, 8).map(account => <li key={account.friendId}><button className="row-btn" onClick={() => openDrawer({ kind: "payment", friendId: account.friendId })}><span>{name(account.friendId)}</span><Money value={account.balance} strong /></button></li>)}</ul> : <Empty title="目前沒有待收款" />}
      </Panel>
      <Panel title="可以出貨" meta="已到貨、還沒放進包裹" flush>
        {readyByFriend.size ? <ul className="rows">{[...readyByFriend.entries()].map(([friendId, count]) => <li key={friendId}><button className="row-btn" onClick={() => openDrawer({ kind: "parcel", friendId })}><span>{name(friendId)}</span><span className="muted">{count} 筆訂單</span></button></li>)}</ul> : <Empty title="沒有等待出貨的訂單" />}
      </Panel>
    </div>

    <Panel title="進行中的代購團" meta={`${active.length} 團`} actions={<button className="btn btn-ghost" onClick={() => go({ page: "groups" })}>全部代購團</button>} flush>
      {active.length ? <div className="table-scroll"><table className="table">
        <thead><tr><th>代購團</th><th>狀態</th><th className="r">訂單</th><th className="r">已到貨</th><th className="r">已出貨</th><th className="r">尚未收款</th></tr></thead>
        <tbody>{active.map(group => {
          const groupTracks = group.orders.map(order => orderTrack(group, order, index));
          const balance = group.orders.reduce((sum, order) => sum + orderMoney(order, ledger, index).balance, 0);
          return <tr key={group.id} className="clickable" onClick={() => go({ page: "groups", groupId: group.id })}>
            <td><strong>{group.name}</strong><small>開賣 {showDate(group.saleDate)}</small></td>
            <td><GroupTag status={groupStatus(group, index)} /></td>
            <td className="r num">{group.orders.length}</td>
            <td className="r num">{groupTracks.filter(track => track.arrived).length}</td>
            <td className="r num">{groupTracks.filter(track => track.out).length}</td>
            <td className="r">{balance > 0 ? <Money value={balance} /> : <span className="muted">—</span>}</td>
          </tr>;
        })}</tbody>
      </table></div> : <Empty title="還沒有進行中的代購團" action={<button className="btn btn-primary" onClick={() => openDrawer({ kind: "group" })}>新增代購團</button>} />}
    </Panel>
  </>;
}
