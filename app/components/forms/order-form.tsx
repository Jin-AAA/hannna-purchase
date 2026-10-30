"use client";

import { FormEvent, useMemo, useState } from "react";
import { currencyInfo, earnedGifts, foreign, formatOrderCode, newId, orderMoney, orderTrack, payers, removeOrders, showDate, type Order, type OrderLine, type Payer, type State } from "../../lib/model";
import { useApp } from "../../lib/store";
import { Drawer, Field, Money, PayTag, StageTrack } from "../ui";

type Draft = Record<number, { qty: string; unit: string; payer: Payer }>;
const toDraft = (productIds: number[], order?: Order): Draft => Object.fromEntries(productIds.map(id => {
  const line = order?.lines.find(item => item.productId === id);
  return [id, { qty: line ? String(line.quantity) : "", unit: line && line.unitTwd ? String(Math.round(line.unitTwd * 100) / 100) : "", payer: line?.payer ?? "我代墊・需收款" }];
}));

/** 讓單：把某個品項的部分數量移到另一位朋友在同一團的訂單。 */
function transfer(state: State, groupId: number, orderId: number, productId: number, qty: number, toFriendId: number, unitTwd: number): { state: State; targetCode: string } {
  const group = state.groups.find(item => item.id === groupId)!;
  const source = group.orders.find(order => order.id === orderId)!;
  const parcelOrderIds = new Set(state.parcels.flatMap(parcel => parcel.orderIds));
  const sourceLine = source.lines.find(line => line.productId === productId)!;
  const moved: OrderLine = { productId, quantity: qty, unitTwd, payer: sourceLine.payer };
  let target = group.orders.find(order => order.friendId === toFriendId && order.id !== orderId && !parcelOrderIds.has(order.id));
  let nextOrderNo = group.nextOrderNo;
  let created: Order | null = null;
  if (!target) {
    created = { id: newId(), code: formatOrderCode(state.settings.orderPrefix, nextOrderNo), friendId: toFriendId, lines: [] };
    nextOrderNo += 1;
    target = created;
  }
  const mergeInto = (order: Order): Order => {
    const existing = order.lines.find(line => line.productId === productId);
    if (!existing) return { ...order, lines: [...order.lines, moved] };
    const quantity = existing.quantity + qty;
    return { ...order, lines: order.lines.map(line => line.productId === productId ? { ...line, quantity, unitTwd: (existing.unitTwd * existing.quantity + unitTwd * qty) / quantity } : line) };
  };
  const remaining = sourceLine.quantity - qty;
  let orders = group.orders.map(order => {
    if (order.id === orderId) return { ...order, lines: remaining > 0 ? order.lines.map(line => line.productId === productId ? { ...line, quantity: remaining } : line) : order.lines.filter(line => line.productId !== productId) };
    if (order.id === target!.id) return mergeInto(order);
    return order;
  });
  if (created) orders = [...orders, mergeInto(created)];
  let next: State = { ...state, groups: state.groups.map(item => item.id === groupId ? { ...item, orders, nextOrderNo } : item) };
  // 新建立的訂單跟著原訂單的國際運單，貨態才會一致。
  const waybill = state.waybills.find(item => item.items.some(ref => ref.orderId === orderId));
  if (created && waybill) next = { ...next, waybills: next.waybills.map(item => item.id === waybill.id ? { ...item, items: [...item.items, { groupId, orderId: created!.id, weightG: 0, freightTwd: 0 }] } : item) };
  if (orders.find(order => order.id === orderId)?.lines.length === 0) next = removeOrders(next, [orderId]);
  return { state: next, targetCode: target.code };
}

