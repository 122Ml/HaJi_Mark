import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
  Drawer,
  Form,
  Input,
  Pagination,
  Select,
  Space,
  Steps,
  Tabs,
  Typography,
} from "antd";
import { FileSpreadsheet, Plus } from "lucide-react";
import { Field } from "../shared/Field";
import { FileUpload } from "../shared/FileUpload";
import { PageHeader } from "../shared/PageHeader";
import { requestJSON } from "../shared/api";
import { useConfirm } from "../shared/confirm";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  MetaTag,
  MetaTags,
  StatusTag,
} from "../shared/ui";
import { AIDraft } from "./ai-jobs";
import { FrozenEvidence } from "./citations";
import { RichContent } from "./content-render";
import {
  ContentLinks,
  DecisionHistory,
  type TopicData,
} from "./content-topics";
import { ContextAgent } from "./context-agent";
import {
  Feedback,
  Link,
  useAction,
  useLearning,
  useLiveQuery,
  when,
} from "./context";
import { labelFor, questionTypeLabels, stateLabels } from "./domain-meta";
import { DraftNotice, EditorScope, useEditorDraft } from "./editing";
import { useLocationPage, useLocationValue } from "./location-state";
import { PaperImport } from "./material-assist";
import {
  IntegerInput,
  QuizOptionsEditor,
  nextCriterionID,
} from "./shared-editors";
import type { Criterion, Hit, Point, RubricVersion } from "./types";
import { hasControlNull, utf8ByteLength } from "./validation";

export interface BankVersion {
  id: string;
  bank_id: string;
  title: string;
  prompt: string;
  type: string;
  version: number;
  max_score: number;
  state: string;
  requirements: string;
  reference_answer: string;
  reference_state: string;
  knowledge_point_id: string | null;
  options: string[];
  correct_answer: string;
  evidence_refs: Hit[];
  archived?: boolean;
}

type BankDetail = {
  entry: { id: string; archived: boolean };
  versions: BankVersion[];
  uses: {
    question_id: string;
    bank_question_version_id: string;
    assignment_id: string;
    title: string;
    status: string;
    bound_rubric_id: string | null;
  }[];
};

type Candidate = {
  title: string;
  prompt: string;
  reference_answer: string;
  criteria: Criterion[];
  max_score?: number;
};

function pruneCriteriaEvidence(criteria: Criterion[], refs: Hit[]): {
  criteria: Criterion[];
  prunedCount: number;
} {
  const validIDs = new Set(refs.map((h) => h.id));
  let prunedCount = 0;
  const next = criteria.map((p) => {
    const oldIDs = p.evidence_ids || [];
    const kept = oldIDs.filter((id) => validIDs.has(id));
    if (kept.length !== oldIDs.length) {
      prunedCount += oldIDs.length - kept.length;
      return { ...p, evidence_ids: kept };
    }
    return p;
  });
  return { criteria: next, prunedCount };
}

function validateBankCriteria(
  criteria: Criterion[],
  maxScore: number,
  refs: Hit[],
): string | null {
  if (!criteria.length) return null;
  if (criteria.length > 30) return "评分点最多 30 项。";
  const seen = new Set<string>();
  const validEvidenceIDs = new Set(refs.map((h) => h.id));
  let sum = 0;
  for (let i = 0; i < criteria.length; i += 1) {
    const p = criteria[i];
    const id = p.id.trim();
    const title = p.title.trim();
    const rule = p.rule.trim();
    if (!id || utf8ByteLength(id) > 100 || hasControlNull(id)) {
      return `第 ${i + 1} 个评分点编号不能为空且不能超过 100 字节。`;
    }
    if (seen.has(id)) {
      return `评分点编号「${id}」重复，请修改为唯一编号。`;
    }
    seen.add(id);
    if (!title || utf8ByteLength(title) > 300 || hasControlNull(title)) {
      return `评分点 ${id} 名称不能为空且不能超过 300 字节。`;
    }
    if (!rule || utf8ByteLength(rule) > 5000 || hasControlNull(rule)) {
      return `评分点 ${id} 给分规则不能为空且不能超过 5000 字节。`;
    }
    if (!Number.isInteger(p.max_score) || p.max_score < 1 || p.max_score > maxScore) {
      return `评分点 ${id} 满分须为 1 至 ${maxScore} 的整数。`;
    }
    if (p.evidence_ids?.some((eid) => !validEvidenceIDs.has(eid))) {
      return `评分点 ${id} 引用了已移除的依据，请重新核对依据勾选。`;
    }
    sum += p.max_score;
  }
  if (sum !== maxScore) {
    return `评分点分值合计（${sum} 分）必须等于题目满分（${maxScore} 分）。`;
  }
  return null;
}

function importedCandidates(data: unknown): Candidate[] {
  const raw = Array.isArray(data)
    ? data
    : data && typeof data === "object" && "questions" in data
      ? (data as { questions: unknown }).questions
      : [data];
  if (!Array.isArray(raw) || !raw.length || raw.length > 30) {
    throw Error("需要1至30个题目对象");
  }
  return raw.map((q) => {
    if (
      !q ||
      typeof q !== "object" ||
      typeof (q as Record<string, unknown>).title !== "string" ||
      typeof (q as Record<string, unknown>).prompt !== "string" ||
      ((q as Record<string, unknown>).reference_answer !== undefined &&
        typeof (q as Record<string, unknown>).reference_answer !== "string")
    ) {
      throw Error("题目须含文本title、prompt，reference_answer也须为文本");
    }
    const obj = q as Record<string, unknown>;
    const title = (obj.title as string).trim();
    const prompt = (obj.prompt as string).trim();
    if (!title || !prompt || hasControlNull(title) || hasControlNull(prompt)) {
      throw Error("题目的 title 和 prompt 不能为空且不能包含非法空字符");
    }
    if (
      obj.max_score !== undefined &&
      (!Number.isInteger(obj.max_score) ||
        (obj.max_score as number) < 1 ||
        (obj.max_score as number) > 10000)
    ) {
      throw Error("max_score须为1至10000的整数");
    }
    const rawCriteria = obj.criteria ?? [];
    if (
      !Array.isArray(rawCriteria) ||
      rawCriteria.length > 30 ||
      rawCriteria.some(
        (p) =>
          !p ||
          typeof p !== "object" ||
          typeof (p as Record<string, unknown>).id !== "string" ||
          typeof (p as Record<string, unknown>).title !== "string" ||
          typeof (p as Record<string, unknown>).rule !== "string" ||
          !Number.isInteger((p as Record<string, unknown>).max_score) ||
          ((p as Record<string, unknown>).max_score as number) < 1 ||
          [
            "requirement",
            "partial_credit",
            "acceptable_answers",
            "error_conditions",
          ].some(
            (k) =>
              (p as Record<string, unknown>)[k] !== undefined &&
              typeof (p as Record<string, unknown>)[k] !== "string",
          ) ||
          ((p as Record<string, unknown>).evidence_ids !== undefined &&
            (!Array.isArray((p as Record<string, unknown>).evidence_ids) ||
              ((p as Record<string, unknown>).evidence_ids as unknown[]).some(
                (id) => typeof id !== "string",
              ))),
      )
    ) {
      throw Error("criteria须为完整评分点数组，evidence_ids须为文本数组");
    }
    const seenIDs = new Set<string>();
    const criteria: Criterion[] = (rawCriteria as Criterion[]).map((p) => {
      const id = p.id.trim();
      const cTitle = p.title.trim();
      const rule = p.rule.trim();
      if (!id || !cTitle || !rule) {
        throw Error("criteria 中的每项须填写非空的 id、title 和 rule");
      }
      if (seenIDs.has(id)) {
        throw Error(`criteria 中的评分点编号「${id}」重复`);
      }
      seenIDs.add(id);
      return {
        ...p,
        id,
        title: cTitle,
        rule,
        // Imported JSON cannot guarantee matching course evidence chunk IDs until selected.
        evidence_ids: [],
      };
    });
    const maxScore = obj.max_score as number | undefined;
    if (maxScore !== undefined && criteria.length > 0) {
      const sum = criteria.reduce((acc, item) => acc + item.max_score, 0);
      if (sum !== maxScore) {
        throw Error(`criteria 分值合计（${sum}）与 max_score（${maxScore}）不一致`);
      }
    }
    return {
      title,
      prompt,
      reference_answer: (obj.reference_answer as string) || "",
      criteria,
      max_score: maxScore,
    };
  });
}

const blankPoint = (existing: Criterion[], max = 1): Criterion => ({
  id: nextCriterionID(existing),
  title: "",
  max_score: max,
  rule: "",
  evidence_ids: [],
});

