import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Button, Drawer, Space, Tag, Tooltip, Typography } from "antd";
import { Maximize2, Sparkles } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useSession } from "../shared/session";
import { LoadingState } from "../shared/ui";
import { useLearning } from "./context";
import { ContextAgentBoundary } from "./context-agent";
import { EditorScope } from "./editing";
import { useLivePageContext } from "./page-context";

const LazyAgentPage = lazy(() =>
  import("./agent").then((m) => ({ default: m.AgentPage })),
);

const POS_STORAGE_KEY = "hm.floatingAssistantPos";
const LONG_PRESS_MS = 250;
const DRAG_CANCEL_SLOP_PX = 8;
const VIEWPORT_MARGIN_X = 12;
const VIEWPORT_TOP_MIN = 56;
const VIEWPORT_BOTTOM_MARGIN = 12;

type Position = { x: number; y: number };

const mobileMedia =
  typeof window !== "undefined"
    ? window.matchMedia("(max-width: 767px)")
    : null;

const subscribeMobile = (listener: () => void) => {
  if (!mobileMedia) return () => {};
  mobileMedia.addEventListener("change", listener);
  return () => mobileMedia.removeEventListener("change", listener);
};

function getIsMobile(): boolean {
  return mobileMedia ? mobileMedia.matches : false;
}

function getDefaultDimensions(isMobile: boolean) {
  return isMobile ? { width: 48, height: 48 } : { width: 118, height: 40 };
}

function clampPosition(pos: Position, width: number, height: number): Position {
  if (typeof window === "undefined") return pos;
  const maxX = Math.max(VIEWPORT_MARGIN_X, window.innerWidth - width - VIEWPORT_MARGIN_X);
  const maxY = Math.max(
    VIEWPORT_TOP_MIN,
    window.innerHeight - height - VIEWPORT_BOTTOM_MARGIN,
  );
  return {
    x: Math.round(Math.min(Math.max(pos.x, VIEWPORT_MARGIN_X), maxX)),
    y: Math.round(Math.min(Math.max(pos.y, VIEWPORT_TOP_MIN), maxY)),
  };
}

function getDefaultPosition(isMobile: boolean): Position {
  const { width, height } = getDefaultDimensions(isMobile);
  if (typeof window === "undefined") return { x: 24, y: 80 };
  return clampPosition(
    {
      x: window.innerWidth - width - 24,
      y: window.innerHeight - height - 24,
    },
    width,
    height,
  );
}

function loadSavedPosition(isMobile: boolean): Position {
  const { width, height } = getDefaultDimensions(isMobile);
  try {
    const raw = localStorage.getItem(POS_STORAGE_KEY);
    if (!raw) return getDefaultPosition(isMobile);
    const parsed = JSON.parse(raw) as Partial<Position>;
    if (
      typeof parsed.x === "number" &&
      Number.isFinite(parsed.x) &&
      typeof parsed.y === "number" &&
      Number.isFinite(parsed.y)
    ) {
      return clampPosition({ x: parsed.x, y: parsed.y }, width, height);
    }
  } catch {
    // Ignore storage access or malformed payload errors.
  }
  return getDefaultPosition(isMobile);
}

function savePosition(pos: Position) {
  try {
    localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(pos));
  } catch {
    // Ignore storage quota or private mode errors.
  }
}

