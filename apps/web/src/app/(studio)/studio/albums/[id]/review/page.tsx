import type { InternalMediaView } from "@photostream/contracts";

import { PublishMediaButton } from "@/components/review/publish-media-button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { serverApi } from "@/lib/api";
import { requireInternalSession } from "@/lib/server-auth";

const publicationLabels: Record<InternalMediaView["publicationStatus"], string> = {
  draft: "尚未就绪",
  pending_review: "待审核",
  published: "已发布",
  hidden: "已隐藏",
  deleted: "已删除",
};

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  await requireInternalSession(["admin", "reviewer"]);
  const { id } = await params;
  const media = await serverApi<InternalMediaView[]>(`/api/v1/albums/${id}/media`);
  return (
    <section className="flex flex-col gap-4" aria-labelledby="review-title">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold" id="review-title">
          照片审核
        </h2>
        <p className="text-muted-foreground">
          预览 480/960 校验完成后才能发布；原图可以继续后台上传。
        </p>
      </div>
      {media.length === 0 ? (
        <Empty className="min-h-64 border">
          <EmptyHeader>
            <EmptyTitle>暂无照片</EmptyTitle>
            <EmptyDescription>上传者完成预览上传后，照片会出现在这里。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {media.map((item) => (
            <Card key={item.id} size="sm">
              <CardHeader>
                <CardTitle>照片 {item.id.slice(-8)}</CardTitle>
                <CardDescription>
                  {item.width}×{item.height} · {item.ingestStatus}
                </CardDescription>
                <CardAction>
                  <Badge variant={item.publicationStatus === "published" ? "default" : "secondary"}>
                    {publicationLabels[item.publicationStatus]}
                  </Badge>
                </CardAction>
              </CardHeader>
              <CardContent>
                {item.publicationStatus === "pending_review" ? (
                  <PublishMediaButton mediaId={item.id} />
                ) : (
                  <p className="text-sm text-muted-foreground">当前无需发布操作</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
