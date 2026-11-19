import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
  Form,
  Input,
  Select,
  Space,
  Tag,
} from "antd";
import { Field } from "../shared/Field";
import { useConfirm } from "../shared/confirm";
import { EmptyState, MetaTag, MetaTags } from "../shared/ui";
import { Feedback, Link, useAction, useLearning, useLiveQuery } from "./context";
import { RichContent } from "./content-render";
import { type TopicData } from "./content-topics";
import { ASSET_KIND_LABELS } from "./domain-meta";
import { DraftNotice, useEditorDraft } from "./editing";
import { IntegerInput } from "./shared-editors";
import type { Job, Point } from "./types";
import { cleanTags, dedupeStrings, hasControlNull, isValidHTTPUrl, utf8ByteLength } from "./validation";
import { WorkflowJob } from "./workflow-job";

const QUESTION_TYPE_OPTIONS = [
  { value: "quiz", label: "单选" },
  { value: "subjective", label: "主观" },
  { value: "code", label: "代码文本" },
];

const ANSWER_ORIGIN_OPTIONS = [
  { value: "missing", label: "原卷未提供" },
  { value: "extracted", label: "原卷逐字提取" },
  { value: "teacher", label: "教师补录" },
];

export function URLImport({
  onDone,
  onBusyChange,
}: {
  onDone: (job: Job) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [url, setURL] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [allow, setAllow] = useState(false);
  const [formError, setFormError] = useState("");
  const action = useAction();
  const busyCbRef = useRef(onBusyChange);
  busyCbRef.current = onBusyChange;

  useEffect(() => {
    return () => {
      busyCbRef.current?.(false);
    };
  }, []);

  return (
    <Form
      className="live-form"
      onFinish={async () => {
        const trimmedURL = url.trim();
        const trimmedTitle = title.trim();
        const trimmedNote = note.trim();
        if (!isValidHTTPUrl(trimmedURL)) {
          setFormError("请输入有效的 http:// 或 https:// 公开网页／文档地址");
          return;
        }
        if (utf8ByteLength(trimmedURL) > 3000 || hasControlNull(trimmedURL)) {
          setFormError("网址长度超过限制或包含非法字符");
          return;
        }
        if (utf8ByteLength(trimmedTitle) > 500 || hasControlNull(trimmedTitle)) {
          setFormError("标题不能超过 500 字节");
          return;
        }
        if (!trimmedNote) {
          setFormError("请填写来源说明");
          return;
        }
        if (utf8ByteLength(trimmedNote) > 1000 || hasControlNull(trimmedNote)) {
          setFormError("来源说明不能超过 1000 字节");
          return;
        }
        setFormError("");
        busyCbRef.current?.(true);
        try {
          const job = await action.run<Job>("/sources/url", {
            url: trimmedURL,
            title: trimmedTitle,
            source_note: trimmedNote,
            allow_derived: allow,
          });
          if (job) onDone(job);
        } finally {
          busyCbRef.current?.(false);
        }
      }}
      layout="vertical"
    >
      <Field
        className="ui-field"
        label={<>公开网页／直链文档</>}
        required={true}
      >
        <Input
          aria-label="公开网页／直链文档"
          type="url"
          required
          disabled={action.busy}
          placeholder="https://example.com/lecture.pdf"
          value={url}
          onChange={(e) => {
            setURL(e.target.value);
            if (formError) setFormError("");
          }}
        />
      </Field>
      <small>
        仅支持公开可访问的 http:// 或 https:// 网页与常见文档直链（标准 80/443 端口），抓取过程可能需要数十秒。
      </small>
      <Field className="ui-field" label={<>标题</>}>
        <Input
          aria-label="标题"
          disabled={action.busy}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            if (formError) setFormError("");
          }}
        />
      </Field>
      <Field className="ui-field" label={<>来源说明</>} required={true}>
        <Input.TextArea
          aria-label="来源说明"
          required
          disabled={action.busy}
          placeholder="如：公开课程网站、开源教材章节或官方文档说明"
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            if (formError) setFormError("");
          }}
        />
      </Field>
      <Checkbox
        className="rag-check"
        disabled={action.busy}
        checked={allow}
        onChange={(e) => setAllow(e.target.checked)}
      >
        允许知识提炼
      </Checkbox>
      <Feedback
        error={formError ? new Error(formError) : undefined}
        message={action.message}
        failed={action.failed}
      />
      <Button disabled={action.busy} htmlType="submit" type="primary">
        {action.busy ? "保存快照中…" : "导入并解析"}
      </Button>
    </Form>
  );
}

type OutlineItem = {
  title: string;
  fragment_ids: string[];
};

type NewPointCandidate = {
  title: string;
  parent_id: string;
  duplicate_of: string;
  reason?: string;
};

type NewPointDraft = {
  key: string;
  title: string;
  parent_id: string;
  duplicate_of: string;
};

type Suggestions = {
  outline: OutlineItem[];
  topic_ids: string[];
  new_topic_names: string[];
  new_points: NewPointCandidate[];
  tags: string[];
  knowledge_point_ids: string[];
  similar_knowledge_ids: string[];
  reason: string;
};

function parseSuggestions(raw: Record<string, unknown>): Suggestions {
  const outline: OutlineItem[] = Array.isArray(raw.outline)
    ? raw.outline
        .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
        .map((item) => ({
          title: typeof item.title === "string" ? item.title : "",
          fragment_ids: Array.isArray(item.fragment_ids)
            ? item.fragment_ids.filter((x): x is string => typeof x === "string")
            : [],
        }))
        .filter((item) => item.title.trim().length > 0)
    : [];
  const new_points: NewPointCandidate[] = Array.isArray(raw.new_points)
    ? raw.new_points
        .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
        .map((item) => ({
          title: typeof item.title === "string" ? item.title : "",
          parent_id: typeof item.parent_id === "string" ? item.parent_id : "",
          duplicate_of: typeof item.duplicate_of === "string" ? item.duplicate_of : "",
          reason: typeof item.reason === "string" ? item.reason : undefined,
        }))
        .filter((item) => item.title.trim().length > 0)
    : [];
  const strList = (v: unknown) =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string")
      : [];
  return {
    outline,
    topic_ids: dedupeStrings(strList(raw.topic_ids)),
    new_topic_names: cleanTags(strList(raw.new_topic_names)),
    new_points,
    tags: cleanTags(strList(raw.tags)),
    knowledge_point_ids: dedupeStrings(strList(raw.knowledge_point_ids)),
    similar_knowledge_ids: dedupeStrings(strList(raw.similar_knowledge_ids)),
    reason: typeof raw.reason === "string" ? raw.reason : "",
  };
}

