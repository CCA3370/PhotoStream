"use client";

import Image from "next/image";
import { useCallback, useRef, useState } from "react";

interface PhotoBeforeAfterSliderProps {
  readonly beforeUrl: string;
  readonly afterUrl: string | null;
  readonly disabled?: boolean;
}

function clamp(value: number): number {
  return Math.min(100, Math.max(0, value));
}

export function PhotoBeforeAfterSlider({
  beforeUrl,
  afterUrl,
  disabled = false,
}: PhotoBeforeAfterSliderProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState(50);
  const [dragging, setDragging] = useState(false);
  const hasAfter = afterUrl !== null;

  const updateFromClientX = useCallback((clientX: number) => {
    const bounds = containerRef.current?.getBoundingClientRect();
    if (bounds === undefined || bounds.width <= 0) return;
    setPosition(clamp(((clientX - bounds.left) / bounds.width) * 100));
  }, []);

  return (
    <div
      className="relative h-full w-full select-none overflow-hidden"
      onPointerDown={(event) => {
        if (!hasAfter || disabled) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        updateFromClientX(event.clientX);
      }}
      onPointerMove={(event) => {
        if (!dragging || !hasAfter || disabled) return;
        updateFromClientX(event.clientX);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        setDragging(false);
      }}
      onPointerCancel={() => setDragging(false)}
      ref={containerRef}
    >
      <Image
        alt="原始照片"
        className="pointer-events-none object-contain"
        draggable={false}
        fill
        sizes="(max-width: 767px) 100vw, 70vw"
        src={beforeUrl}
        unoptimized
      />

      {hasAfter ? (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 overflow-hidden"
            style={{ clipPath: `inset(0 0 0 ${position}%)` }}
          >
            <Image
              alt="修图预览"
              className="object-contain"
              draggable={false}
              fill
              sizes="(max-width: 767px) 100vw, 70vw"
              src={afterUrl}
              unoptimized
            />
          </div>

          <span className="pointer-events-none absolute left-3 top-3 rounded-md bg-black/55 px-2 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
            原图
          </span>
          <span className="pointer-events-none absolute right-3 top-3 rounded-md bg-black/55 px-2 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
            修图
          </span>

          <div
            className="absolute inset-y-0 z-10 w-px bg-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.28)]"
            style={{ left: `${position}%` }}
          >
            <button
              aria-label="调整原图与修图对比分割线"
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={Math.round(position)}
              className="absolute left-1/2 top-1/2 grid size-9 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize place-items-center rounded-full border border-white/70 bg-black/60 text-white shadow-lg backdrop-blur-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50"
              disabled={disabled}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  setPosition((current) => clamp(current - 2));
                } else if (event.key === "ArrowRight") {
                  event.preventDefault();
                  setPosition((current) => clamp(current + 2));
                } else if (event.key === "Home") {
                  event.preventDefault();
                  setPosition(0);
                } else if (event.key === "End") {
                  event.preventDefault();
                  setPosition(100);
                }
              }}
              role="slider"
              type="button"
            >
              <span aria-hidden="true" className="flex gap-1">
                <span>‹</span>
                <span>›</span>
              </span>
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
