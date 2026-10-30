"use client";

import { ReactNode, useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { stageOrder, type GroupStatus, type PaymentStatus, type Stage } from "../lib/model";

export function PageHeader({ title, description, actions, back }: { title: string; description?: string; actions?: ReactNode; back?: ReactNode }) {
  return <div className="page-header">
    {back}
    <div className="page-header-row">
      <div><h1>{title}</h1>{description && <p>{description}</p>}</div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  </div>;
}

export function Figures({ items }: { items: { label: string; value: ReactNode; hint?: ReactNode; tone?: "warn" | "good" }[] }) {
  return <dl className="figures">{items.map(item => <div key={item.label} className={item.tone ? `tone-${item.tone}` : ""}><dt>{item.label}</dt><dd>{item.value}</dd>{item.hint && <small>{item.hint}</small>}</div>)}</dl>;
}

export function Panel({ title, meta, actions, children, flush }: { title?: ReactNode; meta?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean }) {
  return <section className={`panel ${flush ? "flush" : ""}`}>
    {(title || actions) && <header className="panel-head"><div>{title && <h2>{title}</h2>}{meta && <span>{meta}</span>}</div>{actions && <div className="panel-actions">{actions}</div>}</header>}
    {children}
  </section>;
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty"><strong>{title}</strong>{children && <p>{children}</p>}{action}</div>;
}

const toneByLabel: Record<string, string> = {
  未付款: "red", 部分付款: "amber", 已付款: "green", 無應收: "gray", 自用: "pine",
  待下單: "gray", 已下單: "blue", 運回中: "blue", 部分到貨: "amber", 已到貨: "amber", 待出貨: "amber", 包裹處理中: "amber",
  部分出貨: "amber", 已出貨: "green", 已交付: "green", 已完成: "gray", 已申請運回: "blue", 已取貨: "green",
  已設定: "green", 尚未設定: "gray", 已停用: "red",
};
export function Tag({ children, tone }: { children: string; tone?: string }) {
  return <span className={`tag tag-${tone ?? toneByLabel[children] ?? "gray"}`}>{children}</span>;
}
export const PayTag = ({ status }: { status: PaymentStatus }) => <Tag>{status}</Tag>;
export const GroupTag = ({ status }: { status: GroupStatus }) => <Tag>{status}</Tag>;

const trackSteps: { label: string; reached: Stage }[] = [
  { label: "下單", reached: "已下單" },
  { label: "運回", reached: "運回中" },
  { label: "到貨", reached: "待出貨" },
  { label: "出貨", reached: "已出貨" },
  { label: "交付", reached: "已交付" },
];
/** 訂單進度條：從下單到交付的五段刻度。 */
export function StageTrack({ stage, compact }: { stage: Stage; compact?: boolean }) {
  const at = stageOrder.indexOf(stage);
  return <span className={`track ${compact ? "compact" : ""}`} title={stage} aria-label={`進度：${stage}`}>
    <span className="track-bar">{trackSteps.map(step => <i key={step.label} className={at >= stageOrder.indexOf(step.reached) ? "on" : ""} />)}</span>
    <span className="track-label">{stage}</span>
  </span>;
}

export function Drawer({ title, subtitle, onClose, children, footer, wide }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("input:not([type=hidden]):not([disabled]), select, textarea");
    first?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.classList.add("no-scroll");
    return () => { document.removeEventListener("keydown", onKey); document.body.classList.remove("no-scroll"); previous?.focus?.(); };
  }, [onClose]);
  return <div className="drawer-layer" onMouseDown={onClose}>
    <div ref={ref} className={`drawer ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={event => event.stopPropagation()}>
      <header className="drawer-head"><div><h2 id={titleId}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button type="button" className="icon-btn" onClick={onClose} aria-label="關閉"><X size={18} /></button></header>
      <div className="drawer-body">{children}</div>
      {footer && <footer className="drawer-foot">{footer}</footer>}
    </div>
  </div>;
}

export type ConfirmRequest = { title: string; body: ReactNode; confirm: string; danger?: boolean; onConfirm: () => void | Promise<void> };
export function ConfirmDialog({ request, onClose }: { request: ConfirmRequest; onClose: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => { ref.current?.focus(); const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; document.addEventListener("keydown", onKey); return () => document.removeEventListener("keydown", onKey); }, [onClose]);
  return <div className="dialog-layer" onMouseDown={onClose}>
    <div className="dialog" role="alertdialog" aria-modal="true" onMouseDown={event => event.stopPropagation()}>
      <h2>{request.title}</h2>
      <div className="dialog-body">{request.body}</div>
      <div className="dialog-actions"><button type="button" className="btn" onClick={onClose}>取消</button><button ref={ref} type="button" className={`btn ${request.danger ? "btn-danger" : "btn-primary"}`} onClick={async () => { await request.onConfirm(); onClose(); }}>{request.confirm}</button></div>
    </div>
  </div>;
}

export function Field({ label, hint, children, wide }: { label: string; hint?: ReactNode; children: ReactNode; wide?: boolean }) {
  return <label className={`field ${wide ? "wide" : ""}`}><span className="field-label">{label}</span>{children}{hint && <span className="field-hint">{hint}</span>}</label>;
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: readonly T[]; onChange: (value: T) => void; label: string }) {
  return <div className="segmented" role="tablist" aria-label={label}>{options.map(option => <button type="button" role="tab" aria-selected={value === option} key={option} className={value === option ? "on" : ""} onClick={() => onChange(option)}>{option}</button>)}</div>;
}

export function Money({ value, muted, strong }: { value: number; muted?: boolean; strong?: boolean }) {
  return <span className={`num ${muted ? "muted" : ""} ${strong ? "strong" : ""}`}>NT${Math.round(value).toLocaleString("en-US")}</span>;
}
