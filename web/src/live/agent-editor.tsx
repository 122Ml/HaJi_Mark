import { lazy, Suspense, useState } from "react";
import { Alert, Button, Drawer, Space } from "antd";
import { useConfirm } from "../shared/confirm";
import { ErrorState, LoadingState } from "../shared/ui";
import { useLiveQuery } from "./context";
import { EditorScope } from "./editing";
import type { IntelligenceDetail } from "./intelligence";
import type { Assignment, Knowledge, Question } from "./types";

const CurriculumPage = lazy(() => import("./curriculum").then((m) => ({ default: m.CurriculumPage })));
const DiagnosisReview = lazy(() => import("./intelligence").then((m) => ({ default: m.DiagnosisReview })));
const KnowledgeEditor = lazy(() => import("./knowledge").then((m) => ({ default: m.KnowledgeEditor })));
const SourceWorkspace = lazy(() => import("./materials").then((m) => ({ default: m.SourceWorkspace })));
const PaperImport = lazy(() => import("./material-assist").then((m) => ({ default: m.PaperImport })));
const BankDetailView = lazy(() => import("./question-bank").then((m) => ({ default: m.BankDetailView })));
const SubmissionImport = lazy(() => import("./submission-import").then((m) => ({ default: m.SubmissionImport })));

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
  endedNotice,
}: {
  target: EditorTarget;
  disabled: boolean;
  complete: () => Promise<boolean>;
  endedNotice?: string;
}) {
  const [open, setOpen] = useState(false);
  const [drawerDirty, setDrawerDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const confirm = useConfirm();

  const requestClose = async (promptText: string) => {
    if (!drawerDirty || (await confirm(promptText))) {
      setOpen(false);
      setDrawerDirty(false);
    }
  };

  return (
    <>
      {!endedNotice && (
        <Button type="primary" disabled={disabled} onClick={() => setOpen(true)}>
          打开{names[target.kind] || "编辑器"}
        </Button>
      )}
      <Drawer
        title={names[target.kind] || "编辑器"}
        open={open}
        width="min(100vw, 1100px)"
        destroyOnHidden
        maskClosable={false}
        push={false}
        onClose={() =>
          void requestClose("尚有未保存编辑。暂时收起并保留浏览器草稿？")
        }
        footer={
          <Space wrap>
            <Button
              type="primary"
              loading={submitting}
              disabled={disabled || drawerDirty || submitting || !!endedNotice}
              onClick={async () => {
                setSubmitting(true);
                try {
                  if (await complete()) {
                    setOpen(false);
                    setDrawerDirty(false);
                  }
                } finally {
                  setSubmitting(false);
                }
              }}
            >
              返回对话并继续
            </Button>
            <Button
              disabled={submitting}
              onClick={() =>
                void requestClose("暂时收起，未保存编辑保留在浏览器？")
              }
            >
              暂时收起
            </Button>
            {drawerDirty && (
              <Alert type="warning" message="先保存编辑，再返回任务" />
            )}
          </Space>
        }
      >
        <Space direction="vertical" className="live-full-width" size="middle">
          {endedNotice && (
            <Alert type="warning" showIcon message={endedNotice} />
          )}
          <EditorScope isolated onDirtyChange={setDrawerDirty}>
            <Suspense fallback={<LoadingState />}>
              <EditorBody target={target} />
            </Suspense>
          </EditorScope>
        </Space>
      </Drawer>
    </>
  );
}

function EditorBody({ target }: { target: EditorTarget }) {
  if (target.kind === "source")
    return <SourceWorkspace id={target.id} fragmentID="" embedded />;
  if (target.kind === "question")
    return <BankDetailView bankID={target.id} embedded />;
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
  if (q.error) {
    return (
      <ErrorState message={q.error.message} onRetry={() => void q.refetch()} />
    );
  }
  if (!q.data) return <LoadingState />;
  return <PaperImport id={id} fragments={q.data.fragments} />;
}

function KnowledgeWork({ id }: { id: string }) {
  const q = useLiveQuery<Knowledge[]>("/knowledge");
  const [saved, setSaved] = useState(false);
  if (q.error) {
    return (
      <ErrorState message={q.error.message} onRetry={() => void q.refetch()} />
    );
  }
  if (!q.data) return <LoadingState />;
  const k = q.data.find((item) => item.id === id);
  if (!k) return <ErrorState message="此知识已不可用" />;
  if (saved) {
    return (
      <Alert
        showIcon
        type="success"
        message="版本已保存，可返回原对话继续核对与确认"
        action={
          <Button size="small" onClick={() => setSaved(false)}>
            继续编辑
          </Button>
        }
      />
    );
  }
  return <KnowledgeEditor initial={k} onDone={() => setSaved(true)} />;
}

function ImportWork({ id }: { id: string }) {
  const q = useLiveQuery<{ assignment: Assignment; questions: Question[] }>(
    `/assignments/${id}`,
  );
  if (q.error) {
    return (
      <ErrorState message={q.error.message} onRetry={() => void q.refetch()} />
    );
  }
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
  if (q.error) {
    return (
      <ErrorState message={q.error.message} onRetry={() => void q.refetch()} />
    );
  }
  if (!q.data) return <LoadingState />;
  return <DiagnosisReview detail={q.data} embedded />;
}
