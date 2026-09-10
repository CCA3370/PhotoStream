"use client";

import type { PublicMediaView } from "@photostream/contracts";
import {
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { swipeIntentDirection } from "@/lib/photo-swipe-intent";

const minZoom = 1;
const maxZoom = 5;
const swipeSettleMs = 180;

type Point = { x: number; y: number };
type Gesture =
  | { mode: "idle" }
  | { mode: "pan"; start: Point; origin: Point }
  | { mode: "swipe"; start: Point; requested?: -1 | 1 }
  | { mode: "pinch"; distance: number; zoom: number };

function distance(points: readonly Point[]): number {
  const [first, second] = points;
  if (first === undefined || second === undefined) return 0;
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function usePhotoLightboxGestures({
  canNavigate,
  cancelTargetRequest,
  commitOffset,
  requestTarget,
  selected,
}: Readonly<{
  canNavigate: boolean;
  cancelTargetRequest: () => void;
  commitOffset: (offset: -1 | 1) => void;
  requestTarget: (offset: -1 | 1, viewportWidth: number, viewportHeight: number) => void;
  selected: PublicMediaView | null;
}>) {
  const stageRef = useRef<HTMLDivElement>(null);
  const stageResizeObserverRef = useRef<ResizeObserver | null>(null);
  const pointersRef = useRef(new Map<number, Point>());
  const gestureRef = useRef<Gesture>({ mode: "idle" });
  const swipeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [swipeSettling, setSwipeSettling] = useState(false);
  const [stageWidth, setStageWidth] = useState(0);
  const [stageHeight, setStageHeight] = useState(0);

  const setStageElement = useCallback((node: HTMLDivElement | null) => {
    stageResizeObserverRef.current?.disconnect();
    stageResizeObserverRef.current = null;
    stageRef.current = node;
    if (node === null) {
      setStageWidth(0);
      setStageHeight(0);
      return;
    }
    const measure = () => {
      setStageWidth(node.clientWidth);
      setStageHeight(node.clientHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    stageResizeObserverRef.current = observer;
  }, []);

  const clampPan = useCallback(
    (value: Point, nextZoom: number): Point => {
      const stage = stageRef.current;
      if (stage === null || selected === null || nextZoom <= 1) return { x: 0, y: 0 };
      const rect = stage.getBoundingClientRect();
      const fit = Math.min(rect.width / selected.width, rect.height / selected.height);
      const renderedWidth = selected.width * fit * nextZoom;
      const renderedHeight = selected.height * fit * nextZoom;
      return {
        x: clamp(
          value.x,
          -Math.max(0, (renderedWidth - rect.width) / 2),
          Math.max(0, (renderedWidth - rect.width) / 2),
        ),
        y: clamp(
          value.y,
          -Math.max(0, (renderedHeight - rect.height) / 2),
          Math.max(0, (renderedHeight - rect.height) / 2),
        ),
      };
    },
    [selected],
  );

  const changeZoom = useCallback(
    (value: number) => {
      const nextZoom = clamp(value, minZoom, maxZoom);
      setZoom(nextZoom);
      setPan((current) => clampPan(current, nextZoom));
    },
    [clampPan],
  );

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const resetInteraction = useCallback(() => {
    resetView();
    pointersRef.current.clear();
    gestureRef.current = { mode: "idle" };
    if (swipeTimerRef.current !== null) {
      clearTimeout(swipeTimerRef.current);
      swipeTimerRef.current = null;
    }
    setSwipeSettling(false);
    setSwipeOffset(0);
  }, [resetView]);

  const animateOffset = useCallback(
    (offset: -1 | 1) => {
      if (!canNavigate || swipeSettling) return;
      requestTarget(offset, stageWidth, stageHeight);
      const width = stageRef.current?.clientWidth ?? stageWidth;
      if (width <= 0) return;
      setSwipeSettling(true);
      setSwipeOffset(offset > 0 ? -width : width);
      if (swipeTimerRef.current !== null) clearTimeout(swipeTimerRef.current);
      swipeTimerRef.current = setTimeout(() => {
        swipeTimerRef.current = null;
        setSwipeSettling(false);
        setSwipeOffset(0);
        commitOffset(offset);
      }, swipeSettleMs);
    },
    [
      canNavigate,
      commitOffset,
      requestTarget,
      stageHeight,
      stageWidth,
      swipeSettling,
    ],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (swipeSettling) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      const point = { x: event.clientX, y: event.clientY };
      pointersRef.current.set(event.pointerId, point);
      const points = [...pointersRef.current.values()];
      if (points.length >= 2) {
        cancelTargetRequest();
        gestureRef.current = { mode: "pinch", distance: distance(points), zoom };
        setDragging(false);
        setSwipeOffset(0);
        return;
      }
      if (zoom > 1) {
        gestureRef.current = { mode: "pan", start: point, origin: pan };
        setDragging(true);
      } else {
        gestureRef.current = { mode: "swipe", start: point };
      }
    },
    [cancelTargetRequest, pan, swipeSettling, zoom],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (!pointersRef.current.has(event.pointerId)) return;
      const point = { x: event.clientX, y: event.clientY };
      pointersRef.current.set(event.pointerId, point);
      const gesture = gestureRef.current;
      const points = [...pointersRef.current.values()];
      if (gesture.mode === "pinch" && points.length >= 2 && gesture.distance > 0) {
        const nextZoom = clamp(
          gesture.zoom * (distance(points) / gesture.distance),
          minZoom,
          maxZoom,
        );
        setZoom(nextZoom);
        setPan((current) => clampPan(current, nextZoom));
        return;
      }
      if (gesture.mode === "pan") {
        setPan(
          clampPan(
            {
              x: gesture.origin.x + point.x - gesture.start.x,
              y: gesture.origin.y + point.y - gesture.start.y,
            },
            zoom,
          ),
        );
        return;
      }
      if (gesture.mode === "swipe" && points.length === 1) {
        const width = stageRef.current?.clientWidth ?? stageWidth;
        if (width <= 0) return;
        const deltaX = point.x - gesture.start.x;
        const direction = swipeIntentDirection(deltaX, point.y - gesture.start.y);
        if (direction !== null && gesture.requested !== direction) {
          gesture.requested = direction;
          requestTarget(direction, stageWidth, stageHeight);
        }
        setSwipeOffset(clamp(deltaX, -width, width));
      }
    },
    [clampPan, requestTarget, stageHeight, stageWidth, zoom],
  );

  const finishPointer = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      const point = { x: event.clientX, y: event.clientY };
      const gesture = gestureRef.current;
      if (gesture.mode === "swipe") {
        const deltaX = point.x - gesture.start.x;
        const deltaY = point.y - gesture.start.y;
        const shouldNavigate =
          event.type !== "pointercancel" &&
          Math.abs(deltaX) >= 52 &&
          Math.abs(deltaX) > Math.abs(deltaY) * 1.2;
        if (shouldNavigate) {
          animateOffset(deltaX < 0 ? 1 : -1);
        } else {
          cancelTargetRequest();
          setSwipeSettling(true);
          setSwipeOffset(0);
          if (swipeTimerRef.current !== null) clearTimeout(swipeTimerRef.current);
          swipeTimerRef.current = setTimeout(() => {
            setSwipeSettling(false);
            swipeTimerRef.current = null;
          }, swipeSettleMs);
        }
      }
      pointersRef.current.delete(event.pointerId);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setDragging(false);
      if (pointersRef.current.size === 0) gestureRef.current = { mode: "idle" };
    },
    [animateOffset, cancelTargetRequest],
  );

  const onWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>): void => {
      event.preventDefault();
      changeZoom(zoom + (event.deltaY < 0 ? 0.35 : -0.35));
    },
    [changeZoom, zoom],
  );

  useEffect(
    () => () => {
      if (swipeTimerRef.current !== null) clearTimeout(swipeTimerRef.current);
      stageResizeObserverRef.current?.disconnect();
    },
    [],
  );

  return {
    animateOffset,
    changeZoom,
    dragging,
    finishPointer,
    onPointerDown,
    onPointerMove,
    onWheel,
    pan,
    resetInteraction,
    resetView,
    setStageElement,
    stageHeight,
    stageWidth,
    swipeOffset,
    swipeSettling,
    zoom,
  } as const;
}
