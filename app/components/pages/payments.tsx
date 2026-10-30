"use client";

import { useState } from "react";
import { showDate, todayIso } from "../../lib/model";
import { useApp } from "../../lib/store";
import { Empty, Figures, Money, PageHeader, Panel, Segmented, Tag } from "../ui";

const tabs = ["應收款項", "收款紀錄", "支出紀錄"] as const;

export function PaymentsPage() {
  const { state, index, ledger, openDrawer } = useApp();
  const [tab, setTab] = useState<(typeof tabs)[number]>("應收款項");
  const [open, setOpen] = useState<number | null>(null);
  const accounts = [...ledger.friends.values()].filter(account => account.balance > 0 || account.credit > 0)
    .sort((a, b) => b.balance - a.balance || b.credit - a.credit);
  const charges = [...ledger.charges.values()];
  const totalBalance = accounts.reduce((sum, account) => sum + account.balance, 0);
  const totalCredit = accounts.reduce((sum, account) => sum + account.credit, 0);
  const month = todayIso().slice(0, 7);
  const name = (id: number) => index.friendById.get(id)?.name ?? "未知";
  const payments = [...state.payments].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const expenses = [...state.expenses].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);

  return <>
    <PageHeader title="款項" description="收款會依金額扣抵款項，付多的部分記為預付餘額，之後有新款項時自動扣抵。" actions={tab === "支出紀錄"
      ? <button className="btn btn-primary" onClick={() => openDrawer({ kind: "expense" })}>新增支出</button>
      : <button className="btn btn-primary" onClick={() => openDrawer({ kind: "payment" })}>記錄收款</button>} />
    <Figures items={[
      { label: "待收款", value: <Money value={totalBalance} />, hint: `${accounts.filter(a => a.balance > 0).length} 位朋友`, tone: totalBalance > 0 ? "warn" : undefined },
      { label: "預付餘額", value: <Money value={totalCredit} />, hint: `${accounts.filter(a => a.credit > 0).length} 位朋友` },
      { label: "本月收款", value: <Money value={state.payments.filter(p => p.date.startsWith(month)).reduce((sum, p) => sum + p.amount, 0)} /> },
      { label: "本月支出", value: <Money value={state.expenses.filter(e => e.date.startsWith(month)).reduce((sum, e) => sum + e.amount, 0)} /> },
    ]} />
    <Panel flush title={<Segmented label="款項分類" value={tab} options={tabs} onChange={setTab} />}>
      {tab === "應收款項" && (accounts.length ? <div className="table-scroll"><table className="table">
        <thead><tr><th>朋友</th><th className="r">應收合計</th><th className="r">已收</th><th className="r">尚未收款</th><th className="r">預付餘額</th><th /></tr></thead>
        {accounts.map(account => {
          const items = charges.filter(charge => charge.friendId === account.friendId && charge.balance > 0);
          const expanded = open === account.friendId;
          return <tbody key={account.friendId} className={expanded ? "expanded" : ""}>
            <tr className="clickable" onClick={() => setOpen(expanded ? null : account.friendId)} aria-expanded={expanded}>
              <td><strong>{name(account.friendId)}</strong><small>{items.length} 筆待收</small></td>
              <td className="r"><Money value={account.due} /></td>
              <td className="r"><Money value={account.paid} muted /></td>
              <td className="r">{account.balance > 0 ? <Money value={account.balance} strong /> : <span className="muted">—</span>}</td>
              <td className="r">{account.credit > 0 ? <Money value={account.credit} /> : <span className="muted">—</span>}</td>
              <td className="r"><button className="btn btn-small" onClick={event => { event.stopPropagation(); openDrawer({ kind: "payment", friendId: account.friendId }); }}>記錄收款</button></td>
            </tr>
            {expanded && items.map(charge => {
              const group = state.groups.find(item => item.id === charge.groupId);
              const order = index.orderById.get(charge.orderId);
              return <tr key={charge.key} className="sub-row clickable" onClick={() => group && openDrawer({ kind: "order", groupId: group.id, orderId: charge.orderId })}>
                <td>{charge.kind === "product" ? "商品款" : "國際運費"}<small>{group?.name}，{order?.code}</small></td>
                <td className="r"><Money value={charge.amount} /></td>
                <td className="r"><Money value={charge.paid} muted /></td>
                <td className="r"><Money value={charge.balance} /></td>
                <td /><td />
              </tr>;
            })}
          </tbody>;
        })}
      </table></div> : <Empty title="所有款項都已收齊" />)}

      {tab === "收款紀錄" && (payments.length ? <div className="table-scroll"><table className="table">
        <thead><tr><th>日期</th><th>朋友</th><th>方式</th><th>備註</th><th className="r">收款</th><th className="r">存為預付</th></tr></thead>
        <tbody>{payments.map(payment => {
          const info = ledger.payments.get(payment.id);
          return <tr key={payment.id} className="clickable" onClick={() => openDrawer({ kind: "payment", id: payment.id })}>
            <td className="num">{showDate(payment.date)}</td><td><strong>{name(payment.friendId)}</strong></td><td>{payment.method}</td><td className="wrap muted">{payment.note || "—"}</td>
            <td className="r"><Money value={payment.amount} strong /></td>
            <td className="r">{info?.toCredit ? <Money value={info.toCredit} /> : <span className="muted">—</span>}</td>
          </tr>;
        })}</tbody>
      </table></div> : <Empty title="還沒有收款紀錄" action={<button className="btn btn-primary" onClick={() => openDrawer({ kind: "payment" })}>記錄收款</button>} />)}

      {tab === "支出紀錄" && (expenses.length ? <div className="table-scroll"><table className="table">
        <thead><tr><th>日期</th><th>類別</th><th>代購團</th><th>備註</th><th className="r">金額</th></tr></thead>
        <tbody>{expenses.map(expense => <tr key={expense.id} className="clickable" onClick={() => openDrawer({ kind: "expense", id: expense.id })}>
          <td className="num">{showDate(expense.date)}</td><td><Tag tone="gray">{expense.category}</Tag></td><td>{state.groups.find(group => group.id === expense.groupId)?.name ?? <span className="muted">—</span>}</td><td className="wrap muted">{expense.note || "—"}</td><td className="r"><Money value={expense.amount} /></td>
        </tr>)}</tbody>
      </table></div> : <Empty title="還沒有支出紀錄" action={<button className="btn btn-primary" onClick={() => openDrawer({ kind: "expense" })}>新增支出</button>} />)}
    </Panel>
  </>;
}
