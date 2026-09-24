"use client";

import type { DataSaverSettingView } from "@photostream/contracts/bandwidth";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { clientMutation } from "@/lib/client-api";
export function AlbumDataSaverSetting({
  albumId,
  initialSetting,
}: Readonly<{
  albumId: string;
  initialSetting: DataSaverSettingView;
}>) {
  const [setting, setSetting] = useState(initialSetting);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function update(enabled: boolean): Promise<void> {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const next = await clientMutation<DataSaverSettingView>(
        `/api/v1/albums/${albumId}/data-saver`,
        {
          method: "PATCH",
          body: { enabled },
        },
      );
      setSetting(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "更新省流模式失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Card className="overflow-hidden">
        <CardHeader className="border-b py-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>流量控制</CardTitle>
            <Badge variant={setting.enabled ? "default" : "secondary"}>
              {setting.enabled ? "省流模式已开启" : "标准画质"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="flex items-center justify-between gap-4 px-4 py-3.5">
            <div className="min-w-0">
              <p className="text-sm font-medium">省流模式</p>
              <p className="mt-0.5 max-w-3xl text-xs leading-5 text-muted-foreground">
                开启后，观众页会优先使用较低清晰度的大图，停止相邻照片网络预加载，并减少提前加载的照片页。下载、找照片和直播更新功能保持可用。
              </p>
            </div>
            <div className="shrink-0">
              {pending ? (
                <Spinner className="size-4 animate-spin text-muted-foreground" />
              ) : (
                <Switch
                  aria-label="省流模式"
                  checked={setting.enabled}
                  onCheckedChange={(checked) => void update(checked)} />
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      <ErrorDialog message={error} onClose={() => setError(null)} title="无法更新省流模式" />
    </>
  );
}