export function SourceSuggestions({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const action = useAction();
  const topics = useLiveQuery<TopicData>("/topics", open && !!id);
  const known = useLiveQuery<{ id: string; title: string }[]>(
    "/knowledge",
    open && !!id,
  );
  const points = useLiveQuery<{ points: Point[] }>("", open && !!id);

  const [candidate, setCandidate] = useState<Suggestions | null>(null);
  const [job, setJob] = useState("");
  const [outlineIdx, setOutlineIdx] = useState<number[]>([]);
  const [newPoints, setNewPoints] = useState<NewPointDraft[]>([]);
  const [topicIDs, setTopics] = useState<string[]>([]);
  const [newTopics, setNewTopics] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [pointIDs, setPoints] = useState<string[]>([]);
  const [reason, setReason] = useState("教师核对后采纳所选建议");
  const [droppedInactive, setDroppedInactive] = useState(0);
  const [validationError, setValidationError] = useState("");

  const activeTopics = useMemo(
    () => (topics.data?.topics || []).filter((t) => t.active),
    [topics.data?.topics],
  );
  const validPoints = useMemo(
    () => (points.data?.points || []).filter((p) => p.kind === "point"),
    [points.data?.points],
  );

  return (
    <Collapse
      className="card-panel"
      onChange={(keys) =>
        setOpen(Array.isArray(keys) ? keys.length > 0 : Boolean(keys))
      }
      items={[
        {
          key: "content",
          label: <>目录与归类建议</>,
          children: (
            <>
              <WorkflowJob
                kind="source_suggest"
                target={{ source_id: id }}
                onAdopt={(o, j) => {
                  const s = parseSuggestions(o);
                  const activeSet = new Set(activeTopics.map((t) => t.id));
                  const existingTopicIDs = (topics.data?.links || [])
                    .filter((l) => l.source_id === id && activeSet.has(l.topic_id))
                    .map((l) => l.topic_id);
                  const existingMeta = topics.data?.tags.find(
                    (t) => t.object_kind === "source" && t.object_id === id,
                  );
                  const suggestedActiveTopics = topics.data
                    ? s.topic_ids.filter((tid) => activeSet.has(tid))
                    : s.topic_ids;
                  const dropped = topics.data
                    ? s.topic_ids.length - suggestedActiveTopics.length
                    : 0;
                  const validPointSet = new Set(validPoints.map((p) => p.id));
                  const mergedPoints = dedupeStrings([
                    ...(existingMeta?.knowledge_point_ids || []),
                    ...s.knowledge_point_ids,
                  ]).filter((pid) => !points.data || validPointSet.has(pid));

                  setCandidate(s);
                  setJob(j);
                  setOutlineIdx([]);
                  setNewPoints([]);
                  setTopics(
                    dedupeStrings([...existingTopicIDs, ...suggestedActiveTopics]),
                  );
                  setNewTopics([]);
                  setTags(cleanTags([...(existingMeta?.tags || []), ...s.tags]));
                  setPoints(mergedPoints);
                  setReason("教师核对后采纳所选建议");
                  setDroppedInactive(dropped);
                  setValidationError("");
                }}
              />
              {candidate && (
                <div className="live-form">
                  {candidate.reason && <p>{candidate.reason}</p>}
                  <Alert
                    type="info"
                    showIcon
                    message="已自动合并当前资料已有的有效专题、标签与知识点，避免采纳时覆盖原有关联。"
                  />
                  {droppedInactive > 0 && (
                    <Alert
                      type="warning"
                      showIcon
                      message={`已忽略 ${droppedInactive} 个已停用或失效的建议专题。`}
                    />
                  )}
                  {candidate.outline.length > 0 && (
                    <Card size="small" title={<>追加目录</>}>
                      {candidate.outline.map((s, i) => (
                        <Checkbox
                          key={`${i}:${s.title}`}
                          className="rag-check"
                          checked={outlineIdx.includes(i)}
                          onChange={(e) =>
                            setOutlineIdx(
                              e.target.checked
                                ? [...outlineIdx, i].sort((a, b) => a - b)
                                : outlineIdx.filter((v) => v !== i),
                            )
                          }
                        >
                          {s.title}
                          {s.fragment_ids.length > 0 && (
                            <span className="live-meta">
                              {" "}
                              （关联 {s.fragment_ids.length} 个片段）
                            </span>
                          )}
                        </Checkbox>
                      ))}
                    </Card>
                  )}
                  <Field className="ui-field" label={<>专题</>}>
                    <Select
                      aria-label="建议专题"
                      mode="multiple"
                      optionFilterProp="label"
                      value={topicIDs}
                      onChange={(v) => setTopics(dedupeStrings(v))}
                      options={activeTopics.map((t) => ({
                        value: t.id,
                        label: t.title,
                      }))}
                    />
                  </Field>
                  {candidate.new_topic_names.length > 0 && (
                    <Card size="small" title={<>新增专题</>}>
                      {candidate.new_topic_names.map((n, i) => (
                        <Checkbox
                          key={`${i}:${n}`}
                          className="rag-check"
                          checked={newTopics.includes(n)}
                          onChange={(e) =>
                            setNewTopics(
                              e.target.checked
                                ? cleanTags([...newTopics, n])
                                : newTopics.filter((v) => v !== n),
                            )
                          }
                        >
                          {n}
                        </Checkbox>
                      ))}
                    </Card>
                  )}
                  <Field className="ui-field" label={<>标签</>}>
                    <Select
                      aria-label="建议标签"
                      mode="tags"
                      value={tags}
                      onChange={(v) => setTags(cleanTags(v))}
                    />
                  </Field>
                  <Field className="ui-field" label={<>课程知识点</>}>
                    <Select
                      aria-label="建议知识点"
                      mode="multiple"
                      optionFilterProp="label"
                      value={pointIDs}
                      onChange={(v) => setPoints(dedupeStrings(v))}
                      options={validPoints.map((p) => ({
                        value: p.id,
                        label: p.title,
                      }))}
                    />
                  </Field>
                  {candidate.new_points.length > 0 && (
                    <Card size="small" title={<>建议新知识点</>}>
                      <Space direction="vertical" style={{ width: "100%" }}>
                        {candidate.new_points.map((p, i) => {
                          const key = `${i}:${p.title}`;
                          const draftItem = newPoints.find((v) => v.key === key);
                          const dupTitle = p.duplicate_of
                            ? points.data?.points.find(
                                (v) => v.id === p.duplicate_of,
                              )?.title
                            : "";
                          return (
                            <div key={key} style={{ marginBottom: 4 }}>
                              <Checkbox
                                className="rag-check"
                                checked={!!draftItem}
                                onChange={(e) =>
                                  setNewPoints(
                                    e.target.checked
                                      ? [
                                          ...newPoints,
                                          {
                                            key,
                                            title: p.title,
                                            parent_id: p.parent_id || "",
                                            duplicate_of: p.duplicate_of || "",
                                          },
                                        ]
                                      : newPoints.filter((v) => v.key !== key),
                                  )
                                }
                              >
                                {dupTitle
                                  ? `已存在：${dupTitle}（改为关联）`
                                  : p.title}
                              </Checkbox>
                              {!!draftItem && !dupTitle && (
                                <Space
                                  direction="vertical"
                                  style={{ width: "100%", marginTop: 6 }}
                                >
                                  <Input
                                    aria-label="新知识点名称"
                                    value={draftItem.title}
                                    onChange={(e) =>
                                      setNewPoints(
                                        newPoints.map((v) =>
                                          v.key === key
                                            ? { ...v, title: e.target.value }
                                            : v,
                                        ),
                                      )
                                    }
                                  />
                                  <Select
                                    aria-label="上级目录"
                                    allowClear
                                    placeholder="挂到章或节（可留空）"
                                    value={draftItem.parent_id || undefined}
                                    style={{ width: "100%" }}
                                    onChange={(value) =>
                                      setNewPoints(
                                        newPoints.map((v) =>
                                          v.key === key
                                            ? { ...v, parent_id: value || "" }
                                            : v,
                                        ),
                                      )
                                    }
                                    options={(points.data?.points || [])
                                      .filter((v) => v.kind !== "point")
                                      .map((v) => ({
                                        value: v.id,
                                        label: v.title,
                                      }))}
                                  />
                                </Space>
                              )}
                              {!!p.reason && (
                                <div className="live-meta">{p.reason}</div>
                              )}
                            </div>
                          );
                        })}
                      </Space>
                    </Card>
                  )}
                  <Field className="ui-field" label={<>采纳说明</>}>
                    <Input
                      aria-label="采纳说明"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </Field>
                  {candidate.similar_knowledge_ids.length > 0 && (
                    <div>
                      相似知识：
                      {candidate.similar_knowledge_ids.map((k) => (
                        <Link
                          key={k}
                          to={`/teacher/knowledge?knowledge=${encodeURIComponent(k)}`}
                        >
                          {known.data?.find((v) => v.id === k)?.title ||
                            "查看知识"}{" "}
                        </Link>
                      ))}
                    </div>
                  )}
                  <Button
                    htmlType="button"
                    disabled={action.busy}
                    onClick={async () => {
                      const cleanReason =
                        reason.trim() || "教师核对后采纳所选建议";
                      if (
                        utf8ByteLength(cleanReason) > 5000 ||
                        hasControlNull(cleanReason)
                      ) {
                        setValidationError("采纳说明不能超过 5000 字节");
                        return;
                      }
                      const activeSet = new Set(activeTopics.map((t) => t.id));
                      const filteredTopicIDs = topics.data
                        ? dedupeStrings(topicIDs).filter((tid) =>
                            activeSet.has(tid),
                          )
                        : dedupeStrings(topicIDs);
                      const normalizedTags = cleanTags(tags);
                      if (
                        filteredTopicIDs.length + newTopics.length > 30 ||
                        normalizedTags.length > 30
                      ) {
                        setValidationError("专题或标签总数不能超过 30 项");
                        return;
                      }
                      const selectedOutline = candidate.outline
                        .filter((_, idx) => outlineIdx.includes(idx))
                        .map((item) => item.title.trim())
                        .filter(Boolean);
                      if (newPoints.length > 10) {
                        setValidationError("单次新增知识点不能超过 10 个");
                        return;
                      }
                      const preparedNewPoints: {
                        title: string;
                        parent_id: string;
                        duplicate_of: string;
                      }[] = [];
                      for (const item of newPoints) {
                        const cleanTitle = item.title.trim();
                        if (
                          !cleanTitle ||
                          utf8ByteLength(cleanTitle) > 200 ||
                          hasControlNull(cleanTitle)
                        ) {
                          setValidationError("新知识点名称不能为空且不超过 200 字节");
                          return;
                        }
                        preparedNewPoints.push({
                          title: cleanTitle,
                          parent_id: item.parent_id,
                          duplicate_of: item.duplicate_of,
                        });
                      }
                      setValidationError("");
                      const saved = await action.run(
                        `/sources/${id}/suggestions/adopt`,
                        {
                          job_id: job,
                          topic_ids: filteredTopicIDs,
                          tags: normalizedTags,
                          knowledge_point_ids: dedupeStrings(pointIDs),
                          new_topics: cleanTags(newTopics),
                          new_points: preparedNewPoints,
                          outline: selectedOutline,
                          reason: cleanReason,
                        },
                        "POST",
                        "已保存",
                        {
                          invalidatePrefixes: [
                            "sources",
                            "topics",
                            "decisions",
                            "",
                          ],
                        },
                      );
                      if (saved) setCandidate(null);
                    }}
                    type="primary"
                  >
                    采纳所选建议
                  </Button>
                </div>
              )}
              <Feedback
                error={
                  topics.error ||
                  known.error ||
                  points.error ||
                  (validationError ? new Error(validationError) : undefined)
                }
                message={action.message}
                failed={action.failed}
              />
            </>
          ),
        },
      ]}
    />
  );
}

type PaperQuestion = {
  title: string;
  prompt: string;
  type: string;
  max_score: number;
  options: string[];
  correct_answer: string;
  reference_answer: string;
  answer_origin: string;
  source_fragment_ids: string[];
  asset_ids: string[];
  uncertain: string[];
};

type Paper = {
  questions: PaperQuestion[];
  excluded: { fragment_id: string; reason: string }[];
  review_status: string;
  job_id?: string;
};

type AdoptedPaperResult = {
  count?: number;
  versions?: { id: string; title: string }[];
};

const EMPTY_PAPER: Paper = {
  questions: [],
  excluded: [],
  review_status: "pending_teacher_review",
};

function sanitizeQuestion(raw: Partial<PaperQuestion>): PaperQuestion {
  const type =
    raw.type === "quiz" || raw.type === "subjective" || raw.type === "code"
      ? raw.type
      : "subjective";
  const maxScore =
    typeof raw.max_score === "number" && Number.isFinite(raw.max_score)
      ? Math.max(1, Math.min(10000, Math.round(raw.max_score)))
      : 10;
  const rawOptions =
    type === "quiz" && Array.isArray(raw.options)
      ? raw.options.filter((x): x is string => typeof x === "string")
      : [];
  const rawCorrect =
    type === "quiz" && typeof raw.correct_answer === "string"
      ? raw.correct_answer
      : "";
  const answerOrigin =
    raw.answer_origin === "missing" ||
    raw.answer_origin === "extracted" ||
    raw.answer_origin === "teacher"
      ? raw.answer_origin
      : "missing";
  const cleanStringList = (value: unknown) =>
    dedupeStrings(
      Array.isArray(value)
        ? value.filter((x): x is string => typeof x === "string")
        : [],
    );
  return {
    title: typeof raw.title === "string" ? raw.title : "",
    prompt: typeof raw.prompt === "string" ? raw.prompt : "",
    type,
    max_score: maxScore,
    options: rawOptions,
    correct_answer: rawCorrect,
    reference_answer:
      typeof raw.reference_answer === "string" ? raw.reference_answer : "",
    answer_origin: answerOrigin,
    source_fragment_ids: cleanStringList(raw.source_fragment_ids),
    asset_ids: cleanStringList(raw.asset_ids),
    uncertain: cleanStringList(raw.uncertain),
  };
}

function sanitizeAdoptedPaper(
  raw: Record<string, unknown>,
  jobID: string,
): Paper {
  const rawQuestions = Array.isArray(raw.questions) ? raw.questions : [];
  const questions = rawQuestions
    .filter((q): q is Record<string, unknown> => !!q && typeof q === "object")
    .map((q) => sanitizeQuestion(q as Partial<PaperQuestion>));

  const assigned = new Set(questions.flatMap((q) => q.source_fragment_ids));
  const rawExcluded = Array.isArray(raw.excluded) ? raw.excluded : [];
  const seenExcluded = new Set<string>();
  const excluded: { fragment_id: string; reason: string }[] = [];
  for (const item of rawExcluded) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const fid = typeof rec.fragment_id === "string" ? rec.fragment_id : "";
    const reason = typeof rec.reason === "string" ? rec.reason : "";
    if (!fid || assigned.has(fid) || seenExcluded.has(fid)) continue;
    seenExcluded.add(fid);
    excluded.push({ fragment_id: fid, reason });
  }
  return {
    questions,
    excluded,
    review_status: "pending_teacher_review",
    job_id: jobID,
  };
}

