import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useBlocker } from "react-router-dom";
import { Modal, Alert, Button } from "antd";
import { useSession } from "../shared/session";

const EditContext = createContext<(id: string, dirty: boolean) => void>(
  () => {},
);
const DirtyContext = createContext<Record<string, boolean>>({});
const ControlsContext = createContext<{ clearAllDirty: () => void }>({
  clearAllDirty: () => {},
});
const IsolatedScopeContext = createContext<boolean>(false);
const LocalEditRegisterContext = createContext<((id: string, dirty: boolean) => void) | null>(null);

const BLOCKED_QUERY_KEYS = [
  "course",
  "task",
  "resource",
  "source",
  "fragment",
  "paper_source",
  "tab",
  "source_view",
  "knowledge",
  "bank",
  "version",
  "bank_version",
  "diagnosis_report",
  "recommendation_report",
  "change",
  "change_kind",
  "batch",
  "view",
  "new",
  "paper",
  "turn",
];

// Wraps embedded drawers/modals (such as AgentEditor or ContextAgent) so their
// local drafts do not deadlock the outer page's route blocker.
export function EditorScope({
  isolated = true,
  onDirtyChange,
  children,
}: {
  isolated?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  children: ReactNode;
}) {
  const localDirtyRef = useRef<Record<string, boolean>>({});
  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;
  const registerLocal = useCallback((id: string, value: boolean) => {
    const current = localDirtyRef.current;
    if (current[id] === value || (!value && !(id in current))) return;
    const next = { ...current };
    if (value) next[id] = true;
    else delete next[id];
    localDirtyRef.current = next;
    onDirtyChangeRef.current?.(Object.keys(next).length > 0);
  }, []);
  useEffect(() => () => onDirtyChangeRef.current?.(false), []);
  return (
    <IsolatedScopeContext.Provider value={isolated}>
      <LocalEditRegisterContext.Provider value={isolated ? registerLocal : null}>
        {children}
      </LocalEditRegisterContext.Provider>
    </IsolatedScopeContext.Provider>
  );
}

export function useUnsavedChanges(ignoreEditor?: string) {
  const dirty = useContext(DirtyContext);
  return Object.keys(dirty).some(
    (key) => !ignoreEditor || !key.endsWith(`:${ignoreEditor}`),
  );
}

export function useEditingControls() {
  return useContext(ControlsContext);
}

export function EditingProvider({ children }: { children: ReactNode }) {
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const dirtyRef = useRef<Record<string, boolean>>({});
  const register = useCallback((id: string, value: boolean) => {
    const current = dirtyRef.current;
    if (current[id] === value || (!value && !(id in current))) return;
    const next = { ...current };
    if (value) next[id] = true;
    else delete next[id];
    dirtyRef.current = next;
    setDirty(next);
  }, []);
  const clearAllDirty = useCallback(() => {
    dirtyRef.current = {};
    setDirty({});
  }, []);
  const controls = useMemo(() => ({ clearAllDirty }), [clearAllDirty]);
  const hasChanges = Object.keys(dirty).length > 0;
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      Object.keys(dirtyRef.current).length > 0 &&
      (currentLocation.pathname !== nextLocation.pathname ||
        BLOCKED_QUERY_KEYS.some(
          (key) =>
            new URLSearchParams(currentLocation.search).get(key) !==
            new URLSearchParams(nextLocation.search).get(key),
        )),
  );
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (hasChanges) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasChanges]);
  return (
    <EditContext.Provider value={register}>
      <ControlsContext.Provider value={controls}>
        <DirtyContext.Provider value={dirty}>
          {children}
          <Modal
            title="还有未保存的内容"
            open={blocker.state === "blocked"}
            okText="离开页面"
            cancelText="继续编辑"
            onOk={() => blocker.state === "blocked" && blocker.proceed()}
            onCancel={() => blocker.state === "blocked" && blocker.reset()}
          >
            <p>
              请先保存需要提交到平台的修改。可恢复的内容已暂存在当前浏览器会话，重新进入可继续编辑。
            </p>
          </Modal>
        </DirtyContext.Provider>
      </ControlsContext.Provider>
    </EditContext.Provider>
  );
}

