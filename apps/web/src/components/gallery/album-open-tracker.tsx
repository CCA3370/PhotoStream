"use client";

import { useEffect } from "react";

import { publicMutation } from "@/lib/client-api";

export function AlbumOpenTracker({ slug }: Readonly<{ slug: string }>) {
  useEffect(() => {
    void publicMutation(`/api/v1/public/albums/${slug}/analytics/open`).catch(() => undefined);
  }, [slug]);
  return null;
}
