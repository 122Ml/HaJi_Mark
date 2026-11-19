import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Alert,
  App,
  Button,
  Card,
  Collapse,
  Dropdown,
  Empty,
  Form,
  Input,
  List,
  Popconfirm,
  Radio,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from "antd";
import { Paperclip, Plus, Send } from "lucide-react";
import { APIError, requestJSON } from "../shared/api";
import { PageHeader } from "../shared/PageHeader";
import { useSession } from "../shared/session";
import { LoadingState } from "../shared/ui";
import { AgentEditor, type EditorTarget } from "./agent-editor";
import { RichContent } from "./content-render";
import { Link, useLearning, uuid } from "./context";
import type { BusinessContext } from "./context-agent";
import { jobKindLabels, labelFor } from "./domain-meta";
import { DraftNotice, useEditorDraft } from "./editing";
import { utf8ByteLength } from "./validation";
import "./agent.css";

type Conversation = {
  id: string;
  title: string;
  mode: string;
  profile_id: string;
  learner_context: boolean;
};

type Attachment = {
  id: string;
  filename: string;
  kind: string;
  size_bytes: number;
};

type Run = {
  id: string;
  request_id: string;
  state: string;
  error: string;
  cancel_requested: boolean;
  can_resume: boolean;
  created_at: string;
  stream_text?: string;
  stream_turn?: number;
};

type Step = {
  id: string;
  run_id: string;
  agent: string;
  tool: string;
  state: string;
  arguments: Record<string, unknown>;
  result: Record<string, unknown>;
};

type Field = {
  key: string;
  label: string;
  kind: string;
  required: boolean;
  options?: string[];
};

type Request = {
  id: string;
  run_id: string;
  step_id: string;
  kind: string;
  prompt: string;
  fields: Field[];
  snapshot: {
    arguments?: Record<string, unknown>;
    before?: unknown;
    editor?: EditorTarget;
  };
  response: Record<string, unknown>;
  state: string;
  expires_at: string;
};

type Message = {
  id: string;
  role: string;
  content: string;
  attachment_ids: string[];
  created_at: string;
};

type Snapshot = {
  conversation: Conversation;
  messages: Message[];
  runs: Run[];
  steps: Step[];
  requests: Request[];
  attachments: Attachment[];
  has_more: boolean;
  next_cursor: string;
  latest_event_id?: number;
};

type Status = {
  configured: boolean;
  profiles: { id: string; label: string; available: boolean; model: string }[];
  tools: { name: string; label: string }[];
};

type ComposerDraft = {
  text: string;
  attachments: Attachment[];
  requestID?: string;
};

const emptyDraft: ComposerDraft = { text: "", attachments: [] };
const emptyDrafts: Record<string, ComposerDraft> = {};

const ALLOWED_EXTENSIONS = new Set([
  ".pdf",
  ".docx",
  ".pptx",
  ".txt",
  ".md",
  ".html",
  ".htm",
  ".csv",
]);
const MAX_FILE_BYTES = 30 * 1024 * 1024;
const MAX_CONVERSATION_FILES = 30;
const MAX_CONVERSATION_BYTES = 150 * 1024 * 1024;

const CONTEXT_KIND_LABELS: Record<string, string> = {
  source: "原始资料",
  resource: "学习资料",
  knowledge: "知识条目",
  question: "题目版本",
  assignment: "作业",
  submission: "学生作答",
  diagnosis: "诊断报告",
  intervention: "补学补练任务",
};

const VERIFIED_CONTEXT_MARKER = "当前业务对象（服务端已核验访问权限";

function getFileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

function splitVerifiedContext(content: string): {
  body: string;
  chip: { kindLabel: string; id: string } | null;
} {
  const idx = content.indexOf(VERIFIED_CONTEXT_MARKER);
  if (idx < 0) return { body: content, chip: null };
  const body = content.slice(0, idx).replace(/\n+$/, "");
  const tail = content.slice(idx);
  const jsonStart = tail.indexOf("{");
  let kindLabel = "已核验业务对象";
  let id = "";
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(tail.slice(jsonStart)) as {
        kind?: string;
        id?: string;
      };
      if (parsed.kind) {
        kindLabel = CONTEXT_KIND_LABELS[parsed.kind] || parsed.kind;
      }
      if (parsed.id) id = parsed.id;
    } catch {
      // Fallback to generic verified chip if suffix JSON is partial.
    }
  }
  return { body, chip: { kindLabel, id } };
}