// Browser recovery is separate from server persistence and scoped to the signed-in user.
export function useEditorDraft<T>(
  key: string,
  initial: T,
  ready = true,
  options?: { blockNavigation?: boolean },
) {
  const { session } = useSession();
  const isolated = useContext(IsolatedScopeContext);
  const localRegister = useContext(LocalEditRegisterContext);
  const shouldBlock = options?.blockNavigation ?? !isolated;
  const storageKey = `haji-edit:${session?.user.id}:${key}`;
  const globalRegister = useContext(EditContext);
  const register = useCallback(
    (id: string, value: boolean) => {
      globalRegister(id, shouldBlock && value);
      if (localRegister) localRegister(id, value);
    },
    [shouldBlock, globalRegister, localRegister],
  );
  const [value, setValue] = useState<T>(initial);
  const [dirty, setDirty] = useState(false);
  const [restored, setRestored] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [initialized, setInitialized] = useState("");
  const loaded = useRef("");
  const latest = useRef(value);
  const dirtyRef = useRef(false);
  const flushTimer = useRef<number | null>(null);
  const pendingPersist = useRef<{ key: string; data: T } | null>(null);
  latest.current = value;
  dirtyRef.current = dirty;

  const flushPersist = useCallback(() => {
    if (flushTimer.current !== null) {
      window.clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }
    const pending = pendingPersist.current;
    if (!pending) return;
    pendingPersist.current = null;
    try {
      sessionStorage.setItem(pending.key, JSON.stringify(pending.data));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, []);

  useEffect(() => {
    if (!ready) {
      if (loaded.current) {
        flushPersist();
        loaded.current = "";
        setDirty(false);
        setRestored(false);
        setInitialized("");
      }
      return;
    }
    if (loaded.current === storageKey) return;
    flushPersist();
    loaded.current = storageKey;
    try {
      const saved = sessionStorage.getItem(storageKey);
      const data = saved ? (JSON.parse(saved) as T) : initial;
      latest.current = data;
      setValue(data);
      setDirty(!!saved);
      setRestored(!!saved);
      setStorageError(false);
    } catch {
      latest.current = initial;
      setValue(initial);
      setDirty(false);
      setRestored(false);
      setStorageError(true);
    }
    setInitialized(storageKey);
  }, [ready, storageKey, initial, flushPersist]);

  useEffect(() => {
    register(storageKey, dirty);
    return () => register(storageKey, false);
  }, [register, storageKey, dirty]);

  useEffect(() => {
    const onUnload = () => flushPersist();
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      flushPersist();
    };
  }, [flushPersist]);

  function change(next: T | ((v: T) => T)) {
    const data =
      typeof next === "function" ? (next as (v: T) => T)(latest.current) : next;
    latest.current = data;
    setValue(data);
    setDirty(true);
    register(storageKey, true);
    pendingPersist.current = { key: storageKey, data };
    if (flushTimer.current !== null) window.clearTimeout(flushTimer.current);
    flushTimer.current = window.setTimeout(flushPersist, 250);
  }

  function saved(snapshot: T = latest.current) {
    if (JSON.stringify(latest.current) !== JSON.stringify(snapshot))
      return false;
    if (flushTimer.current !== null) {
      window.clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }
    pendingPersist.current = null;
    setDirty(false);
    setRestored(false);
    register(storageKey, false);
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      setStorageError(true);
    }
    return true;
  }

  function reset(data: T) {
    latest.current = data;
    setValue(data);
    saved(data);
  }

  return {
    value,
    change,
    saved,
    reset,
    dirty,
    restored,
    storageError,
    ready: ready && initialized === storageKey,
  };
}

export function DraftNotice({
  restored,
  storageError,
  onDiscard,
}: {
  restored: boolean;
  storageError: boolean;
  onDiscard?: () => void;
}) {
  return storageError ? (
    <Alert
      type="error"
      showIcon
      role="alert"
      message="浏览器暂存不可用，请及时保存到平台。"
    />
  ) : restored ? (
    <Alert
      type="success"
      showIcon
      role="status"
      message="已恢复上次未保存的编辑。"
      action={
        onDiscard ? (
          <Button size="small" onClick={onDiscard}>
            放弃暂存
          </Button>
        ) : undefined
      }
    />
  ) : null;
}
