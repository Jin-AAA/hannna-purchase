"use client";

import { FormEvent, useState } from "react";
import { newId, orderQuantity, orderTrack, productName, todayIso, type Parcel, type ParcelStatus } from "../../lib/model";
import { useApp } from "../../lib/store";
import { Drawer, Field } from "../ui";

export function ParcelForm({ id, friendId: presetFriend }: { id?: number; friendId?: number }) {
  const { state, update, index, closeDrawer, notify, confirm } = useApp();
  const parcel = state.parcels.find(item => item.id === id);
  const [friendId, setFriendId] = useState<number | "">(parcel?.friendId ?? presetFriend ?? "");
  // 從「可以出貨」進來時，預先勾好這位朋友所有可出貨的訂單。
  const [orderIds, setOrderIds] = useState<number[]>(() => parcel?.orderIds ?? (presetFriend
    ? state.groups.flatMap(group => group.orders.filter(order => order.friendId === presetFriend && orderTrack(group, order, index).needsParcel).map(order => order.id))
    : []));
  const [method, setMethod] = useState(parcel?.method ?? state.settings.deliveryMethods[0] ?? "面交");
  const [status, setStatus] = useState<ParcelStatus>(parcel?.status ?? "待出貨");
  const [date, setDate] = useState(parcel?.date || todayIso());
  const [tracking, setTracking] = useState(parcel?.tracking ?? "");
  const [note, setNote] = useState(parcel?.note ?? state.settings.defaultShippingNote);
  const [error, setError] = useState("");

  const options = state.groups.flatMap(group => group.orders
    .filter(order => order.friendId === friendId)
    .filter(order => orderIds.includes(order.id) || orderTrack(group, order, index).needsParcel)
    .map(order => ({ group, order })));
  const methods = Array.from(new Set([...state.settings.deliveryMethods, method]));

  function submit(event: FormEvent) {
    event.preventDefault();
    if (friendId === "") return setError("請選擇朋友");
    if (!orderIds.length) return setError("請至少勾選一筆訂單");
    const value: Parcel = { id: parcel?.id ?? newId(), code: parcel?.code ?? `SHIP-${String(state.counters.parcel + 1).padStart(3, "0")}`, friendId, orderIds, method, status, date, tracking: tracking.trim(), note: note.trim() };
    update(current => parcel
      ? { ...current, parcels: current.parcels.map(item => item.id === parcel.id ? value : item) }
      : { ...current, parcels: [value, ...current.parcels], counters: { ...current.counters, parcel: current.counters.parcel + 1 } });
    notify(parcel ? "包裹已儲存" : `已建立 ${index.friendById.get(friendId)?.name} 的包裹`);
    closeDrawer();
  }
  function remove() {
    if (!parcel) return;
    confirm({ title: `刪除包裹 ${parcel.code}？`, danger: true, confirm: "刪除包裹", body: <p>裡面的 {parcel.orderIds.length} 筆訂單會回到「可以出貨」。</p>, onConfirm: () => { update(current => ({ ...current, parcels: current.parcels.filter(item => item.id !== parcel.id) })); closeDrawer(); notify("包裹已刪除"); } });
  }

  return <Drawer title={parcel ? `包裹 ${parcel.code}` : "建立包裹"} onClose={closeDrawer} footer={<>
    {parcel && <button type="button" className="btn btn-danger-ghost" onClick={remove}>刪除包裹</button>}
    <span className="spacer" />
    <button type="button" className="btn" onClick={closeDrawer}>取消</button>
    <button type="submit" form="parcel-form" className="btn btn-primary">{parcel ? "儲存變更" : "建立包裹"}</button>
  </>}>
    <form id="parcel-form" className="stack" onSubmit={submit}>
      <Field label="朋友"><select className="input" value={friendId} disabled={Boolean(parcel)} onChange={event => { setFriendId(event.target.value === "" ? "" : Number(event.target.value)); setOrderIds([]); setError(""); }}><option value="">選擇朋友</option>{state.friends.filter(friend => !friend.isSelf).map(friend => <option key={friend.id} value={friend.id}>{friend.name}</option>)}</select></Field>
      <fieldset className="block">
        <legend>包裹內容<span>只列出已到貨、還沒放進其他包裹的訂單，可以跨代購團合併</span></legend>
        {friendId === "" ? <p className="muted">先選擇朋友。</p> : options.length ? <div className="check-list">{options.map(({ group, order }) => <label key={order.id} className="check-row">
          <input type="checkbox" checked={orderIds.includes(order.id)} onChange={event => setOrderIds(current => event.target.checked ? [...current, order.id] : current.filter(item => item !== order.id))} />
          <span><strong>{group.name}</strong><small>{order.code}，{orderQuantity(order)} 件：{order.lines.map(line => `${productName(group, line.productId)} × ${line.quantity}`).join("、")}</small></span>
        </label>)}</div> : <p className="muted">這位朋友目前沒有可以出貨的訂單。</p>}
      </fieldset>
      <div className="form-grid">
        <Field label="交付方式"><select className="input" value={method} onChange={event => setMethod(event.target.value)}>{methods.map(item => <option key={item}>{item}</option>)}</select></Field>
        <Field label="狀態"><select className="input" value={status} onChange={event => setStatus(event.target.value as ParcelStatus)}><option>待出貨</option><option>已出貨</option><option>已取貨</option></select></Field>
        <Field label="出貨／面交日"><input className="input" type="date" value={date} onChange={event => setDate(event.target.value)} /></Field>
        <Field label="寄件編號"><input className="input" value={tracking} onChange={event => setTracking(event.target.value)} placeholder="面交可留空" /></Field>
      </div>
      <Field label="備註" hint="朋友看不到這段備註"><input className="input" value={note} onChange={event => setNote(event.target.value)} /></Field>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  </Drawer>;
}
