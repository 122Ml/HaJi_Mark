import { Button, Alert } from "antd";
import { useState } from "react";
import { Feedback, useAction, useLiveQuery } from "./context";
import { ModelSelect, useJob, type Job } from "./knowledge";

const labels: Record<string, string> = {
  vision: "识别所选图像",
  source_suggest: "生成编排建议",
  knowledge_compare: "比较相关知识",
  paper_split: "拆分题卷",
};
export function WorkflowJob({
  kind,
  target,
  onAdopt,
}: {
  kind: "vision" | "source_suggest" | "knowledge_compare" | "paper_split";
  target: Record<string, unknown>;
  onAdopt: (output: Record<string, unknown>, id: string) => void;
}) {
  const [model, setModel] = useState(""),
    [selected, setSelected] = useState("");
  const action = useAction();
  const args = Object.fromEntries(
    Object.entries(target).filter(
      ([k, v]) =>
        ["source_id", "knowledge_id", "asset_id"].includes(k) &&
        typeof v === "string",
    ),
  ) as Record<string, string>;
  const jobs = useLiveQuery<Job[]>(
    `/jobs?${new URLSearchParams({ kind, ...args })}`,
  );
  // A list snapshot can lag behind a just-created task.
  const id = selected || jobs.data?.[0]?.id || "",
    q = useJob(id),
    busy = action.busy || ["queued", "running"].includes(q.data?.state || "");
  return (
    <div className="rag-ai-tool">
      <div className="live-inline">
        <ModelSelect
          kind={kind === "vision" ? "vision" : "chat"}
          value={model}
          onChange={setModel}
        />
        <Button
          disabled={busy}
          onClick={async () => {
            const j = await action.run<Job>("/jobs", {
              kind,
              ...target,
              profile_id: model,
            });
            if (j) setSelected(j.id);
          }}
        >
          {busy ? "处理中…" : labels[kind]}
        </Button>
      </div>
      <Feedback
        error={q.error || jobs.error}
        message={action.message}
        failed={action.failed}
      />
      {q.data?.state === "failed" && <Alert type="error" showIcon role="alert" message={<>{q.data.error}</>} />}
      {q.data?.state === "succeeded" && (
        <Button
          onClick={() => onAdopt(q.data!.output, q.data!.id)}
          type="primary"
        >
          载入候选
        </Button>
      )}
      {q.data?.state === "canceled" && <p>任务已取消</p>}
    </div>
  );
}
