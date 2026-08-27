"use client";

import { BellIcon, SearchIcon } from "lucide-react";

import { InternalProviders } from "@/components/internal-providers";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const categories = [
  { label: "选择分类", value: null },
  { label: "开幕式", value: "opening" },
  { label: "田径", value: "track" },
] as const;

export function UiFoundationDemo() {
  return (
    <InternalProviders>
      <main className="workbench-theme min-h-screen bg-background p-4 text-foreground md:p-8">
        <div className="mx-auto flex max-w-4xl flex-col gap-8">
          <header className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">Base UI 试验面</p>
            <h1 className="text-2xl font-semibold">界面基础状态</h1>
            <p className="text-muted-foreground">
              用于验证按钮、表单、选择、切换、Dialog、Drawer 与 Toast 的键盘和无障碍行为。
            </p>
          </header>

          <section aria-labelledby="button-states" className="flex flex-col gap-3">
            <h2 className="text-xl font-semibold" id="button-states">
              操作状态
            </h2>
            <div className="flex flex-wrap gap-2">
              <Button>主操作</Button>
              <Button variant="outline">次要操作</Button>
              <Button disabled>提交中</Button>
              <Button variant="destructive">危险操作</Button>
            </div>
          </section>

          <section aria-labelledby="form-states" className="flex max-w-xl flex-col gap-3">
            <h2 className="text-xl font-semibold" id="form-states">
              表单状态
            </h2>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="foundation-search">搜索活动</FieldLabel>
                <InputGroup className="min-h-11">
                  <InputGroupAddon aria-hidden="true">
                    <SearchIcon />
                  </InputGroupAddon>
                  <InputGroupInput id="foundation-search" placeholder="输入活动名称" />
                </InputGroup>
                <FieldDescription>搜索值不会写入地址栏。</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="foundation-category">一级分类</FieldLabel>
                <Select items={categories}>
                  <SelectTrigger className="min-h-11 w-full" id="foundation-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {categories
                        .filter((item) => item.value !== null)
                        .map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel id="foundation-view-mode">查找方式</FieldLabel>
                <ToggleGroup
                  aria-labelledby="foundation-view-mode"
                  defaultValue={["bib"]}
                  variant="outline"
                >
                  <ToggleGroupItem className="min-h-11" value="bib">
                    按号码
                  </ToggleGroupItem>
                  <ToggleGroupItem className="min-h-11" value="attributes">
                    按年级班级
                  </ToggleGroupItem>
                </ToggleGroup>
              </Field>
            </FieldGroup>
          </section>

          <section aria-labelledby="overlay-states" className="flex flex-col gap-3">
            <h2 className="text-xl font-semibold" id="overlay-states">
              浮层与通知
            </h2>
            <div className="flex flex-wrap gap-2">
              <Dialog>
                <DialogTrigger render={<Button variant="outline" />}>打开对话框</DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>确认界面状态</DialogTitle>
                    <DialogDescription>关闭后焦点应回到原按钮。</DialogDescription>
                  </DialogHeader>
                  <DialogFooter showCloseButton />
                </DialogContent>
              </Dialog>
              <Drawer showSwipeHandle>
                <DrawerTrigger render={<Button variant="outline" />}>打开抽屉</DrawerTrigger>
                <DrawerContent>
                  <DrawerHeader>
                    <DrawerTitle>移动任务面板</DrawerTitle>
                    <DrawerDescription>验证滚动锁、焦点和安全区。</DrawerDescription>
                  </DrawerHeader>
                  <div className="p-4">
                    <Button className="min-h-11">继续</Button>
                  </div>
                </DrawerContent>
              </Drawer>
              <Button
                onClick={() =>
                  toast.add({ title: "状态已保存", description: "Toast 不是唯一结果提示。" })
                }
                variant="outline"
              >
                <BellIcon data-icon="inline-start" />
                显示通知
              </Button>
            </div>
          </section>
        </div>
      </main>
    </InternalProviders>
  );
}
