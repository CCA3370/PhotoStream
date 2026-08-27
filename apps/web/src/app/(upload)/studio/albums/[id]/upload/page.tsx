import { UploadShell } from "@/components/shells/upload-shell";
import { Button } from "@/components/ui/button";
import { requireInternalSession } from "@/lib/server-auth";

export default async function UploadPage({ params }: { params: Promise<{ id: string }> }) {
  await requireInternalSession();
  const { id } = await params;
  return (
    <UploadShell albumId={id} albumTitle="春季运动会">
      <section className="flex flex-col gap-4" aria-labelledby="upload-title">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold" id="upload-title">
            上传队列
          </h2>
          <p className="text-sm text-muted-foreground">
            请选择系统 Chrome、Edge 或 Safari 上传媒体。
          </p>
        </div>
        <Button className="min-h-11 w-fit">选择照片或视频</Button>
        <div className="rounded-xl border bg-card p-5">
          <h3 className="font-semibold">队列为空</h3>
          <p className="mt-1 text-sm text-muted-foreground">媒体处理与直传将在阶段 2 接入。</p>
        </div>
      </section>
    </UploadShell>
  );
}
