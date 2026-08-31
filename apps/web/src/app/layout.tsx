import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "北航实验学校中学部｜影像直播",
    template: "%s｜中学部影像直播",
  },
  description: "北航实验学校中学部活动影像直播平台",
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