function BankProvenance({ id }: { id: string }) {
  const [expanded, setExpanded] = useState(false);
  const q = useLiveQuery<{
    decisions: {
      id: string;
      kind: string;
      reason: string;
      created_at: string;
    }[];
    assets: { id: string }[];
  }>(`/question-bank/versions/${id}/provenance`, expanded);
  const { course } = useLearning();
  return (
    <Collapse
      onChange={(keys) =>
        setExpanded(Array.isArray(keys) ? keys.length > 0 : Boolean(keys))
      }
      items={[
        {
          key: "content",
          label: <>题图与原始来源</>,
          children: (
            <>
              <Feedback error={q.error} />
              {q.isPending && <LoadingState />}
              {course &&
                q.data?.assets.map((a) => (
                  <img
                    className="asset-preview"
                    key={a.id}
                    alt="确认后的题图"
                    src={`/api/v1/learning/courses/${course.id}/assets/${a.id}/file`}
                  />
                ))}
              {q.data?.decisions.map((d) => (
                <article key={d.id}>
                  <strong>
                    {d.kind === "paper_adopt" ? "原卷拆题采纳" : "AI草稿采纳"}
                  </strong>
                  <p>{d.reason}</p>
                  <small>{when(d.created_at)}</small>
                </article>
              ))}
              {!q.isPending &&
                !q.data?.assets.length &&
                !q.data?.decisions.length && <p className="live-meta">暂无来源记录。</p>}
            </>
          ),
        },
      ]}
    />
  );
}

