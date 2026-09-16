import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "北航实验学校中学部暨北航实验学校分校｜影像直播",
    template: "%s｜中学部影像直播",
  },
  description: "北航实验学校中学部暨北航实验学校分校活动影像直播平台",
  icons: {
    icon: "/photostream-app-icon.svg",
    shortcut: "/photostream-app-icon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light dark",
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  await connection();
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
