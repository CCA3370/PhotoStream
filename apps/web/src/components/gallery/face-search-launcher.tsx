"use client";

import { ScanFaceIcon } from "lucide-react";
import type { ComponentType } from "react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

export interface FaceSearchPanelProps {
  readonly complaintContact: string;
  readonly noticeVersion: string;
  readonly onClose: () => void;
  readonly privacyNotice: string;
  readonly slug: string;
}

export function FaceSearchLauncher(props: Readonly<Omit<FaceSearchPanelProps, "onClose">>) {
  const [Panel, setPanel] = useState<ComponentType<FaceSearchPanelProps> | null>(null);
  const [loading, setLoading] = useState(false);

  async function open(): Promise<void> {
    if (loading || Panel !== null) return;
    setLoading(true);
    try {
      const module = await import("@/components/gallery/face-search-panel");
      setPanel(() => module.FaceSearchPanel);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button disabled={loading} onClick={() => void open()} type="button" variant="outline">
        <ScanFaceIcon data-icon="inline-start" />
        {loading ? "正在准备…" : "上传照片找我"}
      </Button>
      {Panel === null ? null : <Panel {...props} onClose={() => setPanel(null)} />}
    </>
  );
}
