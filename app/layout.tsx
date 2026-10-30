import type { Metadata, Viewport } from "next";
import "./globals.css";

const base = process.env.GITHUB_PAGES === "true" ? "/hannna-purchase" : "";

export const metadata: Metadata = {
  title: "哈娜的小車車",
  description: "哈娜的小車車代購管理後台",
  robots: { index: false, follow: false },
  icons: { icon: `${base}/favicon.svg?v=3`, shortcut: `${base}/favicon.svg?v=3` },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f3f4f1" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-Hant"><body>{children}</body></html>;
}
