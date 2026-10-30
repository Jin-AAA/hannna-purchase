"use client";

import { FormEvent, useState } from "react";
import { newId, todayIso, type ExpenseCategory } from "../../lib/model";
import { useApp } from "../../lib/store";
import { Drawer, Field, Money } from "../ui";

const categories: ExpenseCategory[] = ["商品款", "國際運費", "關稅", "包材", "其他"];

export function ExpenseForm({ id }: { id?: number }) {
  const { state, update, closeDrawer, notify, confirm } = useApp();
  const expense = state.expenses.find(item => item.id === id);
  const [category, setCategory] = useState<ExpenseCategory>(expense?.category ?? "商品款");
  const [amount, setAmount] = useState(expense ? String(expense.amount) : "");
  const [date, setDate] = useState(expense?.date || todayIso());
  const [groupId, setGroupId] = useState<number | "">(expense?.groupId ?? "");
  const [note, setNote] = useState(expense?.note ?? "");
  const [error, setError] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = Math.round(Number(amount) || 0);
    if (value <= 0) return setError("請填寫支出金額");
    const record = { id: expense?.id ?? newId(), category, amount: value, date, groupId: groupId === "" ? null : groupId, note: note.trim() };
    update(current => ({ ...current, expenses: expense ? current.expenses.map(item => item.id === expense.id ? record : item) : [record, ...current.expenses] }));
    notify(expense ? "支出已儲存" : "已新增支出");
    closeDrawer();
  }
  function remove() {
    if (!expense) return;
    confirm({ title: "刪除這筆支出？", danger: true, confirm: "刪除支出", body: <p>{expense.category} <Money value={expense.amount} /> 會被刪除。</p>, onConfirm: () => { update(current => ({ ...current, expenses: current.expenses.filter(item => item.id !== expense.id) })); closeDrawer(); notify("支出已刪除"); } });
  }

  return <Drawer title={expense ? "編輯支出" : "新增支出"} onClose={closeDrawer} footer={<>
    {expense && <button type="button" className="btn btn-danger-ghost" onClick={remove}>刪除支出</button>}
    <span className="spacer" />
    <button type="button" className="btn" onClick={closeDrawer}>取消</button>
    <button type="submit" form="expense-form" className="btn btn-primary">{expense ? "儲存變更" : "新增支出"}</button>
  </>}>
    <form id="expense-form" className="stack" onSubmit={submit}>
      <div className="form-grid">
        <Field label="類別"><select className="input" value={category} onChange={event => setCategory(event.target.value as ExpenseCategory)}>{categories.map(item => <option key={item}>{item}</option>)}</select></Field>
        <Field label="金額（NT$）"><input className="input num" type="number" min="1" value={amount} onChange={event => setAmount(event.target.value)} /></Field>
        <Field label="日期"><input className="input" type="date" value={date} onChange={event => setDate(event.target.value)} /></Field>
        <Field label="代購團"><select className="input" value={groupId} onChange={event => setGroupId(event.target.value === "" ? "" : Number(event.target.value))}><option value="">不指定</option>{state.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></Field>
      </div>
      <Field label="備註"><input className="input" value={note} onChange={event => setNote(event.target.value)} /></Field>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  </Drawer>;
}
