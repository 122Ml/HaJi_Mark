import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Alert,
  Button,
  Card,
  Drawer,
  Input,
  Pagination,
  Select,
  Typography,
} from "antd";
import { Field } from "../shared/Field";
import { useConfirm } from "../shared/confirm";
import { PageHeader } from "../shared/PageHeader";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  MetaTag,
  MetaTags,
  StatusTag,
} from "../shared/ui";
import {
  Feedback,
  Link,
  useAction,
  useLearning,
  useLiveQuery,
} from "./context";
import { labelFor, stateLabels } from "./domain-meta";
import { DraftNotice, EditorScope, useEditorDraft } from "./editing";
import { DecisionHistory } from "./content-topics";
import { CreateRegrade, RegradeDetail } from "./regrades";
import { hasControlNull, utf8ByteLength } from "./validation";

type Change = {
  kind: string;
  id: string;
  title: string;
  version: number;
  state: string;
  previous_id: string | null;
  allow_derived?: boolean;
};

type ImpactItem = {
  kind: string;
  id: string;
  title: string;
  state: string;
  version: number;
  parent_id: string | null;
};

type Impact = {
  changes: Change[];
  items: ImpactItem[];
};

const kindLabels: Record<string, string> = {
  knowledge: "知识",
  question: "题库题目",
  rubric: "题库评分标准",
  assignment_rubric: "作业评分标准",
  assignment: "作业",
  resource: "学习资料",
  result: "正式结果",
  assignment_question: "作业题目",
};

const changeKindLabels: Record<string, string> = {
  source: "原始资料",
  knowledge: "知识",
};

const decisionOptions = [
  { value: "no_action", label: "无需处理历史内容" },
  { value: "future_version", label: "后续任务选用新版" },
  { value: "regrade", label: "安排整组重评" },
];

const CHANGES_PAGE_SIZE = 20;
const ITEMS_PAGE_SIZE = 20;

function itemPath(item: ImpactItem): string {
  switch (item.kind) {
    case "knowledge":
      return `/teacher/knowledge?knowledge=${encodeURIComponent(item.id)}`;
    case "question":
      return `/teacher/question-bank?bank_version=${encodeURIComponent(item.id)}`;
    case "rubric":
      return item.parent_id
        ? `/teacher/question-bank?bank_version=${encodeURIComponent(item.parent_id)}`
        : "/teacher/question-bank";
    case "assignment_rubric":
      return item.parent_id
        ? `/teacher/homework/${encodeURIComponent(item.parent_id)}`
        : "/teacher/homework";
    case "assignment":
      return `/teacher/homework/${encodeURIComponent(item.id)}`;
    case "assignment_question":
      return item.parent_id
        ? `/teacher/homework/${encodeURIComponent(item.parent_id)}`
        : "/teacher/homework";
    case "resource":
      return `/teacher/materials?tab=published&resource=${encodeURIComponent(item.id)}`;
    case "result":
      return item.parent_id
        ? `/teacher/homework/${encodeURIComponent(item.parent_id)}/submissions`
        : "/teacher/homework";
    default:
      return "/teacher/dashboard";
  }
}

