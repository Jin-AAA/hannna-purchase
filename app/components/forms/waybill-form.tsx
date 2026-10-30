"use client";

import { FormEvent, useState } from "react";
import { newId, orderQuantity, productName, todayIso, type Destination, type Waybill, type WaybillStatus } from "../../lib/model";
import { useApp } from "../../lib/store";
import { Drawer, Field, Money } from "../ui";

type Pick = { checked: boolean; weightG: string; freightTwd: string };

export function WaybillForm({ id }: { id?: number }) {
  const { state, update, index, closeDrawer, notify, confirm } = useApp();
  const waybill = state.waybills.find(item => item.id === id);
  const [country, setCountry] = useState<Waybill["country"]>(waybill?.country ?? "韓國");
  const [tracking, setTracking] = useState(waybill?.tracking ?? "");
  const [status, setStatus] = useState<WaybillStatus>(waybill?.status ?? "已申請運回");
  const [destination, setDestination] = useState<Destination>(waybill?.destination ?? "寄到我這裡");
  const [recipient, setRecipient] = useState<number | "">(waybill?.recipientFriendId ?? "");
  const [appliedDate, setAppliedDate] = useState(waybill?.appliedDate || todayIso());
  const [arrivedDate, setArrivedDate] = useState(waybill?.arrivedDate || "");
  const [totalWeight, setTotalWeight] = useState(waybill ? String(waybill.totalWeightG) : "");
  const [freight, setFreight] = useState(waybill ? String(waybill.freightTwd) : "");
  const [note, setNote] = useState(waybill?.note ?? "");
  const [picks, setPicks] = useState<Record<number, Pick>>(() => Object.fromEntries((waybill?.items ?? []).map(item => [item.orderId, { checked: true, weightG: String(item.weightG || ""), freightTwd: String(item.freightTwd || "") }])));
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  const taken = new Set(state.waybills.filter(item => item.id !== id).flatMap(item => item.items.map(ref => ref.orderId)));
  const q = query.trim().toLowerCase();
  const candidates = state.groups.flatMap(group => {
    const orders = group.orders.filter(order => {
      if (taken.has(order.id)) return false;
      if (picks[order.id]?.checked) return true;
      if (group.completedAt || order.legacyArrived || order.legacyDelivered) return false;
      return !q || group.name.toLowerCase().includes(q) || (index.friendById.get(order.friendId)?.name ?? "").toLowerCase().includes(q);
    });
    return orders.length ? [{ group, orders }] : [];
  });
  const checked = Object.entries(picks).filter(([, pick]) => pick.checked);
  const sumWeight = checked.reduce((sum, [, pick]) => sum + (Number(pick.weightG) || 0), 0);
  const sumFreight = checked.reduce((sum, [, pick]) => sum + (Number(pick.freightTwd) || 0), 0);
  const setPick = (orderId: number, patch: Partial<Pick>) => setPicks(current => ({ ...current, [orderId]: { ...(current[orderId] ?? { checked: false, weightG: "", freightTwd: "" }), ...patch } }));

  function splitByWeight() {
    const total = Number(freight) || 0;
    if (!total || !sumWeight) return notify("請先填實付運費和各訂單重量");
    let left = total;
    const rows = checked.filter(([, pick]) => Number(pick.weightG) > 0);
    const next = { ...picks };
    rows.forEach(([orderId, pick], i) => {
      const share = i === rows.length - 1 ? left : Math.round(total * Number(pick.weightG) / sumWeight);
      left -= share;
      next[Number(orderId)] = { ...pick, freightTwd: String(share) };
    });
    setPicks(next);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const items = checked.map(([orderId, pick]) => ({ groupId: index.groupByOrder.get(Number(orderId))?.id ?? 0, orderId: Number(orderId), weightG: Math.max(0, Number(pick.weightG) || 0), freightTwd: Math.max(0, Math.round(Number(pick.freightTwd) || 0)) })).filter(item => item.groupId);
    if (!items.length) return setError("請至少勾選一筆訂單");
    if (destination === "直寄朋友" && recipient === "") return setError("請選擇直寄的收貨朋友");
    const value: Waybill = {
      id: waybill?.id ?? newId(),
      code: waybill?.code ?? `INTL-${String(state.counters.waybill + 1).padStart(3, "0")}`,
      country, tracking: tracking.trim(), items,
      totalWeightG: totalWeight === "" ? sumWeight : Math.max(0, Number(totalWeight) || 0),
      freightTwd: Math.max(0, Math.round(Number(freight) || 0)),
      destination, recipientFriendId: destination === "直寄朋友" ? Number(recipient) : null,
      status, appliedDate, arrivedDate: status === "已到貨" ? arrivedDate || todayIso() : "", note: note.trim(),
    };
    update(current => waybill
      ? { ...current, waybills: current.waybills.map(item => item.id === waybill.id ? value : item) }
      : { ...current, waybills: [value, ...current.waybills], counters: { ...current.counters, waybill: current.counters.waybill + 1 } });
    notify(waybill ? "運單已儲存" : status === "已到貨" ? `已建立運單，${items.length} 筆訂單標為已到貨` : "已建立運單");
    closeDrawer();
  }

  function remove() {
    if (!waybill) return;
    confirm({
      title: `刪除運單 ${waybill.code}？`,
      danger: true,
      confirm: "刪除運單",
      body: <p>裡面 {waybill.items.length} 筆訂單會回到「已下單」，填在這張運單上的應收運費也會一起移除。</p>,
      onConfirm: () => { update(current => ({ ...current, waybills: current.waybills.filter(item => item.id !== waybill.id) })); closeDrawer(); notify("運單已刪除"); },
    });
  }

  return <Drawer wide title={waybill ? `運單 ${waybill.code}` : "建立國際運單"} onClose={closeDrawer} footer={<>
    {waybill && <button type="button" className="btn btn-danger-ghost" onClick={remove}>刪除運單</button>}
    <span className="spacer" />
    <button type="button" className="btn" onClick={closeDrawer}>取消</button>
    <button type="submit" form="waybill-form" className="btn btn-primary">{waybill ? "儲存變更" : "建立運單"}</button>
  </>}>
    <form id="waybill-form" className="stack" onSubmit={submit}>
      <div className="form-grid three">
        <Field label="出貨國家"><select className="input" value={country} onChange={event => setCountry(event.target.value as Waybill["country"])}><option>韓國</option><option>日本</option><option>其他</option></select></Field>
        <Field label="物流單號"><input className="input" value={tracking} onChange={event => setTracking(event.target.value)} placeholder="可稍後補上" /></Field>
        <Field label="狀態"><select className="input" value={status} onChange={event => { const value = event.target.value as WaybillStatus; setStatus(value); if (value === "已到貨" && !arrivedDate) setArrivedDate(todayIso()); }}><option>已申請運回</option><option>已到貨</option></select></Field>
        <Field label="申請運回日"><input className="input" type="date" value={appliedDate} onChange={event => setAppliedDate(event.target.value)} /></Field>
        {status === "已到貨" && <Field label="到貨日"><input className="input" type="date" value={arrivedDate} onChange={event => setArrivedDate(event.target.value)} /></Field>}
        <Field label="收貨地"><select className="input" value={destination} onChange={event => setDestination(event.target.value as Destination)}><option>寄到我這裡</option><option>直寄朋友</option></select></Field>
        {destination === "直寄朋友" && <Field label="直寄給"><select className="input" value={recipient} onChange={event => setRecipient(event.target.value === "" ? "" : Number(event.target.value))}><option value="">選擇朋友</option>{state.friends.filter(friend => !friend.isSelf).map(friend => <option key={friend.id} value={friend.id}>{friend.name}</option>)}</select></Field>}
      </div>

      <fieldset className="block">
        <legend>這次一起運回的訂單<span>已在其他運單的訂單不會出現</span></legend>
        <input className="input search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜尋團名或朋友" aria-label="搜尋訂單" />
        <div className="pick-list">
          {candidates.length ? candidates.map(({ group, orders }) => <div key={group.id} className="pick-group">
            <h3>{group.name}</h3>
            {orders.map(order => {
              const pick = picks[order.id] ?? { checked: false, weightG: "", freightTwd: "" };
              const friend = index.friendById.get(order.friendId);
              return <div key={order.id} className={`pick-row ${pick.checked ? "on" : ""}`}>
                <label className="pick-main"><input type="checkbox" checked={pick.checked} onChange={event => setPick(order.id, { checked: event.target.checked })} /><span><strong>{friend?.name}{friend?.isSelf ? "（本人）" : ""}</strong><small>{order.code}，{orderQuantity(order)} 件：{order.lines.map(line => `${productName(group, line.productId)} × ${line.quantity}`).join("、")}</small></span></label>
                <label className="pick-input"><span>重量 g</span><input className="input num" type="number" min="0" value={pick.weightG} disabled={!pick.checked} onChange={event => setPick(order.id, { weightG: event.target.value })} /></label>
                <label className="pick-input"><span>{friend?.isSelf ? "自用分攤 NT$" : "應收運費 NT$"}</span><input className="input num" type="number" min="0" value={pick.freightTwd} disabled={!pick.checked} placeholder="不收可留空" onChange={event => setPick(order.id, { freightTwd: event.target.value })} /></label>
              </div>;
            })}
          </div>) : <p className="muted">目前沒有可以加入運單的訂單。</p>}
        </div>
      </fieldset>

      <div className="form-grid three">
        <Field label="總重量（g）" hint={sumWeight ? `勾選訂單合計 ${sumWeight.toLocaleString()} g` : "留空會用勾選訂單的重量合計"}><input className="input num" type="number" min="0" value={totalWeight} onChange={event => setTotalWeight(event.target.value)} /></Field>
        <Field label="實付國際運費（NT$）"><input className="input num" type="number" min="0" value={freight} onChange={event => setFreight(event.target.value)} /></Field>
        <div className="field"><span className="field-label">各訂單運費合計</span><span className="field-static"><Money value={sumFreight} />{Number(freight) > 0 && sumFreight !== Number(freight) && <small className="muted">與實付差 <Money value={Number(freight) - sumFreight} /></small>}</span><button type="button" className="btn btn-ghost btn-small" onClick={splitByWeight}>依重量分攤實付運費</button></div>
      </div>
      <Field label="備註"><input className="input" value={note} onChange={event => setNote(event.target.value)} placeholder="例如：集運倉合箱（朋友看不到）" /></Field>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  </Drawer>;
}
