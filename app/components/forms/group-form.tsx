"use client";

import { FormEvent, useState } from "react";
import { Trash2 } from "lucide-react";
import { currencyInfo, newId, type Currency } from "../../lib/model";
import { useApp } from "../../lib/store";
import { Drawer, Field } from "../ui";

type ProductRow = { id: number; name: string; unitPrice: string };
type GiftRow = { id: number; threshold: string; giftName: string; cumulative: boolean };

export function GroupForm({ id }: { id?: number }) {
  const { state, update, closeDrawer, notify, confirm, go } = useApp();
  const group = state.groups.find(item => item.id === id);
  const [name, setName] = useState(group?.name ?? "");
  const [saleDate, setSaleDate] = useState(group?.saleDate ?? "");
  const [currency, setCurrency] = useState<Currency>(group?.currency ?? "KRW");
  const [products, setProducts] = useState<ProductRow[]>(group?.products.map(p => ({ id: p.id, name: p.name, unitPrice: String(p.unitPrice) })) ?? [{ id: newId(), name: "", unitPrice: "" }]);
  const [gifts, setGifts] = useState<GiftRow[]>(group?.giftRules.map(r => ({ id: r.id, threshold: String(r.threshold), giftName: r.giftName, cumulative: r.cumulative })) ?? []);
  const [error, setError] = useState("");
  const used = new Set(group?.orders.flatMap(order => order.lines.map(line => line.productId)) ?? []);

  function submit(event: FormEvent) {
    event.preventDefault();
    const cleanProducts = products.filter(row => row.name.trim()).map(row => ({ id: row.id, name: row.name.trim(), unitPrice: Math.max(0, Number(row.unitPrice) || 0) }));
    const cleanGifts = gifts.filter(row => row.giftName.trim() && Number(row.threshold) > 0).map(row => ({ id: row.id, threshold: Number(row.threshold), giftName: row.giftName.trim(), cumulative: row.cumulative }));
    if (!name.trim()) return setError("請填寫團名");
    if (!cleanProducts.length) return setError("請至少新增一個商品");
    const missing = [...used].filter(productId => !cleanProducts.some(product => product.id === productId));
    if (missing.length) return setError("已有訂單使用的商品不能刪除，請保留商品名稱");
    if (group) {
      update(current => ({ ...current, groups: current.groups.map(item => item.id === group.id ? { ...item, name: name.trim(), saleDate, currency, products: cleanProducts, giftRules: cleanGifts } : item) }));
      notify("代購團已儲存");
    } else {
      const newGroupId = newId();
      update(current => ({ ...current, groups: [{ id: newGroupId, name: name.trim(), saleDate, currency, products: cleanProducts, giftRules: cleanGifts, orders: [], nextOrderNo: 1 }, ...current.groups] }));
      notify(`已建立「${name.trim()}」`);
      go({ page: "groups", groupId: newGroupId });
    }
    closeDrawer();
  }

  function remove() {
    if (!group) return;
    confirm({
      title: `刪除「${group.name}」？`,
      body: <p>這團沒有任何訂單，刪除後無法復原。</p>,
      confirm: "刪除代購團",
      danger: true,
      onConfirm: () => {
        update(current => ({ ...current, groups: current.groups.filter(item => item.id !== group.id), expenses: current.expenses.map(expense => expense.groupId === group.id ? { ...expense, groupId: null } : expense) }));
        closeDrawer();
        go({ page: "groups" });
        notify("代購團已刪除");
      },
    });
  }

  return <Drawer title={group ? "編輯代購團" : "新增代購團"} onClose={closeDrawer} wide footer={<>
    {group && group.orders.length === 0 && <button type="button" className="btn btn-danger-ghost" onClick={remove}>刪除代購團</button>}
    <span className="spacer" />
    <button type="button" className="btn" onClick={closeDrawer}>取消</button>
    <button type="submit" form="group-form" className="btn btn-primary">{group ? "儲存變更" : "建立代購團"}</button>
  </>}>
    <form id="group-form" onSubmit={submit} className="stack">
      <div className="form-grid three">
        <Field label="團名" wide><input className="input" value={name} onChange={event => setName(event.target.value)} placeholder="例如：ESON 8 月周邊" required /></Field>
        <Field label="開賣日"><input className="input" type="date" value={saleDate} onChange={event => setSaleDate(event.target.value)} /></Field>
        <Field label="商品幣別"><select className="input" value={currency} onChange={event => setCurrency(event.target.value as Currency)}>{(Object.keys(currencyInfo) as Currency[]).map(code => <option key={code} value={code}>{currencyInfo[code].label} {code}</option>)}</select></Field>
      </div>

      <fieldset className="block">
        <legend>商品與單價<span>單價用 {currencyInfo[currency].label} 填寫</span></legend>
        <div className="row-editor">
          {products.map((row, i) => <div className="editor-row products" key={row.id}>
            <input className="input" aria-label={`商品 ${i + 1}`} value={row.name} onChange={event => setProducts(rows => rows.map(item => item.id === row.id ? { ...item, name: event.target.value } : item))} placeholder="商品名稱" />
            <input className="input num" aria-label={`商品 ${i + 1} 單價`} type="number" min="0" inputMode="decimal" value={row.unitPrice} onChange={event => setProducts(rows => rows.map(item => item.id === row.id ? { ...item, unitPrice: event.target.value } : item))} placeholder="單價" />
            <button type="button" className="icon-btn" aria-label="刪除商品" disabled={used.has(row.id) || products.length === 1} title={used.has(row.id) ? "已有訂單使用" : "刪除"} onClick={() => setProducts(rows => rows.filter(item => item.id !== row.id))}><Trash2 size={16} /></button>
          </div>)}
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => setProducts(rows => [...rows, { id: newId(), name: "", unitPrice: "" }])}>新增商品</button>
      </fieldset>

      <fieldset className="block">
        <legend>滿額贈<span>依每一筆訂單的原幣金額計算</span></legend>
        {gifts.length > 0 && <div className="row-editor">
          {gifts.map((row, i) => <div className="editor-row gifts" key={row.id}>
            <input className="input num" aria-label={`門檻 ${i + 1}`} type="number" min="1" value={row.threshold} onChange={event => setGifts(rows => rows.map(item => item.id === row.id ? { ...item, threshold: event.target.value } : item))} placeholder="滿額門檻" />
            <input className="input" aria-label={`贈品 ${i + 1}`} value={row.giftName} onChange={event => setGifts(rows => rows.map(item => item.id === row.id ? { ...item, giftName: event.target.value } : item))} placeholder="贈品" />
            <select className="input" aria-label={`計算方式 ${i + 1}`} value={row.cumulative ? "yes" : "no"} onChange={event => setGifts(rows => rows.map(item => item.id === row.id ? { ...item, cumulative: event.target.value === "yes" } : item))}><option value="yes">累贈</option><option value="no">不累贈</option></select>
            <button type="button" className="icon-btn" aria-label="刪除滿額贈" onClick={() => setGifts(rows => rows.filter(item => item.id !== row.id))}><Trash2 size={16} /></button>
          </div>)}
        </div>}
        <button type="button" className="btn btn-ghost" onClick={() => setGifts(rows => [...rows, { id: newId(), threshold: "", giftName: "", cumulative: true }])}>新增滿額贈</button>
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  </Drawer>;
}
