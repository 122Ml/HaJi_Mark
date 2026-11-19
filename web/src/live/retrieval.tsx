import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Form, Input, Select, Space, Typography } from "antd";
import { Field } from "../shared/Field";
import { PageHeader } from "../shared/PageHeader";
import { useSession } from "../shared/session";
import { GroundedAnswer } from "./citations";
import { ModelSelect } from "./ai-jobs";
import {
  Feedback,
  Link,
  useAction,
  useLearning,
  useLiveQuery,
  uuid,
} from "./context";
import { formatHitLocator, labelFor, stateLabels } from "./domain-meta";
import { RetrievalHistory } from "./retrieval-history";
import type { AssistAnswer, Hit, Resource } from "./types";
import { hasControlNull, utf8ByteLength } from "./validation";
import "./knowledge.css";

interface RetrievalReadiness {
  configured: boolean;
  indexed: boolean;
  object_index?: { keyword_chunks: number; vector_chunks: number };
  latest_index_job?: { state: string; error: string; created_at: string };
}

const MODE_LABELS: Record<string, string> = {
  resource_keyword: "当前学习资料文内检索",
  hybrid: "语义与关键词混合检索",
  vector: "语义检索",
  keyword: "关键词检索",
};

const PURPOSE_OPTIONS = [
  { value: "learning", label: "学习资料与知识" },
  { value: "grading", label: "评分依据" },
];

function formatSearchMode(rawMode: string, teacher: boolean): string {
  if (!rawMode) return "";
  const [base, ...rest] = rawMode.split(" · ");
  const friendlyBase = MODE_LABELS[base.trim()] || base.trim();
  if (teacher && rest.length > 0) {
    return `${friendlyBase} · ${rest.join(" · ")}`;
  }
  return friendlyBase;
}

function resourceHref(teacher: boolean, resourceID: string): string {
  return teacher
    ? `/teacher/materials?tab=published&resource=${encodeURIComponent(resourceID)}`
    : `/student/course-content?resource=${encodeURIComponent(resourceID)}`;
}

function sourceHref(sourceID: string, fragmentID?: string): string {
  const sp = new URLSearchParams({ source: sourceID });
  if (fragmentID) sp.set("fragment", fragmentID);
  return `/teacher/materials?${sp.toString()}`;
}