export function FloatingAssistant({ teacher }: { teacher: boolean }) {
  const { course } = useLearning();
  const { session } = useSession();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const isMobile = useSyncExternalStore(subscribeMobile, getIsMobile, () => false);

  const isAssistantRoute =
    pathname === "/teacher/assistant" ||
    pathname === "/student/assistant" ||
    pathname.endsWith("/assistant");
  const hidden = isAssistantRoute || !course || !session?.user.id;

  const [open, setOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const [scopeDirty, setScopeDirty] = useState(false);
  const [composerDirty, setComposerDirty] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pos, setPos] = useState<Position>(() => loadSavedPosition(isMobile));

  const fabRef = useRef<HTMLButtonElement | HTMLAnchorElement | null>(null);
  const posRef = useRef<Position>(pos);
  posRef.current = pos;

  const activePointerRef = useRef<{
    id: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const isDraggingRef = useRef(false);
  const suppressClickRef = useRef(false);
  const suppressClearTimerRef = useRef<number | null>(null);

  const scopeKey = `${session?.user.id || ""}:${course?.id || ""}`;
  const prevScopeKeyRef = useRef(scopeKey);

  const { pageContext, autoContext, refresh } = useLivePageContext(
    teacher,
    course,
    open && !hidden,
  );

  const measureAndClamp = useCallback(
    (targetPos: Position) => {
      const el = fabRef.current;
      const fallback = getDefaultDimensions(isMobile);
      const width = el?.offsetWidth || fallback.width;
      const height = el?.offsetHeight || fallback.height;
      return clampPosition(targetPos, width, height);
    },
    [isMobile],
  );

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearLongPressTimer();
      if (suppressClearTimerRef.current !== null) {
        window.clearTimeout(suppressClearTimerRef.current);
      }
    };
  }, [clearLongPressTimer]);

  // Reset transient state cleanly when hiding, switching courses, or changing user.
  useEffect(() => {
    if (hidden) {
      setOpen(false);
      setHasOpened(false);
      setScopeDirty(false);
      setComposerDirty(false);
      setDragging(false);
      isDraggingRef.current = false;
      activePointerRef.current = null;
      clearLongPressTimer();
    }
  }, [hidden, clearLongPressTimer]);

  useEffect(() => {
    if (prevScopeKeyRef.current !== scopeKey) {
      prevScopeKeyRef.current = scopeKey;
      setScopeDirty(false);
      setComposerDirty(false);
      if (!open) {
        setHasOpened(false);
      }
    }
  }, [scopeKey, open]);

  // Re-clamp FAB inside viewport when layout density/breakpoint changes or window resizes.
  useLayoutEffect(() => {
    if (hidden) return;
    setPos((prev) => measureAndClamp(prev));
  }, [hidden, isMobile, measureAndClamp]);

  useEffect(() => {
    const onResize = () => {
      setPos((prev) => measureAndClamp(prev));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [measureAndClamp]);

  useEffect(() => {
    if (open && !hidden) {
      refresh();
    }
  }, [open, hidden, refresh]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;

    clearLongPressTimer();
    suppressClickRef.current = false;
    isDraggingRef.current = false;
    activePointerRef.current = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: posRef.current.x,
      originY: posRef.current.y,
    };

    const targetEl = event.currentTarget;
    const pointerId = event.pointerId;
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      if (!activePointerRef.current || activePointerRef.current.id !== pointerId) {
        return;
      }
      isDraggingRef.current = true;
      setDragging(true);
      try {
        targetEl.setPointerCapture(pointerId);
      } catch {
        // Synthetic pointer events may not support capture.
      }
    }, LONG_PRESS_MS);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const active = activePointerRef.current;
    if (!active || active.id !== event.pointerId) return;

    const dx = event.clientX - active.startX;
    const dy = event.clientY - active.startY;

    if (!isDraggingRef.current) {
      if (Math.hypot(dx, dy) > DRAG_CANCEL_SLOP_PX) {
        clearLongPressTimer();
        activePointerRef.current = null;
      }
      return;
    }

    event.preventDefault();
    const nextPos = measureAndClamp({
      x: active.originX + dx,
      y: active.originY + dy,
    });
    posRef.current = nextPos;
    setPos(nextPos);
  };

  const finishPointerDrag = (event: ReactPointerEvent<HTMLElement>) => {
    clearLongPressTimer();
    const active = activePointerRef.current;
    if (!active || active.id !== event.pointerId) return;
    activePointerRef.current = null;

    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      setDragging(false);
      suppressClickRef.current = true;
      if (suppressClearTimerRef.current !== null) {
        window.clearTimeout(suppressClearTimerRef.current);
      }
      suppressClearTimerRef.current = window.setTimeout(() => {
        suppressClickRef.current = false;
        suppressClearTimerRef.current = null;
      }, 180);

      const finalPos = measureAndClamp(posRef.current);
      posRef.current = finalPos;
      setPos(finalPos);
      savePosition(finalPos);

      try {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      } catch {
        // Ignore capture release failures.
      }
    }
  };

  const handleFabClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      if (suppressClearTimerRef.current !== null) {
        window.clearTimeout(suppressClearTimerRef.current);
        suppressClearTimerRef.current = null;
      }
      return;
    }
    setOpen((prev) => {
      const next = !prev;
      if (next) setHasOpened(true);
      return next;
    });
  };

  const openFullPage = () => {
    const base = `/${teacher ? "teacher" : "student"}/assistant`;
    const search = new URLSearchParams();
    if (course?.id) search.set("course", course.id);
    if (session?.user.id && course?.id) {
      try {
        const activeConvID = sessionStorage.getItem(
          `haji-agent-context:${session.user.id}:${course.id}::`,
        );
        if (activeConvID) search.set("conversation", activeConvID);
      } catch {
        // Ignore private-mode storage restrictions.
      }
    }
    const qs = search.toString();
    setOpen(false);
    navigate(qs ? `${base}?${qs}` : base);
  };

  if (hidden) return null;

  const dirty = scopeDirty || composerDirty;
  const liveBadgeText = pageContext.sub_page || pageContext.page_title || "";

  const fabClassName = [
    "floating-agent-fab",
    isMobile ? "is-mobile" : "",
    dragging ? "is-dragging" : "",
    dirty && !open ? "has-draft" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const fabButton = (
    <Button
      ref={fabRef}
      type="primary"
      htmlType="button"
      data-floating-assistant="fab"
      className={fabClassName}
      style={{ left: pos.x, top: pos.y }}
      aria-label={isMobile ? "打开课程助理" : "课程助理"}
      aria-expanded={open}
      title={isMobile ? "课程助理" : undefined}
      icon={<Sparkles size={isMobile ? 18 : 16} aria-hidden="true" />}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointerDrag}
      onPointerCancel={finishPointerDrag}
      onContextMenu={(e) => {
        if (isDraggingRef.current || dragging) e.preventDefault();
      }}
      onClick={handleFabClick}
    >
      {!isMobile && "课程助理"}
    </Button>
  );

  return (
    <>
      {!open &&
        (isMobile ? (
          fabButton
        ) : (
          <Tooltip
            title="点击展开课程助理，长按拖动位置"
            open={dragging ? false : undefined}
          >
            {fabButton}
          </Tooltip>
        ))}

      <Drawer
        rootClassName={
          isMobile
            ? "floating-agent-drawer is-mobile-sheet"
            : "floating-agent-drawer"
        }
        placement={isMobile ? "bottom" : "right"}
        mask={isMobile}
        maskClosable={isMobile}
        width={isMobile ? undefined : "min(100%, 760px)"}
        height={isMobile ? "86dvh" : undefined}
        push={false}
        destroyOnHidden={false}
        zIndex={isMobile ? 950 : 850}
        open={open}
        onClose={() => setOpen(false)}
        styles={{
          wrapper: { maxWidth: "100%" },
          header: { minWidth: 0 },
          body: { minWidth: 0 },
        }}
        title={
          <Space
            size={8}
            align="center"
            wrap
            className="floating-agent-drawer-title"
          >
            <Sparkles size={15} aria-hidden="true" />
            <Typography.Text strong>课程助理</Typography.Text>
            {liveBadgeText && (
              <Tag className="ui-meta-tag floating-agent-badge">
                {liveBadgeText}
              </Tag>
            )}
          </Space>
        }
        extra={
          <Button
            size="small"
            htmlType="button"
            icon={<Maximize2 size={13} aria-hidden="true" />}
            onClick={openFullPage}
          >
            完整页面
          </Button>
        }
      >
        <div
          className="floating-agent-drawer-body"
          data-floating-assistant="drawer"
        >
          {hasOpened && (
            <ContextAgentBoundary>
              <EditorScope key={scopeKey} isolated onDirtyChange={setScopeDirty}>
                <Suspense fallback={<LoadingState label="正在加载课程助理…" />}>
                  <LazyAgentPage
                    key={scopeKey}
                    embedded
                    pageContext={pageContext}
                    autoContext={autoContext}
                    onDirtyChange={setComposerDirty}
                  />
                </Suspense>
              </EditorScope>
            </ContextAgentBoundary>
          )}
        </div>
      </Drawer>
    </>
  );
}