export function PaperImport({
  id,
  fragments,
  parseRevision,
  defaultExpanded = false,
}: {
  id: string;
  fragments: { id: string; body: string }[];
  parseRevision?: number;
  defaultExpanded?: boolean;
}) {
  const confirm = useConfirm();
  const { course } = useLearning();
  const [job, setJob] = useState("");
  const [adoptedJobID, setAdoptedJobID] = useState("");
  const [adoptedResult, setAdoptedResult] = useState<AdoptedPaperResult | null>(
    null,
  );
  const [validationError, setValidationError] = useState("");
  const action = useAction();

  const assets = useLiveQuery<{
    assets: { id: string; kind: string }[];
    revisions: { asset_id: string; state: string }[];
  }>(`/sources/${id}/assets`, !!id && fragments.length > 0);

  const revisionKey =
    parseRevision !== undefined
      ? String(parseRevision)
      : fragments[0]?.id || "empty";
  const draft = useEditorDraft<Paper>(
    `paper:${course?.id || ""}:${id}:${revisionKey}`,
    EMPTY_PAPER,
    !!course,
  );
  const p = draft.value;

  const [selected, setSelected] = useState(0);
  const [splitAt, setSplitAt] = useState(0);

  const safeSelected =
    p.questions.length > 0
      ? Math.min(Math.max(0, selected), p.questions.length - 1)
      : 0;
  const current = p.questions[safeSelected];

  useEffect(() => {
    if (selected !== safeSelected) {
      setSelected(safeSelected);
      setSplitAt(0);
    }
  }, [selected, safeSelected]);

  const activeJobID = p.job_id || job;
  const alreadyAdopted = !!activeJobID && adoptedJobID === activeJobID;

  function update(v: Partial<PaperQuestion>) {
    if (!current) return;
    const nextFragmentIDs = v.source_fragment_ids
      ? dedupeStrings(v.source_fragment_ids)
      : current.source_fragment_ids;
    const nextAssetIDs = v.asset_ids
      ? dedupeStrings(v.asset_ids)
      : current.asset_ids;
    const newlyCovered = new Set(nextFragmentIDs);
    const nextExcluded = v.source_fragment_ids
      ? p.excluded.filter((x) => !newlyCovered.has(x.fragment_id))
      : p.excluded;
    draft.change({
      ...p,
      excluded: nextExcluded,
      questions: p.questions.map((q, i) =>
        i === safeSelected
          ? {
              ...q,
              ...v,
              source_fragment_ids: nextFragmentIDs,
              asset_ids: nextAssetIDs,
            }
          : q,
      ),
    });
    if (validationError) setValidationError("");
  }

  function swap(delta: number) {
    const j = safeSelected + delta;
    if (j < 0 || j >= p.questions.length) return;
    const qs = [...p.questions];
    [qs[safeSelected], qs[j]] = [qs[j], qs[safeSelected]];
    draft.change({ ...p, questions: qs });
    setSelected(j);
    setSplitAt(0);
  }

  const excludedSet = useMemo(
    () => new Set(p.excluded.map((x) => x.fragment_id)),
    [p.excluded],
  );
  const covered = useMemo(
    () =>
      new Set([
        ...p.questions.flatMap((q) => q.source_fragment_ids),
        ...p.excluded.map((x) => x.fragment_id),
      ]),
    [p.questions, p.excluded],
  );
  const missing = useMemo(
    () => fragments.filter((f) => !covered.has(f.id)),
    [fragments, covered],
  );

  const confirmedAssetOptions = useMemo(() => {
    const list = assets.data?.assets || [];
    const revs = assets.data?.revisions || [];
    const confirmedSet = new Set(
      revs.filter((r) => r.state === "confirmed").map((r) => r.asset_id),
    );
    return list
      .filter((a) => a.kind !== "page" && confirmedSet.has(a.id))
      .map((a, i) => ({
        value: a.id,
        label: `图${i + 1} · ${ASSET_KIND_LABELS[a.kind] || a.kind}`,
      }));
  }, [assets.data]);

  const validQuizOptions = useMemo(() => {
    if (!current || current.type !== "quiz") return [];
    return cleanTags(current.options);
  }, [current]);

  const staleConflict = action.error?.status === 409;

  function buildSubmitPayload(): { payload: Paper | null; error: string } {
    if (!fragments.length) {
      return { payload: null, error: "当前原件暂无已解析片段，无法拆题入库" };
    }
    if (!p.questions.length) {
      return { payload: null, error: "至少需要保留 1 道题目" };
    }
    if (missing.length > 0) {
      return {
        payload: null,
        error: `还有 ${missing.length} 个片段未归题或标记排除`,
      };
    }
    const cleanedQuestions: PaperQuestion[] = [];
    for (let i = 0; i < p.questions.length; i += 1) {
      const q = p.questions[i];
      const title = q.title.trim();
      const prompt = q.prompt.trim();
      const maxScore = Math.round(Number(q.max_score));
      const fids = dedupeStrings(q.source_fragment_ids);
      const aids = dedupeStrings(q.asset_ids);
      if (!title || utf8ByteLength(title) > 500) {
        return {
          payload: null,
          error: `第 ${i + 1} 题标题为空或超过 500 字节`,
        };
      }
      if (!prompt || utf8ByteLength(prompt) > 30000) {
        return {
          payload: null,
          error: `第 ${i + 1} 题题干为空或超过 30000 字节`,
        };
      }
      if (!Number.isInteger(maxScore) || maxScore < 1 || maxScore > 10000) {
        return {
          payload: null,
          error: `第 ${i + 1} 题满分须为 1 到 10000 之间的整数`,
        };
      }
      if (!fids.length) {
        return {
          payload: null,
          error: `第 ${i + 1} 题至少需要关联 1 个出处片段`,
        };
      }
      let options: string[] = [];
      let correctAnswer = "";
      if (q.type === "quiz") {
        options = cleanTags(q.options);
        correctAnswer = q.correct_answer.trim();
        if (options.length < 2 || options.length > 8) {
          return {
            payload: null,
            error: `第 ${i + 1} 题（单选）需设置 2 到 8 个非空且不重复的选项`,
          };
        }
        if (!correctAnswer || !options.includes(correctAnswer)) {
          return {
            payload: null,
            error: `第 ${i + 1} 题（单选）需从有效选项中选择正确答案`,
          };
        }
      }
      const refAnswer = q.reference_answer;
      if (q.answer_origin === "missing" && (refAnswer.trim() || correctAnswer)) {
        return {
          payload: null,
          error: `第 ${i + 1} 题解答来源为「原卷未提供」，不能填写参考解答或正确答案`,
        };
      }
      cleanedQuestions.push({
        title,
        prompt,
        type: q.type,
        max_score: maxScore,
        options,
        correct_answer: correctAnswer,
        reference_answer: q.answer_origin === "missing" ? "" : refAnswer,
        answer_origin: q.answer_origin,
        source_fragment_ids: fids,
        asset_ids: aids,
        uncertain: dedupeStrings(q.uncertain || []),
      });
    }
    const assigned = new Set(
      cleanedQuestions.flatMap((q) => q.source_fragment_ids),
    );
    const cleanedExcluded = p.excluded.filter(
      (x) => !assigned.has(x.fragment_id),
    );
    for (const x of cleanedExcluded) {
      if (!x.reason.trim()) {
        return { payload: null, error: "所有排除片段均需填写排除原因" };
      }
    }
    return {
      payload: {
        questions: cleanedQuestions,
        excluded: cleanedExcluded.map((x) => ({
          fragment_id: x.fragment_id,
          reason: x.reason.trim(),
        })),
        review_status: "pending_teacher_review",
      },
      error: "",
    };
  }

  return (
    <Collapse
      className="card-panel"
      defaultActiveKey={defaultExpanded ? ["content"] : []}
      items={[
        {
          key: "content",
          label: <>整卷拆题</>,
          children: !fragments.length ? (
            <EmptyState title="当前原件暂无已解析片段">
              请等待原件解析完成后再进行整卷拆题。
            </EmptyState>
          ) : (
            <>
              <WorkflowJob
                kind="paper_split"
                target={{ source_id: id }}
                onAdopt={async (o, j) => {
                  if (
                    draft.dirty &&
                    !(await confirm("载入拆题候选并替换当前编辑？"))
                  ) {
                    return;
                  }
                  const clean = sanitizeAdoptedPaper(o, j);
                  setJob(j);
                  if (adoptedJobID !== j) {
                    setAdoptedResult(null);
                  }
                  draft.change(clean);
                  setSelected(0);
                  setSplitAt(0);
                  setValidationError("");
                }}
              />
              {adoptedResult && (
                <Alert
                  type="success"
                  showIcon
                  message={`已保存 ${adoptedResult.count ?? adoptedResult.versions?.length ?? 0} 道题库草稿`}
                  description={
                    adoptedResult.versions?.length ? (
                      <Space wrap size="small">
                        {adoptedResult.versions.map((v) => (
                          <Link
                            key={v.id}
                            to={`/teacher/question-bank?bank_version=${encodeURIComponent(v.id)}`}
                          >
                            {v.title || "查看题目草稿"}
                          </Link>
                        ))}
                      </Space>
                    ) : (
                      <Link to="/teacher/question-bank">进入题库确认</Link>
                    )
                  }
                />
              )}
              {p.questions.length > 0 && (
                <div className="live-form">
                  <DraftNotice
                    {...draft}
                    onDiscard={() => {
                      draft.reset(EMPTY_PAPER);
                      setSelected(0);
                      setSplitAt(0);
                      setValidationError("");
                    }}
                  />
                  <div className="live-inline">
                    <Field className="ui-field" label={<>题目</>}>
                      <Select
                        aria-label="题目"
                        value={safeSelected}
                        onChange={(val) => {
                          setSelected(Number(val));
                          setSplitAt(0);
                        }}
                        showSearch
                        optionFilterProp="label"
                        options={p.questions.map((q, i) => ({
                          value: i,
                          label: `${i + 1}. ${q.title || "未命名题目"}${q.uncertain?.length ? "（待核对）" : ""}`,
                        }))}
                      />
                    </Field>
                    <Button
                      htmlType="button"
                      disabled={!safeSelected}
                      onClick={() => swap(-1)}
                    >
                      上移
                    </Button>
                    <Button
                      htmlType="button"
                      disabled={safeSelected === p.questions.length - 1}
                      onClick={() => swap(1)}
                    >
                      下移
                    </Button>
                    <Button
                      htmlType="button"
                      disabled={
                        !current || safeSelected === p.questions.length - 1
                      }
                      onClick={async () => {
                        if (!current) return;
                        const next = p.questions[safeSelected + 1];
                        if (!next) return;
                        const nextHasDistinctQuiz =
                          next.type === "quiz" &&
                          (next.correct_answer.trim() !== "" ||
                            cleanTags(next.options).some(
                              (opt) => !cleanTags(current.options).includes(opt),
                            ));
                        if (
                          nextHasDistinctQuiz &&
                          !(await confirm(
                            "下一题包含独立选项或正确答案，合并后将保留当前题的选项设置。继续合并？",
                          ))
                        ) {
                          return;
                        }
                        const qs = p.questions.filter(
                          (_, i) => i !== safeSelected + 1,
                        );
                        const mergedRefAnswer = [
                          current.reference_answer.trim(),
                          next.reference_answer.trim(),
                        ]
                          .filter(Boolean)
                          .join("\n\n");
                        const nextOrigin =
                          current.answer_origin === "missing" &&
                          mergedRefAnswer
                            ? next.answer_origin === "missing"
                              ? "teacher"
                              : next.answer_origin
                            : current.answer_origin;
                        qs[safeSelected] = {
                          ...current,
                          prompt: current.prompt + "\n\n" + next.prompt,
                          max_score: Math.min(
                            10000,
                            Math.max(
                              1,
                              (current.max_score || 0) + (next.max_score || 0),
                            ),
                          ),
                          reference_answer: mergedRefAnswer,
                          answer_origin: nextOrigin,
                          source_fragment_ids: dedupeStrings([
                            ...current.source_fragment_ids,
                            ...next.source_fragment_ids,
                          ]),
                          asset_ids: dedupeStrings([
                            ...current.asset_ids,
                            ...next.asset_ids,
                          ]),
                          uncertain: dedupeStrings([
                            ...(current.uncertain || []),
                            ...(next.uncertain || []),
                          ]),
                        };
                        draft.change({ ...p, questions: qs });
                        setSplitAt(0);
                      }}
                    >
                      与下一题合并
                    </Button>
                    <Button
                      htmlType="button"
                      onClick={() => {
                        const blank: PaperQuestion = {
                          title: `第 ${p.questions.length + 1} 题`,
                          prompt: "",
                          type: "subjective",
                          max_score: 10,
                          options: [],
                          correct_answer: "",
                          reference_answer: "",
                          answer_origin: "missing",
                          source_fragment_ids: [],
                          asset_ids: [],
                          uncertain: [],
                        };
                        draft.change({
                          ...p,
                          questions: [...p.questions, blank],
                        });
                        setSelected(p.questions.length);
                        setSplitAt(0);
                      }}
                    >
                      新增空白题
                    </Button>
                    <Button
                      htmlType="button"
                      danger
                      disabled={p.questions.length <= 1}
                      onClick={async () => {
                        if (
                          !(await confirm(
                            "删除当前题目？其关联片段将回到未归题列表。",
                            { danger: true },
                          ))
                        ) {
                          return;
                        }
                        const qs = p.questions.filter(
                          (_, i) => i !== safeSelected,
                        );
                        draft.change({ ...p, questions: qs });
                        setSelected(Math.max(0, safeSelected - 1));
                        setSplitAt(0);
                      }}
                    >
                      删除当前题
                    </Button>
                  </div>
                  {current && (
                    <>
                      <Field className="ui-field" label={<>题目名称</>}>
                        <Input
                          aria-label="题目名称"
                          value={current.title}
                          onChange={(e) => update({ title: e.target.value })}
                        />
                      </Field>
                      <div className="live-inline">
                        <Field className="ui-field" label={<>题型</>}>
                          <Select
                            aria-label="题型"
                            value={current.type}
                            onChange={(nextType) =>
                              update(
                                nextType === "quiz"
                                  ? { type: nextType }
                                  : {
                                      type: nextType,
                                      options: [],
                                      correct_answer: "",
                                    },
                              )
                            }
                            showSearch
                            optionFilterProp="label"
                            options={QUESTION_TYPE_OPTIONS}
                          />
                        </Field>
                        <Field className="ui-field" label={<>满分</>}>
                          <IntegerInput
                            aria-label="满分"
                            min={1}
                            max={10000}
                            value={current.max_score}
                            onChange={(val) => update({ max_score: val })}
                          />
                        </Field>
                      </div>
                      <Field className="ui-field" label={<>题干</>}>
                        <Input.TextArea
                          aria-label="题干"
                          rows={9}
                          value={current.prompt}
                          onChange={(e) => update({ prompt: e.target.value })}
                          onSelect={(e) =>
                            setSplitAt(e.currentTarget.selectionStart)
                          }
                        />
                      </Field>
                      <Button
                        htmlType="button"
                        disabled={
                          splitAt <= 0 || splitAt >= current.prompt.length
                        }
                        onClick={() => {
                          const qs = [...p.questions];
                          qs.splice(
                            safeSelected,
                            1,
                            {
                              ...current,
                              prompt: current.prompt.slice(0, splitAt),
                            },
                            {
                              ...current,
                              title: current.title + "（拆分）",
                              prompt: current.prompt.slice(splitAt),
                              reference_answer: "",
                              correct_answer: "",
                              answer_origin: "missing",
                            },
                          );
                          draft.change({ ...p, questions: qs });
                          setSplitAt(0);
                        }}
                      >
                        在光标位置拆题
                      </Button>
                      <RichContent text={current.prompt} />
                      {current.type === "quiz" && (
                        <>
                          <Field
                            className="ui-field"
                            label={<>选项（每行一个）</>}
                          >
                            <Input.TextArea
                              aria-label="选项（每行一个）"
                              rows={4}
                              value={current.options.join("\n")}
                              onChange={(e) => {
                                const nextOptions = e.target.value.split("\n");
                                const cleaned = cleanTags(nextOptions);
                                const keepCorrect = cleaned.includes(
                                  current.correct_answer.trim(),
                                );
                                update({
                                  options: nextOptions,
                                  correct_answer: keepCorrect
                                    ? current.correct_answer.trim()
                                    : "",
                                });
                              }}
                            />
                          </Field>
                          <Field className="ui-field" label={<>正确选项</>}>
                            <Select
                              aria-label="正确选项"
                              value={
                                validQuizOptions.includes(
                                  current.correct_answer.trim(),
                                )
                                  ? current.correct_answer.trim()
                                  : ""
                              }
                              onChange={(val) =>
                                update({
                                  correct_answer: val,
                                  answer_origin: val
                                    ? "teacher"
                                    : current.reference_answer.trim()
                                      ? current.answer_origin
                                      : "missing",
                                })
                              }
                              showSearch
                              optionFilterProp="label"
                              options={[
                                { value: "", label: "待补全" },
                                ...validQuizOptions.map((o) => ({
                                  value: o,
                                  label: o,
                                })),
                              ]}
                            />
                          </Field>
                        </>
                      )}
                      <Field className="ui-field" label={<>参考解答</>}>
                        <Input.TextArea
                          aria-label="参考解答"
                          value={current.reference_answer}
                          onChange={(e) =>
                            update({
                              reference_answer: e.target.value,
                              answer_origin: e.target.value.trim()
                                ? "teacher"
                                : current.correct_answer.trim()
                                  ? current.answer_origin
                                  : "missing",
                            })
                          }
                        />
                      </Field>
                      <Field className="ui-field" label={<>解答来源</>}>
                        <Select
                          aria-label="解答来源"
                          value={current.answer_origin}
                          onChange={async (val) => {
                            if (
                              val === "missing" &&
                              (current.reference_answer.trim() ||
                                current.correct_answer.trim())
                            ) {
                              if (
                                !(await confirm(
                                  "切换为「原卷未提供」将清空当前参考解答和正确选项。继续？",
                                ))
                              ) {
                                return;
                              }
                              update({
                                answer_origin: val,
                                reference_answer: "",
                                correct_answer: "",
                              });
                              return;
                            }
                            update({ answer_origin: val });
                          }}
                          showSearch
                          optionFilterProp="label"
                          options={ANSWER_ORIGIN_OPTIONS}
                        />
                      </Field>
                      <Field className="ui-field" label={<>出处片段</>}>
                        <Select
                          aria-label="拆题出处片段"
                          mode="multiple"
                          optionFilterProp="label"
                          value={current.source_fragment_ids}
                          onChange={(v) =>
                            update({ source_fragment_ids: dedupeStrings(v) })
                          }
                          options={fragments.map((f, i) => ({
                            value: f.id,
                            label: `${i + 1} ${f.body.slice(0, 70)}${excludedSet.has(f.id) ? "（当前已排除，选入将取消排除）" : ""}`,
                          }))}
                        />
                      </Field>
                      <Field className="ui-field" label={<>题图</>}>
                        <Select
                          mode="multiple"
                          aria-label="题目图像"
                          optionFilterProp="label"
                          value={current.asset_ids}
                          onChange={(v) =>
                            update({ asset_ids: dedupeStrings(v) })
                          }
                          options={confirmedAssetOptions}
                        />
                      </Field>
                      {!!current.uncertain?.length && (
                        <MetaTags>
                          <MetaTag>待核对：{current.uncertain.join("；")}</MetaTag>
                        </MetaTags>
                      )}
                    </>
                  )}
                  <Collapse
                    items={[
                      {
                        key: "content",
                        label: <>公共说明／排除片段 · {p.excluded.length}</>,
                        children: p.excluded.length ? (
                          <>
                            {p.excluded.map((x, i) => (
                              <Field
                                className="ui-field"
                                key={x.fragment_id}
                                label={
                                  <Space wrap>
                                    <span>
                                      {fragments
                                        .find((f) => f.id === x.fragment_id)
                                        ?.body.slice(0, 130) || x.fragment_id}
                                    </span>
                                    <Button
                                      htmlType="button"
                                      size="small"
                                      onClick={() =>
                                        draft.change({
                                          ...p,
                                          excluded: p.excluded.filter(
                                            (_, j) => j !== i,
                                          ),
                                        })
                                      }
                                    >
                                      恢复待分配
                                    </Button>
                                  </Space>
                                }
                              >
                                <Input
                                  aria-label="排除原因"
                                  value={x.reason}
                                  onChange={(e) =>
                                    draft.change({
                                      ...p,
                                      excluded: p.excluded.map((v, j) =>
                                        i === j
                                          ? { ...v, reason: e.target.value }
                                          : v,
                                      ),
                                    })
                                  }
                                />
                              </Field>
                            ))}
                          </>
                        ) : (
                          <p className="live-meta">暂无排除片段。</p>
                        ),
                      },
                    ]}
                  />
                  {missing.length > 0 && (
                    <div role="alert">
                      <strong>{missing.length}个片段未归题</strong>
                      {missing.map((f) => (
                        <div key={f.id}>
                          <p>{f.body.slice(0, 150)}</p>
                          <Space wrap size="small">
                            <Button
                              htmlType="button"
                              disabled={!current}
                              onClick={() => {
                                if (!current) return;
                                update({
                                  source_fragment_ids: dedupeStrings([
                                    ...current.source_fragment_ids,
                                    f.id,
                                  ]),
                                });
                              }}
                            >
                              加入当前题
                            </Button>
                            <Button
                              htmlType="button"
                              onClick={() =>
                                draft.change({
                                  ...p,
                                  excluded: [
                                    ...p.excluded.filter(
                                      (x) => x.fragment_id !== f.id,
                                    ),
                                    {
                                      fragment_id: f.id,
                                      reason: "公共说明（请核对）",
                                    },
                                  ],
                                })
                              }
                            >
                              标记排除
                            </Button>
                          </Space>
                        </div>
                      ))}
                    </div>
                  )}
                  {alreadyAdopted && (
                    <Alert
                      type="info"
                      showIcon
                      message="本次拆题任务已入库，同一任务不会重复写入。如需继续编辑请前往题库，或重新运行拆分任务。"
                    />
                  )}
                  {staleConflict && (
                    <Alert
                      type="warning"
                      showIcon
                      message="原卷修订版本已改变，当前拆题草稿无法入库。请刷新原件并重新运行「拆分题卷」。"
                      action={
                        <Button
                          size="small"
                          htmlType="button"
                          onClick={() => {
                            draft.reset(EMPTY_PAPER);
                            setSelected(0);
                            setSplitAt(0);
                          }}
                        >
                          重置当前草稿
                        </Button>
                      }
                    />
                  )}
                  <Space wrap>
                    <Button
                      htmlType="button"
                      disabled={
                        action.busy ||
                        !!missing.length ||
                        !activeJobID ||
                        alreadyAdopted
                      }
                      onClick={async () => {
                        const { payload, error } = buildSubmitPayload();
                        if (error || !payload) {
                          setValidationError(error);
                          return;
                        }
                        setValidationError("");
                        const snapshot = draft.value;
                        const r = await action.run<AdoptedPaperResult>(
                          `/sources/${id}/paper/adopt`,
                          {
                            ...payload,
                            job_id: activeJobID,
                          },
                          "POST",
                          undefined,
                          {
                            invalidatePrefixes: [
                              "sources",
                              "question-bank",
                              "decisions",
                            ],
                          },
                        );
                        if (r) {
                          setAdoptedJobID(activeJobID);
                          setAdoptedResult(r);
                          draft.saved(snapshot);
                        }
                      }}
                      type="primary"
                    >
                      保存整组题库草稿
                    </Button>
                    <Link to="/teacher/question-bank">进入题库确认</Link>
                  </Space>
                </div>
              )}
              <Feedback
                error={
                  assets.error ||
                  (validationError ? new Error(validationError) : undefined)
                }
                message={action.message}
                failed={action.failed}
              />
            </>
          ),
        },
      ]}
    />
  );
}

