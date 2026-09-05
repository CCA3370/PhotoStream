"use client";

import type { AdminUserView, UserRole } from "@photostream/contracts";
import { KeyRoundIcon, UserPlusIcon } from "lucide-react";
import { useState } from "react";

import { PasswordConfirmDialog } from "@/components/auth/password-confirm-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  uploader: "上传者",
};

interface CreatedUser {
  readonly user: AdminUserView;
  readonly generatedTemporaryPassword: string;
}

export function UserManagement({
  initialUsers,
}: Readonly<{ initialUsers: readonly AdminUserView[] }>) {
  const [users, setUsers] = useState(initialUsers);
  const [role, setRole] = useState<UserRole>("uploader");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<AdminUserView | null>(null);

  async function create(formData: FormData): Promise<void> {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const created = await clientMutation<CreatedUser>("/api/v1/users", {
        body: {
          username: String(formData.get("username") ?? ""),
          displayName: String(formData.get("displayName") ?? ""),
          role,
        },
        idempotencyKey: crypto.randomUUID(),
      });
      setUsers((current) => [...current, created.user]);
      setTemporaryPassword(created.generatedTemporaryPassword);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "成员创建失败");
    } finally {
      setPending(false);
    }
  }

  async function update(userId: string, input: Partial<Pick<AdminUserView, "isActive" | "role">>) {
    if (pending) return;
    setPending(true);
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
      setPending(false);
    }
  }

  async function resetPassword(userId: string, password: string): Promise<void> {
    const result = await clientMutation<{ generatedTemporaryPassword: string }>(
      `/api/v1/users/${userId}/reset-password`,
      { confirmPassword: password, idempotencyKey: crypto.randomUUID() },
    );
    setTemporaryPassword(result.generatedTemporaryPassword);
    setResetTarget(null);
  }

  return (
    <div className="flex flex-col gap-4">
      {temporaryPassword === null ? null : (
        <Alert>
          <KeyRoundIcon aria-hidden="true" />
          <AlertTitle>一次性临时密码</AlertTitle>
          <AlertDescription>
            <p className="font-mono text-base text-foreground">{temporaryPassword}</p>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>新增成员</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={create}>
            <FieldGroup className="md:grid md:grid-cols-3">
              <Field>
                <FieldLabel htmlFor="new-username">用户名</FieldLabel>
                <Input id="new-username" name="username" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="new-display-name">显示名</FieldLabel>
                <Input id="new-display-name" name="displayName" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="new-role">角色</FieldLabel>
                <Select
                  items={[
                    { label: "上传者", value: "uploader" },
                    { label: "审核员", value: "reviewer" },
                    { label: "管理员", value: "admin" },
                  ]}
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
                      <SelectItem value="uploader">上传者</SelectItem>
                      <SelectItem value="reviewer">审核员</SelectItem>
                      <SelectItem value="admin">管理员</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Button className="md:col-span-3 md:w-fit" disabled={pending} type="submit">
                <UserPlusIcon data-icon="inline-start" />
                {pending ? "正在创建…" : "创建成员"}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>成员与角色</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>成员</TableHead>
                <TableHead>角色</TableHead>
                <TableHead>启用</TableHead>
                <TableHead>密码</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <p className="font-medium">{user.displayName}</p>
                    <p className="text-muted-foreground">{user.username}</p>
                  </TableCell>
                  <TableCell>
                    <Select
                      items={Object.entries(roleLabels).map(([value, label]) => ({ value, label }))}
                      onValueChange={(value) => {
                        if (value === "admin" || value === "reviewer" || value === "uploader") {
                          void update(user.id, { role: value });
                        }
                      }}
                      value={user.role}
                    >
                      <SelectTrigger aria-label={`${user.displayName}的角色`} disabled={pending}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="uploader">上传者</SelectItem>
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
                        disabled={pending}
                        onCheckedChange={(checked) => void update(user.id, { isActive: checked })}
                      />
                      <Badge variant={user.isActive ? "secondary" : "outline"}>
                        {user.isActive ? "已启用" : "已停用"}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button
                      disabled={pending}
                      onClick={() => setResetTarget(user)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      重置密码
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <PasswordConfirmDialog
        confirmLabel="确认重置"
        description={
          resetTarget === null ? undefined : `将重置 ${resetTarget.displayName} 的密码并吊销其旧会话。`
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

      <ErrorDialog message={error} onClose={() => setError(null)} title="成员操作失败" />
    </div>
  );
}