export function QuestionBankPage() {
  const { course } = useLearning();
  const [params, setParams] = useSearchParams();
  const paperOpen = params.has("paper_source") || params.get("paper") === "1";
  const paperSource = params.get("paper_source") || "";
  const bankID = params.get("bank") || "";
  const bankVersionParam = params.get("bank_version") || "";
  const creating = params.get("new") === "1";

  const linked = useLiveQuery<BankVersion>(
    `/question-bank/versions/${bankVersionParam}`,
    !!bankVersionParam && !bankID,
  );
  const activeBank = bankID || linked.data?.bank_id || "";

  const [search, setSearch] = useLocationValue("search");
  const [searchInput, setSearchInput] = useState(search);
  const [state, setState] = useLocationValue("state");
  const [page, setPage] = useLocationPage();
  const [type, setType] = useLocationValue("type");
  const [pointID, setPoint] = useLocationValue("point");
  const [topicID, setTopic] = useLocationValue("topic");

  useEffect(() => {
    setSearchInput(search);
  }, [search]);

  useEffect(() => {
    if (searchInput === search) return;
    const timer = window.setTimeout(() => {
      setSearch(searchInput);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput, search, setSearch]);

  const topics = useLiveQuery<TopicData>("/topics");
  const points = useLiveQuery<{ points: Point[] }>("");

  const searchPath = useMemo(
    () =>
      `/question-bank/search?${new URLSearchParams({
        search,
        state,
        type,
        point_id: pointID,
        topic_id: topicID,
        page: String(page),
        page_size: "10",
      })}`,
    [search, state, type, pointID, topicID, page],
  );

  const query = useQuery({
    queryKey: ["live", course?.id, searchPath],
    enabled: !!course,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) =>
      (
        await requestJSON<{ data: { items: BankVersion[]; total: number } }>(
          `/learning/courses/${course!.id}${searchPath}`,
          { signal },
        )
      ).data,
  });

  const list = query.data?.items || [];

  const leafPoints = useMemo(
    () => (points.data?.points || []).filter((p) => p.kind === "point"),
    [points.data],
  );

  function select(id: string) {
    const next = new URLSearchParams(params);
    next.set("bank", id);
    next.delete("version");
    next.delete("bank_version");
    next.delete("new");
    setParams(next);
  }

  function setCreating(open: boolean) {
    const next = new URLSearchParams(params);
    if (open) {
      next.set("new", "1");
      next.delete("bank");
      next.delete("version");
      next.delete("bank_version");
    } else {
      next.delete("new");
    }
    setParams(next);
  }

  return (
    <div className="live-page">
      <PageHeader
        title="题库与标准"
        subtitle={course?.title}
        meta={<MetaTag>{query.data?.total || 0} 道题目</MetaTag>}
        extra={
          <>
            <Button
              htmlType="button"
              icon={<FileSpreadsheet size={14} aria-hidden="true" />}
              onClick={() => {
                const next = new URLSearchParams(params);
                next.set("paper", "1");
                setParams(next);
              }}
            >
              整卷导入
            </Button>
            <Button
              htmlType="button"
              icon={<Plus size={14} aria-hidden="true" />}
              onClick={() => setCreating(true)}
              type="primary"
            >
              新建题目
            </Button>
          </>
        }
      />

      <Drawer
        title="整卷导入"
        aria-label="整卷导入"
        open={paperOpen}
        width="min(100%, 900px)"
        destroyOnHidden
        onClose={() => {
          const next = new URLSearchParams(params);
          next.delete("paper_source");
          next.delete("paper");
          setParams(next);
        }}
      >
        <PaperSource
          selected={paperSource}
          onSelect={(id) => {
            const next = new URLSearchParams(params);
            next.set("paper_source", id);
            setParams(next);
          }}
        />
      </Drawer>

      <div className="filter-bar">
        <Input.Search
          aria-label="搜索题目"
          allowClear
          placeholder="输入题名或题干关键词"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onSearch={setSearch}
        />
        <Select
          aria-label="题目状态"
          value={state}
          onChange={(e) => setState(e)}
          showSearch
          optionFilterProp="children"
        >
          <Select.Option value="">全部状态</Select.Option>
          <Select.Option value="draft">草稿</Select.Option>
          <Select.Option value="confirmed">已确认</Select.Option>
          <Select.Option value="archived">已停用</Select.Option>
        </Select>
        <Select
          aria-label="筛选题型"
          value={type}
          onChange={(e) => setType(e)}
          showSearch
          optionFilterProp="children"
        >
          <Select.Option value="">全部题型</Select.Option>
          {Object.entries(questionTypeLabels).map(([id, name]) => (
            <Select.Option key={id} value={id}>
              {name}
            </Select.Option>
          ))}
        </Select>
        <Select
          aria-label="筛选知识点"
          value={pointID}
          onChange={(e) => setPoint(e)}
          showSearch
          optionFilterProp="children"
        >
          <Select.Option value="">全部知识点</Select.Option>
          {leafPoints.map((p) => (
            <Select.Option key={p.id} value={p.id}>
              {p.title}
            </Select.Option>
          ))}
        </Select>
        <Select
          aria-label="筛选专题"
          value={topicID}
          onChange={(e) => setTopic(e)}
          showSearch
          optionFilterProp="children"
        >
          <Select.Option value="">全部专题</Select.Option>
          {topics.data?.topics.map((t) => (
            <Select.Option key={t.id} value={t.id}>
              {t.title}
            </Select.Option>
          ))}
        </Select>
      </div>

      {(topics.error || points.error) && (
        <Alert
          type="warning"
          showIcon
          message={`筛选维度读取失败：${topics.error?.message || points.error?.message}`}
        />
      )}

      {creating && (
        <Card className="card-panel">
          <BankEditor
            onSaved={(newBankID) => select(newBankID)}
            onCancel={() => setCreating(false)}
          />
        </Card>
      )}

      <Feedback error={linked.error} />

      <div className={creating || activeBank ? "question-bank-grid" : ""}>
        <Card className="card-panel question-bank-master">
          {query.error ? (
            <ErrorState
              message={query.error.message}
              onRetry={() => void query.refetch()}
            />
          ) : query.isPending && !query.data ? (
            <LoadingState />
          ) : !list.length ? (
            <EmptyState title="暂无匹配题目">
              新建题目，或选择资料与知识后由 AI 起草。
            </EmptyState>
          ) : (
            list.map((q) => (
              <article
                className={`live-row question-bank-row${q.bank_id === activeBank ? " is-active" : ""}`}
                key={q.bank_id}
              >
                <div>
                  <Typography.Text strong className="item-title">
                    {q.title}
                  </Typography.Text>
                  <MetaTags>
                    <StatusTag
                      status={q.archived ? "closed" : q.state}
                      label={
                        q.archived ? "已停用" : labelFor(stateLabels, q.state)
                      }
                    />
                    <MetaTag>{labelFor(questionTypeLabels, q.type)}</MetaTag>
                    <MetaTag>v{q.version}</MetaTag>
                    <MetaTag>{q.max_score} 分</MetaTag>
                  </MetaTags>
                </div>
                <Button
                  htmlType="button"
                  type={q.bank_id === activeBank ? "primary" : "default"}
                  onClick={() => select(q.bank_id)}
                >
                  {q.bank_id === activeBank ? "查看中" : "管理题目"}
                </Button>
              </article>
            ))
          )}
          <Pagination
            responsive
            hideOnSinglePage
            showLessItems
            current={page}
            total={query.data?.total || 0}
            pageSize={10}
            showSizeChanger={false}
            onChange={setPage}
          />
        </Card>

        {(creating || activeBank) && (
          <div className="question-bank-detail">
            {creating ? (
              <Card className="card-panel">
                <BankEditor
                  onSaved={(newBankID) => select(newBankID)}
                  onCancel={() => setCreating(false)}
                />
              </Card>
            ) : (
              <BankDetailView
                key={activeBank}
                bankID={activeBank}
                onClose={() => {
                  const next = new URLSearchParams(params);
                  next.delete("bank");
                  next.delete("version");
                  next.delete("bank_version");
                  setParams(next);
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PaperSource({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (id: string) => void;
}) {
  const sources = useLiveQuery<
    { id: string; title: string; state: string; fragment_count: number }[]
  >("/sources");
  const source = useLiveQuery<{
    source: { state: string };
    fragments: { id: string; body: string }[];
  }>(`/sources/${selected}`, !!selected);
  return (
    <Form layout="vertical" component={false}>
      <div className="live-form">
        <Feedback error={sources.error || source.error} />
        <Field className="ui-field" label={<>试卷原件</>}>
          <Select
            aria-label="试卷原件"
            value={selected}
            onChange={(e) => onSelect(e)}
            showSearch
            optionFilterProp="children"
          >
            <Select.Option value="">选择已解析的原件</Select.Option>
            {sources.data
              ?.filter((s) => s.state === "active" && s.fragment_count > 0)
              .map((s) => (
                <Select.Option key={s.id} value={s.id}>
                  {s.title}
                </Select.Option>
              ))}
          </Select>
        </Field>
        <Link
          to={
            selected
              ? `/teacher/materials?source=${selected}`
              : "/teacher/materials"
          }
        >
          导入或核对原件
        </Link>
        {selected && source.isPending && <LoadingState />}
        {source.data?.source.state === "active" &&
          source.data.fragments.length > 0 && (
            <PaperImport
              key={selected}
              id={selected}
              fragments={source.data.fragments}
              defaultExpanded
            />
          )}
      </div>
    </Form>
  );
}

export function BankDetailView({
  bankID,
  embedded = false,
  initialVersionID,
  onClose,
}: {
  bankID: string;
  embedded?: boolean;
  initialVersionID?: string;
  onClose?: () => void;
}) {
  const confirm = useConfirm();
  const query = useLiveQuery<BankDetail>(`/question-bank/${bankID}`);
  const [params, setParams] = useSearchParams();
  const [localVersion, setLocalVersion] = useState(initialVersionID || "");
  const [editing, setEditing] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const [overrideRefs, setOverrideRefs] = useState<{
    seq: number;
    refs: Hit[];
  } | null>(null);
  const action = useAction();

  useEffect(() => {
    if (embedded && initialVersionID) {
      setLocalVersion(initialVersionID);
    }
  }, [embedded, initialVersionID]);

  const requestedVersionPreview = embedded
    ? localVersion
    : params.get("version") || params.get("bank_version") || "";
  const activeVersionPreview =
    query.data?.versions.find((item) => item.id === requestedVersionPreview) ||
    query.data?.versions[0];
  const rubricsPreview = useLiveQuery<RubricVersion[]>(
    activeVersionPreview
      ? `/question-bank/versions/${activeVersionPreview.id}/rubrics`
      : "",
    !!activeVersionPreview && activeVersionPreview.type !== "quiz",
  );

  if (query.error) {
    return (
      <ErrorState
        message={query.error.message}
        onRetry={() => void query.refetch()}
      />
    );
  }
  if (!query.data) return <LoadingState />;

  const { entry, versions, uses } = query.data;
  const requestedVersion = embedded
    ? localVersion
    : params.get("version") || params.get("bank_version") || "";
  const v = versions.find((item) => item.id === requestedVersion) || versions[0];
  if (!v) return null;

  function selectVersion(nextVersionID: string) {
    if (embedded) {
      setLocalVersion(nextVersionID);
    } else {
      const next = new URLSearchParams(params);
      next.set("version", nextVersionID);
      next.delete("bank_version");
      setParams(next);
    }
  }

  const questionAndRefConfirmed =
    v.state === "confirmed" &&
    (!v.reference_answer || v.reference_state === "confirmed");
  const hasConfirmedRubric =
    v.type === "quiz" ||
    (rubricsPreview.data || []).some((r) => r.state === "confirmed");
  const readinessStep = !questionAndRefConfirmed
    ? 0
    : !hasConfirmedRubric
      ? 1
      : 2;

  async function confirmQuestionAndReference() {
    action.setMessage("");
    if (v.state === "draft") {
      const ok = await action.run(
        `/question-bank/versions/${v.id}/confirm`,
        undefined,
        "POST",
        v.reference_answer && v.reference_state === "draft"
          ? undefined
          : "题目版本已确认",
      );
      if (!ok) return;
    }
    if (v.reference_answer && v.reference_state === "draft") {
      await action.run(
        `/question-bank/versions/${v.id}/reference/confirm`,
        undefined,
        "POST",
        "题目与参考解答已确认",
      );
    }
  }

  return (
    <Card className="card-panel">
      <div className="section-head">
        <Typography.Text strong className="item-title">
          {v.title}
        </Typography.Text>
        <ContextAgent context={{ kind: "question", id: v.id, title: v.title }} />
        <Form layout="vertical" component={false}>
          <div className="live-inline">
            {!embedded && onClose && (
              <Button htmlType="button" onClick={onClose}>
                关闭详情
              </Button>
            )}
            <Field className="ui-field" label={<>题目版本</>}>
              <Select
                aria-label="题目版本"
                value={v.id}
                onChange={async (e) => {
                  if (
                    editing &&
                    editorDirty &&
                    !(await confirm("切换版本？未保存编辑可在返回时恢复。"))
                  ) {
                    return;
                  }
                  selectVersion(e);
                  setEditing(false);
                  setOverrideRefs(null);
                }}
                showSearch
                optionFilterProp="children"
              >
                {versions.map((ver) => (
                  <Select.Option key={ver.id} value={ver.id}>
                    v{ver.version} · {labelFor(stateLabels, ver.state)}
                  </Select.Option>
                ))}
              </Select>
            </Field>
            <Button
              htmlType="button"
              disabled={action.busy || entry.archived}
              onClick={async () => {
                if (
                  editing &&
                  editorDirty &&
                  !(await confirm("收起未保存编辑？返回时可恢复。"))
                ) {
                  return;
                }
                setOverrideRefs(null);
                setEditing(!editing);
              }}
            >
              {editing ? "收起编辑" : "另建题目版本"}
            </Button>
            <Button
              htmlType="button"
              disabled={action.busy}
              onClick={async () => {
                if (
                  await confirm(
                    entry.archived
                      ? "恢复此题目？"
                      : "停用后不能加入新作业，历史作业保留。继续？",
                  )
                ) {
                  void action.run(
                    `/question-bank/${bankID}/archive`,
                    { archived: !entry.archived },
                    "POST",
                    entry.archived ? "已恢复题目" : "已停用题目",
                  );
                }
              }}
            >
              {entry.archived ? "恢复题目" : "停用题目"}
            </Button>
          </div>
        </Form>
      </div>

      <Feedback message={action.message} failed={action.failed} />
      <Steps
        size="small"
        current={readinessStep}
        style={{ marginBottom: 12 }}
        items={[
          { title: "确认题目与解答" },
          {
            title:
              v.type === "quiz" ? "客观测验规则就绪" : "确认评分标准",
          },
          { title: "可用于组卷" },
        ]}
      />
      <ContentLinks kind="question" id={v.id} />
      <DecisionHistory id={v.id} />
      <BankProvenance id={v.id} />

      {editing ? (
        <BankEditor
          key={v.id}
          initial={v}
          overrideRefs={overrideRefs}
          onDirtyChange={setEditorDirty}
          onSaved={(_, id) => {
            selectVersion(id);
            setEditing(false);
            setOverrideRefs(null);
          }}
          onCancel={() => {
            setEditing(false);
            setOverrideRefs(null);
          }}
        />
      ) : (
        <Tabs
          key={v.id}
          items={[
            {
              key: "question",
              label: "题目与参考解答",
              children: (
                <div className="live-stack" style={{ gap: 12 }}>
                  <RichContent text={v.prompt} />
                  <MetaTags>
                    <MetaTag>{labelFor(questionTypeLabels, v.type)}</MetaTag>
                    <MetaTag>满分 {v.max_score}</MetaTag>
                  </MetaTags>
                  {v.requirements && (
                    <p className="live-prose" style={{ margin: 0 }}>
                      考查要求：{v.requirements}
                    </p>
                  )}
                  {v.options.map((o, i) => (
                    <div
                      key={i}
                      className="live-inline"
                      style={{ flexWrap: "nowrap", alignItems: "flex-start" }}
                    >
                      <span style={{ flexShrink: 0, marginTop: 3 }}>
                        <MetaTag>{String.fromCharCode(65 + i)}</MetaTag>
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <RichContent text={o} />
                      </div>
                    </div>
                  ))}
                  {v.type === "quiz" && (
                    <p className="live-prose" style={{ margin: 0 }}>
                      正确答案：{v.correct_answer}
                    </p>
                  )}
                  <div className="live-inline">
                    <StatusTag
                      status={v.state}
                      label={`题目${labelFor(stateLabels, v.state)}`}
                    />
                    {v.reference_answer && (
                      <StatusTag
                        status={v.reference_state}
                        label={`解答${labelFor(stateLabels, v.reference_state)}`}
                      />
                    )}
                    {!questionAndRefConfirmed && (
                      <Button
                        htmlType="button"
                        disabled={action.busy || entry.archived}
                        onClick={() => void confirmQuestionAndReference()}
                        type="primary"
                      >
                        {v.reference_answer
                          ? "确认题目与参考解答"
                          : "确认题目"}
                      </Button>
                    )}
                  </div>
                  {v.reference_answer && (
                    <>
                      <Typography.Text strong className="item-title" style={{ margin: 0 }}>
                        参考解答
                      </Typography.Text>
                      <RichContent text={v.reference_answer} />
                    </>
                  )}
                </div>
              ),
            },
            {
              key: "evidence",
              label: "知识与来源",
              children: (
                <BankAnalysis
                  version={v}
                  archived={entry.archived}
                  onRevise={(refs) => {
                    setOverrideRefs({ seq: Date.now(), refs });
                    setEditing(true);
                  }}
                />
              ),
            },
            {
              key: "rubric",
              label: "评分标准",
              children:
                v.type === "quiz" ? (
                  <p>客观题按本版本固定的选项与答案规则自动判分。</p>
                ) : (
                  <BankStandards
                    key={v.id}
                    version={v}
                    archived={entry.archived}
                    onConfirmVersion={confirmQuestionAndReference}
                    confirmBusy={action.busy}
                  />
                ),
            },
            {
              key: "uses",
              label: `使用记录（${uses.length}）`,
              children: uses.length ? (
                uses.map((u) => (
                  <article className="live-row" key={u.question_id}>
                    <div>
                      <Link
                        style={{ overflowWrap: "anywhere" }}
                        to={`/teacher/homework/${u.assignment_id}`}
                      >
                        {u.title}
                      </Link>
                      <MetaTags>
                        <MetaTag>
                          题目 v
                          {
                            versions.find(
                              (ver) => ver.id === u.bank_question_version_id,
                            )?.version
                          }
                        </MetaTag>
                        <StatusTag
                          status={u.status}
                          label={labelFor(stateLabels, u.status)}
                        />
                      </MetaTags>
                    </div>
                  </article>
                ))
              ) : (
                <EmptyState title="尚未用于作业" />
              ),
            },
          ]}
        />
      )}
    </Card>
  );
}

export function EvidencePicker({
  value,
  onChange,
  defaultQuery,
}: {
  value: Hit[];
  onChange: (hits: Hit[]) => void;
  defaultQuery?: string;
}) {
  const [params] = useSearchParams();
  const sources =
    useLiveQuery<{ id: string; title: string; state: string }[]>("/sources");
  const knowledge = useLiveQuery<
    { id: string; title: string; state: string; use_for_grading: boolean }[]
  >("/knowledge");
  const [scope, setScope] = useState(
    params.get("source_id")
      ? `s:${params.get("source_id")}`
      : params.get("knowledge_id")
        ? `k:${params.get("knowledge_id")}`
        : "",
  );
  const [search, setSearch] = useState(() =>
    value.length ? "" : (defaultQuery || "").trim().slice(0, 30),
  );
  const [hits, setHits] = useState<Hit[]>([]);
  const action = useAction();

  const totalChars = useMemo(
    () => value.reduce((sum, h) => sum + (h.body?.length || 0), 0),
    [value],
  );

  async function find() {
    const data = await action.run<{ hits: Hit[] }>(
      "/question-bank/evidence",
      {
        query: search,
        source_id: scope.startsWith("s:") ? scope.slice(2) : "",
        knowledge_id: scope.startsWith("k:") ? scope.slice(2) : "",
      },
      "POST",
      "已更新候选依据列表",
      { invalidate: false },
    );
    if (data) setHits(data.hits);
  }

  return (
    <div className="bank-evidence">
      <Form className="live-form" onFinish={() => void find()} layout="vertical">
        <div className="live-inline">
          <Field className="ui-field" label={<>依据范围</>}>
            <Select
              aria-label="依据范围"
              value={scope}
              onChange={(e) => {
                setScope(e);
                setHits([]);
              }}
              showSearch
              optionFilterProp="children"
            >
              <Select.Option value="">课程内检索</Select.Option>
              {sources.data
                ?.filter((s) => s.state === "active")
                .map((s) => (
                  <Select.Option key={s.id} value={`s:${s.id}`}>
                    资料：{s.title}
                  </Select.Option>
                ))}
              {knowledge.data
                ?.filter((k) => k.state === "confirmed" && k.use_for_grading)
                .map((k) => (
                  <Select.Option key={k.id} value={`k:${k.id}`}>
                    知识：{k.title}
                  </Select.Option>
                ))}
            </Select>
          </Field>
          <Field className="ui-field" label={<>检索词</>} required={!scope}>
            <Input
              aria-label="依据检索词"
              placeholder={scope ? "可选：在所选范围内过滤关键词" : "输入检索关键词"}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Field>
          <Button
            disabled={action.busy || (!scope && !search.trim())}
            htmlType="submit"
          >
            查找依据
          </Button>
        </div>
      </Form>
      <Feedback
        error={sources.error || knowledge.error}
        message={action.failed ? action.message : ""}
        failed={action.failed}
      />
      {hits.length > 0 && (
        <Collapse
          defaultActiveKey={["content"]}
          items={[
            {
              key: "content",
              label: <>候选依据（{hits.length}）</>,
              children: (
                <>
                  {hits.map((h) => (
                    <article className="rag-hit" key={h.id}>
                      <Checkbox
                        className="rag-check"
                        checked={value.some((v) => v.id === h.id)}
                        disabled={
                          !value.some((v) => v.id === h.id) && value.length >= 8
                        }
                        onChange={(e) =>
                          onChange(
                            e.target.checked
                              ? [...value, h]
                              : value.filter((v) => v.id !== h.id),
                          )
                        }
                      >
                        {h.title} · {h.heading}
                      </Checkbox>
                      <p className="live-prose">{h.body}</p>
                    </article>
                  ))}
                </>
              ),
            },
          ]}
        />
      )}
      {value.length > 0 && (
        <>
          <p className="live-meta">
            已选 {value.length}/8 条 · 共 {totalChars}/8000 字
          </p>
          {totalChars > 8000 && (
            <Alert
              type="warning"
              showIcon
              message="已选依据总字数超过 8000 字上限，请移除部分依据后再保存。"
            />
          )}
          {value.map((h) => (
            <div className="live-inline" key={h.id}>
              <span>
                {h.title} · {h.heading}
              </span>
              <Button
                onClick={() => onChange(value.filter((v) => v.id !== h.id))}
                htmlType="button"
              >
                移除此依据
              </Button>
            </div>
          ))}
          <FrozenEvidence sources={value} />
        </>
      )}
    </div>
  );
}

function BankCriteriaEditor({
  value,
  onChange,
  maxScore,
  refs,
  disabled = false,
}: {
  value: Criterion[];
  onChange: (points: Criterion[]) => void;
  maxScore: number;
  refs: Hit[];
  disabled?: boolean;
}) {
  const total = value.reduce((sum, p) => sum + (Number(p.max_score) || 0), 0);
  const idCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of value) {
      const k = p.id.trim();
      if (k) counts.set(k, (counts.get(k) || 0) + 1);
    }
    return counts;
  }, [value]);

  function update(i: number, patch: Partial<Criterion>) {
    onChange(value.map((p, n) => (n === i ? { ...p, ...patch } : p)));
  }

  function move(i: number, delta: -1 | 1) {
    const target = i + delta;
    if (target < 0 || target >= value.length) return;
    const copy = [...value];
    const [item] = copy.splice(i, 1);
    copy.splice(target, 0, item);
    onChange(copy);
  }

  return (
    <div className="live-form">
      {value.map((p, i) => {
        const dup = (idCounts.get(p.id.trim()) || 0) > 1;
        return (
          <Card
            size="small"
            key={`${p.id}-${i}`}
            title={<>评分点 {i + 1}</>}
            extra={
              <Space wrap size="small">
                <Button
                  size="small"
                  htmlType="button"
                  disabled={disabled || i === 0}
                  onClick={() => move(i, -1)}
                >
                  上移
                </Button>
                <Button
                  size="small"
                  htmlType="button"
                  disabled={disabled || i === value.length - 1}
                  onClick={() => move(i, 1)}
                >
                  下移
                </Button>
                <Button
                  size="small"
                  danger
                  htmlType="button"
                  disabled={disabled}
                  onClick={() => onChange(value.filter((_, n) => n !== i))}
                >
                  删除评分点
                </Button>
              </Space>
            }
          >
            <div className="live-stack" style={{ gap: 12 }}>
              <div className="rag-two-fields">
                <Field className="ui-field" label={<>编号</>} required={true}>
                  <Input
                    aria-label={value.length === 1 ? "编号" : `评分点 ${i + 1} 编号`}
                    disabled={disabled}
                    value={p.id}
                    maxLength={100}
                    status={dup ? "error" : undefined}
                    onChange={(e) => update(i, { id: e.target.value })}
                  />
                </Field>
                <Field
                  className="ui-field"
                  label={<>评分点满分</>}
                  required={true}
                >
                  <IntegerInput
                    aria-label={value.length === 1 ? "评分点满分" : `评分点 ${i + 1} 满分`}
                    disabled={disabled}
                    min={1}
                    max={maxScore}
                    value={p.max_score}
                    onChange={(val) => update(i, { max_score: val })}
                  />
                </Field>
              </div>
              {dup && (
                <Alert
                  type="error"
                  showIcon
                  message={`编号「${p.id.trim()}」重复，请修改为唯一编号。`}
                />
              )}
              <Field
                className="ui-field"
                label={<>评分点名称</>}
                required={true}
              >
                <Input
                  aria-label={value.length === 1 ? "评分点名称" : `评分点 ${i + 1} 名称`}
                  disabled={disabled}
                  value={p.title}
                  onChange={(e) => update(i, { title: e.target.value })}
                />
              </Field>
              <Field className="ui-field" label={<>给分规则</>} required={true}>
                <Input.TextArea
                  aria-label={value.length === 1 ? "给分规则" : `评分点 ${i + 1} 给分规则`}
                  disabled={disabled}
                  value={p.rule}
                  onChange={(e) => update(i, { rule: e.target.value })}
                />
              </Field>
              <Collapse
                items={[
                  {
                    key: "content",
                    label: <>部分分、替代表达与依据</>,
                    children: (
                      <div className="live-stack" style={{ gap: 12 }}>
                        {(
                          [
                            ["requirement", "对应考查要求"],
                            ["partial_credit", "部分分条件"],
                            ["acceptable_answers", "可接受表达或替代解法"],
                            ["error_conditions", "错误或矛盾条件"],
                          ] as const
                        ).map(([key, label]) => (
                          <Field
                            className="ui-field"
                            key={key}
                            label={<>{label}</>}
                          >
                            <Input.TextArea
                              disabled={disabled}
                              value={p[key] || ""}
                              onChange={(e) => update(i, { [key]: e.target.value })}
                            />
                          </Field>
                        ))}
                        {refs.map((h) => (
                          <Checkbox
                            className="rag-check"
                            key={h.id}
                            disabled={disabled}
                            checked={p.evidence_ids?.includes(h.id) || false}
                            onChange={(e) =>
                              update(i, {
                                evidence_ids: e.target.checked
                                  ? [...(p.evidence_ids || []), h.id]
                                  : (p.evidence_ids || []).filter(
                                      (id) => id !== h.id,
                                    ),
                              })
                            }
                          >
                            {h.title} · {h.heading}
                          </Checkbox>
                        ))}
                      </div>
                    ),
                  },
                ]}
              />
            </div>
          </Card>
        );
      })}
      <div className="live-inline">
        <Button
          disabled={disabled || value.length >= 30}
          onClick={() =>
            onChange([
              ...value,
              blankPoint(value, Math.max(1, maxScore - total)),
            ])
          }
          htmlType="button"
        >
          添加评分点
        </Button>
        <span>
          分值合计 {total}/ {maxScore}
        </span>
      </div>
      {value.length > 0 && total !== maxScore && (
        <Alert
          type="warning"
          showIcon
          message={`评分点分值合计（${total} 分）与题目满分（${maxScore} 分）不一致，请调整后再保存。`}
        />
      )}
    </div>
  );
}

interface BankEditorDraft {
  title: string;
  prompt: string;
  type: string;
  max_score: number;
  requirements: string;
  reference_answer: string;
  knowledge_point_id: string;
  options: string[];
  correct_answer: string;
  refs: Hit[];
  criteria: Criterion[];
  ai_job_id: string;
}

function BankEditor({
  initial,
  overrideRefs,
  onDirtyChange,
  onSaved,
  onCancel,
}: {
  initial?: BankVersion;
  overrideRefs?: { seq: number; refs: Hit[] } | null;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved: (bankID: string, versionID: string) => void;
  onCancel: () => void;
}) {
  const confirm = useConfirm();
  const { course } = useLearning();
  const action = useAction();
  const points = useLiveQuery<{ points: Point[] }>("");
  const [params] = useSearchParams();

  const initialDraft = useMemo<BankEditorDraft>(
    () => ({
      title: initial?.title || "",
      prompt: initial?.prompt || "",
      type: initial?.type || "subjective",
      max_score: initial?.max_score || 10,
      requirements: initial?.requirements || "",
      reference_answer: initial?.reference_answer || "",
      knowledge_point_id: initial?.knowledge_point_id || "",
      options: initial?.options?.length ? initial.options : ["", ""],
      correct_answer: initial?.correct_answer || "",
      refs: initial?.evidence_refs || [],
      criteria: [],
      ai_job_id: "",
    }),
    [initial],
  );

  const draft = useEditorDraft<BankEditorDraft>(
    `bank:${course?.id}:${initial?.id || "new"}`,
    initialDraft,
  );
  const v = draft.value;

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidate, setCandidate] = useState(0);
  const [count, setCount] = useState(1);
  const [error, setError] = useState("");
  const [pruneNotice, setPruneNotice] = useState("");
  const [uploadResetKey, setUploadResetKey] = useState(0);
  const appliedOverrideRef = useRef(0);

  useEffect(() => {
    onDirtyChange?.(draft.dirty);
    return () => onDirtyChange?.(false);
  }, [draft.dirty, onDirtyChange]);

  const leafPoints = useMemo(
    () => (points.data?.points || []).filter((p) => p.kind === "point"),
    [points.data],
  );

  const change = useCallback(
    (patch: Partial<BankEditorDraft>) => {
      setError("");
      draft.change((old) => ({ ...old, ...patch }));
    },
    [draft],
  );

  const updateRefs = useCallback(
    (nextRefs: Hit[]) => {
      setError("");
      draft.change((old) => {
        const { criteria, prunedCount } = pruneCriteriaEvidence(
          old.criteria,
          nextRefs,
        );
        if (prunedCount > 0) {
          setPruneNotice(`已自动清理评分点中 ${prunedCount} 条失效依据引用。`);
        } else {
          setPruneNotice("");
        }
        return { ...old, refs: nextRefs, criteria };
      });
    },
    [draft],
  );

  useEffect(() => {
    if (!overrideRefs || overrideRefs.seq === appliedOverrideRef.current) return;
    appliedOverrideRef.current = overrideRefs.seq;
    updateRefs(overrideRefs.refs);
  }, [overrideRefs, updateRefs]);

  function loadCandidate(q: Candidate, extra?: Partial<BankEditorDraft>) {
    const nextRefs = extra?.refs ?? v.refs;
    const { criteria } = pruneCriteriaEvidence(q.criteria || [], nextRefs);
    change({
      title: q.title,
      prompt: q.prompt,
      reference_answer: q.reference_answer,
      criteria,
      type: v.type === "code" ? "code" : "subjective",
      ...(q.max_score ? { max_score: q.max_score } : {}),
      ...extra,
    });
  }

  async function adopt(output: Record<string, unknown>, id: string) {
    const qs = Array.isArray(output.questions)
      ? (output.questions as Candidate[])
      : [];
    if (!qs.length) {
      setError("AI 草稿中未包含可用题目，请重新生成。");
      return;
    }
    if (draft.dirty && !(await confirm("载入 AI 候选并替换当前编辑？"))) return;
    setCandidates(qs);
    setCandidate(0);
    const nextRefs = Array.isArray(output.evidence_refs)
      ? (output.evidence_refs as Hit[])
      : v.refs;
    loadCandidate(qs[0], { refs: nextRefs, ai_job_id: id });
  }

  function validateForm(): string | null {
    if (!v.title.trim() || utf8ByteLength(v.title.trim()) > 500 || hasControlNull(v.title)) {
      return "请填写题目名称（不超过 500 字节）。";
    }
    if (!v.prompt.trim() || utf8ByteLength(v.prompt.trim()) > 30000 || hasControlNull(v.prompt)) {
      return "请填写题干与条件（不超过 30000 字节）。";
    }
    if (!Number.isInteger(v.max_score) || v.max_score < 1 || v.max_score > 10000) {
      return "满分须为 1 至 10000 之间的整数。";
    }
    if (v.type === "quiz") {
      const cleaned = v.options.map((o) => o.trim());
      if (cleaned.length < 2 || cleaned.length > 8) {
        return "客观题须包含 2 至 8 个选项。";
      }
      const seen = new Set<string>();
      for (const opt of cleaned) {
        if (!opt || utf8ByteLength(opt) > 1000 || hasControlNull(opt)) {
          return "客观题选项不能为空且每项不超过 1000 字节。";
        }
        if (seen.has(opt)) {
          return `客观题选项「${opt}」重复，请修改。`;
        }
        seen.add(opt);
      }
      if (!v.correct_answer.trim() || !seen.has(v.correct_answer.trim())) {
        return "请选择一个属于当前选项列表的正确答案。";
      }
    } else if (v.criteria.length > 0) {
      const criteriaErr = validateBankCriteria(v.criteria, v.max_score, v.refs);
      if (criteriaErr) return criteriaErr;
    }
    return null;
  }

  const criteriaMismatch =
    v.type !== "quiz" &&
    v.criteria.length > 0 &&
    v.criteria.reduce((s, p) => s + (Number(p.max_score) || 0), 0) !== v.max_score;

  async function save() {
    const err = validateForm();
    if (err) {
      setError(err);
      return;
    }
    setError("");
    const snapshot = draft.value;
    const pruned = pruneCriteriaEvidence(v.criteria, v.refs).criteria.map((c) => ({
      ...c,
      id: c.id.trim(),
      title: c.title.trim(),
      rule: c.rule.trim(),
    }));
    const payload = {
      title: v.title.trim(),
      prompt: v.prompt.trim(),
      type: v.type,
      max_score: v.max_score,
      requirements: v.requirements,
      reference_answer: v.reference_answer,
      knowledge_point_id: v.knowledge_point_id,
      options: v.type === "quiz" ? v.options.map((o) => o.trim()) : [],
      correct_answer: v.type === "quiz" ? v.correct_answer.trim() : "",
      evidence_ids: v.refs.map((h) => h.id),
      criteria: v.type === "quiz" ? [] : pruned,
      ai_job_id: v.ai_job_id,
      base_version_id: initial?.id || "",
    };
    const saved = await action.run<BankVersion>(
      initial ? `/question-bank/${initial.bank_id}/versions` : "/question-bank",
      payload,
      "POST",
      initial ? "已另建题目版本草稿" : "已保存题目草稿",
    );
    if (saved) {
      draft.saved(snapshot);
      onSaved(saved.bank_id, saved.id);
    }
  }

  return (
    <Card
      size="small"
      className="bank-editor"
      title={<>{initial ? "另建题目版本" : "新建题目"}</>}
    >
      <DraftNotice
        restored={draft.restored}
        storageError={draft.storageError}
        onDiscard={() => {
          draft.reset(initialDraft);
          setError("");
          setPruneNotice("");
        }}
      />

      <Collapse
        defaultActiveKey={
          params.has("source_id") || params.has("knowledge_id")
            ? ["content"]
            : []
        }
        items={[
          {
            key: "content",
            label: <>AI 辅助出题与依据选择</>,
            children: (
              <Form layout="vertical" component={false}>
                <div className="live-stack" style={{ gap: 12 }}>
                  <Field
                    className="ui-field"
                    label={<>出题要求（与下方考查要求同步）</>}
                  >
                    <Input.TextArea
                      aria-label="AI出题要求"
                      value={v.requirements}
                      onChange={(e) => change({ requirements: e.target.value })}
                      disabled={action.busy}
                    />
                  </Field>
                  <Field className="ui-field" label={<>候选数量</>}>
                    <IntegerInput
                      aria-label="候选数量"
                      min={1}
                      max={3}
                      value={count}
                      onChange={(val) => setCount(val)}
                      disabled={action.busy}
                    />
                  </Field>
                  <EvidencePicker value={v.refs} onChange={updateRefs} />
                  <AIDraft
                    kind="question_generate"
                    target={{
                      requirements: v.requirements,
                      max_score: v.max_score,
                      count,
                      evidence_ids: v.refs.map((h) => h.id),
                    }}
                    onAdopt={adopt}
                  />
                  {candidates.length > 1 && (
                    <Field className="ui-field" label={<>选择候选</>}>
                      <Select
                        aria-label="选择候选"
                        value={candidate}
                        onChange={async (e) => {
                          if (!(await confirm("切换候选并替换题目编辑内容？"))) {
                            return;
                          }
                          const i = Number(e);
                          setCandidate(i);
                          loadCandidate(candidates[i]);
                        }}
                        showSearch
                        optionFilterProp="children"
                        disabled={action.busy}
                      >
                        {candidates.map((q, i) => (
                          <Select.Option value={i} key={i}>
                            {q.title}
                          </Select.Option>
                        ))}
                      </Select>
                    </Field>
                  )}
                </div>
              </Form>
            ),
          },
        ]}
      />

      <Form layout="vertical" component={false}>
        <Field className="ui-field" label={<>导入题目 JSON</>}>
          <FileUpload
            aria-label="导入题目 JSON"
            accept=".json,application/json"
            resetKey={uploadResetKey}
            onChange={async (files) => {
              const f = files[0];
              if (!f) return;
              setError("");
              try {
                if (f.size > 1024 * 1024) throw Error("文件不能超过1MB");
                const items = importedCandidates(JSON.parse(await f.text()));
                if (
                  draft.dirty &&
                  !(await confirm("载入导入内容并替换当前编辑？"))
                ) {
                  setUploadResetKey((k) => k + 1);
                  return;
                }
                setCandidates(items);
                setCandidate(0);
                loadCandidate(items[0], { ai_job_id: "" });
              } catch (err) {
                setUploadResetKey((k) => k + 1);
                setError(err instanceof Error ? err.message : "导入失败");
              }
            }}
            disabled={action.busy}
          />
        </Field>
      </Form>

      {pruneNotice && <Alert type="info" showIcon message={pruneNotice} />}
      {error && <Alert type="error" showIcon role="alert" message={error} />}
      {points.error && (
        <Alert
          type="warning"
          showIcon
          message={`知识点列表读取失败：${points.error.message}`}
        />
      )}

      <Form className="live-form" onFinish={() => void save()} layout="vertical">
        <Field className="ui-field" label={<>题目名称</>} required={true}>
          <Input
            aria-label="题目名称"
            value={v.title}
            onChange={(e) => change({ title: e.target.value })}
            disabled={action.busy}
          />
        </Field>
        <div className="rag-two-fields">
          <Field className="ui-field" label={<>题型</>}>
            <Select
              aria-label="题型"
              value={v.type}
              onChange={(nextType) =>
                change({
                  type: nextType,
                  criteria: nextType === "quiz" ? [] : v.criteria,
                  options:
                    nextType === "quiz"
                      ? v.options.length >= 2
                        ? v.options
                        : ["", ""]
                      : [],
                  correct_answer: nextType === "quiz" ? v.correct_answer : "",
                })
              }
              showSearch
              optionFilterProp="children"
              disabled={action.busy}
            >
              {Object.entries(questionTypeLabels).map(([id, name]) => (
                <Select.Option value={id} key={id}>
                  {name}
                </Select.Option>
              ))}
            </Select>
          </Field>
          <Field className="ui-field" label={<>满分</>} required={true}>
            <IntegerInput
              aria-label="满分"
              min={1}
              max={10000}
              value={v.max_score}
              onChange={(val) => change({ max_score: val })}
              disabled={action.busy}
            />
          </Field>
        </div>

        <Field className="ui-field" label={<>题干与条件</>} required={true}>
          <Input.TextArea
            aria-label="题干与条件"
            rows={5}
            value={v.prompt}
            onChange={(e) => change({ prompt: e.target.value })}
            disabled={action.busy}
          />
        </Field>
        {v.prompt.trim() && (
          <Collapse
            items={[
              {
                key: "prompt-preview",
                label: <>题干公式与排版预览</>,
                children: <RichContent text={v.prompt} />,
              },
            ]}
          />
        )}

        <Field className="ui-field" label={<>考查要求</>}>
          <Input.TextArea
            aria-label="考查要求"
            value={v.requirements}
            onChange={(e) => change({ requirements: e.target.value })}
            disabled={action.busy}
          />
        </Field>

        <Field className="ui-field" label={<>参考解答</>}>
          <Input.TextArea
            aria-label="参考解答"
            rows={4}
            value={v.reference_answer}
            onChange={(e) => change({ reference_answer: e.target.value })}
            disabled={action.busy}
          />
        </Field>
        {v.reference_answer.trim() && (
          <Collapse
            items={[
              {
                key: "ref-preview",
                label: <>参考解答排版预览</>,
                children: <RichContent text={v.reference_answer} />,
              },
            ]}
          />
        )}

        {v.type === "quiz" && (
          <Field className="ui-field" label={<>客观题选项与正确答案</>} required>
            <QuizOptionsEditor
              options={v.options}
              correctAnswer={v.correct_answer}
              disabled={action.busy}
              onChange={(nextOptions, nextCorrect) =>
                change({ options: nextOptions, correct_answer: nextCorrect })
              }
            />
          </Field>
        )}

        <Field className="ui-field" label={<>关联知识点</>}>
          <Select
            aria-label="关联知识点"
            value={v.knowledge_point_id}
            onChange={(e) => change({ knowledge_point_id: e })}
            showSearch
            optionFilterProp="children"
            disabled={action.busy}
          >
            <Select.Option value="">暂不关联</Select.Option>
            {leafPoints.map((p) => (
              <Select.Option key={p.id} value={p.id}>
                {p.title}
              </Select.Option>
            ))}
          </Select>
        </Field>

        <FrozenEvidence sources={v.refs} />

        {v.type !== "quiz" && (
          <>
            <div className="section-head">
              <Typography.Text strong className="item-title">
                随题保存的标准草稿（可选）
              </Typography.Text>
              {!v.criteria.length && (
                <Button
                  size="small"
                  htmlType="button"
                  disabled={action.busy}
                  onClick={() =>
                    change({ criteria: [blankPoint([], v.max_score)] })
                  }
                >
                  添加随题评分点
                </Button>
              )}
            </div>
            {v.criteria.length > 0 && (
              <BankCriteriaEditor
                value={v.criteria}
                onChange={(criteria) => change({ criteria })}
                maxScore={v.max_score}
                refs={v.refs}
                disabled={action.busy}
              />
            )}
          </>
        )}

        <Feedback message={action.message} failed={action.failed} />
        <div className="live-inline">
          <Button
            htmlType="submit"
            type="primary"
            disabled={action.busy || criteriaMismatch || !course}
          >
            保存题目草稿
          </Button>
          <Button
            onClick={async () => {
              if (
                !draft.dirty ||
                (await confirm("收起未保存编辑？返回时可恢复。"))
              ) {
                onCancel();
              }
            }}
            htmlType="button"
            disabled={action.busy}
          >
            取消
          </Button>
        </div>
      </Form>
    </Card>
  );
}

function BankAnalysis({
  version: v,
  archived,
  onRevise,
}: {
  version: BankVersion;
  archived: boolean;
  onRevise: (refs: Hit[]) => void;
}) {
  const [refs, setRefs] = useState(v.evidence_refs);
  const [analysis, setAnalysis] = useState<Record<string, unknown> | null>(
    null,
  );
  return (
    <div className="live-stack" style={{ gap: 12 }}>
      <EvidencePicker value={refs} onChange={setRefs} defaultQuery={v.title} />
      <AIDraft
        kind="question_analyze"
        target={{ question_id: v.id, evidence_ids: refs.map((h) => h.id) }}
        onAdopt={setAnalysis}
      />
      {analysis && (
        <>
          <Typography.Text strong className="item-title" style={{ margin: 0 }}>
            题目分析建议
          </Typography.Text>
          {(analysis.requirements as string[] | undefined)?.map((s, i) => (
            <p key={`r${i}`} style={{ margin: 0 }}>{s}</p>
          ))}
          {(analysis.issues as string[] | undefined)?.map((s, i) => (
            <p key={`i${i}`} style={{ margin: 0 }}>待澄清：{s}</p>
          ))}
          {(analysis.associations as { reason: string }[] | undefined)?.map(
            (s, i) => (
              <p key={`a${i}`} style={{ margin: 0 }}>关联：{s.reason}</p>
            ),
          )}
        </>
      )}
      <Button
        htmlType="button"
        disabled={archived}
        onClick={() => onRevise(refs)}
        style={{ justifySelf: "start" }}
      >
        以所选依据另建题目版本
      </Button>
      <FrozenEvidence sources={v.evidence_refs} />
    </div>
  );
}

interface BankStandardSeed {
  seq: number;
  criteria: Criterion[];
  refs: Hit[];
}

function BankStandardDraftEditor({
  version: v,
  archived,
  canConfirmRubric,
  seed,
  onDirtyChange,
  onSaved,
  onCancel,
}: {
  version: BankVersion;
  archived: boolean;
  canConfirmRubric: boolean;
  seed: BankStandardSeed | null;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const confirm = useConfirm();
  const action = useAction();
  const initialDraft = useMemo(
    () => ({
      criteria: [blankPoint([], v.max_score)],
      refs: v.evidence_refs || [],
      ai_job_id: "",
    }),
    [v.max_score, v.evidence_refs],
  );
  const draft = useEditorDraft(`bank-rubric:${v.id}`, initialDraft);
  const [validationError, setValidationError] = useState("");
  const [pruneNotice, setPruneNotice] = useState("");
  const appliedSeedRef = useRef(0);

  useEffect(() => {
    onDirtyChange(draft.dirty);
    return () => onDirtyChange(false);
  }, [draft.dirty, onDirtyChange]);

  useEffect(() => {
    if (!seed || seed.seq === appliedSeedRef.current) return;
    appliedSeedRef.current = seed.seq;
    const { criteria } = pruneCriteriaEvidence(seed.criteria, seed.refs);
    draft.change({
      criteria: criteria.map((p) => ({ ...p })),
      refs: seed.refs,
      ai_job_id: "",
    });
    setValidationError("");
    setPruneNotice("");
  }, [seed, draft]);

  const { criteria, refs } = draft.value;
  const total = criteria.reduce((s, p) => s + (Number(p.max_score) || 0), 0);

  async function saveRubric(confirmAfter: boolean) {
    const err = validateBankCriteria(criteria, v.max_score, refs);
    if (err) {
      setValidationError(err);
      return;
    }
    setValidationError("");
    action.setMessage("");
    const snapshot = draft.value;
    const cleaned = pruneCriteriaEvidence(criteria, refs).criteria.map(
      (c) => ({
        ...c,
        id: c.id.trim(),
        title: c.title.trim(),
        rule: c.rule.trim(),
      }),
    );
    const saved = await action.run<RubricVersion>(
      `/question-bank/versions/${v.id}/rubrics`,
      {
        criteria: cleaned,
        evidence_ids: refs.map((h) => h.id),
        ai_job_id: draft.value.ai_job_id,
      },
      "POST",
      confirmAfter && canConfirmRubric ? undefined : "评分标准草稿已保存",
    );
    if (!saved) return;
    if (confirmAfter && canConfirmRubric && saved.id) {
      const confirmed = await action.run(
        `/rubrics/${saved.id}/confirm`,
        undefined,
        "POST",
        "评分标准已保存并确认",
      );
      if (!confirmed) {
        draft.saved(snapshot);
        return;
      }
    }
    if (draft.saved(snapshot)) {
      onSaved();
    }
  }

  return (
    <div className="live-form">
      <DraftNotice
        restored={draft.restored}
        storageError={draft.storageError}
        onDiscard={() => {
          draft.reset(initialDraft);
          setValidationError("");
          setPruneNotice("");
          action.setMessage("");
        }}
      />
      <EvidencePicker
        value={refs}
        defaultQuery={v.title}
        onChange={(nextRefs) => {
          setValidationError("");
          draft.change((prev) => {
            const { criteria: cleaned, prunedCount } = pruneCriteriaEvidence(
              prev.criteria,
              nextRefs,
            );
            setPruneNotice(
              prunedCount > 0
                ? `已自动清理评分点中 ${prunedCount} 条失效依据引用。`
                : "",
            );
            return { ...prev, refs: nextRefs, criteria: cleaned };
          });
        }}
      />
      {pruneNotice && <Alert type="info" showIcon message={pruneNotice} />}
      <AIDraft
        kind="bank_rubric"
        autoAdopt={!draft.dirty}
        disabled={!canConfirmRubric}
        target={{ question_id: v.id, evidence_ids: refs.map((h) => h.id) }}
        onAdopt={async (output, id) => {
          if (draft.dirty && !(await confirm("载入 AI 标准并替换当前编辑？"))) {
            return;
          }
          const nextRefs = Array.isArray(output.evidence_refs)
            ? (output.evidence_refs as Hit[])
            : refs;
          const rawCriteria = Array.isArray(output.criteria)
            ? (output.criteria as Criterion[])
            : [];
          const { criteria: cleaned } = pruneCriteriaEvidence(
            rawCriteria,
            nextRefs,
          );
          draft.change({
            criteria: cleaned,
            refs: nextRefs,
            ai_job_id: id,
          });
          setValidationError("");
        }}
      />
      <Form
        className="live-form"
        onFinish={() => void saveRubric(canConfirmRubric)}
        layout="vertical"
      >
        <BankCriteriaEditor
          value={criteria}
          onChange={(nextCriteria) => {
            setValidationError("");
            draft.change((prev) => ({ ...prev, criteria: nextCriteria }));
          }}
          maxScore={v.max_score}
          refs={refs}
          disabled={action.busy || archived}
        />
        {validationError && (
          <Alert type="error" showIcon role="alert" message={validationError} />
        )}
        <Feedback message={action.message} failed={action.failed} />
        <Space wrap>
          {canConfirmRubric && (
            <Button
              disabled={
                action.busy ||
                archived ||
                !criteria.length ||
                total !== v.max_score
              }
              htmlType="submit"
              type="primary"
            >
              保存并确认标准
            </Button>
          )}
          <Button
            disabled={
              action.busy ||
              archived ||
              !criteria.length ||
              total !== v.max_score
            }
            htmlType={canConfirmRubric ? "button" : "submit"}
            type={canConfirmRubric ? "default" : "primary"}
            onClick={
              canConfirmRubric ? () => void saveRubric(false) : undefined
            }
          >
            {canConfirmRubric ? "仅保存草稿" : "保存标准草稿"}
          </Button>
          <Button
            htmlType="button"
            disabled={action.busy}
            onClick={async () => {
              if (
                !draft.dirty ||
                (await confirm("收起标准编辑？未保存内容可在重新打开时恢复。"))
              ) {
                onCancel();
              }
            }}
          >
            取消
          </Button>
        </Space>
      </Form>
    </div>
  );
}

function BankStandards({
  version: v,
  archived,
  onConfirmVersion,
  confirmBusy = false,
}: {
  version: BankVersion;
  archived: boolean;
  onConfirmVersion?: () => Promise<void>;
  confirmBusy?: boolean;
}) {
  const confirm = useConfirm();
  const query = useLiveQuery<RubricVersion[]>(
    `/question-bank/versions/${v.id}/rubrics`,
  );
  const action = useAction();
  const [editing, setEditing] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const [seed, setSeed] = useState<BankStandardSeed | null>(null);

  const canConfirmRubric =
    !archived &&
    v.state === "confirmed" &&
    (!v.reference_answer || v.reference_state === "confirmed");

  return (
    <div className="live-stack" style={{ gap: 12 }}>
      <Feedback
        error={query.error}
        message={action.message}
        failed={action.failed}
      />
      {!canConfirmRubric && !archived && (
        <Alert
          type="info"
          showIcon
          message="需先确认题目版本与参考解答后，方可起草和确认评分标准。"
          action={
            onConfirmVersion && (
              <Button
                size="small"
                type="primary"
                htmlType="button"
                disabled={confirmBusy || action.busy}
                onClick={() => void onConfirmVersion()}
              >
                一键确认题目与解答
              </Button>
            )
          }
        />
      )}
      <Button
        htmlType="button"
        disabled={archived || !canConfirmRubric}
        style={{ justifySelf: "start" }}
        onClick={async () => {
          if (
            editing &&
            editorDirty &&
            !(await confirm("收起标准编辑？未保存内容可在重新打开时恢复。"))
          ) {
            return;
          }
          setEditing(!editing);
        }}
      >
        {editing ? "收起标准编辑" : "新建标准版本"}
      </Button>

      {editing && (
        <BankStandardDraftEditor
          version={v}
          archived={archived}
          canConfirmRubric={canConfirmRubric}
          seed={seed}
          onDirtyChange={setEditorDirty}
          onSaved={() => {
            setEditing(false);
            setSeed(null);
          }}
          onCancel={() => {
            setEditing(false);
            setSeed(null);
          }}
        />
      )}

      {query.isPending && <LoadingState />}
      {query.data?.map((r) => (
        <article className="live-revision" key={r.id}>
          <div className="section-head">
            <Typography.Text strong className="item-title">
              标准 v{r.version}
            </Typography.Text>
            <StatusTag
              status={r.state}
              label={labelFor(stateLabels, r.state)}
            />
          </div>
          {r.criteria.map((p) => (
            <div className="rag-hit" key={p.id}>
              <strong>
                {p.id} · {p.title} · {p.max_score}分
              </strong>
              <p>{p.rule}</p>
              {p.requirement && <p>考查要求：{p.requirement}</p>}
              {p.partial_credit && <p>部分分：{p.partial_credit}</p>}
              {p.acceptable_answers && (
                <p>可接受表达：{p.acceptable_answers}</p>
              )}
              {p.error_conditions && <p>错误条件：{p.error_conditions}</p>}
              {p.evidence_ids?.map((id) => (
                <p className="live-meta" key={id}>
                  依据：
                  {r.evidence_refs?.find((h) => h.id === id)?.title ||
                    "引用已保留"}
                </p>
              ))}
            </div>
          ))}
          <FrozenEvidence sources={r.evidence_refs} />
          <div className="live-inline" style={{ marginTop: 12 }}>
            {r.state === "draft" && (
              <Button
                htmlType="button"
                disabled={action.busy || !canConfirmRubric}
                onClick={() =>
                  void action.run(
                    `/rubrics/${r.id}/confirm`,
                    undefined,
                    "POST",
                    "评分标准已确认",
                  )
                }
                type="primary"
              >
                确认标准 v{r.version}
              </Button>
            )}
            <Button
              htmlType="button"
              disabled={archived}
              onClick={async () => {
                if (
                  editing &&
                  editorDirty &&
                  !(await confirm("复制此标准替换当前编辑？"))
                ) {
                  return;
                }
                setSeed({
                  seq: Date.now(),
                  criteria: r.criteria,
                  refs: r.evidence_refs || [],
                });
                setEditing(true);
              }}
            >
              复制到新标准版本
            </Button>
          </div>
        </article>
      ))}
    </div>
  );
}

export function BankQuestionPicker({
  open,
  onClose,
  onSelect,
  type,
  embedded = true,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (v: BankVersion, rubric?: RubricVersion) => void;
  type: string;
  embedded?: boolean;
}) {
  const list = useLiveQuery<BankVersion[]>("/question-bank", open);
  const [bank, setBank] = useState("");
  const [repairing, setRepairing] = useState(false);
  const [version, setVersion] = useState("");
  const [rubric, setRubric] = useState("");

  useEffect(() => {
    setBank("");
    setVersion("");
    setRubric("");
  }, [type]);

  const compatibleBankItems = useMemo(
    () =>
      (list.data || []).filter((item) => !item.archived && item.type === type),
    [list.data, type],
  );

  const detail = useLiveQuery<BankDetail>(
    `/question-bank/${bank}`,
    !!bank && open,
  );
  const versions =
    detail.data?.versions.filter(
      (v) =>
        v.state === "confirmed" &&
        (v.reference_state === "confirmed" || !v.reference_answer) &&
        v.type === type,
    ) || [];
  const current = versions.find((v) => v.id === version) || versions[0];
  const rubrics = useLiveQuery<RubricVersion[]>(
    `/question-bank/versions/${current?.id}/rubrics`,
    !!current && open && type !== "quiz",
  );
  const confirmed = rubrics.data?.filter((r) => r.state === "confirmed") || [];
  const selected = confirmed.find((r) => r.id === rubric) || confirmed[0];

  return (
    <Drawer
      title="从题库选题"
      aria-label="从题库选题"
      open={open}
      onClose={onClose}
      width="min(100%, 720px)"
      push={false}
    >
      <Feedback error={list.error || detail.error || rubrics.error} />
      <Form layout="vertical" component={false}>
        <div className="live-form">
        <Field
          className="ui-field"
          label={<>题目（仅显示{labelFor(questionTypeLabels, type)}）</>}
        >
          <Select
            aria-label="题目"
            allowClear
            placeholder="选择题目"
            style={{ width: "100%" }}
            value={bank || undefined}
            onChange={(e) => {
              setBank(e || "");
              setVersion("");
              setRubric("");
            }}
            showSearch
            optionFilterProp="children"
          >
            {compatibleBankItems.map((item) => (
              <Select.Option key={item.bank_id} value={item.bank_id}>
                {item.title}
              </Select.Option>
            ))}
          </Select>
        </Field>
        {!list.isPending && !compatibleBankItems.length && (
          <Alert
            type="info"
            showIcon
            message={`题库中暂无可用的「${labelFor(questionTypeLabels, type)}」，可先在题库创建。`}
          />
        )}
        {bank && (
          <Field className="ui-field" label={<>确认版本</>}>
            <Select
              aria-label="确认版本"
              allowClear
              placeholder="选择版本"
              style={{ width: "100%" }}
              value={current?.id || undefined}
              onChange={(e) => {
                setVersion(e || "");
                setRubric("");
              }}
              showSearch
              optionFilterProp="children"
            >
              {versions.map((ver) => (
                <Select.Option key={ver.id} value={ver.id}>
                  v{ver.version} · {ver.max_score}分
                </Select.Option>
              ))}
            </Select>
          </Field>
        )}
        {current && (
          <>
            <RichContent text={current.prompt} />
            {type !== "quiz" && (
              <Field className="ui-field" label={<>确认标准</>}>
                <Select
                  aria-label="确认标准"
                  allowClear
                  placeholder="选择标准"
                  style={{ width: "100%" }}
                  value={selected?.id || undefined}
                  onChange={(e) => setRubric(e || "")}
                  showSearch
                  optionFilterProp="children"
                >
                  {confirmed.map((r) => (
                    <Select.Option key={r.id} value={r.id}>
                      标准 v{r.version}
                    </Select.Option>
                  ))}
                </Select>
              </Field>
            )}
            <FrozenEvidence
              sources={selected?.evidence_refs || current.evidence_refs}
            />
            <Button
              htmlType="button"
              disabled={
                (type !== "quiz" && !selected) ||
                !!detail.error ||
                !!rubrics.error
              }
              onClick={() => {
                onSelect(current, selected);
                onClose();
              }}
              type="primary"
            >
              加入作业
            </Button>
          </>
        )}
        {bank && !detail.isPending && !versions.length && (
          <p>此题尚无可用确认版本，请先在题库审定题目及参考解答。</p>
        )}
        {bank && (
          <Button htmlType="button" onClick={() => setRepairing(true)}>
            就地核对题目、参考解答与标准
          </Button>
        )}
        </div>
      </Form>
      <Drawer
        title="核对题目与评分标准"
        open={repairing}
        width="min(100%, 900px)"
        push={false}
        destroyOnHidden
        onClose={() => {
          setRepairing(false);
          void detail.refetch();
          void rubrics.refetch();
          void list.refetch();
        }}
      >
        {repairing && bank && (
          <EditorScope isolated={embedded}>
            <BankDetailView key={bank} bankID={bank} embedded={embedded} />
          </EditorScope>
        )}
      </Drawer>
    </Drawer>
  );
}
