"use client";

import type { ReviewCollaborationView } from "@photostream/contracts";
import { UsersIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { clientMutation } from "@/lib/client-api";

export type ReviewAssignmentFilter = "all" | "mine";

const roleLabels = {
  admin: "管理员",
  reviewer: "审核员",
  uploader: "上传员",
} as const;

export function ReviewCollaborationControl({
  albumId,
  assignment,
  onAssignmentChange,
  onValueChange,
  value,
  userRole,
}: Readonly<{
  albumId: string;
  assignment: ReviewAssignmentFilter;
  onAssignmentChange: (value: ReviewAssignmentFilter) => void;
  onValueChange: (value: ReviewCollaborationView) => void;
  value: ReviewCollaborationView;
  userRole: "admin" | "reviewer";
}>) {
  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    new Set(value.participants.map((participant) => participant.id)),
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setSelectedIds(new Set(value.participants.map((participant) => participant.id)));
    }
  }, [open, value.participants]);

  useEffect(() => {
    if (assignment === "mine" && (!value.enabled || !value.currentUserParticipating)) {
      onAssignmentChange("all");
    }
  }, [assignment, onAssignmentChange, value.currentUserParticipating, value.enabled]);

  const mineLabel =
    value.currentUserRemainingCount === null
      ? "只看分配给我"
      : `只看分配给我（待审核 ${value.currentUserRemainingCount}）`;
  const invalidSelectedIds = [...selectedIds].filter((userId) => {
    const participant = value.availableParticipants.find((item) => item.id === userId);
    return participant === undefined || !participant.isActive || participant.role === "uploader";
  });

  function toggleParticipant(userId: string, checked: boolean): void {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(userId);
      else next.delete(userId);
      return next;
    });
  }

  async function save(): Promise<void> {
    if (saving || selectedIds.size === 1 || invalidSelectedIds.length > 0) return;
    setSaving(true);
    try {
      const next = await clientMutation<ReviewCollaborationView>(
        `/api/v1/albums/${albumId}/review-collaboration`,
        {
          method: "PATCH",
          body: { participantIds: [...selectedIds] },
        },
      );
      onValueChange(next);
      if (!next.enabled || !next.currentUserParticipating) onAssignmentChange("all");
      setOpen(false);
      toast.add({
        title: next.enabled ? `已启用审核分工（${next.participants.length} 人）` : "已关闭审核分工",
        type: "success",
      });
    } catch (cause) {
      toast.add({
        title: cause instanceof Error ? cause.message : "保存审核分工失败",
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {value.enabled && value.currentUserParticipating ? (
        <Select
          items={[
            { label: "全部分工", value: "all" },
            { label: mineLabel, value: "mine" },
          ]}
          onValueChange={(next) => onAssignmentChange((next ?? "all") as ReviewAssignmentFilter)}
          value={assignment}
        >
          <SelectTrigger aria-label="审核分工筛选" className="h-8 w-44 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">全部分工</SelectItem>
              <SelectItem value="mine">{mineLabel}</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      ) : null}

      {userRole === "admin" ? (
        <>
          <Button
            className="h-8 px-2.5 text-xs"
            onClick={() => setOpen(true)}
            size="sm"
            type="button"
            variant="outline"
          >
            <UsersIcon data-icon="inline-start" />
            分工设置
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>审核分工</DialogTitle>
                <DialogDescription>
                  选择至少 2
                  个账号后，系统会优先将当前未审核照片平均分配；之后的新照片会自动分给剩余待审核任务最少的协作者。首次显示照片或打开大图即视为审核完成。清空选择可关闭分工。
                </DialogDescription>
              </DialogHeader>

              <div className="max-h-80 space-y-2 overflow-y-auto py-1">
                {value.availableParticipants.length === 0 ? (
                  <p className="text-sm text-muted-foreground">暂无可参与审核的账号。</p>
                ) : (
                  value.availableParticipants.map((participant) => {
                    const remaining =
                      value.participants.find((item) => item.id === participant.id)
                        ?.remainingCount ?? 0;
                    const checked = selectedIds.has(participant.id);
                    const eligible =
                      participant.isActive &&
                      (participant.role === "admin" || participant.role === "reviewer");
                    return (
                      <label
                        className="flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5"
                        htmlFor={`review-collaborator-${participant.id}`}
                        key={participant.id}
                      >
                        <Checkbox
                          checked={checked}
                          disabled={!eligible && !checked}
                          id={`review-collaborator-${participant.id}`}
                          onCheckedChange={(next) => toggleParticipant(participant.id, next)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {participant.displayName}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            @{participant.username} · {roleLabels[participant.role]}
                            {!participant.isActive
                              ? " · 已停用"
                              : participant.role === "uploader"
                                ? " · 无审核权限"
                                : ""}
                          </span>
                        </span>
                        {value.enabled ? (
                          <span className="text-xs tabular-nums text-muted-foreground">
                            待审核 {remaining} 张
                          </span>
                        ) : null}
                      </label>
                    );
                  })
                )}
              </div>

              {invalidSelectedIds.length > 0 ? (
                <p className="text-xs text-destructive">
                  当前分工中有已停用或已失去审核权限的账号，请取消勾选后保存。
                </p>
              ) : selectedIds.size === 1 ? (
                <p className="text-xs text-destructive">审核分工至少需要 2 个账号。</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  已选择 {selectedIds.size} 个账号
                  {selectedIds.size === 0 ? "，保存后将关闭分工" : ""}
                </p>
              )}

              <DialogFooter>
                <Button
                  disabled={saving}
                  onClick={() => setOpen(false)}
                  type="button"
                  variant="outline"
                >
                  取消
                </Button>
                <Button
                  disabled={saving || selectedIds.size === 1 || invalidSelectedIds.length > 0}
                  onClick={() => void save()}
                  type="button"
                >
                  {saving ? "保存中…" : "保存并重新分配"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </>
  );
}
