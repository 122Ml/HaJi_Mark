import { useState } from "react";
import { Alert, Button, Drawer, Space } from "antd";
import { SourceWorkspace, KnowledgeEditor, type Knowledge } from "./knowledge";
import { BankDetailView } from "./question-bank";
import { CurriculumPage } from "./curriculum";
import { DiagnosisReview, type IntelligenceDetail } from "./intelligence";
import { SubmissionImport } from "./submission-import";
import { PaperImport } from "./material-assist";
import { useLearning, useLiveQuery } from "./context";
import { useUnsavedChanges } from "./editing";
import { useConfirm } from "../shared/confirm";
import { LoadingState, ErrorState } from "../shared/ui";
import type { Assignment, Question } from "./assessment";

export type EditorTarget = {
  kind:
    | "source"
    | "knowledge"
    | "question"
    | "curriculum"
    | "import"
    | "diagnosis"
    | "paper";
  id: string;
};
const names: Record<EditorTarget["kind"], string> = {
  source: "原文核对",
  knowledge: "知识编辑",
  question: "题目与评分标准",
  curriculum: "课程目录",
  import: "作答导入",
  diagnosis: "诊断复核",
  paper: "整卷拆题",
};

export function AgentEditor({
  target,
  disabled,
  complete,
}: {
  target: EditorTarget;
  disabled: boolean;
  complete: () => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const { course } = useLearning();
  const unsaved = useUnsavedChanges(`agent:${course!.id}`);
  const confirm = useConfirm();
  return (
    <>
      <Button type="primary" disabled={disabled} onClick={() => setOpen(true)}>
        打开{names[target.kind] || "编辑器"}
      </Button>
      <Drawer
        title={names[target.kind] || "编辑器"}
        open={open}
        width="min(100vw, 1100px)"
        destroyOnHidden
        maskClosable={false}
        onClose={async () => {
          if (
            !unsaved ||
            (await confirm("尚有未保存编辑。暂时收起并保留浏览器草稿？"))
          )
            setOpen(false);
        }}
        footer={
          <Space wrap>
            <Button
              type="primary"
              disabled={disabled || unsaved}
              onClick={async () => {
                if (await complete()) setOpen(false);
              }}
            >
              返回对话并继续
            </Button>
            <Button
              onClick={async () => {
                if (
                  !unsaved ||
                  (await confirm("暂时收起，未保存编辑保留在浏览器？"))
                )
                  setOpen(false);
              }}
            >
              暂时收起
            </Button>
            {unsaved && (
              <Alert type="warning" message="先保存编辑，再返回任务" />
            )}
          </Space>
        }
      >
        <EditorBody target={target} />
      </Drawer>
    </>
  );
}
function EditorBody({ target }: { target: EditorTarget }) {
  if (target.kind === "source")
    return <SourceWorkspace id={target.id} fragmentID="" />;
  if (target.kind === "question") return <BankDetailView bankID={target.id} />;
  if (target.kind === "knowledge") return <KnowledgeWork id={target.id} />;
  if (target.kind === "curriculum") return <CurriculumPage />;
  if (target.kind === "import") return <ImportWork id={target.id} />;
  if (target.kind === "diagnosis") return <DiagnosisWork id={target.id} />;
  if (target.kind === "paper") return <PaperWork id={target.id} />;
  return <ErrorState message="此编辑器不受支持" />;
}
function PaperWork({ id }: { id: string }) {
  const q = useLiveQuery<{ fragments: { id: string; body: string }[] }>(
    `/sources/${id}`,
  );
  if (q.error)
    return (
      <ErrorState message={q.error.message} onRetry={() => void q.refetch()} />
    );
  if (!q.data) return <LoadingState />;
  return <PaperImport id={id} fragments={q.data.fragments} />;
}
function KnowledgeWork({ id }: { id: string }) {
  const q = useLiveQuery<Knowledge[]>("/knowledge");
  const [saved, setSaved] = useState(false);
  if (q.error)
    return (
      <ErrorState message={q.error.message} onRetry={() => void q.refetch()} />
    );
  if (!q.data) return <LoadingState />;
  const k = q.data.find((k) => k.id === id);
  if (!k) return <ErrorState message="此知识已不可用" />;
  if (saved)
    return (
      <Alert
        showIcon
        type="success"
        message="版本已保存，可返回原对话继续核对与确认"
      />
    );
  return <KnowledgeEditor initial={k} onDone={() => setSaved(true)} />;
}
function ImportWork({ id }: { id: string }) {
  const q = useLiveQuery<{ assignment: Assignment; questions: Question[] }>(
    `/assignments/${id}`,
  );
  if (q.error)
    return (
      <ErrorState message={q.error.message} onRetry={() => void q.refetch()} />
    );
  if (!q.data) return <LoadingState />;
  return (
    <SubmissionImport
      assignment={q.data.assignment}
      questions={q.data.questions}
    />
  );
}
function DiagnosisWork({ id }: { id: string }) {
  const q = useLiveQuery<IntelligenceDetail>(`/intelligence/${id}`);
  if (q.error)
    return (
      <ErrorState message={q.error.message} onRetry={() => void q.refetch()} />
    );
  if (!q.data) return <LoadingState />;
  return <DiagnosisReview detail={q.data} />;
}
