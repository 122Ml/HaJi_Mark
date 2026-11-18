import { useState } from "react";
import { Button, Drawer } from "antd";
import { AgentPage } from "./agent";
import { useConfirm } from "../shared/confirm";
import { useUnsavedChanges } from "./editing";

export type BusinessContext = {
  kind: "source" | "resource" | "knowledge" | "question" | "assignment" | "submission" | "diagnosis" | "intervention";
  id: string;
  title: string;
};

export function ContextAgent({ context }: { context: BusinessContext }) {
  const [open, setOpen] = useState(false);
  const confirm = useConfirm();
  const dirty = useUnsavedChanges();
  return <>
    <Button onClick={() => setOpen(true)}>助理协作</Button>
    <Drawer title={`助理协作 · ${context.title}`} open={open} width={780} destroyOnHidden onClose={async () => {
      if (!dirty || await confirm("关闭助理？未保存内容保留在当前浏览器会话。")) setOpen(false);
    }}>
      {open && <AgentPage key={`${context.kind}:${context.id}`} embedded context={context} />}
    </Drawer>
  </>;
}
