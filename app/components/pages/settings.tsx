"use client";

import { FormEvent, useState } from "react";
import { updatePassword } from "firebase/auth";
import { auth } from "../../firebase";
import { buildIndex, buildLedger, foreign, orderForeignTotal, orderMoney, orderTrack, productName, todayIso } from "../../lib/model";
import { useApp } from "../../lib/store";
import { Field, PageHeader, Panel } from "../ui";

const LIMIT = 1_048_576;

function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const csv = (rows: (string | number)[][]) => "﻿" + rows.map(row => row.map(cell => {
  const text = String(cell ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}).join(",")).join("\n");

function ChipEditor({ label, values, onChange }: { label: string; values: string[]; onChange: (values: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => { const value = draft.trim(); if (value && !values.includes(value)) onChange([...values, value]); setDraft(""); };
  return <div className="field wide"><span className="field-label">{label}</span>
    <div className="chips">{values.map(value => <span key={value} className="chip">{value}<button type="button" aria-label={`移除${value}`} onClick={() => onChange(values.filter(item => item !== value))}>×</button></span>)}
      <input className="input chip-input" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); add(); } }} placeholder="新增後按 Enter" aria-label={`新增${label}`} />
    </div>
  </div>;
}

export function SettingsPage({ storageBytes }: { storageBytes: number }) {
  const { state, update, notify } = useApp();
  const [settings, setSettings] = useState(state.settings);
  const [password, setPassword] = useState("");
  const dirty = JSON.stringify(settings) !== JSON.stringify(state.settings);
  const usage = storageBytes / LIMIT;

  function save(event: FormEvent) {
    event.preventDefault();
    update(current => ({ ...current, settings: { ...settings, siteName: settings.siteName.trim() || "哈娜的小車車", adminName: settings.adminName.trim() || "Jiin", orderPrefix: settings.orderPrefix.trim().toUpperCase() || "ORDER" } }));
    notify("設定已儲存");
  }
  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (password.length < 6) return notify("新密碼至少需要 6 個字元");
    if (!auth.currentUser) return;
    try { await updatePassword(auth.currentUser, password); setPassword(""); notify("登入密碼已更新"); }
    catch { notify("密碼更新失敗：請登出再登入一次後重試"); }
  }
  function exportJson() {
    download(`哈娜的小車車-備份-${todayIso()}.json`, JSON.stringify(state, null, 2), "application/json");
  }
  function exportCsv() {
    const index = buildIndex(state);
    const ledger = buildLedger(state, index);
    const rows: (string | number)[][] = [["代購團", "開賣日", "下單日", "訂單編號", "朋友", "商品", "原幣金額", "應收商品款", "應收國際運費", "已收", "尚未收款", "付款狀態", "進度"]];
    state.groups.forEach(group => group.orders.forEach(order => {
      const money = orderMoney(order, ledger, index);
      rows.push([group.name, group.saleDate, group.orderedAt ?? "", order.code, index.friendById.get(order.friendId)?.name ?? "", order.lines.map(line => `${productName(group, line.productId)}×${line.quantity}`).join("、"), foreign(orderForeignTotal(group, order), group.currency), money.productDue, money.freightDue, money.paid, money.balance, money.status, orderTrack(group, order, index).stage]);
    }));
    download(`哈娜的小車車-訂單-${todayIso()}.csv`, csv(rows), "text/csv;charset=utf-8");
    const paymentRows: (string | number)[][] = [["日期", "朋友", "金額", "方式", "備註", "存為預付"]];
    [...state.payments].sort((a, b) => a.date.localeCompare(b.date)).forEach(payment => paymentRows.push([payment.date, index.friendById.get(payment.friendId)?.name ?? "", payment.amount, payment.method, payment.note, ledger.payments.get(payment.id)?.toCredit ?? 0]));
    window.setTimeout(() => download(`哈娜的小車車-收款-${todayIso()}.csv`, csv(paymentRows), "text/csv;charset=utf-8"), 400);
  }

  return <>
    <PageHeader title="設定" />
    {state.migrationNotes.length > 0 && <Panel title="資料檢查" meta="資料升級為新版格式時發現的事項" actions={<button className="btn" onClick={() => update(current => ({ ...current, migrationNotes: [] }))}>都看過了</button>}>
      <ul className="bullets notes">{state.migrationNotes.map((note, i) => <li key={i}>{note}</li>)}</ul>
    </Panel>}
    <form onSubmit={save}>
      <Panel title="基本設定" actions={<button className="btn btn-primary" type="submit" disabled={!dirty}>儲存設定</button>}>
        <div className="form-grid">
          <Field label="後台名稱"><input className="input" value={settings.siteName} onChange={event => setSettings({ ...settings, siteName: event.target.value })} /></Field>
          <Field label="管理者名稱"><input className="input" value={settings.adminName} onChange={event => setSettings({ ...settings, adminName: event.target.value })} /></Field>
          <Field label="訂單編號開頭" hint={`新訂單會編成「${settings.orderPrefix || "ORDER"} 01」`}><input className="input" value={settings.orderPrefix} onChange={event => setSettings({ ...settings, orderPrefix: event.target.value.toUpperCase() })} /></Field>
          <Field label="預設出貨備註"><input className="input" value={settings.defaultShippingNote} onChange={event => setSettings({ ...settings, defaultShippingNote: event.target.value })} placeholder="建立包裹時自動帶入" /></Field>
          <ChipEditor label="收款方式" values={settings.paymentMethods} onChange={paymentMethods => setSettings({ ...settings, paymentMethods })} />
          <ChipEditor label="交付方式" values={settings.deliveryMethods} onChange={deliveryMethods => setSettings({ ...settings, deliveryMethods })} />
        </div>
      </Panel>
    </form>
    <div className="split">
      <Panel title="後台登入密碼">
        <form className="stack" onSubmit={changePassword}>
          <Field label="新密碼" hint="至少 6 個字元"><input className="input" type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} /></Field>
          <div><button className="btn" type="submit" disabled={!password}>更新密碼</button></div>
        </form>
      </Panel>
      <Panel title="備份與匯出">
        <div className="stack">
          <p className="muted">JSON 是完整備份；CSV 會下載訂單與收款兩個檔案，可以用 Excel 或 Google 試算表開啟。</p>
          <div className="button-row"><button className="btn" onClick={exportJson}>下載完整備份（JSON）</button><button className="btn" onClick={exportCsv}>匯出 CSV</button></div>
          <div className="meter"><div className="meter-head"><span>雲端資料容量</span><span className="num">{(storageBytes / 1024).toFixed(0)} KB ／ 1,024 KB</span></div><span className="bar"><i className={usage > 0.8 ? "warn" : ""} style={{ width: `${Math.min(100, Math.max(1, usage * 100))}%` }} /></span>{usage > 0.8 && <small className="warn-text">容量接近上限，建議先下載備份，再整理已完成的舊代購團。</small>}</div>
        </div>
      </Panel>
    </div>
  </>;
}