function uniqueRows<T extends { id: string }>(rows: T[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

function withHistory(
  latest: Snapshot | undefined,
  older: Snapshot[],
): Snapshot | undefined {
  if (!latest) return latest;
  const pages = [latest, ...older];
  const oldest = pages[pages.length - 1];
  return {
    ...latest,
    has_more: oldest.has_more,
    next_cursor: oldest.next_cursor,
    messages: uniqueRows(pages.flatMap((p) => p.messages)),
    runs: uniqueRows(pages.flatMap((p) => p.runs)),
    steps: uniqueRows(pages.flatMap((p) => p.steps)),
    requests: uniqueRows(pages.flatMap((p) => p.requests)),
    attachments: uniqueRows(pages.flatMap((p) => p.attachments)),
  };
}

const states: Record<string, [string, string]> = {
  queued: ["排队中", "default"],
  running: ["执行中", "processing"],
  waiting_input: ["等待回答", "warning"],
  waiting_approval: ["等待确认", "warning"],
  waiting_job: ["等待后台任务", "processing"],
  succeeded: ["已结束", "success"],
  failed: ["失败", "error"],
  canceled: ["已停止", "default"],
  unknown: ["结果待核对", "warning"],
  proposed: ["准备中", "default"],
  executing: ["执行中", "processing"],
  denied: ["未执行", "default"],
  pending: ["待处理", "warning"],
  answered: ["已确认", "success"],
  rejected: ["已拒绝", "default"],
  expired: ["已过期", "default"],
};

const domains: Record<string, string> = {
  coordinator: "协调",
  materials: "资料与知识",
  questions: "题目与标准",
  assessment: "作业与评阅",
  learning: "学习支持",
};

const modes = [
  { value: "read-only", label: "只读" },
  { value: "auto-review", label: "自动审查" },
  { value: "full-access", label: "完整操作" },
];

const isActive = (s: string) =>
  [
    "queued",
    "running",
    "waiting_input",
    "waiting_approval",
    "waiting_job",
  ].includes(s);

function StateTag({ state }: { state: string }) {
  const [text, color] = states[state] || [state, "default"];
  return <Tag color={color}>{text}</Tag>;
}

const labels: Record<string, string> = {
  id: "编号",
  title: "标题",
  content: "内容",
  body: "正文",
  name: "名称",
  state: "状态",
  status: "状态",
  response: "业务回执",
  data: "数据",
  http_status: "响应码",
  source_note: "来源说明",
  allow_derived: "允许提炼",
  fragment_ids: "所选片段",
  knowledge_point_id: "知识点",
  attachment_id: "附件",
  source_id: "原件",
  question_id: "题目版本",
  rubric_id: "标准",
  score: "得分",
  max_score: "满分",
  feedback: "反馈",
  points: "逐点反馈",
  criteria: "评分标准",
  prompt: "题干",
  requirements: "要求",
  reference_answer: "参考解答",
  evidence_ids: "依据",
  job: "处理任务",
  kind: "类型",
  error: "问题",
  message: "提示",
  summary: "处理结果",
  domain: "领域",
  filename: "文件名",
  download_url: "下载文件",
  rows: "记录数",
  fragments: "原文片段",
  revision: "修订",
  edit_version: "编辑版本",
  conditions: "适用条件",
  reason: "原因",
  related_ids: "关联条目",
  tags: "标签",
  topic_ids: "专题",
  student_id: "学生",
  fields: "问题",
  steps: "计划",
  truncated: "已截断",
  total: "总数",
};

const DOWNLOAD_URL_RE =
  /^\/api\/v1\/learning\/courses\/[\w-]+\/agent\/conversations\/[\w-]+\/attachments\/[\w-]+\/file$/;

function ValueView({
  value,
  depth = 0,
  onDownload,
}: {
  value: unknown;
  depth?: number;
  onDownload?: (url: string, filename: string) => void;
}) {
  if (value === null || value === undefined)
    return <Typography.Text type="secondary">无</Typography.Text>;
  if (typeof value === "boolean") return <Tag>{value ? "是" : "否"}</Tag>;
  if (typeof value !== "object")
    return <span className="agent-value">{String(value)}</span>;
  if (depth > 4)
    return (
      <Typography.Text type="secondary">
        请打开业务页面查看完整内容
      </Typography.Text>
    );
  if (Array.isArray(value)) {
    if (!value.length)
      return <Typography.Text type="secondary">无</Typography.Text>;
    return (
      <>
        <ol className="agent-value-list">
          {value.slice(0, 30).map((v, i) => (
            <li key={i}>
              <ValueView value={v} depth={depth + 1} onDownload={onDownload} />
            </li>
          ))}
        </ol>
        {value.length > 30 && (
          <Typography.Text type="secondary">
            还有 {value.length - 30} 项，请在业务页面查看完整内容
          </Typography.Text>
        )}
      </>
    );
  }
  const obj = value as Record<string, unknown>;
  const suggestedName =
    typeof obj.filename === "string" && obj.filename.trim()
      ? obj.filename
      : "导出反馈.csv";
  return (
    <dl className="agent-values">
      {Object.entries(obj)
        .filter(([key]) => key !== "business_hash")
        .map(([key, v]) => (
          <div key={key}>
            <dt>{labels[key] || key}</dt>
            <dd>
              {key === "download_url" &&
              typeof v === "string" &&
              DOWNLOAD_URL_RE.test(v) ? (
                <Typography.Link
                  href={v}
                  onClick={(e) => {
                    if (onDownload) {
                      e.preventDefault();
                      onDownload(v, suggestedName);
                    }
                  }}
                >
                  下载反馈 CSV
                </Typography.Link>
              ) : (
                <ValueView
                  value={v}
                  depth={depth + 1}
                  onDownload={onDownload}
                />
              )}
            </dd>
          </div>
        ))}
    </dl>
  );
}

function RequestCard({
  request,
  disabled,
  respond,
  onDownload,
}: {
  request: Request;
  disabled: boolean;
  respond: (
    id: string,
    decision: string,
    values?: Record<string, unknown>,
  ) => Promise<boolean>;
  onDownload: (url: string, filename: string) => void;
}) {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const expired =
    request.state === "expired" ||
    (request.state === "pending" &&
      !Number.isNaN(Date.parse(request.expires_at)) &&
      Date.parse(request.expires_at) <= Date.now());
  const pending = request.state === "pending" && !expired;
  const isFormInput = request.kind === "input" && !request.snapshot.editor;
  const savedEditor =
    request.state === "answered" && request.response.editor
      ? (request.response.editor as EditorTarget)
      : undefined;
  const savedPath = savedEditor
    ? (
        {
          source: `/teacher/materials?source=${encodeURIComponent(savedEditor.id)}`,
          knowledge: `/teacher/knowledge?knowledge=${encodeURIComponent(savedEditor.id)}`,
          question: `/teacher/question-bank?bank=${encodeURIComponent(savedEditor.id)}`,
          curriculum: "/teacher/curriculum",
          import: `/teacher/homework/${encodeURIComponent(savedEditor.id)}/submissions`,
          diagnosis: `/teacher/insight?view=gaps&diagnosis_report=${encodeURIComponent(savedEditor.id)}`,
          paper: `/teacher/question-bank?paper_source=${encodeURIComponent(savedEditor.id)}`,
        } as Record<string, string>
      )[savedEditor.kind]
    : undefined;

  // Only populate Form values when the Form component is actually mounted.
  useEffect(() => {
    if (isFormInput && request.state === "answered") {
      form.setFieldsValue(request.response);
    }
  }, [isFormInput, request.state, request.response, form]);

  const submitDecision = async (
    decision: string,
    values?: Record<string, unknown>,
  ) => {
    setSubmitting(true);
    try {
      return await respond(request.id, decision, values);
    } finally {
      setSubmitting(false);
    }
  };

  const editorEndedNotice = !pending
    ? expired
      ? "当前编辑请求已过期，无法直接返回继续原运行；你的内容仍可在业务工作台独立保存。"
      : request.state === "answered"
        ? "当前编辑请求已提交返回。"
        : "当前编辑请求已结束或取消，无法返回继续原运行。"
    : undefined;

  return (
    <Card
      size="small"
      className="agent-request"
      title={
        <Space wrap>
          <Tag color={request.kind === "input" ? "blue" : "orange"}>
            {request.kind === "input" ? "需要补充" : "操作确认"}
          </Tag>
          <span>{request.prompt}</span>
        </Space>
      }
      extra={
        <StateTag
          state={expired && request.state === "pending" ? "expired" : request.state}
        />
      }
    >
      {request.snapshot.editor ? (
        <Space direction="vertical">
          <Tag>
            {request.snapshot.editor.kind === "question"
              ? "题目与标准"
              : "业务工作台"}
          </Tag>
          <Space wrap>
            <AgentEditor
              target={request.snapshot.editor}
              disabled={disabled || submitting}
              endedNotice={editorEndedNotice}
              complete={() => submitDecision("approve")}
            />
            {pending && (
              <Button
                disabled={disabled || submitting}
                onClick={() => void submitDecision("reject")}
              >
                暂不编辑
              </Button>
            )}
          </Space>
          {savedPath && (
            <Space wrap>
              <Typography.Text>
                {request.response.changed
                  ? "服务端已重新读取保存结果"
                  : "未检测到服务端对象变化"}
              </Typography.Text>
              <Link to={savedPath}>打开已核对对象</Link>
            </Space>
          )}
        </Space>
      ) : isFormInput ? (
        <Form
          name={`agent-input-${request.id}`}
          form={form}
          layout="vertical"
          disabled={!pending || disabled || submitting}
          onFinish={(values) => void submitDecision("approve", values)}
        >
          {request.fields.map((f) => (
            <Form.Item
              key={f.key}
              name={f.key}
              label={f.label}
              rules={[
                ...(f.required
                  ? [
                      {
                        required: true,
                        whitespace: f.kind === "text",
                        message: "请填写或选择此项",
                      },
                    ]
                  : []),
                ...(f.kind === "text"
                  ? [
                      {
                        validator: async (_: unknown, val: unknown) => {
                          if (
                            typeof val === "string" &&
                            utf8ByteLength(val) > 10000
                          ) {
                            throw new Error("内容不能超过 10000 字节");
                          }
                        },
                      },
                    ]
                  : []),
              ]}
            >
              {f.kind === "text" ? (
                <Input.TextArea
                  autoSize={{ minRows: 2, maxRows: 5 }}
                  maxLength={10000}
                />
              ) : f.kind === "select" ? (
                <Radio.Group
                  options={f.options?.map((x) => ({ label: x, value: x }))}
                />
              ) : (
                <Select
                  mode="multiple"
                  options={f.options?.map((x) => ({ label: x, value: x }))}
                />
              )}
            </Form.Item>
          ))}
          {pending && (
            <Space>
              <Button
                type="primary"
                htmlType="submit"
                disabled={disabled}
                loading={submitting}
              >
                提交回答
              </Button>
              <Button
                onClick={() => void submitDecision("reject")}
                disabled={disabled || submitting}
              >
                暂不提供
              </Button>
            </Space>
          )}
        </Form>
      ) : (
        <>
          <ValueView
            value={request.snapshot.arguments}
            onDownload={onDownload}
          />
          {request.snapshot.before !== undefined && (
            <Collapse
              ghost
              items={[
                {
                  key: "before",
                  label: "查看当前业务对象",
                  children: (
                    <ValueView
                      value={request.snapshot.before}
                      onDownload={onDownload}
                    />
                  ),
                },
              ]}
            />
          )}
          {pending && (
            <Space wrap>
              <Button
                type="primary"
                disabled={disabled}
                loading={submitting}
                onClick={() => void submitDecision("approve")}
              >
                确认执行
              </Button>
              <Button
                disabled={disabled || submitting}
                onClick={() => void submitDecision("reject")}
              >
                拒绝
              </Button>
              <Typography.Text type="secondary">
                仅批准本卡列出的操作
              </Typography.Text>
            </Space>
          )}
        </>
      )}
    </Card>
  );
}

function ResultCards({ steps }: { steps: Step[] }) {
  const { session } = useSession();
  const role = session?.user.role === "teacher" ? "teacher" : "student";
  const cards: { key: string; title: string; state: string; path: string }[] =
    [];

  for (const step of steps) {
    if (step.state !== "succeeded") continue;
    const status = step.result.http_status;
    const response = step.result.response as { data?: unknown } | undefined;
    const data =
      typeof status === "number" && status >= 200 && status < 300
        ? response?.data
        : step.tool === "job_wait"
          ? step.result.job
          : undefined;
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    for (const [index, value] of rows.entries()) {
      if (!value || typeof value !== "object") continue;
      const row = value as Record<string, unknown>;
      if (typeof row.id !== "string") continue;
      const id = encodeURIComponent(row.id);
      let path = "";
      let title = "";
      if (
        typeof row.kind === "string" &&
        typeof row.progress === "number" &&
        row.input
      ) {
        const input = row.input as Record<string, unknown>;
        const jobKind = row.kind;
        if (role === "teacher") {
          if (
            ["question_generate", "question_analyze", "bank_rubric"].includes(
              jobKind,
            )
          ) {
            path = "/teacher/question-bank";
          } else if (["grade", "rubric"].includes(jobKind)) {
            path = "/teacher/homework";
          } else if (jobKind === "diagnosis") {
            path = "/teacher/insight?view=gaps";
          } else {
            path = `/teacher/materials?source_view=tasks${
              typeof input.source_id === "string"
                ? `&source=${encodeURIComponent(input.source_id)}`
                : ""
            }`;
          }
        } else if (jobKind === "recommendation") {
          path = "/student/learning";
        }
        const kindLabel = labelFor(jobKindLabels, jobKind, "");
        title = kindLabel ? `后台任务 · ${kindLabel}` : "后台处理任务";
      } else if (
        /^resource_(create|revision|publish)$|^source_publish$/.test(step.tool)
      ) {
        path =
          role === "teacher"
            ? `/teacher/materials?tab=published&resource=${id}`
            : `/student/course-content?resource=${id}`;
        title = "学习资料";
      } else if (/^knowledge_(create|update|state|decide)$/.test(step.tool)) {
        path = `/${role}/knowledge?knowledge=${id}`;
        title = "知识条目";
      } else if (
        /^question_(create|revision|confirm)$|^reference_confirm$/.test(
          step.tool,
        )
      ) {
        path = `/teacher/question-bank?bank_version=${id}`;
        title = "题目版本";
      } else if (
        /^rubric_(create|confirm)$/.test(step.tool) &&
        typeof row.bank_question_version_id === "string"
      ) {
        path = `/teacher/question-bank?bank_version=${encodeURIComponent(row.bank_question_version_id)}`;
        title = "评分标准";
      } else if (
        step.tool === "answer_submit" ||
        (/^(grade_save|grade_state)$/.test(step.tool) &&
          typeof row.submission_id === "string")
      ) {
        const targetSubID =
          step.tool === "answer_submit" ? row.id : String(row.submission_id);
        path = `/${role}/homework/submissions/${encodeURIComponent(targetSubID)}/${role === "teacher" ? "grade" : "feedback"}`;
        title = "作答与评分";
      } else if (/^assignment_(create|update|state)$/.test(step.tool)) {
        path = `/${role}/homework/${id}`;
        title = "作业";
      } else if (/^intervention_(create|state)$/.test(step.tool)) {
        path = `/${role}/intervention?task=${id}`;
        title = "补学补练任务";
      } else if (/^regrade_(create|state)$/.test(step.tool)) {
        path = `/teacher/regrades?batch=${id}`;
        title = "整组重评批次";
      } else if (row.kind === "diagnosis" || row.kind === "recommendation") {
        path =
          row.kind === "diagnosis"
            ? `/teacher/insight?view=gaps&diagnosis_report=${id}`
            : `/student/learning?recommendation_report=${id}`;
        title = "分析报告";
      }
      if (path) {
        cards.push({
          key: `${step.id}:${index}`,
          title:
            typeof row.title === "string" && row.title.trim()
              ? `${title} · ${row.title}`
              : title,
          state: String(row.state || row.status || "已保存"),
          path,
        });
      }
    }
  }

  if (!cards.length) return null;
  const receiptStateLabels: Record<string, string> = {
    draft: "草稿已保存",
    published: "已发布",
    confirmed: "已确认",
    archived: "已归档",
    assigned: "已下发",
  };
  return (
    <div className="agent-result-cards" aria-label="业务处理回执">
      {cards.map((card) => (
        <Card key={card.key} size="small">
          <Space wrap>
            <Typography.Text strong>{card.title}</Typography.Text>
            <Tag>
              {receiptStateLabels[card.state] ||
                states[card.state]?.[0] ||
                card.state}
            </Tag>
            <Link to={card.path}>打开业务对象</Link>
          </Space>
        </Card>
      ))}
    </div>
  );
}

function RunPanel({
  run,
  steps,
  requests,
  toolLabels,
  disabled,
  hasActive,
  liveText,
  liveStage,
  respond,
  resume,
  onDownload,
}: {
  run: Run;
  steps: Step[];
  requests: Request[];
  toolLabels: Map<string, string>;
  disabled: boolean;
  hasActive: boolean;
  liveText?: string;
  liveStage?: string;
  respond: (
    id: string,
    decision: string,
    values?: Record<string, unknown>,
  ) => Promise<boolean>;
  resume: () => Promise<boolean>;
  onDownload: (url: string, filename: string) => void;
}) {
  const pending = requests.filter(
    (r) => r.state === "pending" && isActive(run.state),
  );
  const completed = requests.filter((r) => !pending.includes(r));
  const streamText =
    run.state === "running" || (run.state === "queued" && !!liveText)
      ? liveText || run.stream_text || ""
      : ["failed", "canceled", "unknown"].includes(run.state)
        ? run.stream_text || ""
        : "";
  const activeStep = steps.find(
    (s) => s.state === "executing" || s.state === "proposed",
  );
  const progressHint =
    run.state === "running" ||
    run.state === "queued" ||
    run.state === "waiting_job"
      ? liveStage ||
        (activeStep
          ? `${domains[activeStep.agent] || activeStep.agent} · ${toolLabels.get(activeStep.tool) || activeStep.tool}`
          : run.state === "waiting_job"
            ? "正在等待后台任务完成…"
            : run.state === "queued"
              ? "正在排队等待执行…"
              : "")
      : "";

  const card = (r: Request) => (
    <RequestCard
      key={r.id}
      request={r}
      disabled={disabled || !isActive(run.state) || run.cancel_requested}
      respond={respond}
      onDownload={onDownload}
    />
  );

  return (
    <div className="agent-run" data-run-id={run.id}>
      <ResultCards steps={steps} />
      {progressHint && !streamText && (
        <Space wrap role="status">
          <Tag color="processing">{progressHint}</Tag>
        </Space>
      )}
      {!!streamText && (
        <Card
          size="small"
          className="agent-stream"
          title={
            <Space wrap>
              <Tag color={run.state === "running" ? "processing" : "warning"}>
                {run.state === "running"
                  ? "正在生成"
                  : "生成中断 · 以下为未完成内容"}
              </Tag>
              {progressHint && (
                <Typography.Text type="secondary">
                  {progressHint}
                </Typography.Text>
              )}
            </Space>
          }
        >
          <RichContent text={streamText} />
        </Card>
      )}
      <Collapse
        size="small"
        items={[
          {
            key: run.id,
            label: (
              <Space wrap>
                <StateTag state={run.state} />
                <span>执行记录</span>
                <Typography.Text type="secondary">
                  {steps.length} 步
                </Typography.Text>
              </Space>
            ),
            children: (
              <Space direction="vertical" className="agent-full-width">
                {steps.map((step) => (
                  <Collapse
                    key={step.id}
                    size="small"
                    items={[
                      {
                        key: step.id,
                        label: (
                          <Space wrap>
                            <Tag>{domains[step.agent] || step.agent}</Tag>
                            <span>
                              {toolLabels.get(step.tool) || step.tool}
                            </span>
                            <StateTag state={step.state} />
                          </Space>
                        ),
                        children: (
                          <>
                            <Typography.Text strong>操作内容</Typography.Text>
                            <ValueView
                              value={step.arguments}
                              onDownload={onDownload}
                            />
                            <Typography.Text strong>执行回执</Typography.Text>
                            <ValueView
                              value={step.result}
                              onDownload={onDownload}
                            />
                          </>
                        ),
                      },
                    ]}
                  />
                ))}
              </Space>
            ),
          },
        ]}
      />
      {run.error && (
        <Alert
          showIcon
          type={run.state === "unknown" ? "warning" : "error"}
          message={run.error}
        />
      )}
      {run.state === "succeeded" &&
        steps.some((s) => ["failed", "denied", "unknown"].includes(s.state)) && (
          <Alert
            showIcon
            type="warning"
            message="本轮包含失败或未执行的操作，请展开记录核对。"
          />
        )}
      {run.can_resume && !hasActive && (
        <Popconfirm
          title="从检查点恢复，模型请求可能再次计费；未知写操作会被拒绝重放。"
          onConfirm={() => void resume()}
        >
          <Button disabled={disabled}>从检查点恢复</Button>
        </Popconfirm>
      )}
      {pending.map(card)}
      {!!completed.length && (
        <Collapse
          size="small"
          items={[
            {
              key: "completed",
              label: `已处理的确认与补充（${completed.length}）`,
              children: (
                <Space direction="vertical" className="agent-full-width">
                  {completed.map(card)}
                </Space>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}

export function AgentPage({
  embedded = false,
  context,
  onDirtyChange,
}: {
  embedded?: boolean;
  context?: BusinessContext;
  onDirtyChange?: (dirty: boolean) => void;
} = {}) {
  const { course } = useLearning();
  const { session, refresh } = useSession();
  const cache = useQueryClient();
  const { message } = App.useApp();
  const [params, setParams] = useSearchParams();

  const courseID = course?.id || "";
  const userID = session?.user.id || "";
  const isTeacher = session?.user.role === "teacher";
  const associationKey = `haji-agent-context:${userID}:${courseID}:${context?.kind || ""}:${context?.id || ""}`;

  const [localConversation, setLocalConversation] = useState(() => {
    try {
      return embedded ? sessionStorage.getItem(associationKey) || "" : "";
    } catch {
      return "";
    }
  });
  const conversationID = embedded
    ? localConversation
    : params.get("conversation") || "";

  const draftKey =
    conversationID || (context ? `new:${context.kind}:${context.id}` : "new");
  const drafts = useEditorDraft(
    embedded && context
      ? `agent:${courseID}:${context.kind}:${context.id}`
      : `agent:${courseID}`,
    emptyDrafts,
    Boolean(courseID),
  );
  const composer = drafts.value[draftKey] || emptyDraft;

  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [archive, setArchive] = useState<{ key: string; pages: Snapshot[] }>({
    key: "",
    pages: [],
  });
  const [historyLoadingKey, setHistoryLoadingKey] = useState("");
  const [historyError, setHistoryError] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const [following, setFollowing] = useState(true);
  const [streamState, setStreamState] = useState("连接中");
  const [streamNonce, setStreamNonce] = useState(0);
  const [liveStream, setLiveStream] = useState<{
    conversationID: string;
    turn: number;
    text: string;
  } | null>(null);
  const liveStreamRef = useRef<{
    conversationID: string;
    turn: number;
    text: string;
  } | null>(null);
  const updateLiveStream = useCallback(
    (
      next: { conversationID: string; turn: number; text: string } | null,
    ) => {
      liveStreamRef.current = next;
      setLiveStream(next);
    },
    [],
  );
  const [liveStage, setLiveStage] = useState<{
    conversationID: string;
    label: string;
  } | null>(null);

  const anchor = useRef<{ top: number; height: number } | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const mutationLocked = useRef(false);
  const activeConversationIDRef = useRef(conversationID);
  activeConversationIDRef.current = conversationID;

  const scope = `${userID}:${courseID}`;
  const archiveKey = `${scope}:${conversationID}`;
  const currentArchiveKey = useRef(archiveKey);
  currentArchiveKey.current = archiveKey;
  const currentScope = useRef(scope);
  currentScope.current = scope;

  const prefix = `/learning/courses/${courseID}/agent`;
  const key = useMemo(() => ["agent", userID, courseID], [userID, courseID]);

  // Report local draft dirty state to ContextAgent Drawer without leaking to host page blocker.
  const hasComposerContent = Boolean(
    composer.text || composer.attachments.length || composer.requestID,
  );
  useEffect(() => {
    onDirtyChange?.(hasComposerContent);
    return () => onDirtyChange?.(false);
  }, [hasComposerContent, onDirtyChange]);

  // Debounce & trim conversation sidebar search (backend limit is 200 UTF-8 bytes).
  useEffect(() => {
    const trimmed = searchInput.trim();
    const timer = window.setTimeout(() => setDebouncedSearch(trimmed), 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const get = useCallback(
    async <T,>(path: string, signal?: AbortSignal) =>
      (await requestJSON<{ data: T }>(`${prefix}${path}`, { signal })).data,
    [prefix],
  );
  const write = useCallback(
    async <T,>(path: string, body: unknown, method = "POST") =>
      (
        await requestJSON<{ data: T }>(
          `${prefix}${path}`,
          { method, body: JSON.stringify(body) },
          session?.csrf_token,
        )
      ).data,
    [prefix, session?.csrf_token],
  );

  const status = useQuery({
    queryKey: [...key, "status"],
    enabled: Boolean(courseID),
    queryFn: ({ signal }) => get<Status>("/status", signal),
  });

  const conversationPages = useInfiniteQuery({
    queryKey: [...key, "conversations", debouncedSearch],
    enabled: Boolean(courseID) && !embedded,
    initialPageParam: 0,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal, pageParam }) => {
      const rows = await get<Conversation[]>(
        `/conversations?${new URLSearchParams({
          size: "31",
          offset: String(pageParam),
          search: debouncedSearch,
        })}`,
        signal,
      );
      return {
        rows: rows.slice(0, 30),
        more: rows.length > 30,
        offset: pageParam,
      };
    },
    getNextPageParam: (page) => (page.more ? page.offset + 30 : undefined),
  });
  const conversations = {
    ...conversationPages,
    data: uniqueRows(
      conversationPages.data?.pages.flatMap((p) => p.rows) || [],
    ),
  };

  const latestSnapshot = useQuery({
    queryKey: [...key, conversationID],
    enabled: Boolean(courseID && conversationID),
    queryFn: ({ signal }) =>
      get<Snapshot>(`/conversations/${conversationID}`, signal),
    refetchInterval: (query) => {
      const data = query.state.data;
      const hasRunning = data?.runs.some((r) => isActive(r.state)) ?? false;
      if (hasRunning || streamState !== "实时连接") return 5000;
      return false;
    },
  });

  const latestSnapshotRef = useRef(latestSnapshot.data);
  latestSnapshotRef.current = latestSnapshot.data;

  const snapshot = {
    ...latestSnapshot,
    data: withHistory(
      latestSnapshot.data,
      archive.key === archiveKey ? archive.pages : [],
    ),
  };
  const current = snapshot.data?.conversation;
  const runs = snapshot.data?.runs || [];
  const active = runs.find((r) => isActive(r.state));
  const toolLabels = useMemo(
    () => new Map(status.data?.tools.map((t) => [t.name, t.label])),
    [status.data],
  );
  const configured =
    !!status.data?.configured && status.data.profiles.some((p) => p.available);
  const inputDisabled =
    busy ||
    !!active ||
    !configured ||
    !drafts.ready ||
    !courseID ||
    (!!conversationID && !current);
  const bytes = utf8ByteLength(composer.text);
  const allAttachments = snapshot.data?.attachments || [];
  const reusable = allAttachments.filter(
    (a) =>
      a.kind === "upload" &&
      !composer.attachments.some((selected) => selected.id === a.id),
  );
  const exports = allAttachments.filter((a) => a.kind === "export");
  const fileURL = useCallback(
    (id: string) =>
      `/api/v1${prefix}/conversations/${conversationID}/attachments/${id}/file`,
    [prefix, conversationID],
  );

  const downloadFromURL = useCallback(
    async (url: string, filename: string) => {
      try {
        const res = await fetch(url, { credentials: "same-origin" });
        if (!res.ok) {
          if (res.status === 401) void refresh();
          let errText = `下载失败（HTTP ${res.status}）`;
          try {
            const payload = (await res.json()) as {
              error?: { message?: string };
            };
            if (payload.error?.message) errText = payload.error.message;
          } catch {
            // Non-JSON error body.
          }
          void message.error(errText);
          return;
        }
        const blob = await res.blob();
        const objectURL = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = objectURL;
        link.download = filename || "attachment";
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(objectURL), 5000);
      } catch {
        void message.error("文件下载失败，请检查网络后重试");
      }
    },
    [message, refresh],
  );

  const timeline = useMemo(
    () =>
      [
        ...(snapshot.data?.messages || []).map((m) => ({
          kind: "message" as const,
          value: m,
          priority: m.role === "user" ? 0 : 2,
        })),
        ...runs.map((r) => ({
          kind: "run" as const,
          value: r,
          priority: 1,
        })),
      ].sort(
        (a, b) =>
          Date.parse(a.value.created_at) - Date.parse(b.value.created_at) ||
          a.priority - b.priority ||
          a.value.id.localeCompare(b.value.id),
      ),
    [snapshot.data?.messages, runs],
  );

  const invalidate = useCallback(
    async (targetConversationID?: string) => {
      const id = targetConversationID ?? activeConversationIDRef.current;
      const tasks: Promise<unknown>[] = [
        cache.invalidateQueries({ queryKey: [...key, "conversations"] }),
      ];
      if (id) {
        tasks.push(cache.invalidateQueries({ queryKey: [...key, id] }));
      }
      await Promise.all(tasks);
    },
    [cache, key],
  );

  const selectConversation = useCallback(
    (id: string, replace = false) => {
      activeConversationIDRef.current = id;
      if (embedded) {
        setLocalConversation(id);
        try {
          if (id) sessionStorage.setItem(associationKey, id);
          else sessionStorage.removeItem(associationKey);
        } catch {
          // Server history remains available.
        }
      } else {
        setParams(
          (p) => {
            const next = new URLSearchParams(p);
            if (id) next.set("conversation", id);
            else next.delete("conversation");
            return next;
          },
          { replace },
        );
      }
    },
    [embedded, associationKey, setParams],
  );

  function updateComposer(patch: Partial<ComposerDraft>) {
    drafts.change((all) => ({
      ...all,
      [draftKey]: {
        ...(all[draftKey] || emptyDraft),
        ...patch,
        requestID: undefined,
      },
    }));
  }

  function clearDraft(id: string) {
    drafts.change((all) => {
      const next = { ...all };
      delete next[id];
      return next;
    });
  }

  async function createConversationRecord(
    preserveDraft = !conversationID,
    selectNow = true,
  ) {
    const v = await write<Conversation>("/conversations", {
      mode: "auto-review",
      profile_id: status.data?.profiles.find((p) => p.available)?.id || "",
    });
    if (scope === currentScope.current) {
      if (preserveDraft) {
        drafts.change((all) => {
          const next = { ...all, [v.id]: all[draftKey] || emptyDraft };
          delete next[draftKey];
          return next;
        });
      }
      setSearchInput("");
      setDebouncedSearch("");
      if (selectNow) selectConversation(v.id);
    }
    await cache.invalidateQueries({ queryKey: [...key, "conversations"] });
    return v.id;
  }

  async function runAction(
    fn: () => Promise<string | void | unknown>,
  ): Promise<boolean> {
    if (mutationLocked.current) {
      void message.info("上一条操作仍在处理中，请稍候");
      return false;
    }
    mutationLocked.current = true;
    setBusy(true);
    try {
      const maybeID = await fn();
      const targetID =
        typeof maybeID === "string" && maybeID
          ? maybeID
          : activeConversationIDRef.current;
      await invalidate(targetID);
      return true;
    } catch (e) {
      if (e instanceof APIError && e.status === 401) void refresh();
      if (scope === currentScope.current) {
        void message.error(
          e instanceof Error ? e.message : "操作失败，请刷新后核对",
        );
      }
      return false;
    } finally {
      mutationLocked.current = false;
      setBusy(false);
    }
  }

  async function send() {
    if (
      inputDisabled ||
      mutationLocked.current ||
      bytes > 12000 ||
      (!composer.text.trim() && !composer.attachments.length)
    ) {
      return;
    }
    const requestID = composer.requestID || uuid();
    const pendingText = composer.text;
    const pendingAttachments = composer.attachments;
    const initialDraftKey = draftKey;
    drafts.change((all) => ({
      ...all,
      [initialDraftKey]: {
        text: pendingText,
        attachments: pendingAttachments,
        requestID,
      },
    }));
    setFollowing(true);
    await runAction(async () => {
      let id = conversationID;
      let createdNow = false;
      if (!id) {
        // Create without switching active view yet so GET /conversations/:id doesn't cache an empty snapshot before POST /messages commits.
        id = await createConversationRecord(true, false);
        createdNow = true;
      }
      try {
        await write(`/conversations/${id}/messages`, {
          content: pendingText,
          attachment_ids: pendingAttachments.map((a) => a.id),
          request_id: requestID,
          context: context ? { kind: context.kind, id: context.id } : undefined,
        });
      } catch (err) {
        // If conversation was created before POST /messages failed, select it so retry reuses the exact conversation & request_id.
        if (createdNow && scope === currentScope.current) {
          selectConversation(id);
        }
        throw err;
      }
      if (scope === currentScope.current) {
        drafts.change((all) => {
          const next = { ...all };
          delete next[initialDraftKey];
          delete next[id];
          return next;
        });
        if (createdNow) selectConversation(id);
      }
      return id;
    });
  }

  async function loadHistory() {
    if (!snapshot.data?.next_cursor || historyLoadingKey === archiveKey) return;
    const cursor = snapshot.data.next_cursor;
    setHistoryLoadingKey(archiveKey);
    setHistoryError(null);
    try {
      const page = await get<Snapshot>(
        `/conversations/${conversationID}?before=${encodeURIComponent(cursor)}`,
      );
      if (currentArchiveKey.current !== archiveKey) return;
      if (scroll.current) {
        anchor.current = {
          top: scroll.current.scrollTop,
          height: scroll.current.scrollHeight,
        };
      }
      setFollowing(false);
      setArchive((previous) => {
        const basePages =
          previous.key === archiveKey && previous.pages.length
            ? previous.pages
            : latestSnapshotRef.current
              ? [latestSnapshotRef.current]
              : [];
        return { key: archiveKey, pages: [...basePages, page] };
      });
    } catch (e) {
      if (currentArchiveKey.current === archiveKey) {
        setHistoryError({
          key: archiveKey,
          message: e instanceof Error ? e.message : "历史读取失败，请重试",
        });
      }
    } finally {
      if (currentArchiveKey.current === archiveKey) setHistoryLoadingKey("");
    }
  }

  // Auto-select latest conversation on full page using replace: true to avoid back-button loops.
  useEffect(() => {
    if (
      !embedded &&
      !conversationID &&
      conversations.data?.[0] &&
      !composer.text &&
      !composer.attachments.length
    ) {
      selectConversation(conversations.data[0].id, true);
    }
  }, [
    embedded,
    conversationID,
    conversations.data,
    composer.text,
    composer.attachments.length,
    selectConversation,
  ]);

  // Reset transient per-conversation state when switching scope or conversation.
  useEffect(() => {
    setFollowing(true);
    anchor.current = null;
    setArchive({ key: "", pages: [] });
    updateLiveStream(null);
    setLiveStage(null);
  }, [scope, conversationID, updateLiveStream]);

  // Hydrate liveStream from snapshot so mid-turn reconnects resume delta streaming without polling fallback.
  useEffect(() => {
    const snap = latestSnapshot.data;
    if (!snap || snap.conversation.id !== conversationID) return;
    const activeRun = snap.runs.find((r) => r.state === "running");
    if (!activeRun) return;
    const serverText = activeRun.stream_text ?? "";
    const turn = activeRun.stream_turn ?? 0;
    const cur = liveStreamRef.current;
    if (
      !cur ||
      cur.conversationID !== conversationID ||
      cur.turn !== turn ||
      utf8ByteLength(cur.text) < utf8ByteLength(serverText)
    ) {
      updateLiveStream({
        conversationID,
        turn,
        text: serverText,
      });
    }
  }, [latestSnapshot.data, conversationID, updateLiveStream]);

  useEffect(() => {
    setSearchInput("");
    setDebouncedSearch("");
  }, [scope]);

  useEffect(() => {
    if (!latestSnapshot.data) return;
    setArchive((previous) => {
      if (previous.key !== archiveKey || !previous.pages.length) return previous;
      const merged = withHistory(latestSnapshot.data, [previous.pages[0]]);
      if (!merged) return previous;
      return {
        key: archiveKey,
        pages: [merged, ...previous.pages.slice(1)],
      };
    });
  }, [latestSnapshot.data, archiveKey]);

  useEffect(() => {
    if (
      drafts.ready &&
      drafts.dirty &&
      !Object.values(drafts.value).some(
        (d) => d.text || d.attachments.length || d.requestID,
      )
    ) {
      drafts.reset(emptyDrafts);
    }
  }, [drafts.value, drafts.ready, drafts.dirty, drafts.reset]);

  useEffect(() => {
    if (
      drafts.ready &&
      composer.requestID &&
      runs.some((r) => r.request_id === composer.requestID)
    ) {
      clearDraft(draftKey);
    }
  }, [snapshot.data, drafts.ready, composer.requestID, runs, draftKey]);

  // Track latest SSE event cursor per conversation so fresh streams never replay full history.
  const convKey = `${scope}:${conversationID}`;
  const lastEventIDRef = useRef<{ key: string; id: number }>({
    key: "",
    id: 0,
  });
  const streamReady = Boolean(
    courseID &&
      conversationID &&
      latestSnapshot.data?.conversation.id === conversationID,
  );
  useEffect(() => {
    if (lastEventIDRef.current.key !== convKey) {
      lastEventIDRef.current = { key: convKey, id: 0 };
    }
    if (latestSnapshot.data?.conversation.id === conversationID) {
      const serverCursor = latestSnapshot.data.latest_event_id ?? 0;
      if (serverCursor > lastEventIDRef.current.id) {
        lastEventIDRef.current = { key: convKey, id: serverCursor };
      }
    }
  }, [
    convKey,
    conversationID,
    latestSnapshot.data?.conversation.id,
    latestSnapshot.data?.latest_event_id,
  ]);

  useEffect(() => {
    if (!streamReady) return;
    const afterID =
      lastEventIDRef.current.key === convKey ? lastEventIDRef.current.id : 0;
    setStreamState("连接中");
    const stream = new EventSource(
      `/api/v1${prefix}/conversations/${conversationID}/events?after=${afterID}`,
    );
    let invalidateTimer: ReturnType<typeof setTimeout> | undefined;
    let errorFlashTimer: ReturnType<typeof setTimeout> | undefined;
    let silentReconnect = false;

    const recordCursor = (e: Event) => {
      const idStr = (e as MessageEvent).lastEventId;
      if (idStr) {
        const parsed = Number.parseInt(idStr, 10);
        if (
          !Number.isNaN(parsed) &&
          lastEventIDRef.current.key === convKey &&
          parsed > lastEventIDRef.current.id
        ) {
          lastEventIDRef.current = { key: convKey, id: parsed };
        }
      }
    };

    const scheduleInvalidate = (delay = 250) => {
      if (invalidateTimer) return;
      invalidateTimer = setTimeout(() => {
        invalidateTimer = undefined;
        void invalidate(conversationID);
      }, delay);
    };

    const onText = (e: Event) => {
      recordCursor(e);
      try {
        const payload = JSON.parse((e as MessageEvent).data || "{}") as {
          turn?: number;
          text?: string;
          delta?: string;
          offset?: number;
        };
        const turn = payload.turn ?? 0;
        if (typeof payload.text === "string") {
          updateLiveStream({
            conversationID,
            turn,
            text: payload.text,
          });
        } else if (typeof payload.delta === "string") {
          const cur = liveStreamRef.current;
          if (
            cur &&
            cur.conversationID === conversationID &&
            cur.turn === turn &&
            typeof payload.offset === "number" &&
            utf8ByteLength(cur.text) === payload.offset
          ) {
            updateLiveStream({
              conversationID,
              turn,
              text: cur.text + payload.delta,
            });
          } else {
            scheduleInvalidate(100);
          }
        }
      } catch {
        // Ignore malformed chunk.
      }
    };

    const onStatus = (e: Event) => {
      recordCursor(e);
      try {
        const payload = JSON.parse((e as MessageEvent).data || "{}") as {
          state?: string;
        };
        const nextState = payload.state || "";
        if (nextState === "waiting_job") {
          setLiveStage({ conversationID, label: "正在等待后台任务完成…" });
        } else if (nextState === "running") {
          setLiveStage({ conversationID, label: "正在思考与执行…" });
        } else {
          updateLiveStream(null);
          setLiveStage(null);
        }
      } catch {
        // Fallback to snapshot refresh.
      }
      scheduleInvalidate(200);
    };

    const onDelegated = (e: Event) => {
      recordCursor(e);
      try {
        const payload = JSON.parse((e as MessageEvent).data || "{}") as {
          domain?: string;
        };
        if (payload.domain) {
          setLiveStage({
            conversationID,
            label: `已委派${domains[payload.domain] || payload.domain}处理…`,
          });
        }
      } catch {
        // Ignore malformed payload.
      }
      scheduleInvalidate(300);
    };

    const onStructural = (e: Event) => {
      recordCursor(e);
      if (e.type === "tool") {
        updateLiveStream(null);
        scheduleInvalidate(250);
      } else if (e.type === "done") {
        updateLiveStream(null);
        setLiveStage(null);
        void cache.invalidateQueries({ queryKey: ["live", courseID] });
        scheduleInvalidate(100);
      } else {
        scheduleInvalidate(250);
      }
    };

    const onReconnect = () => {
      silentReconnect = true;
      if (errorFlashTimer) {
        clearTimeout(errorFlashTimer);
        errorFlashTimer = undefined;
      }
      stream.close();
      setStreamNonce((n) => n + 1);
    };

    const onAuthError = () => {
      silentReconnect = true;
      stream.close();
      setStreamState("会话已失效");
      void refresh();
    };

    stream.onopen = () => {
      if (errorFlashTimer) {
        clearTimeout(errorFlashTimer);
        errorFlashTimer = undefined;
      }
      setStreamState("实时连接");
    };

    stream.onerror = () => {
      if (silentReconnect) return;
      if (stream.readyState === EventSource.CLOSED) {
        setStreamState("连接已断开");
        return;
      }
      if (!errorFlashTimer) {
        errorFlashTimer = setTimeout(() => {
          errorFlashTimer = undefined;
          setStreamState("重连中 · 定时同步");
        }, 4000);
      }
    };

    stream.addEventListener("text", onText);
    stream.addEventListener("status", onStatus);
    stream.addEventListener("delegated", onDelegated);
    stream.addEventListener("reconnect", onReconnect);
    stream.addEventListener("auth_error", onAuthError);
    for (const ev of ["tool", "plan", "request", "response", "done"]) {
      stream.addEventListener(ev, onStructural);
    }

    return () => {
      silentReconnect = true;
      stream.close();
      if (invalidateTimer) clearTimeout(invalidateTimer);
      if (errorFlashTimer) clearTimeout(errorFlashTimer);
    };
  }, [
    streamReady,
    convKey,
    prefix,
    conversationID,
    courseID,
    streamNonce,
    invalidate,
    updateLiveStream,
    cache,
    refresh,
  ]);

  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el) return;
    if (anchor.current) {
      el.scrollTop = anchor.current.top + el.scrollHeight - anchor.current.height;
      anchor.current = null;
    } else if (following) {
      el.scrollTop = el.scrollHeight;
    }
  }, [latestSnapshot.data, archive, liveStream?.text, following, conversationID]);

  const embeddedMissing404 =
    embedded &&
    Boolean(conversationID) &&
    snapshot.error instanceof APIError &&
    snapshot.error.status === 404;

  const activeError = status.error || conversations.error || snapshot.error;

  const workspace = (
    <div className={`agent-workspace${embedded ? " agent-embedded" : ""}`}>
      {!embedded && (
        <aside className="agent-conversations">
          <Button
            block
            type="primary"
            icon={<Plus size={14} aria-hidden="true" />}
            disabled={busy || !configured || !drafts.ready}
            onClick={() => void runAction(() => createConversationRecord(false))}
          >
            新对话
          </Button>
          <Input
            aria-label="搜索对话"
            placeholder="搜索对话"
            allowClear
            maxLength={66}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <List
            loading={conversations.isPending}
            dataSource={conversations.data || []}
            locale={{
              emptyText: debouncedSearch ? "没有匹配的对话" : "暂无对话",
            }}
            renderItem={(c) => {
              const hasDraft = Boolean(
                drafts.value[c.id]?.text ||
                  drafts.value[c.id]?.attachments.length,
              );
              return (
                <List.Item>
                  <Button
                    data-conversation-id={c.id}
                    disabled={busy}
                    title={c.title}
                    type={c.id === conversationID ? "text" : "default"}
                    aria-current={c.id === conversationID ? "page" : undefined}
                    className={c.id === conversationID ? "agent-selected" : ""}
                    block
                    onClick={() => selectConversation(c.id)}
                  >
                    <span>{c.title}</span>
                    {isTeacher && c.learner_context && <Tag>含学情</Tag>}
                    {hasDraft ? <Tag>草稿</Tag> : null}
                  </Button>
                </List.Item>
              );
            }}
          />
          {conversationPages.hasNextPage && (
            <Button
              block
              loading={conversationPages.isFetchingNextPage}
              onClick={() => void conversationPages.fetchNextPage()}
            >
              加载更多对话
            </Button>
          )}
        </aside>
      )}
      <section className="agent-main" aria-label="课程助理对话">
        <div className="agent-toolbar">
          {embedded && (
            <Space wrap>
              <Tag>当前：{context?.title}</Tag>
              <Button
                disabled={busy || !!active || !configured || !drafts.ready}
                onClick={() =>
                  void runAction(() => createConversationRecord(false))
                }
              >
                为此对象新建对话
              </Button>
              {conversationID && (
                <Link
                  to={`/${isTeacher ? "teacher" : "student"}/assistant?conversation=${encodeURIComponent(conversationID)}`}
                >
                  完整会话记录
                </Link>
              )}
            </Space>
          )}
          <Space wrap>
            <Select
              aria-label="对话模型"
              placeholder="选择模型"
              value={
                current?.profile_id ||
                status.data?.profiles.find((p) => p.available)?.id
              }
              disabled={!current || !!active || busy}
              onChange={(profile_id) => {
                if (!current) return;
                void runAction(() =>
                  write(
                    `/conversations/${conversationID}`,
                    { mode: current.mode, profile_id },
                    "PATCH",
                  ),
                );
              }}
              options={status.data?.profiles.map((p) => ({
                value: p.id,
                label: p.label,
                disabled: !p.available,
              }))}
            />
            <Tooltip title="只读不写入；自动审查允许草稿并确认重要修改；完整操作仍须确认正式发布和成绩。">
              <Select
                aria-label="权限模式"
                value={current?.mode || "auto-review"}
                disabled={!current || !!active || busy}
                options={modes.filter(
                  (m) => isTeacher || m.value !== "full-access",
                )}
                onChange={(mode) => {
                  if (!current) return;
                  void runAction(() =>
                    write(
                      `/conversations/${conversationID}`,
                      { mode, profile_id: current.profile_id },
                      "PATCH",
                    ),
                  );
                }}
              />
            </Tooltip>
            {active && (
              <span role="status">
                <StateTag state={active.state} />
              </span>
            )}
            {conversationID && (
              <Space size={4}>
                {!configured ? (
                  <Tag className="ui-meta-tag">未配置模型</Tag>
                ) : (
                  <Tag
                    color={
                      streamState === "实时连接"
                        ? "success"
                        : streamState === "连接已断开" ||
                            streamState === "会话已失效"
                          ? "error"
                          : "default"
                    }
                  >
                    {streamState}
                  </Tag>
                )}
                {configured && streamState === "连接已断开" && (
                  <Button
                    size="small"
                    onClick={() => setStreamNonce((n) => n + 1)}
                  >
                    重连
                  </Button>
                )}
              </Space>
            )}
          </Space>
          {active && (
            <Popconfirm
              title="停止后保留已完成的操作，已发出的模型调用仍会记账。"
              onConfirm={() =>
                void runAction(() => write(`/runs/${active.id}/cancel`, {}))
              }
            >
              <Button danger disabled={busy || active.cancel_requested}>
                {active.cancel_requested ? "正在停止" : "停止"}
              </Button>
            </Popconfirm>
          )}
        </div>
        {activeError && (
          <Alert
            showIcon
            type="error"
            role="alert"
            message={activeError.message}
            action={
              <Space wrap>
                {embeddedMissing404 && (
                  <Button
                    size="small"
                    type="primary"
                    onClick={() => selectConversation("")}
                  >
                    重新开始对话
                  </Button>
                )}
                <Button
                  size="small"
                  onClick={() => {
                    void invalidate();
                    void status.refetch();
                  }}
                >
                  重试
                </Button>
              </Space>
            }
          />
        )}
        {status.data && !configured && (
          <Alert
            showIcon
            type="warning"
            message="暂无可用生成模型，请联系维护者检查服务端配置。"
          />
        )}
        {isTeacher && current?.learner_context && (
          <Alert
            showIcon
            type="info"
            message="本对话已读取学习或作答数据；出题与评分标准请使用独立新对话。"
            action={
              <Button
                size="small"
                disabled={busy || !configured || !drafts.ready}
                onClick={() =>
                  void runAction(() => createConversationRecord(false))
                }
              >
                新建独立对话
              </Button>
            }
          />
        )}
        <div className="agent-scroll-wrap">
          <div
            className="agent-scroll"
            ref={scroll}
            onScroll={() => {
              const el = scroll.current;
              if (!el) return;
              setFollowing(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
            }}
          >
            {snapshot.data?.has_more && (
              <Button
                block
                loading={historyLoadingKey === archiveKey}
                onClick={() => void loadHistory()}
              >
                加载更早记录
              </Button>
            )}
            {historyError?.key === archiveKey && (
              <Alert
                type="error"
                showIcon
                message={historyError.message}
                action={
                  <Button size="small" onClick={() => void loadHistory()}>
                    重试
                  </Button>
                }
              />
            )}
            {snapshot.isPending && conversationID ? (
              <LoadingState label="正在读取会话…" />
            ) : !timeline.length ? (
              <Empty description="发送要求或上传资料，开始处理当前课程任务" />
            ) : (
              timeline.map((item) => {
                if (item.kind === "message") {
                  const m = item.value;
                  const parsed =
                    m.role === "user"
                      ? splitVerifiedContext(m.content)
                      : { body: m.content, chip: null };
                  return (
                    <article
                      key={m.id}
                      data-message-id={m.id}
                      className={`agent-message agent-message-${m.role}`}
                    >
                      <Typography.Text strong>
                        {m.role === "user" ? "你" : "课程助理"}
                      </Typography.Text>
                      {parsed.body && <RichContent text={parsed.body} />}
                      {parsed.chip && (
                        <div className="agent-context-chip">
                          <Tooltip
                            title={
                              parsed.chip.id
                                ? `服务端已核验对象：${parsed.chip.id}`
                                : "服务端已核验访问权限"
                            }
                          >
                            <Tag color="cyan">
                              上下文：{parsed.chip.kindLabel}
                            </Tag>
                          </Tooltip>
                        </div>
                      )}
                      {!!m.attachment_ids?.length && (
                        <Space wrap>
                          {m.attachment_ids.map((id) => {
                            const filename =
                              allAttachments.find((a) => a.id === id)
                                ?.filename || "下载附件";
                            const url = fileURL(id);
                            return (
                              <Tag key={id}>
                                <Typography.Link
                                  href={url}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    void downloadFromURL(url, filename);
                                  }}
                                >
                                  {filename}
                                </Typography.Link>
                              </Tag>
                            );
                          })}
                        </Space>
                      )}
                    </article>
                  );
                }
                const run = item.value;
                const runSteps = (snapshot.data?.steps || []).filter(
                  (s) => s.run_id === run.id,
                );
                const runRequests = (snapshot.data?.requests || []).filter(
                  (r) => r.run_id === run.id,
                );
                const isLiveRun = active?.id === run.id;
                return (
                  <RunPanel
                    key={run.id}
                    run={run}
                    steps={runSteps}
                    requests={runRequests}
                    toolLabels={toolLabels}
                    disabled={busy}
                    hasActive={!!active}
                    liveText={
                      isLiveRun && liveStream?.conversationID === conversationID
                        ? liveStream.text
                        : undefined
                    }
                    liveStage={
                      isLiveRun && liveStage?.conversationID === conversationID
                        ? liveStage.label
                        : undefined
                    }
                    respond={(id, decision, values) =>
                      runAction(() =>
                        write(`/requests/${id}/respond`, {
                          decision,
                          values: values || {},
                        }),
                      )
                    }
                    resume={() =>
                      runAction(() => write(`/runs/${run.id}/resume`, {}))
                    }
                    onDownload={(url, filename) =>
                      void downloadFromURL(url, filename)
                    }
                  />
                );
              })
            )}
            {!!exports.length && (
              <List
                className="agent-exports"
                size="small"
                header={<Typography.Text strong>导出文件</Typography.Text>}
                dataSource={exports}
                renderItem={(file) => {
                  const url = fileURL(file.id);
                  return (
                    <List.Item
                      actions={[
                        <Button
                          key="download"
                          href={url}
                          onClick={(e) => {
                            e.preventDefault();
                            void downloadFromURL(url, file.filename);
                          }}
                        >
                          下载
                        </Button>,
                      ]}
                    >
                      <Typography.Text>{file.filename}</Typography.Text>
                    </List.Item>
                  );
                }}
              />
            )}
          </div>
          {!following && (
            <Button
              className="agent-jump"
              size="small"
              onClick={() => setFollowing(true)}
            >
              回到最新
            </Button>
          )}
        </div>
        <Form className="agent-composer" onFinish={() => void send()}>
          {(composer.text || composer.attachments.length > 0) && (
            <DraftNotice
              restored={drafts.restored}
              storageError={drafts.storageError}
              onDiscard={() => clearDraft(draftKey)}
            />
          )}
          {!!composer.attachments.length && (
            <Space wrap>
              {composer.attachments.map((a) => (
                <Tag
                  key={a.id}
                  closable={!busy}
                  onClose={() =>
                    updateComposer({
                      attachments: composer.attachments.filter(
                        (x) => x.id !== a.id,
                      ),
                    })
                  }
                >
                  {a.filename}
                </Tag>
              ))}
            </Space>
          )}
          <Input.TextArea
            aria-label="消息"
            placeholder={
              active?.state === "waiting_input"
                ? "请先回答当前问题"
                : active?.state === "waiting_approval"
                  ? "请先确认或拒绝当前操作"
                  : active
                    ? "任务执行中，可查看执行记录或停止"
                    : "输入要求，或上传需要导入的文件"
            }
            value={drafts.ready ? composer.text : ""}
            maxLength={12000}
            status={bytes > 12000 ? "error" : undefined}
            autoSize={{ minRows: 3, maxRows: 8 }}
            disabled={inputDisabled}
            onChange={(e) => updateComposer({ text: e.target.value })}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                (e.ctrlKey || e.metaKey) &&
                !e.nativeEvent.isComposing &&
                e.keyCode !== 229
              ) {
                e.preventDefault();
                void send();
              }
            }}
          />
          {bytes > 12000 && (
            <Typography.Text type="danger" role="alert">
              消息超过12000字节，请缩短后发送。
            </Typography.Text>
          )}
          <div className="agent-compose-actions">
            <Space wrap>
              <Upload
                accept=".pdf,.docx,.pptx,.txt,.md,.html,.htm,.csv"
                showUploadList={false}
                disabled={inputDisabled || composer.attachments.length >= 10}
                beforeUpload={(file) => {
                  if (mutationLocked.current) return Upload.LIST_IGNORE;
                  if (!file.size || file.size > MAX_FILE_BYTES) {
                    void message.error("文件须为非空且不超过30MiB");
                    return Upload.LIST_IGNORE;
                  }
                  const ext = getFileExtension(file.name);
                  if (!ALLOWED_EXTENSIONS.has(ext)) {
                    void message.error(
                      "仅支持 PDF、DOCX、PPTX、TXT、MD、HTML 与 CSV 文件",
                    );
                    return Upload.LIST_IGNORE;
                  }
                  const existingUploads = allAttachments.filter(
                    (a) => a.kind === "upload",
                  );
                  if (existingUploads.length >= MAX_CONVERSATION_FILES) {
                    void message.error("本对话上传附件数量已达 30 份上限");
                    return Upload.LIST_IGNORE;
                  }
                  const existingBytes = existingUploads.reduce(
                    (sum, a) => sum + (a.size_bytes || 0),
                    0,
                  );
                  if (existingBytes + file.size > MAX_CONVERSATION_BYTES) {
                    void message.error("本对话上传附件总大小超过 150MiB 上限");
                    return Upload.LIST_IGNORE;
                  }
                  void runAction(async () => {
                    setUploading(true);
                    try {
                      let id = conversationID;
                      let createdNow = false;
                      if (!id) {
                        id = await createConversationRecord(true, false);
                        createdNow = true;
                      }
                      const body = new FormData();
                      body.append("file", file);
                      let a: Attachment;
                      try {
                        a = (
                          await requestJSON<{ data: Attachment }>(
                            `${prefix}/conversations/${id}/attachments`,
                            { method: "POST", body },
                            session?.csrf_token,
                          )
                        ).data;
                      } catch (err) {
                        if (createdNow && scope === currentScope.current) {
                          selectConversation(id);
                        }
                        throw err;
                      }
                      if (scope === currentScope.current) {
                        drafts.change((all) => ({
                          ...all,
                          [id]: {
                            ...(all[id] || emptyDraft),
                            attachments: [...(all[id]?.attachments || []), a],
                            requestID: undefined,
                          },
                        }));
                        if (createdNow) selectConversation(id);
                      }
                      return id;
                    } finally {
                      setUploading(false);
                    }
                  });
                  return false;
                }}
              >
                <Button
                  icon={<Paperclip size={14} aria-hidden="true" />}
                  loading={uploading}
                  disabled={inputDisabled || composer.attachments.length >= 10}
                >
                  上传文件
                </Button>
              </Upload>
              {!!reusable.length && (
                <Dropdown
                  menu={{
                    items: reusable.map((a) => ({
                      key: a.id,
                      label: a.filename,
                    })),
                    onClick: ({ key: attachmentKey }) => {
                      const found = reusable.find(
                        (a) => a.id === attachmentKey,
                      );
                      if (found) {
                        updateComposer({
                          attachments: [...composer.attachments, found],
                        });
                      }
                    },
                  }}
                  disabled={inputDisabled || composer.attachments.length >= 10}
                >
                  <Button
                    disabled={inputDisabled || composer.attachments.length >= 10}
                  >
                    已上传文件
                  </Button>
                </Dropdown>
              )}
            </Space>
            <div className="agent-compose-right">
              <span className="agent-byte-count">{bytes} / 12000 字节</span>
              <Button
                htmlType="submit"
                type="primary"
                icon={<Send size={14} aria-hidden="true" />}
                loading={busy && !uploading}
                disabled={
                  inputDisabled ||
                  bytes > 12000 ||
                  (!composer.text.trim() && !composer.attachments.length)
                }
              >
                发送
              </Button>
            </div>
          </div>
        </Form>
      </section>
    </div>
  );

  if (embedded) return workspace;
  return (
    <div className="live-page is-wide-workspace">
      <PageHeader
        title="课程助理"
        subtitle={course?.title}
        meta={
          !status.isPending && !configured ? (
            <Tag className="ui-meta-tag">未配置模型</Tag>
          ) : undefined
        }
      />
      {workspace}
    </div>
  );
}
