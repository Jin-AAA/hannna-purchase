"use client";

import { FormEvent, useMemo, useState } from "react";
import { buildLedger, chargeKey, newId, suggestAllocations, todayIso, type Allocation, type ChargeState } from "../../lib/model";
import { useApp } from "../../lib/store";
import { Drawer, Field, Money } from "../ui";

export function PaymentForm({ id, friendId: presetFriend }: { id?: number; friendId?: number }) {
  const { state, update, index, closeDrawer, notify, confirm } = useApp();
  const payment = state.payments.find(item => item.id === id);
  const friends = state.friends.filter(friend => !friend.isSelf);
  const [friendId, setFriendId] = useState<number | "">(payment?.friendId ?? presetFriend ?? "");
  const [amount, setAmount] = useState(payment ? String(payment.amount) : "");
  const [date, setDate] = useState(payment?.date || todayIso());
  const [method, setMethod] = useState(payment?.method ?? state.settings.paymentMethods[0] ?? "銀行轉帳");
  const [note, setNote] = useState(payment?.note ?? "");
  const [manual, setManual] = useState<Record<string, string> | null>(() => payment ? Object.fromEntries(payment.allocations.map(a => [chargeKey(a.orderId, a.kind), String(a.amount)])) : null);
  const [error, setError] = useState("");

  // 先把這筆收款拿掉，算出「收這筆之前」的帳。
  const before = useMemo(() => buildLedger({ ...state, payments: state.payments.filter(item => item.id !== id) }, index), [state, id, index]);
  const open: ChargeState[] = friendId === "" ? [] : [...before.charges.values()].filter(charge => charge.friendId === friendId && charge.balance > 0);
  const credit = friendId === "" ? 0 : before.friends.get(friendId)?.credit ?? 0;
  const value = Math.max(0, Math.round(Number(amount) || 0));
  const allocations: Record<string, number> = manual
    ? Object.fromEntries(Object.entries(manual).map(([key, raw]) => [key, Math.max(0, Math.round(Number(raw) || 0))]))
    : Object.fromEntries(suggestAllocations(open, value).map(a => [chargeKey(a.orderId, a.kind), a.amount]));
  const allocated = open.reduce((sum, charge) => sum + Math.min(allocations[charge.key] ?? 0, charge.balance), 0);
  const toCredit = value - allocated;
  const methods = Array.from(new Set([...state.settings.paymentMethods, method]));

  function setAllocation(key: string, raw: string) {
    setManual(current => ({ ...(current ?? Object.fromEntries(Object.entries(allocations).map(([k, v]) => [k, String(v)]))), [key]: raw }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (friendId === "") return setError("請選擇付款的朋友");
    if (value <= 0) return setError("請填寫收款金額");
    if (toCredit < 0) return setError("分配到款項的金額超過這次收款");
    const over = open.find(charge => (allocations[charge.key] ?? 0) > charge.balance);
    if (over) return setError("有款項分配的金額超過尚未付的金額");
    const list: Allocation[] = open.flatMap(charge => (allocations[charge.key] ?? 0) > 0 ? [{ orderId: charge.orderId, kind: charge.kind, amount: allocations[charge.key] }] : []);
    const record = { id: payment?.id ?? newId(), friendId, amount: value, date, method, note: note.trim(), allocations: list };
    update(current => ({ ...current, payments: payment ? current.payments.map(item => item.id === payment.id ? record : item) : [record, ...current.payments] }));
    notify(toCredit > 0 ? `已記錄收款，其中 NT$${toCredit.toLocaleString()} 存為預付餘額` : "已記錄收款");
    closeDrawer();
  }
  function remove() {
    if (!payment) return;
    confirm({ title: "刪除這筆收款？", danger: true, confirm: "刪除收款", body: <p>{index.friendById.get(payment.friendId)?.name} 在 {payment.date.replaceAll("-", "/")} 的 <Money value={payment.amount} /> 會被刪除，相關款項會恢復成未付。</p>, onConfirm: () => { update(current => ({ ...current, payments: current.payments.filter(item => item.id !== payment.id) })); closeDrawer(); notify("收款已刪除"); } });
  }

  return <Drawer title={payment ? "編輯收款" : "記錄收款"} onClose={closeDrawer} footer={<>
    {payment && <button type="button" className="btn btn-danger-ghost" onClick={remove}>刪除收款</button>}
    <span className="spacer" />
    <button type="button" className="btn" onClick={closeDrawer}>取消</button>
    <button type="submit" form="payment-form" className="btn btn-primary">{payment ? "儲存變更" : "記錄收款"}</button>
  </>}>
    <form id="payment-form" className="stack" onSubmit={submit}>
      <div className="form-grid">
        <Field label="朋友"><select className="input" value={friendId} onChange={event => { setFriendId(event.target.value === "" ? "" : Number(event.target.value)); setManual(null); }}><option value="">選擇朋友</option>{friends.map(friend => <option key={friend.id} value={friend.id}>{friend.name}</option>)}</select></Field>
        <Field label="收款金額（NT$）"><input className="input num" type="number" min="1" inputMode="numeric" value={amount} onChange={event => setAmount(event.target.value)} /></Field>
        <Field label="收款日"><input className="input" type="date" value={date} onChange={event => setDate(event.target.value)} /></Field>
        <Field label="方式"><select className="input" value={method} onChange={event => setMethod(event.target.value)}>{methods.map(item => <option key={item}>{item}</option>)}</select></Field>
      </div>

      <fieldset className="block">
        <legend>這筆錢付哪些款項<span>{manual ? "已手動調整" : "自動從最早的款項開始扣"}</span></legend>
        {credit > 0 && <p className="muted small">她另外還有 <Money value={credit} /> 預付餘額，已經先扣抵在下列款項中。</p>}
        {friendId === "" ? <p className="muted">先選擇朋友。</p> : open.length ? <div className="alloc-list">
          {open.map(charge => {
            const group = state.groups.find(item => item.id === charge.groupId);
            const order = index.orderById.get(charge.orderId);
            return <label key={charge.key} className="alloc-row">
              <span><strong>{charge.kind === "product" ? "商品款" : "國際運費"}</strong><small>{group?.name}，{order?.code}</small></span>
              <span className="muted num">尚欠 <Money value={charge.balance} /></span>
              <input className="input num" type="number" min="0" max={charge.balance} value={manual ? manual[charge.key] ?? "" : allocations[charge.key] ? String(allocations[charge.key]) : ""} placeholder="0" onChange={event => setAllocation(charge.key, event.target.value)} aria-label="分配金額" />
            </label>;
          })}
          {manual && <button type="button" className="btn btn-ghost btn-small" onClick={() => setManual(null)}>改回自動分配</button>}
        </div> : <p className="muted">這位朋友目前沒有待收款項，這筆錢會全部存為預付餘額。</p>}
      </fieldset>

      <dl className="totals">
        <div><dt>這次收款</dt><dd><Money value={value} /></dd></div>
        <div><dt>扣抵款項</dt><dd><Money value={allocated} /></dd></div>
        <div className={toCredit < 0 ? "bad" : ""}><dt>{toCredit < 0 ? "超過收款" : "存為預付餘額"}</dt><dd><Money value={Math.abs(toCredit)} strong /></dd></div>
      </dl>
      <Field label="備註" hint="朋友看不到備註"><input className="input" value={note} onChange={event => setNote(event.target.value)} placeholder="例如：商品款與運費一起付" /></Field>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  </Drawer>;
}
