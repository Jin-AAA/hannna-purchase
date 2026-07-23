import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "哈娜的小車車",
  description: "哈娜的小車車代購管理後台",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: process.env.GITHUB_PAGES === "true" ? "/hannna-purchase/favicon.svg?v=2" : "/favicon.svg?v=2",
    shortcut: process.env.GITHUB_PAGES === "true" ? "/hannna-purchase/favicon.svg?v=2" : "/favicon.svg?v=2",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
