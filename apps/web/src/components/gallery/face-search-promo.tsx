"use client";

import { ScanFaceIcon } from "lucide-react";
import { useEffect, useState } from "react";

const promoStorageKey = "photostream:face-search-promo:v1";

export function FaceSearchPromo() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(promoStorageKey) === "seen") return;
      window.localStorage.setItem(promoStorageKey, "seen");
      setVisible(true);
    } catch {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  return (
    <aside className="rounded-2xl border border-primary/20 bg-primary/[0.055] px-4 py-3.5 shadow-xs sm:px-4.5 sm:py-4">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
          <ScanFaceIcon aria-hidden="true" className="size-5" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground sm:text-[15px]">
              推荐使用人脸找照片
            </p>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
              推荐
            </span>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground sm:text-[13px]">
            不用记号码。打开下方“找照片”，选择“人脸”，拍一张或选一张清晰的单人正脸照，系统会帮你在本相册中查找可能包含这个人的照片。
          </p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-1.5 text-center text-[11px] leading-4 text-muted-foreground sm:gap-2 sm:text-xs">
        <div className="rounded-xl bg-background/70 px-2 py-2 ring-1 ring-border/50">
          <span className="font-semibold text-foreground">1.</span> 打开找照片
        </div>
        <div className="rounded-xl bg-background/70 px-2 py-2 ring-1 ring-border/50">
          <span className="font-semibold text-foreground">2.</span> 选择人脸
        </div>
        <div className="rounded-xl bg-background/70 px-2 py-2 ring-1 ring-border/50">
          <span className="font-semibold text-foreground">3.</span> 拍照或选图
        </div>
      </div>
    </aside>
  );
}
