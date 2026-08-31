import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "北航实验学校中学部｜影像直播",
    short_name: "中学部影像直播",
    description: "校内活动照片上传与受控直播工作台",
    start_url: "/login",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#315bea",
    lang: "zh-CN",
    icons: [
      {
        src: "/photostream-app-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/photostream-app-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
