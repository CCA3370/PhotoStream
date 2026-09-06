"use client";

import type { AdminUserView, UserRole } from "@photostream/contracts";
import { CheckIcon, CopyIcon, KeyRoundIcon, LoaderCircleIcon, UserPlusIcon } from "lucide-react";
import { useRef, useState } from "react";

import { PasswordConfirmDialog } from "@/components/auth/password-confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { clientMutation } from "@/lib/client-api";

const roleLabels: Record<UserRole, string> = {
  admin: "管理员",
  reviewer: "审核员",
  uploader: "上传员",
};

interface CreatedUser {
  readonly user: AdminUserView;
  readonly generatedTemporaryPassword: string;
}

interface TemporaryCredential {
  readonly displayName: string;
  readonly password: string;
}

export function UserManagement({
  initialUsers,
}: Readonly<{ initialUsers: readonly AdminUserView[] }>) {
  const formRef = useRef<HTMLFormElement>(null);
  const [users, setUsers] = useState(initialUsers);
  const [role, setRole] = useState<UserRole>("uploader");
  const [creating, setCreating] = useState(false);
  const [pendingUsers, setPendingUsers] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [temporaryCredential, setTemporaryCredential] = useState<TemporaryCredential | null>(null);
  const [copied, setCopied] = useState(false);
  const [resetTarget, setResetTarget] = useState<AdminUserView | null>(null);

  function setUserPending(userId: string, pending: boolean): void {
    setPendingUsers((current) => {
      const next = new Set(current);
      if (pending) next.add(userId);
      else next.delete(userId);
      return next;
    });
  }

  async function create(formData: FormData): Promise<void> {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const created = await clientMutation<CreatedUser>("/api/v1/users", {
        body: {
          username: String(formData.get("username") ?? "").trim(),
          displayName: String(formData.get("displayName") ?? "").trim(),
          role,
        },
        idempotencyKey: crypto.randomUUID(),
      });
      setUsers((current) => [...current, created.user]);
      setTemporaryCredential({
        displayName: created.user.displayName,
        password: created.generatedTemporaryPassword,
      });
      setCopied(false);
      setRole("uploader");
      formRef.current?.reset();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "成员创建失败");
    } finally {
      setCreating(false);
    }
  }

  async function update(userId: string, input: Partial<Pick<AdminUserView, "isActive" | "role">>) {
    if (pendingUsers.has(userId)) return;
    setUserPending(userId, true);
    setError(null);
    try {
      const updated = await clientMutation<AdminUserView>(`/api/v1/users/${userId}`, {
        method: "PATCH",
        body: input,
      });
      setUsers((current) => current.map((user) => (user.id === userId ? updated : user)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "成员更新失败");
    } finally {
      setUserPending(userId, false);
    }
  }

  async function resetPassword(userId: string, password: string): Promise<void> {
    const target = users.find((user) => user.id === userId);
    const result = await clientMutation<{ generatedTemporaryPassword: string }>(
      `/api/v1/users/${userId}/reset-password`,
      { confirmPassword: password, idempotencyKey: crypto.randomUUID() },
    );
    setTemporaryCredential({
      displayName: target?.displayName ?? "成员",
      password: result.generatedTemporaryPassword,
    });
    setCopied(false);
    setResetTarget(null);
  }

  async function copyTemporaryPassword(): Promise<void> {
    if (temporaryCredential === null) return;
    try {
      await navigator.clipboard.writeText(temporaryCredential.password);
      setCopied(true);
    } catch {
      setError("无法复制临时密码，请手动复制");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Card className="overflow-hidden shadow-none">
        <CardHeader className="border-b py-3.5">
          <CardTitle>新增成员</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <form action={create} ref={formRef}>
            <FieldGroup className="gap-3 md:grid md:grid-cols-[1fr_1fr_180px_auto] md:items-end">
              <Field>
                <FieldLabel htmlFor="new-username">用户名</FieldLabel>
                <Input autoComplete="off" id="new-username" name="username" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="new-display-name">显示名</FieldLabel>
                <Input id="new-display-name" name="displayName" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="new-role">角色</FieldLabel>
                <Select
                  items={Object.entries(roleLabels).map(([value, label]) => ({ value, label }))}
                  onValueChange={(value) => {
                    if (value === "admin" || value === "reviewer" || value === "uploader") {
                      setRole(value);
                    }
                  }}
                  value={role}
                >
                  <SelectTrigger id="new-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="uploader">上传员</SelectItem>
                      <SelectItem value="reviewer">审核员</SelectItem>
                      <SelectItem value="admin">管理员</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Button className="md:mb-0" disabled={creating} type="submit">
                {creating ? (
                  <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />
                ) : (
                  <UserPlusIcon data-icon="inline-start" />
                )}
                {creating ? "创建中…" : "创建"}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      <Card className="overflow-hidden shadow-none">
        <CardHeader className="flex flex-row items-center justify-between gap-3 border-b py-3.5">
          <CardTitle>成员与角色</CardTitle>
          <span className="text-xs tabular-nums text-muted-foreground">{users.length} 人</span>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead className="pl-4">成员</TableHead>
                <TableHead>角色</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="pr-4 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => {
                const userPending = pendingUsers.has(user.id);
                return (
                  <TableRow key={user.id}>
                    <TableCell className="pl-4">
                      <div className="flex items-center gap-2.5">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                          {user.displayName.trim().slice(0, 1).toUpperCase() || "?"}
                        </div>
                        <div>
                          <p className="font-medium">{user.displayName}</p>
                          <p className="text-xs text-muted-foreground">{user.username}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Select
                        items={Object.entries(roleLabels).map(([value, label]) => ({
                          value,
                          label,
                        }))}
                        onValueChange={(value) => {
                          if (value === "admin" || value === "reviewer" || value === "uploader") {
                            void update(user.id, { role: value });
                          }
                        }}
                        value={user.role}
                      >
                        <SelectTrigger
                          aria-label={`${user.displayName}的角色`}
                          className="w-32"
                          disabled={userPending}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="uploader">上传员</SelectItem>
                            <SelectItem value="reviewer">审核员</SelectItem>
                            <SelectItem value="admin">管理员</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          aria-label={`${user.displayName}账号启用状态`}
                          checked={user.isActive}
                          disabled={userPending}
                          onCheckedChange={(checked) => void update(user.id, { isActive: checked })}
                        />
                        <Badge variant={user.isActive ? "secondary" : "outline"}>
                          {userPending ? "更新中" : user.isActive ? "已启用" : "已停用"}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <Button
                        disabled={userPending}
                        onClick={() => setResetTarget(user)}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        <KeyRoundIcon data-icon="inline-start" />
                        重置密码
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <PasswordConfirmDialog
        confirmLabel="确认重置"
        description={
          resetTarget === null ? undefined : `重置 ${resetTarget.displayName} 的密码并吊销旧会话。`
        }
        onConfirm={(password) =>
          resetTarget === null ? Promise.resolve() : resetPassword(resetTarget.id, password)
        }
        onOpenChange={(open) => {
          if (!open) setResetTarget(null);
        }}
        open={resetTarget !== null}
        title="重置成员密码"
        variant="destructive"
      />

      <Dialog
        open={temporaryCredential !== null}
        onOpenChange={(open) => {
          if (!open) {
            setTemporaryCredential(null);
            setCopied(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>临时密码</DialogTitle>
            <DialogDescription>{temporaryCredential?.displayName}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 select-all truncate rounded-lg border bg-muted/30 px-3 py-2 font-mono text-base">
              {temporaryCredential?.password}
            </code>
            <Button onClick={() => void copyTemporaryPassword()} type="button" variant="outline">
              {copied ? (
                <CheckIcon data-icon="inline-start" />
              ) : (
                <CopyIcon data-icon="inline-start" />
              )}
              {copied ? "已复制" : "复制"}
            </Button>
          </div>
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>

      <ErrorDialog message={error} onClose={() => setError(null)} title="成员操作失败" />
    </div>
  );
}