type SectionRow = {
  id: string;
  position: number;
  title: string;
  relation: string;
  fragment_ids: string[];
  knowledge_point_id: string | null;
  state: string;
  reason: string;
};

const sectionStateLabel: Record<string, string> = {
  proposed: "待教师确认",
  accepted: "已接受",
  rejected: "已驳回",
};

const sectionStateColor: Record<string, string> = {
  proposed: "blue",
  accepted: "green",
  rejected: "red",
};

export function SourceSegments({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const action = useAction();
  const confirm = useConfirm();
  const points = useLiveQuery<{ points: Point[] }>("", open && !!id);
  const [rows, setRows] = useState<SectionRow[] | null>(null);
  const saved = useLiveQuery<SectionRow[]>(
    `/sources/${id}/sections`,
    open && !!id,
  );
  const shown = rows ?? saved.data ?? [];

  useEffect(() => {
    setRows(null);
  }, [id]);

  return (
    <Collapse
      className="card-panel"
      onChange={(keys) =>
        setOpen(Array.isArray(keys) ? keys.length > 0 : Boolean(keys))
      }
      items={[
        {
          key: "sections",
          label: <>内容切分（按章节或知识点）</>,
          children: (
            <>
              <WorkflowJob
                kind="source_segment"
                target={{ source_id: id }}
                onAdopt={async (_o, j) => {
                  const v = await action.run<SectionRow[]>(
                    `/sources/${id}/sections/adopt`,
                    { job_id: j },
                    "POST",
                    "已保存 AI 内容切分方案（待教师确认）",
                    { invalidatePrefixes: ["sources"] },
                  );
                  if (v) setRows(v);
                }}
              />
              {shown.length > 0 && (
                <div className="live-form" style={{ marginTop: 12 }}>
                  {shown.map((r) => {
                    const pointTitle = r.knowledge_point_id
                      ? points.data?.points.find(
                          (p) => p.id === r.knowledge_point_id,
                        )?.title || r.knowledge_point_id
                      : "";
                    return (
                      <Card key={r.id} size="small">
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: 8,
                            flexWrap: "wrap",
                          }}
                        >
                          <strong>
                            {r.position + 1}. {r.title}
                          </strong>
                          <Space>
                            <Tag color={sectionStateColor[r.state] || "default"}>
                              {sectionStateLabel[r.state] || r.state}
                            </Tag>
                            {r.state === "accepted" && (
                              <Button
                                size="small"
                                htmlType="button"
                                disabled={action.busy}
                                onClick={async () => {
                                  if (
                                    !(await confirm(
                                      `确认将分段「${r.title}」（含 ${r.fragment_ids.length} 个片段）发布为学习资料？`,
                                    ))
                                  ) {
                                    return;
                                  }
                                  await action.run(
                                    `/sources/${id}/publish`,
                                    {
                                      title: r.title,
                                      fragment_ids: r.fragment_ids,
                                      knowledge_point_id:
                                        r.knowledge_point_id || "",
                                      full_source: false,
                                    },
                                    "POST",
                                    `已将「${r.title}」发布为学习资料并排队索引`,
                                    {
                                      invalidatePrefixes: [
                                        "resources",
                                        "sources",
                                        "jobs",
                                      ],
                                    },
                                  );
                                }}
                              >
                                发布为学习资料
                              </Button>
                            )}
                          </Space>
                        </div>
                        <div className="live-meta" style={{ marginTop: 4 }}>
                          {r.relation === "point"
                            ? `对应知识点：${pointTitle}`
                            : "仅顺序切分，不挂知识点"}
                          {" · "}
                          {r.fragment_ids.length} 个片段
                        </div>
                        {!!r.reason && (
                          <div style={{ marginTop: 4 }}>{r.reason}</div>
                        )}
                      </Card>
                    );
                  })}
                  <Space wrap>
                    <Button
                      htmlType="button"
                      disabled={action.busy}
                      onClick={async () => {
                        const v = await action.run<SectionRow[]>(
                          `/sources/${id}/sections/state`,
                          { state: "accepted" },
                          "POST",
                          "已接受全部切分方案",
                          { invalidatePrefixes: ["sources"] },
                        );
                        if (v) setRows(v);
                      }}
                      type="primary"
                    >
                      接受全部切分
                    </Button>
                    {shown.some((r) => r.state === "accepted") && (
                      <Button
                        htmlType="button"
                        disabled={action.busy}
                        onClick={async () => {
                          if (
                            !(await confirm(
                              "按已接受切分批量发布为学习资料？每个切分段将生成一条已发布资料。",
                            ))
                          ) {
                            return;
                          }
                          await action.run(
                            `/sources/${id}/sections/publish`,
                            {},
                            "POST",
                            "已按切分方案批量发布学习资料",
                            { invalidatePrefixes: ["sources", "resources", "topics", "jobs"] },
                          );
                        }}
                      >
                        按已接受切分发布资料
                      </Button>
                    )}
                    <Button
                      htmlType="button"
                      disabled={action.busy}
                      onClick={async () => {
                        const v = await action.run<SectionRow[]>(
                          `/sources/${id}/sections/state`,
                          { state: "rejected" },
                          "POST",
                          "已驳回当前切分，可重新生成并采纳替换",
                          { invalidatePrefixes: ["sources"] },
                        );
                        if (v) setRows(v);
                      }}
                    >
                      驳回全部
                    </Button>
                  </Space>
                </div>
              )}
              <Feedback
                error={saved.error || points.error}
                message={action.message}
                failed={action.failed}
              />
            </>
          ),
        },
      ]}
    />
  );
}
