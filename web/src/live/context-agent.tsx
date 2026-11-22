import { lazy, Suspense, useEffect, useState } from "react";
import { Button, Drawer } from "antd";
import { useConfirm } from "../shared/confirm";
import { LoadingState } from "../shared/ui";
import { EditorScope } from "./editing";

const LazyAgentPage = lazy(() =>
  import("./agent").then((m) => ({ default: m.AgentPage })),
);

export type BusinessContext = {
  kind:
    | "source"
    | "resource"
    | "knowledge"
    | "question"
    | "assignment"
    | "submission"
    | "diagnosis"
    | "intervention";
  id: string;
  title: string;
};

export function ContextAgent({ context }: { context: BusinessContext }) {
  const [open, setOpen] = useState(false);
  const [scopeDirty, setScopeDirty] = useState(false);
  const [composerDirty, setComposerDirty] = useState(false);
  const confirm = useConfirm();
  const dirty = scopeDirty || composerDirty;

  // Reset local drawer state cleanly when opening against a new context target.
  useEffect(() => {
    setScopeDirty(false);
    setComposerDirty(false);
  }, [context.kind, context.id]);

  return (
    <>
      <Button onClick={() => setOpen(true)}>助理协作</Button>
      <Drawer
        title={`助理协作 · ${context.title}`}
        open={open}
        width="min(100vw, 780px)"
        push={false}
        destroyOnHidden
        onClose={async () => {
          if (
            !dirty ||
            (await confirm("关闭助理？未保存内容保留在当前浏览器会话。"))
          ) {
            setOpen(false);
            setScopeDirty(false);
            setComposerDirty(false);
          }
        }}
      >
        {open && (
          <EditorScope isolated onDirtyChange={setScopeDirty}>
            <Suspense fallback={<LoadingState />}>
              <LazyAgentPage
                key={`${context.kind}:${context.id}`}
                embedded
                context={context}
                onDirtyChange={setComposerDirty}
              />
            </Suspense>
          </EditorScope>
        )}
      </Drawer>
    </>
  );
}
