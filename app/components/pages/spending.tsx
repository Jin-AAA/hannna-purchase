"use client";

import { useState } from "react";
import { currencyInfo, foreign, productName, selfFriend, selfSpending, showDate, type Currency } from "../../lib/model";
import { useApp } from "../../lib/store";
import { Empty, Figures, Money, PageHeader, Panel } from "../ui";

export function SpendingPage() {
  const { state, index, go, openDrawer } = useApp();
  const self = selfFriend(state);
  const { byGroup, absorbed } = selfSpending(state, index);
  const years = Array.from(new Set(byGroup.map(row => row.month.slice(0, 4)).filter(Boolean))).sort().reverse();
  const [year, setYear] = useState("all");
  const rows = byGroup.filter(row => year === "all" || row.month.startsWith(year)).sort((a, b) => b.month.localeCompare(a.month));
  const product = rows.reduce((sum, row) => sum + row.productTwd, 0);
  const freight = rows.reduce((sum, row) => sum + row.freightTwd, 0);
  const foreignByCurrency = new Map<Currency, number>();
  rows.forEach(row => foreignByCurrency.set(row.group.currency, (foreignByCurrency.get(row.group.currency) ?? 0) + row.foreignTotal));
  const months = new Map<string, number>();
  rows.forEach(row => months.set(row.month || "未設定", (months.get(row.month || "未設定") ?? 0) + row.productTwd + row.freightTwd));
  const maxMonth = Math.max(1, ...months.values());
  const absorbedRows = absorbed.filter(row => year === "all" || (row.group.orderedAt || row.group.saleDate).startsWith(year));

  if (!self) return <>
    <PageHeader title="自用開銷" />
    <Panel><Empty title="還沒有指定哪一位是妳自己" action={<button className="btn btn-primary" onClick={() => go({ page: "friends" })}>前往朋友名單</button>}>在朋友資料裡勾選「這是我自己」，妳自己的訂單就會統計在這裡，也不會再出現在應收款項和出貨清單。</Empty></Panel>
  </>;

  return <>
    <PageHeader title="自用開銷" description={`「${self.name}」名下的訂單。台幣金額是妳在訂單裡填的台幣成本，國際運費是運單上分攤給自己的部分。`} actions={years.length > 0 && <select className="input" value={year} onChange={event => setYear(event.target.value)} aria-label="年份"><option value="all">全部年份</option>{years.map(item => <option key={item} value={item}>{item} 年</option>)}</select>} />
    <Figures items={[
      { label: "合計", value: <Money value={product + freight} /> },
      { label: "商品", value: <Money value={product} />, hint: `${rows.reduce((sum, row) => sum + row.quantity, 0)} 件` },
      { label: "國際運費分攤", value: <Money value={freight} /> },
      { label: "原幣金額", value: foreignByCurrency.size ? [...foreignByCurrency.entries()].map(([currency, value]) => foreign(value, currency)).join("、") : "—", hint: [...foreignByCurrency.keys()].map(currency => currencyInfo[currency].label).join("、") || undefined },
    ]} />
    {rows.length ? <>
      <Panel title="每月花費" meta="依下單日，沒有下單日時用開賣日">
        <ol className="month-bars">{[...months.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([month, value]) => <li key={month}>
          <span className="num">{month.replace("-", "/")}</span>
          <span className="bar"><i style={{ width: `${Math.max(2, (value / maxMonth) * 100)}%` }} /></span>
          <Money value={value} />
        </li>)}</ol>
      </Panel>
      <Panel flush title="各代購團">
        <div className="table-scroll"><table className="table">
          <thead><tr><th>代購團</th><th>商品</th><th className="r">原幣</th><th className="r">商品台幣</th><th className="r">運費分攤</th><th className="r">小計</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.group.id} className="clickable" onClick={() => row.orders.length === 1 ? openDrawer({ kind: "order", groupId: row.group.id, orderId: row.orders[0].id }) : go({ page: "groups", groupId: row.group.id })}>
            <td><strong>{row.group.name}</strong><small>{showDate(row.group.orderedAt || row.group.saleDate)}</small></td>
            <td className="wrap">{row.orders.flatMap(order => order.lines.map(line => `${productName(row.group, line.productId)} × ${line.quantity}`)).join("、")}</td>
            <td className="r num">{foreign(row.foreignTotal, row.group.currency)}</td>
            <td className="r">{row.productTwd ? <Money value={row.productTwd} /> : <span className="muted" title="訂單裡還沒填台幣成本">未填</span>}</td>
            <td className="r">{row.freightTwd ? <Money value={row.freightTwd} /> : <span className="muted">—</span>}</td>
            <td className="r"><Money value={row.productTwd + row.freightTwd} strong /></td>
          </tr>)}</tbody>
        </table></div>
      </Panel>
    </> : <Panel><Empty title="這段期間沒有自用的訂單" /></Panel>}
    {absorbedRows.length > 0 && <Panel flush title="幫朋友吸收的商品款" meta="朋友訂單中付款人選「我自行負擔」、且有填台幣金額的品項">
      <div className="table-scroll"><table className="table">
        <thead><tr><th>朋友</th><th>代購團</th><th>商品</th><th className="r">金額</th></tr></thead>
        <tbody>{absorbedRows.map(row => <tr key={`${row.order.id}-${row.line.productId}`}><td>{index.friendById.get(row.order.friendId)?.name}</td><td>{row.group.name}</td><td>{productName(row.group, row.line.productId)} × {row.line.quantity}</td><td className="r"><Money value={row.amount} /></td></tr>)}</tbody>
        <tfoot><tr><td colSpan={3}>合計</td><td className="r"><Money value={absorbedRows.reduce((sum, row) => sum + row.amount, 0)} strong /></td></tr></tfoot>
      </table></div>
    </Panel>}
  </>;
}
