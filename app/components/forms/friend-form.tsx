"use client";

import { FormEvent, useState } from "react";
import { newId } from "../../lib/model";
import { useApp } from "../../lib/store";
import { Drawer, Field, Tag } from "../ui";
import { formatLogin } from "../pages/friends";

const randomPassword = () => {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(bytes[0] % 1_000_000).padStart(6, "0");
};

export function FriendForm({ id }: { id?: number }) {
  const { state, update, closeDrawer, notify, confirm, portal, friendAccount, openDrawer } = useApp();
  const friend = state.friends.find(item => item.id === id);
  const otherSelf = state.friends.find(item => item.isSelf && item.id !== id);
  const [name, setName] = useState(friend?.name ?? "");
  const [note, setNote] = useState(friend?.note ?? "");
  const [portalNote, setPortalNote] = useState(friend?.portalNote ?? "");
  const [isSelf, setIsSelf] = useState(Boolean(friend?.isSelf));
  const [password, setPassword] = useState("");
  const [issued, setIssued] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const info = friend ? portal[friend.id] : undefined;
  const status = info?.status ?? "尚未設定";

  function submit(event: FormEvent) {
    event.preventDefault();
    const clean = name.trim();
    if (!clean) return setError("請填寫名稱");
    if (state.friends.some(item => item.id !== id && item.name.trim().toLowerCase() === clean.toLowerCase())) return setError(`已經有一位叫「${clean}」的朋友，請換一個名稱`);
    const value = { id: friend?.id ?? newId(), name: clean, note: note.trim(), portalNote: portalNote.trim(), isSelf: isSelf || undefined };
    update(current => ({ ...current, friends: friend ? current.friends.map(item => item.id === friend.id ? value : item) : [...current.friends, value] }));
    notify(friend ? "朋友資料已儲存" : `已新增「${clean}」`);
    if (!friend && !isSelf) openDrawer({ kind: "friend", id: value.id });
    else closeDrawer();
  }

  async function savePassword() {
    if (!friend || password.length < 4) return;
    setBusy(true);
    const ok = await friendAccount(friend.id, { kind: "password", password });
    setBusy(false);
    if (ok) { setIssued(password); setPassword(""); notify(status === "尚未設定" ? "朋友帳號已開通" : "密碼已重設"); }
  }
  async function toggleSuspend() {
    if (!friend) return;
    setBusy(true);
    const ok = await friendAccount(friend.id, { kind: status === "已停用" ? "resume" : "suspend" });
    setBusy(false);
    if (ok) notify(status === "已停用" ? "已恢復登入" : "已暫停登入");
  }

  function remove() {
    if (!friend) return;
    const orders = state.groups.reduce((sum, group) => sum + group.orders.filter(order => order.friendId === friend.id).length, 0);
    const payments = state.payments.filter(payment => payment.friendId === friend.id).length;
    if (orders || payments) {
      confirm({ title: "還不能刪除這位朋友", confirm: "知道了", body: <p>{friend.name} 還有 {orders} 筆訂單、{payments} 筆收款紀錄。請先刪除或讓給其他人，再刪除朋友。</p>, onConfirm: () => undefined });
      return;
    }
    confirm({
      title: `刪除「${friend.name}」？`,
      danger: true,
      confirm: "刪除朋友",
      body: <p>{friend.isSelf ? "刪除後無法復原。" : "她的朋友端帳號也會一起刪除，之後無法再登入。"}</p>,
      onConfirm: async () => {
        if (!friend.isSelf && status !== "尚未設定") {
          const ok = await friendAccount(friend.id, { kind: "delete" });
          if (!ok) return;
        }
        update(current => ({ ...current, friends: current.friends.filter(item => item.id !== friend.id) }));
        closeDrawer();
        notify("已刪除朋友");
      },
    });
  }

  return <Drawer title={friend ? friend.name : "新增朋友"} subtitle={friend?.isSelf ? "本人" : undefined} onClose={closeDrawer} footer={<>
    {friend && <button type="button" className="btn btn-danger-ghost" onClick={remove}>刪除朋友</button>}
    <span className="spacer" />
    <button type="button" className="btn" onClick={closeDrawer}>取消</button>
    <button type="submit" form="friend-form" className="btn btn-primary">{friend ? "儲存變更" : "新增朋友"}</button>
  </>}>
    <form id="friend-form" className="stack" onSubmit={submit}>
      <Field label="名稱" hint="朋友登入時會從名單選這個名稱"><input className="input" value={name} onChange={event => setName(event.target.value)} required /></Field>
      <Field label="私人備註" hint="只有妳看得到"><input className="input" value={note} onChange={event => setNote(event.target.value)} /></Field>
      {!isSelf && <Field label="給朋友看的備註" hint="會顯示在她的朋友端首頁"><textarea className="input" rows={3} value={portalNote} onChange={event => setPortalNote(event.target.value)} placeholder="例如：這批商品預計下週抵台" /></Field>}
      <label className={`check-row ${otherSelf ? "disabled" : ""}`}>
        <input type="checkbox" checked={isSelf} disabled={Boolean(otherSelf)} onChange={event => setIsSelf(event.target.checked)} />
        <span><strong>這是我自己</strong><small>{otherSelf ? `已經指定「${otherSelf.name}」為本人。` : "本人的訂單不會產生應收款，到貨後直接算交付，花費統計在「自用開銷」，也不會出現在朋友端。"}</small></span>
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>

    {friend && !friend.isSelf && !isSelf && <fieldset className="block account">
      <legend>朋友端帳號<Tag>{status}</Tag></legend>
      <p className="muted small">{info?.lastLoginAt ? `最後登入 ${formatLogin(info.lastLoginAt)}` : "還沒有登入紀錄"}</p>
      {issued && <div className="issued"><span>請把這組密碼交給 {friend.name}</span><strong className="num">{issued}</strong><small>她第一次登入後會被提醒改成自己的密碼。這組密碼離開這個畫面後就看不到了。</small></div>}
      <div className="password-row">
        <Field label={`${status === "尚未設定" ? "初始密碼" : "重設密碼"}（至少 4 個字元）`}><input className="input num" value={password} onChange={event => setPassword(event.target.value)} autoComplete="off" /></Field>
        <button type="button" className="btn btn-ghost" onClick={() => setPassword(randomPassword())}>產生 6 位數</button>
        <button type="button" className="btn" disabled={busy || password.length < 4} onClick={() => void savePassword()}>{status === "尚未設定" ? "開通帳號" : "重設密碼"}</button>
      </div>
      {status !== "尚未設定" && <button type="button" className={`btn ${status === "已停用" ? "" : "btn-danger-ghost"}`} disabled={busy} onClick={() => void toggleSuspend()}>{status === "已停用" ? "恢復登入" : "暫停登入"}</button>}
    </fieldset>}
  </Drawer>;
}
