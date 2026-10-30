"use client";

import { useState } from "react";
import { useApp } from "../../lib/store";
import { Empty, Money, PageHeader, Panel, Tag } from "../ui";

export const formatLogin = (iso?: string) => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-TW", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
};

export function FriendsPage() {
  const { state, ledger, portal, openDrawer } = useApp();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const orderCount = new Map<number, number>();
  state.groups.forEach(group => group.orders.forEach(order => orderCount.set(order.friendId, (orderCount.get(order.friendId) ?? 0) + 1)));
  const rows = state.friends.filter(friend => !q || [friend.name, friend.note, friend.portalNote].some(text => text.toLowerCase().includes(q)))
    .sort((a, b) => Number(Boolean(b.isSelf)) - Number(Boolean(a.isSelf)) || a.name.localeCompare(b.name, "zh-Hant"));

  return <>
    <PageHeader title="朋友" description="朋友端帳號由妳開通：新增朋友後設定一組初始密碼交給她，她登入後可以自己改密碼。" actions={<button className="btn btn-primary" onClick={() => openDrawer({ kind: "friend" })}>新增朋友</button>} />
    <Panel flush title={`${rows.length} 位`} actions={<input className="input search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜尋名稱或備註" aria-label="搜尋朋友" />}>
      {rows.length ? <div className="table-scroll"><table className="table">
        <thead><tr><th>名稱</th><th className="r">訂單</th><th className="r">尚未收款</th><th className="r">預付餘額</th><th>朋友端</th><th>最後登入</th></tr></thead>
        <tbody>{rows.map(friend => {
          const account = ledger.friends.get(friend.id);
          const info = portal[friend.id];
          return <tr key={friend.id} className="clickable" onClick={() => openDrawer({ kind: "friend", id: friend.id })}>
            <td><strong>{friend.name}</strong>{friend.note && <small>{friend.note}</small>}</td>
            <td className="r num">{orderCount.get(friend.id) ?? 0}</td>
            <td className="r">{account?.balance ? <Money value={account.balance} strong /> : <span className="muted">—</span>}</td>
            <td className="r">{account?.credit ? <Money value={account.credit} /> : <span className="muted">—</span>}</td>
            <td>{friend.isSelf ? <Tag tone="pine">本人</Tag> : <Tag>{info?.status ?? "尚未設定"}</Tag>}</td>
            <td className="num muted">{friend.isSelf ? "—" : formatLogin(info?.lastLoginAt) || "—"}</td>
          </tr>;
        })}</tbody>
      </table></div> : <Empty title={state.friends.length ? "找不到符合的朋友" : "還沒有朋友"} action={state.friends.length ? undefined : <button className="btn btn-primary" onClick={() => openDrawer({ kind: "friend" })}>新增朋友</button>} />}
    </Panel>
  </>;
}
