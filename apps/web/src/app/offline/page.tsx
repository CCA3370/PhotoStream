import { WifiOffIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function OfflinePage() {
  return (
    <main className="workbench-theme flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <Alert className="max-w-lg">
        <WifiOffIcon aria-hidden="true" />
        <AlertTitle>当前处于离线状态</AlertTitle>
        <AlertDescription>
          已选择文件和可恢复任务仍保存在本机浏览器中。登录、获取上传签名和继续传输需要网络；恢复连接后请重新打开上传页。
        </AlertDescription>
      </Alert>
    </main>
  );
}
