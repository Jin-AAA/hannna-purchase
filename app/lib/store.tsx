"use client";

import { createContext, useContext } from "react";
import type { ConfirmRequest } from "../components/ui";
import type { Index, Ledger, PortalStatus, State } from "./model";

export type PageKey = "overview" | "groups" | "orders" | "waybills" | "shipping" | "payments" | "spending" | "friends" | "settings";
export type Route = { page: PageKey; groupId?: number };
export type DrawerState =
  | { kind: "group"; id?: number }
  | { kind: "order"; groupId: number; orderId?: number }
  | { kind: "waybill"; id?: number }
  | { kind: "parcel"; id?: number; friendId?: number }
  | { kind: "payment"; id?: number; friendId?: number }
  | { kind: "expense"; id?: number }
  | { kind: "friend"; id?: number };
export type PortalInfo = { status: PortalStatus; lastLoginAt?: string };
export type FriendAction = { kind: "password"; password: string } | { kind: "suspend" } | { kind: "resume" } | { kind: "delete" };

export type AppContext = {
  state: State;
  update: (recipe: (state: State) => State) => void;
  index: Index;
  ledger: Ledger;
  route: Route;
  go: (route: Route) => void;
  notify: (message: string) => void;
  confirm: (request: ConfirmRequest) => void;
  openDrawer: (drawer: DrawerState) => void;
  closeDrawer: () => void;
  portal: Record<number, PortalInfo>;
  friendAccount: (friendId: number, action: FriendAction) => Promise<boolean>;
};

export const Ctx = createContext<AppContext | null>(null);
export function useApp() {
  const value = useContext(Ctx);
  if (!value) throw new Error("useApp must be used inside the app shell");
  return value;
}

export const pageTitles: Record<PageKey, string> = {
  overview: "總覽",
  groups: "代購團",
  orders: "訂單",
  waybills: "國際運單",
  shipping: "出貨",
  payments: "款項",
  spending: "自用開銷",
  friends: "朋友",
  settings: "設定",
};

export function parseHash(hash: string): Route {
  const [page, id] = hash.replace(/^#\/?/, "").split("/");
  const key = (Object.keys(pageTitles) as PageKey[]).includes(page as PageKey) ? (page as PageKey) : "overview";
  return key === "groups" && id ? { page: key, groupId: Number(id) } : { page: key };
}
export const routeHash = (route: Route) => `#/${route.page}${route.groupId ? `/${route.groupId}` : ""}`;