export function ContentImpactPage() {
  const [params, setParams] = useSearchParams();
  const confirm = useConfirm();
  const { course } = useLearning();
  const action = useAction();

  const changes = useLiveQuery<Impact>("/impact");
  const allChanges = changes.data?.changes || [];
  const selectedID = params.get("change") || "";
  const selectedKind = params.get("change_kind") || "";
  const selected =
    allChanges.find((c) => c.id === selectedID && c.kind === selectedKind) ||
    null;

  const [changeSearch, setChangeSearch] = useState("");
  const [changePage, setChangePage] = useState(1);
  const [itemPage, setItemPage] = useState(1);
  const [regrade, setRegrade] = useState<{
    assignmentID: string;
    questionID: string;
    reason: string;
  } | null>(null);
  const [batch, setBatch] = useState("");
  const [regradeDirty, setRegradeDirty] = useState(false);

  const targetKey = selected
    ? selected.kind === "source"
      ? "source_id"
      : selected.kind === "knowledge"
        ? "knowledge_id"
        : ""
    : "";
  const targetValue = selected ? selected.previous_id || selected.id : "";
  const impactQueryString =
    targetKey && targetValue
      ? new URLSearchParams({ [targetKey]: targetValue }).toString()
      : "";

  const q = useLiveQuery<Impact>(
    `/impact?${impactQueryString}`,
    !!impactQueryString,
  );

  const initialDraft = useMemo(
    () => ({ decision: "no_action", reason: "" }),
    [],
  );
  const draft = useEditorDraft(
    `impact:${course?.id || ""}:${selectedKind}:${selectedID}`,
    initialDraft,
    !!selected && !!course,
  );
  const { decision, reason } = draft.value;
  const setDecision = (next: string) =>
    draft.change((v) => ({ ...v, decision: next }));
  const setReason = (next: string) =>
    draft.change((v) => ({ ...v, reason: next }));

  const filteredChanges = useMemo(() => {
    const needle = changeSearch.trim().toLowerCase();
    if (!needle) return allChanges;
    return allChanges.filter((c) =>
      `${c.title} ${changeKindLabels[c.kind] || c.kind}`
        .toLowerCase()
        .includes(needle),
    );
  }, [allChanges, changeSearch]);

  const safeChangePage = Math.min(
    changePage,
    Math.max(1, Math.ceil(filteredChanges.length / CHANGES_PAGE_SIZE)),
  );
  const pagedChanges = filteredChanges.slice(
    (safeChangePage - 1) * CHANGES_PAGE_SIZE,
    safeChangePage * CHANGES_PAGE_SIZE,
  );

  const impactItems = q.data?.items || [];
  const safeItemPage = Math.min(
    itemPage,
    Math.max(1, Math.ceil(impactItems.length / ITEMS_PAGE_SIZE)),
  );
  const pagedItems = impactItems.slice(
    (safeItemPage - 1) * ITEMS_PAGE_SIZE,
    safeItemPage * ITEMS_PAGE_SIZE,
  );

  const hasClosedQuestion = impactItems.some(
    (i) => i.kind === "assignment_question" && i.state === "closed" && !!i.parent_id,
  );
  const reasonTooLong = utf8ByteLength(reason) > 5000 || hasControlNull(reason);

  return (
    <div className="live-page">
      <PageHeader
        title="内容变更"
        subtitle={course?.title}
        extra={
          <Link className="ghost-btn" to="/teacher/regrades">
            整组重评
          </Link>
        }
      />
      <Card className="card-panel">
        {allChanges.length > 8 && (
          <Input.Search
            aria-label="筛选内容变更"
            placeholder="按标题筛选内容变更"
            allowClear
            value={changeSearch}
            onChange={(e) => {
              setChangeSearch(e.target.value);
              setChangePage(1);
            }}
          />
        )}
        {changes.isPending ? (
          <LoadingState />
        ) : changes.error ? (
          <ErrorState
            message={changes.error.message}
            onRetry={() => void changes.refetch()}
          />
        ) : pagedChanges.length ? (
          <>
            {pagedChanges.map((c) => {
              const isCurrent =
                selected?.id === c.id && selected?.kind === c.kind;
              return (
                <div key={`${c.kind}:${c.id}`} className="live-row">
                  <div>
                    <Typography.Text strong className="item-title">
                      {c.title}
                    </Typography.Text>
                    <MetaTags>
                      <MetaTag>
                        {labelFor(changeKindLabels, c.kind, "内容")}
                      </MetaTag>
                      <StatusTag
                        status={c.state}
                        label={
                          c.state === "archived"
                            ? "已归档"
                            : c.kind === "source" && c.allow_derived === false
                              ? "提炼许可变更"
                              : "版本／许可变更"
                        }
                      />
                      <MetaTag>v{c.version}</MetaTag>
                    </MetaTags>
                  </div>
                  <Button
                    htmlType="button"
                    type={isCurrent ? "primary" : "default"}
                    onClick={() => {
                      setItemPage(1);
                      setParams((p) => {
                        const next = new URLSearchParams(p);
                        next.set("change", c.id);
                        next.set("change_kind", c.kind);
                        return next;
                      });
                    }}
                  >
                    查看影响
                  </Button>
                </div>
              );
            })}
            {filteredChanges.length > CHANGES_PAGE_SIZE && (
              <Pagination
                hideOnSinglePage
                current={safeChangePage}
                pageSize={CHANGES_PAGE_SIZE}
                total={filteredChanges.length}
                showSizeChanger={false}
                onChange={setChangePage}
              />
            )}
          </>
        ) : (
          <EmptyState
            title={allChanges.length ? "没有匹配的内容变更" : "暂无内容变更"}
          />
        )}
      </Card>
      {selected && draft.ready && (
        <Card
          className="card-panel live-form"
          title={
            <span style={{ overflowWrap: "anywhere" }}>
              {selected.title} · 引用影响
            </span>
          }
        >
          <DraftNotice
            {...draft}
            onDiscard={() => draft.reset({ decision: "no_action", reason: "" })}
          />
          {q.isPending ? (
            <LoadingState label="正在查询引用影响…" />
          ) : q.error ? (
            <ErrorState
              message={q.error.message}
              onRetry={() => void q.refetch()}
            />
          ) : pagedItems.length ? (
            <>
              {pagedItems.map((i) => (
                <div className="live-row" key={`${i.kind}:${i.id}`}>
                  <div>
                    <Typography.Text strong className="item-title">
                      {i.title}
                    </Typography.Text>
                    <MetaTags>
                      <StatusTag
                        status={i.state}
                        label={labelFor(stateLabels, i.state)}
                      />
                      <MetaTag>
                        {labelFor(kindLabels, i.kind, "关联内容")}
                      </MetaTag>
                      <MetaTag>v{i.version}</MetaTag>
                    </MetaTags>
                  </div>
                  <div className="live-inline">
                    <Link to={itemPath(i)}>查看</Link>
                    {i.kind === "assignment_question" &&
                      i.state === "closed" &&
                      !!i.parent_id && (
                        <Button
                          htmlType="button"
                          disabled={!reason.trim() || reasonTooLong}
                          onClick={() => {
                            setBatch("");
                            setRegradeDirty(false);
                            setRegrade({
                              assignmentID: i.parent_id!,
                              questionID: i.id,
                              reason: `${reason.trim()}\n内容变更：${selected.title} v${selected.version}（${selected.kind}:${selected.id}）`,
                            });
                          }}
                        >
                          就此题建立整组重评
                        </Button>
                      )}
                  </div>
                </div>
              ))}
              {impactItems.length > ITEMS_PAGE_SIZE && (
                <Pagination
                  hideOnSinglePage
                  current={safeItemPage}
                  pageSize={ITEMS_PAGE_SIZE}
                  total={impactItems.length}
                  showSizeChanger={false}
                  onChange={setItemPage}
                />
              )}
              {hasClosedQuestion && !reason.trim() && (
                <p className="live-meta">
                  如需对上方已关闭的作业题目发起整组重评，请先在下方填写处理原因。
                </p>
              )}
            </>
          ) : (
            <EmptyState title="未查到关联内容" />
          )}
          <Field className="ui-field" label={<>处理决定</>}>
            <Select
              aria-label="处理决定"
              value={decision}
              onChange={(e) => setDecision(e)}
              showSearch
              optionFilterProp="label"
              options={decisionOptions}
            />
          </Field>
          <Field className="ui-field" label={<>处理原因</>} required>
            <Input.TextArea
              aria-label="处理原因"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          {reasonTooLong && (
            <Alert
              type="warning"
              showIcon
              message="处理原因不能超过 5000 字节，且不能包含非法空字符。"
            />
          )}
          <Feedback message={action.message} failed={action.failed} />
          <Button
            htmlType="button"
            disabled={action.busy || !reason.trim() || reasonTooLong}
            onClick={async () => {
              const snapshot = draft.value;
              const saved = await action.run(
                "/impact/decisions",
                {
                  kind: selected.kind,
                  id: selected.id,
                  action: decision,
                  reason: reason.trim(),
                },
                "POST",
                "已保存",
                { invalidatePrefixes: ["impact", "decisions"] },
              );
              if (saved) draft.saved(snapshot);
            }}
            type="primary"
          >
            保存处理决定
          </Button>
          {decision === "regrade" && (
            <p>
              填写原因后，在上方已关闭的作业题目旁建立批次；预览、冻结、逐份确认和统一发布均须分别执行。
            </p>
          )}
          <DecisionHistory id={selected.id} />
        </Card>
      )}
      <Drawer
        title="内容变更 · 整组重评"
        open={!!regrade}
        width="min(100vw, 900px)"
        destroyOnHidden
        onClose={async () => {
          if (
            !batch &&
            regradeDirty &&
            !(await confirm("关闭重评建立抽屉？未提交的重评设置将保留在当前浏览器。"))
          ) {
            return;
          }
          setRegrade(null);
          setBatch("");
          setRegradeDirty(false);
        }}
      >
        <EditorScope onDirtyChange={setRegradeDirty}>
          {batch ? (
            <RegradeDetail id={batch} />
          ) : (
            regrade && <CreateRegrade initial={regrade} onCreated={setBatch} />
          )}
        </EditorScope>
      </Drawer>
    </div>
  );
}