export function RetrievalPage({
  resourceID = "",
  embedded = false,
}: {
  resourceID?: string;
  embedded?: boolean;
} = {}) {
  const { session } = useSession();
  const { course } = useLearning();
  const queryClient = useQueryClient();
  const teacher = session?.user.role === "teacher";
  const searchAction = useAction();
  const assistAction = useAction();
  const [params] = useSearchParams();

  const targetResource = resourceID || params.get("resource") || "";
  const taskParam = params.get("task") || "";
  const [onlyCurrent, setOnlyCurrent] = useState(!!targetResource);
  const [pickedResource, setPickedResource] = useState("");
  const [query, setQuery] = useState("");
  const [purpose, setPurpose] = useState("learning");
  const [model, setModel] = useState("");
  const [validationError, setValidationError] = useState("");
  const [result, setResult] = useState<{ hits: Hit[]; mode: string } | null>(
    null,
  );
  const [answer, setAnswer] = useState<AssistAnswer | null>(null);

  const requestIDRef = useRef<{ sig: string; id: string }>({ sig: "", id: "" });
  const opSeqRef = useRef(0);

  useEffect(() => {
    opSeqRef.current += 1;
    setOnlyCurrent(!!targetResource);
    setPickedResource("");
    setValidationError("");
    setResult(null);
    setAnswer(null);
    requestIDRef.current = { sig: "", id: "" };
    assistAction.clearError();
    searchAction.clearError();
  }, [course?.id, targetResource, assistAction.clearError, searchAction.clearError]);

  const resourcesQuery = useLiveQuery<Resource[]>(
    "/resources",
    !embedded && !targetResource,
  );
  const publishedResources = useMemo(
    () => (resourcesQuery.data || []).filter((r) => r.status === "published"),
    [resourcesQuery.data],
  );

  const effectiveResourceID = targetResource
    ? onlyCurrent
      ? targetResource
      : ""
    : pickedResource;

  const effectivePurpose =
    teacher && !effectiveResourceID ? purpose : "learning";

  const readiness = useLiveQuery<RetrievalReadiness>(
    `/retrieval/status${effectiveResourceID ? `?resource_id=${encodeURIComponent(effectiveResourceID)}` : ""}`,
  );
  const assistStatus = useLiveQuery<{ configured: boolean }>("/assist");

  function validateQuery(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) return "请输入课程问题";
    if (hasControlNull(trimmed) || utf8ByteLength(trimmed) > 4000) {
      return "问题长度不能超过 4000 字节";
    }
    return "";
  }

  function readinessMessage(): string {
    if (readiness.isPending) return "正在读取课程检索状态…";
    if (readiness.error) return "检索状态读取失败，可继续阅读原文";
    if (effectiveResourceID) {
      return "仅在当前已发布学习文本中匹配依据（不依赖向量索引）";
    }
    if (!readiness.data?.configured) {
      return "课程智能检索未启用，可选择已发布学习资料进行文内检索";
    }
    if (readiness.data?.indexed) {
      return "课程已有索引空间；不代表每份资料的最新修订已就绪";
    }
    return "课程向量索引尚未就绪；检索可使用已有关键词索引";
  }

  const retrievalUnavailable =
    !effectiveResourceID &&
    !readiness.isPending &&
    readiness.data?.configured === false;
  const assistUnavailable =
    !assistStatus.isPending &&
    (!!assistStatus.error || assistStatus.data?.configured === false);

  async function runAssist() {
    const err = validateQuery(query);
    if (err) {
      setValidationError(err);
      return;
    }
    setValidationError("");
    setAnswer(null);
    searchAction.clearError();
    const trimmed = query.trim();
    const sig = `${trimmed}|${effectiveResourceID}|${model}`;
    if (requestIDRef.current.sig !== sig || !requestIDRef.current.id) {
      requestIDRef.current = { sig, id: uuid() };
    }
    const requestID = requestIDRef.current.id;
    const seq = ++opSeqRef.current;
    try {
      const r = await assistAction.run<AssistAnswer>("/assist", {
        topic: trimmed,
        resource_id: effectiveResourceID,
        profile_id: model,
        request_id: requestID,
      });
      if (r && seq === opSeqRef.current) {
        requestIDRef.current = { sig: "", id: "" };
        setAnswer(r);
        setResult({ hits: r.sources || [], mode: r.mode || "" });
      }
    } finally {
      if (course?.id) {
        void queryClient.invalidateQueries({
          predicate: (entry) =>
            entry.queryKey[0] === "live" &&
            entry.queryKey[1] === course.id &&
            String(entry.queryKey[2] || "").startsWith("/assist/history"),
        });
      }
    }
  }

  useEffect(() => {
    if (assistAction.error?.status === 409) {
      requestIDRef.current = { sig: "", id: "" };
    }
  }, [assistAction.error]);

  return (
    <div className="live-page">
      {!embedded && (
        <PageHeader
          title={teacher ? "检索与问答" : "资料问答"}
          subtitle={course?.title}
        />
      )}
      {!embedded && (taskParam || targetResource) && (
        <Space wrap>
          {taskParam && (
            <Link
              to={`/${teacher ? "teacher" : "student"}/intervention?task=${encodeURIComponent(taskParam)}`}
            >
              返回原学习任务
            </Link>
          )}
          {targetResource && (
            <Link to={resourceHref(teacher, targetResource)}>
              返回当前学习资料
            </Link>
          )}
        </Space>
      )}
      <Alert
        showIcon
        type={readiness.error ? "warning" : "info"}
        message={readinessMessage()}
        description={
          teacher && readiness.data ? (
            <>
              {readiness.data.object_index && (
                <p>
                  已观察到本资料的关键词片段{" "}
                  {readiness.data.object_index.keyword_chunks} 个、当前空间向量{" "}
                  {readiness.data.object_index.vector_chunks}{" "}
                  个；此计数不表示所有片段均已处理。
                </p>
              )}
              {readiness.data.latest_index_job && (
                <p>
                  最近一次课程索引：
                  {labelFor(
                    stateLabels,
                    readiness.data.latest_index_job.state,
                  )}
                  {readiness.data.latest_index_job.error
                    ? ` · ${readiness.data.latest_index_job.error}`
                    : ""}
                </p>
              )}
            </>
          ) : undefined
        }
      />
      {targetResource ? (
        <Select
          aria-label="问答资料范围"
          value={onlyCurrent ? "current" : "course"}
          onChange={(v) => {
            setOnlyCurrent(v === "current");
            setResult(null);
            setAnswer(null);
            requestIDRef.current = { sig: "", id: "" };
          }}
          options={[
            { value: "current", label: "仅当前学习资料" },
            { value: "course", label: "全课程可见资料" },
          ]}
        />
      ) : (
        !embedded &&
        publishedResources.length > 0 && (
          <Field className="ui-field" label={<>限定学习资料（可选）</>}>
            <Select
              aria-label="限定学习资料"
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="全课程可见资料（可选限定某份已发布资料）"
              value={pickedResource || undefined}
              onChange={(val) => {
                setPickedResource(val || "");
                setResult(null);
                setAnswer(null);
                requestIDRef.current = { sig: "", id: "" };
              }}
              options={publishedResources.map((r) => ({
                value: r.id,
                label: `${r.title} · v${r.version}`,
              }))}
            />
          </Field>
        )
      )}
      <Form
        className="card-panel live-form"
        onFinish={async () => {
          const err = validateQuery(query);
          if (err) {
            setValidationError(err);
            return;
          }
          setValidationError("");
          setAnswer(null);
          assistAction.clearError();
          const seq = ++opSeqRef.current;
          const r = await searchAction.run<{ hits: Hit[]; mode: string }>(
            "/retrieval",
            {
              query: query.trim(),
              purpose: effectivePurpose,
              resource_id: effectiveResourceID,
            },
            "POST",
            undefined,
            { invalidate: false },
          );
          if (r && seq === opSeqRef.current) setResult(r);
        }}
        layout="vertical"
      >
        <Field className="ui-field" label={<>课程问题</>} required={true}>
          <Input.TextArea
            aria-label="课程问题"
            required
            rows={3}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (validationError) setValidationError("");
            }}
          />
        </Field>
        {teacher && (
          <div className="live-inline">
            {!effectiveResourceID && (
              <Field className="ui-field" label={<>检索用途</>}>
                <Select
                  aria-label="检索用途"
                  value={purpose}
                  onChange={setPurpose}
                  options={PURPOSE_OPTIONS}
                />
              </Field>
            )}
            <ModelSelect kind="chat" value={model} onChange={setModel} />
          </div>
        )}
        <div className="live-inline">
          <Button
            disabled={
              searchAction.busy || !query.trim() || retrievalUnavailable
            }
            htmlType="submit"
            type="primary"
          >
            {searchAction.busy ? "检索中…" : "检索依据"}
          </Button>
          <Button
            disabled={
              assistAction.busy ||
              !query.trim() ||
              effectivePurpose === "grading" ||
              assistStatus.isPending ||
              assistUnavailable
            }
            onClick={() => void runAssist()}
            htmlType="button"
          >
            {assistAction.busy ? "处理中…" : "根据资料回答"}
          </Button>
        </div>
        {!assistStatus.isPending && assistStatus.error && (
          <p className="live-meta">
            问答模型状态读取失败：{assistStatus.error.message}
          </p>
        )}
        {!assistStatus.isPending &&
          !assistStatus.error &&
          assistStatus.data?.configured === false && (
            <p className="live-meta">
              生成模型未启用，不能生成回答；正文阅读不受影响。
            </p>
          )}
        <Feedback
          error={validationError ? new Error(validationError) : undefined}
          message={assistAction.message || searchAction.message}
          failed={assistAction.failed || searchAction.failed}
        />
      </Form>
      {answer && (
        <Card className="card-panel" title={<>AI回答</>}>
          <GroundedAnswer answer={answer} />
        </Card>
      )}
      {result && (
        <Card className="card-panel">
          <div className="workspace-heading">
            <Typography.Text strong className="item-title">
              检索依据 · {result.hits.length}
            </Typography.Text>
            <span className="live-meta">
              {formatSearchMode(result.mode, teacher)}
            </span>
          </div>
          {!result.hits.length && <p>没有找到当前可见的依据。</p>}
          {result.hits.map((h) => {
            const loc = formatHitLocator(h.locator);
            return (
              <article key={h.id} className="rag-hit">
                <Typography.Text strong className="item-title">
                  {h.title}
                  {h.heading ? ` · ${h.heading}` : ""}
                </Typography.Text>
                {loc && <small> · {loc}</small>}
                <p className="live-prose">{h.body}</p>
                <Space wrap size="small">
                  {teacher && h.source_id && (
                    <Link to={sourceHref(h.source_id, h.fragment_ids?.[0])}>
                      查看原文
                    </Link>
                  )}
                  {h.knowledge_id && (
                    <Link
                      to={`/${teacher ? "teacher" : "student"}/knowledge?knowledge=${encodeURIComponent(h.knowledge_id)}`}
                    >
                      查看知识库
                    </Link>
                  )}
                  {h.resource_id && (
                    <Link to={resourceHref(teacher, h.resource_id)}>
                      查看引用学习资料
                    </Link>
                  )}
                </Space>
              </article>
            );
          })}
        </Card>
      )}
      {!embedded && (
        <RetrievalHistory
          renderAnswer={(saved) => <GroundedAnswer answer={saved} />}
          reuse={(text, turnResourceID) => {
            setQuery(text);
            if (!targetResource) {
              setPickedResource(turnResourceID || "");
            } else if (turnResourceID) {
              setOnlyCurrent(turnResourceID === targetResource);
            }
            setAnswer(null);
            setResult(null);
            setValidationError("");
            requestIDRef.current = { sig: "", id: "" };
            window.scrollTo({ top: 0, behavior: "auto" });
          }}
        />
      )}
    </div>
  );
}