export function OrderForm({ groupId, orderId }: { groupId: number; orderId?: number }) {
  const { state, update, index, ledger, closeDrawer, notify, confirm, openDrawer } = useApp();
  const group = state.groups.find(item => item.id === groupId);
  const order = group?.orders.find(item => item.id === orderId);
  const productIds = group?.products.map(product => product.id) ?? [];
  const initialFriend = order?.friendId ?? state.friends.find(friend => !friend.isSelf)?.id ?? state.friends[0]?.id ?? 0;
  const [friendId, setFriendId] = useState(initialFriend);
  const [draft, setDraft] = useState<Draft>(() => toDraft(productIds, order));
  const [note, setNote] = useState(order?.note ?? "");
  const [error, setError] = useState("");
  const [moveProduct, setMoveProduct] = useState<number | "">("");
  const [moveQty, setMoveQty] = useState("1");
  const [moveTo, setMoveTo] = useState<number | "">("");
  const [moveUnit, setMoveUnit] = useState("");
  const isSelf = Boolean(index.friendById.get(friendId)?.isSelf);
  const initialDraft = useMemo(() => JSON.stringify(toDraft(productIds, order)), [order]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(draft) !== initialDraft || friendId !== initialFriend || note !== (order?.note ?? "");

  if (!group) return null;
  const lines = group.products.flatMap(product => {
    const row = draft[product.id];
    const qty = Math.max(0, Math.floor(Number(row?.qty) || 0));
    if (!qty) return [];
    return [{ product, qty, unit: Math.max(0, Number(row.unit) || 0), payer: isSelf ? "我自行負擔" as Payer : row.payer }];
  });
  const foreignTotal = lines.reduce((sum, line) => sum + line.product.unitPrice * line.qty, 0);
  const receivable = lines.reduce((sum, line) => sum + (line.payer === "我代墊・需收款" || isSelf ? Math.round(line.unit * line.qty) : 0), 0);
  const gifts = earnedGifts(group, foreignTotal);
  const track = order ? orderTrack(group, order, index) : null;
  const money = order ? orderMoney(order, ledger, index) : null;
  const parcel = order ? index.parcelByOrder.get(order.id) : undefined;
  const friendLocked = Boolean(parcel);
  const setRow = (productId: number, patch: Partial<Draft[number]>) => setDraft(current => ({ ...current, [productId]: { ...current[productId], ...patch } }));

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!friendId) return setError("請先到朋友名單新增朋友");
    if (!lines.length) return setError("請至少填一個商品的數量");
    const nextLines: OrderLine[] = lines.map(line => ({ productId: line.product.id, quantity: line.qty, unitTwd: line.unit, payer: line.payer }));
    if (order) {
      update(current => ({ ...current, groups: current.groups.map(item => item.id !== group!.id ? item : { ...item, orders: item.orders.map(o => o.id === order.id ? { ...o, friendId, lines: nextLines, note: note.trim() || undefined } : o) }) }));
      notify("訂單已儲存");
    } else {
      const created: Order = { id: newId(), code: formatOrderCode(state.settings.orderPrefix, group!.nextOrderNo), friendId, lines: nextLines, note: note.trim() || undefined };
      update(current => ({ ...current, groups: current.groups.map(item => item.id !== group!.id ? item : { ...item, orders: [...item.orders, created], nextOrderNo: item.nextOrderNo + 1 }) }));
      notify(`已新增 ${index.friendById.get(friendId)?.name} 的訂單`);
    }
    closeDrawer();
  }

  function remove() {
    if (!order) return;
    const waybill = index.waybillByOrder.get(order.id);
    const paid = money?.paid ?? 0;
    confirm({
      title: "刪除這筆訂單？",
      danger: true,
      confirm: "刪除訂單",
      body: <>
        <p>{index.friendById.get(order.friendId)?.name} 在「{group!.name}」的 {order.code} 會被刪除，無法復原。</p>
        {(waybill || parcel || paid > 0) && <ul className="bullets">
          {waybill && <li>會從國際運單 {waybill.code} 移除</li>}
          {parcel && <li>會從包裹 {parcel.code} 移除</li>}
          {paid > 0 && <li>已收的 <Money value={paid} /> 會轉成她的預付餘額</li>}
        </ul>}
      </>,
      onConfirm: () => { update(current => removeOrders(current, [order.id])); closeDrawer(); notify("訂單已刪除"); },
    });
  }

  function doTransfer() {
    if (!order || moveProduct === "" || moveTo === "") return;
    const line = order.lines.find(item => item.productId === moveProduct);
    const qty = Math.floor(Number(moveQty));
    if (!line || qty < 1 || qty > line.quantity) return notify(`數量需介於 1 到 ${line?.quantity ?? 0}`);
    const unit = moveUnit === "" ? line.unitTwd : Math.max(0, Number(moveUnit) || 0);
    let targetCode = "";
    update(current => { const result = transfer(current, group!.id, order.id, Number(moveProduct), qty, Number(moveTo), unit); targetCode = result.targetCode; return result.state; });
    const name = index.friendById.get(Number(moveTo))?.name;
    notify(`已把 ${qty} 件讓給 ${name}${targetCode ? `（${targetCode}）` : ""}`);
    if (qty === line.quantity && order.lines.length === 1) { closeDrawer(); return; }
    setDraft(current => ({ ...current, [moveProduct]: { ...current[Number(moveProduct)], qty: String(line.quantity - qty) } }));
    setMoveProduct(""); setMoveTo(""); setMoveUnit(""); setMoveQty("1");
  }

  const friendName = index.friendById.get(order?.friendId ?? friendId)?.name ?? "";
  return <Drawer wide title={order ? `${friendName} 的訂單` : "新增訂單"} subtitle={order ? `${group.name}，${order.code}` : group.name} onClose={closeDrawer} footer={<>
    {order && <button type="button" className="btn btn-danger-ghost" onClick={remove}>刪除訂單</button>}
    <span className="spacer" />
    <button type="button" className="btn" onClick={closeDrawer}>取消</button>
    <button type="submit" form="order-form" className="btn btn-primary">{order ? "儲存變更" : "建立訂單"}</button>
  </>}>
    {order && track && money && <section className="order-status">
      <div><span className="field-label">進度</span><StageTrack stage={track.stage} /></div>
      <div><span className="field-label">付款</span>{isSelf ? <PayTag status="自用" /> : <><PayTag status={money.status} />{money.balance > 0 && <span className="muted">尚欠 <Money value={money.balance} /></span>}</>}</div>
      {!isSelf && money.due > 0 && <dl className="mini-ledger"><div><dt>商品款</dt><dd><Money value={money.productDue} /></dd></div><div><dt>國際運費</dt><dd><Money value={money.freightDue} /></dd></div><div><dt>已收</dt><dd><Money value={money.paid} /></dd></div></dl>}
      {(track.waybill || parcel) && <p className="muted small">{track.waybill && <>運單 {track.waybill.code}（{track.waybill.status}{track.waybill.destination === "直寄朋友" ? "，直寄" : ""}）</>}{parcel && <>{track.waybill ? "；" : ""}包裹 {parcel.code}（{parcel.status}）</>}</p>}
      {!isSelf && money.balance > 0 && <button type="button" className="btn btn-small" onClick={() => openDrawer({ kind: "payment", friendId: order.friendId })}>記錄收款</button>}
    </section>}

    <form id="order-form" onSubmit={submit} className="stack">
      <Field label="這筆訂單是誰的" hint={friendLocked ? "已放進包裹的訂單不能換人，請先從包裹移除。" : order && friendId !== order.friendId && (money?.paid ?? 0) > 0 ? "換人後，原本朋友已付的錢會轉成她的預付餘額。" : undefined}>
        <select className="input" value={friendId} disabled={friendLocked} onChange={event => setFriendId(Number(event.target.value))}>
          {!state.friends.length && <option value={0}>請先新增朋友</option>}
          {state.friends.map(friend => <option key={friend.id} value={friend.id}>{friend.name}{friend.isSelf ? "（本人）" : ""}</option>)}
        </select>
      </Field>

      <div className="line-table" role="table" aria-label="商品">
        <div className="line-head" role="row"><span>商品</span><span>數量</span>{!isSelf && <span>付款人</span>}<span>{isSelf ? "台幣成本／件" : "應收台幣／件"}</span><span className="r">台幣小計</span></div>
        {group.products.map(product => {
          const row = draft[product.id];
          const qty = Math.max(0, Math.floor(Number(row.qty) || 0));
          const counts = isSelf || row.payer !== "朋友自行付清";
          return <div className={`line-row ${isSelf ? "self" : ""} ${qty ? "" : "idle"}`} role="row" key={product.id}>
            <span className="line-product"><strong>{product.name}</strong><small className="num">{foreign(product.unitPrice, group.currency)}{qty ? `，小計 ${foreign(product.unitPrice * qty, group.currency)}` : ""}</small></span>
            <label className="cell"><span className="m-label">數量</span><input className="input num" type="number" min="0" step="1" inputMode="numeric" aria-label={`${product.name} 數量`} value={row.qty} placeholder="0" onChange={event => setRow(product.id, { qty: event.target.value })} /></label>
            {!isSelf && <label className="cell"><span className="m-label">付款人</span><select className="input" aria-label={`${product.name} 付款人`} value={row.payer} disabled={!qty} onChange={event => setRow(product.id, { payer: event.target.value as Payer })}>{payers.map(payer => <option key={payer}>{payer}</option>)}</select></label>}
            <label className="cell"><span className="m-label">{isSelf ? "台幣成本／件" : "應收台幣／件"}</span><input className="input num" type="number" min="0" step="any" inputMode="decimal" aria-label={`${product.name} 台幣單價`} value={counts ? row.unit : ""} disabled={!qty || !counts} placeholder={counts ? "0" : "不用填"} onChange={event => setRow(product.id, { unit: event.target.value })} /></label>
            <span className="r num">{qty && counts && Number(row.unit) ? <Money value={Math.round(Number(row.unit) * qty)} muted={!isSelf && row.payer === "我自行負擔"} /> : <span className="muted">—</span>}</span>
          </div>;
        })}
      </div>
      <p className="field-hint">{isSelf ? "本人的訂單不會產生應收款，台幣成本會計入「自用開銷」。" : "只有「我代墊・需收款」會算進應收；「我自行負擔」填的金額會統計在自用開銷的「幫朋友吸收」。"}</p>

      <dl className="totals">
        <div><dt>原幣合計</dt><dd className="num">{foreign(foreignTotal, group.currency)}</dd></div>
        <div><dt>{isSelf ? "台幣成本" : "應收商品款"}</dt><dd><Money value={receivable} strong /></dd></div>
        {group.giftRules.length > 0 && <div><dt>滿額贈</dt><dd>{gifts.length ? gifts.map(gift => `${gift.giftName} × ${gift.count}`).join("、") : <span className="muted">未達門檻（最低 {foreign(Math.min(...group.giftRules.map(rule => rule.threshold)), group.currency)}）</span>}</dd></div>}
      </dl>
      <Field label="備註"><input className="input" value={note} onChange={event => setNote(event.target.value)} placeholder="只有妳看得到" /></Field>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>

    {order && <fieldset className="block transfer">
      <legend>讓單<span>把部分數量轉給同團的另一位朋友，立即生效</span></legend>
      {dirty ? <p className="muted small">請先儲存上方的變更，再進行讓單。</p> : <div className="transfer-grid">
        <Field label="商品"><select className="input" value={moveProduct} onChange={event => { const id = event.target.value === "" ? "" : Number(event.target.value); setMoveProduct(id); setMoveQty("1"); setMoveUnit(""); }}><option value="">選擇商品</option>{order.lines.map(line => <option key={line.productId} value={line.productId}>{group.products.find(p => p.id === line.productId)?.name}（{line.quantity} 件）</option>)}</select></Field>
        <Field label="數量"><input className="input num" type="number" min="1" max={order.lines.find(line => line.productId === moveProduct)?.quantity ?? 1} value={moveQty} onChange={event => setMoveQty(event.target.value)} disabled={moveProduct === ""} /></Field>
        <Field label="讓給"><select className="input" value={moveTo} disabled={moveProduct === ""} onChange={event => setMoveTo(event.target.value === "" ? "" : Number(event.target.value))}><option value="">選擇朋友</option>{state.friends.filter(friend => friend.id !== order.friendId).map(friend => <option key={friend.id} value={friend.id}>{friend.name}{friend.isSelf ? "（本人）" : ""}</option>)}</select></Field>
        <Field label="她的台幣單價" hint="空白則沿用原本的"><input className="input num" type="number" min="0" step="any" value={moveUnit} disabled={moveProduct === ""} placeholder={String(Math.round((order.lines.find(line => line.productId === moveProduct)?.unitTwd ?? 0) * 100) / 100)} onChange={event => setMoveUnit(event.target.value)} /></Field>
        <div className="transfer-action"><button type="button" className="btn" disabled={moveProduct === "" || moveTo === ""} onClick={doTransfer}>讓出</button></div>
      </div>}
    </fieldset>}
    <p className="muted small currency-note">商品單價以{currencyInfo[group.currency].label}計；{order ? `開賣日 ${showDate(group.saleDate)}` : "台幣金額依妳和朋友約定的匯率填寫"}。</p>
  </Drawer>;
}
