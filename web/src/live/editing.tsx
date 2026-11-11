import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useBlocker } from "react-router-dom";
import { Modal } from "antd";
import { useSession } from "../shared/session";

const EditContext = createContext<(id: string, dirty: boolean) => void>(
  () => {},
);
const DirtyContext = createContext(false);
export function useUnsavedChanges() {
  return useContext(DirtyContext);
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
  const hasChanges = Object.keys(dirty).length > 0;
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      Object.keys(dirtyRef.current).length > 0 &&
      (currentLocation.pathname !== nextLocation.pathname ||
        ["course", "task", "resource", "source", "fragment"].some(
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
      <DirtyContext.Provider value={hasChanges}>
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
    </EditContext.Provider>
  );
}

// Browser recovery is separate from server persistence and scoped to the signed-in user.
export function useEditorDraft<T>(key: string, initial: T, ready = true) {
  const { session } = useSession();
  const storageKey = `haji-edit:${session?.user.id}:${key}`;
  const register = useContext(EditContext);
  const [value, setValue] = useState<T>(initial);
  const [dirty, setDirty] = useState(false);
  const [restored, setRestored] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [initialized, setInitialized] = useState("");
  const loaded = useRef("");
  const latest = useRef(value);
  latest.current = value;
  useEffect(() => {
    if (!ready || loaded.current === storageKey) return;
    loaded.current = storageKey;
    try {
      const saved = sessionStorage.getItem(storageKey);
      const data = saved ? JSON.parse(saved) : initial;
      latest.current = data;
      setValue(data);
      setDirty(!!saved);
      setRestored(!!saved);
    } catch {
      setValue(initial);
      setStorageError(true);
    }
    setInitialized(storageKey);
  }, [ready, storageKey, initial]);
  useEffect(() => {
    register(storageKey, dirty);
    return () => register(storageKey, false);
  }, [register, storageKey, dirty]);
  function change(next: T | ((v: T) => T)) {
    const data =
      typeof next === "function" ? (next as (v: T) => T)(latest.current) : next;
    latest.current = data;
    setValue(data);
    setDirty(true);
    register(storageKey, true);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(data));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }
  function saved(snapshot: T = latest.current) {
    if (JSON.stringify(latest.current) !== JSON.stringify(snapshot))
      return false;
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
}: {
  restored: boolean;
  storageError: boolean;
}) {
  return storageError ? (
    <p role="alert" className="live-error">
      浏览器暂存不可用，请及时保存到平台。
    </p>
  ) : restored ? (
    <p role="status" className="live-message">
      已恢复上次未保存的编辑。
    </p>
  ) : null;
}
