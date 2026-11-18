import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Alert, App, Button, Card, Collapse, Dropdown, Empty, Form, Input, List, Popconfirm, Radio, Select, Space, Spin, Tag, Tooltip, Typography, Upload } from "antd";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { APIError, requestJSON } from "../shared/api";
import { useSession } from "../shared/session";
import { Link, useLearning } from "./context";
import type { BusinessContext } from "./context-agent";
import { RichContent } from "./content-render";
import { DraftNotice, useEditorDraft } from "./editing";
import "./agent.css";
import { AgentEditor, type EditorTarget } from "./agent-editor";

type Conversation = { id: string; title: string; mode: string; profile_id: string; learner_context: boolean };
type Attachment = { id: string; filename: string; kind: string; size_bytes: number };
type Run = { id: string; request_id: string; state: string; error: string; cancel_requested: boolean; can_resume: boolean; created_at: string; stream_text?: string; stream_turn?: number };
type Step = { id: string; run_id: string; agent: string; tool: string; state: string; arguments: Record<string, unknown>; result: Record<string, unknown> };
type Field = { key: string; label: string; kind: string; required: boolean; options?: string[] };
type Request = { id: string; run_id: string; step_id: string; kind: string; prompt: string; fields: Field[]; snapshot: { arguments?: Record<string, unknown>; before?: unknown; editor?: EditorTarget }; response: Record<string, unknown>; state: string; expires_at: string };
type Message = { id: string; role: string; content: string; attachment_ids: string[]; created_at: string };
type Snapshot = { conversation: Conversation; messages: Message[]; runs: Run[]; steps: Step[]; requests: Request[]; attachments: Attachment[]; has_more: boolean; next_cursor: string };
type Status = { configured: boolean; profiles: { id: string; label: string; available: boolean; model: string }[]; tools: { name: string; label: string }[] };
type ComposerDraft = { text: string; attachments: Attachment[]; requestID?: string };
const emptyDraft: ComposerDraft = { text: "", attachments: [] };
const emptyDrafts: Record<string, ComposerDraft> = {};

function uniqueRows<T extends { id: string }>(rows: T[]) {
  const seen = new Set<string>();
  return rows.filter(row => { if (seen.has(row.id)) return false; seen.add(row.id); return true; });
}
function withHistory(latest: Snapshot | undefined, older: Snapshot[]): Snapshot | undefined {
  if (!latest) return latest;
  const pages = [latest, ...older];
  const oldest = pages[pages.length - 1];
  return { ...latest, has_more: oldest.has_more, next_cursor: oldest.next_cursor,
    messages: uniqueRows(pages.flatMap(p => p.messages)), runs: uniqueRows(pages.flatMap(p => p.runs)),
    steps: uniqueRows(pages.flatMap(p => p.steps)), requests: uniqueRows(pages.flatMap(p => p.requests)),
    attachments: uniqueRows(pages.flatMap(p => p.attachments)),
  };
}

const states: Record<string, [string, string]> = {
  queued: ["排队中", "default"], running: ["执行中", "processing"], waiting_input: ["等待回答", "warning"], waiting_approval: ["等待确认", "warning"], waiting_job: ["等待后台任务", "processing"], succeeded: ["已结束", "success"], failed: ["失败", "error"], canceled: ["已停止", "default"], unknown: ["结果待核对", "warning"], proposed: ["准备中", "default"], executing: ["执行中", "processing"], denied: ["未执行", "default"], pending: ["待处理", "warning"], answered: ["已确认", "success"], rejected: ["已拒绝", "default"], expired: ["已过期", "default"],
};
const domains: Record<string, string> = { coordinator: "协调", materials: "资料与知识", questions: "题目与标准", assessment: "作业与评阅", learning: "学习支持" };
const modes = [{ value: "read-only", label: "只读" }, { value: "auto-review", label: "自动审查" }, { value: "full-access", label: "完整操作" }];
const isActive = (s: string) => ["queued", "running", "waiting_input", "waiting_approval", "waiting_job"].includes(s);
function StateTag({ state }: { state: string }) { const [text, color] = states[state] || [state, "default"]; return <Tag color={color}>{text}</Tag>; }
const labels: Record<string, string> = { id: "编号", title: "标题", content: "内容", body: "正文", name: "名称", state: "状态", status: "状态", response: "业务回执", data: "数据", http_status: "响应码", source_note: "来源说明", allow_derived: "允许提炼", fragment_ids: "所选片段", knowledge_point_id: "知识点", attachment_id: "附件", source_id: "原件", question_id: "题目版本", rubric_id: "标准", score: "得分", max_score: "满分", feedback: "反馈", points: "逐点反馈", criteria: "评分标准", prompt: "题干", requirements: "要求", reference_answer: "参考解答", evidence_ids: "依据", job: "处理任务", kind: "类型", error: "问题", message: "提示", summary: "处理结果", domain: "领域", filename: "文件名", download_url: "下载文件", rows: "记录数", fragments: "原文片段", revision: "修订", edit_version: "编辑版本", conditions: "适用条件", reason: "原因", related_ids: "关联条目", tags: "标签", topic_ids: "专题", student_id: "学生", fields: "问题", steps: "计划", truncated: "已截断", total: "总数" };
function ValueView({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || value === undefined) return <Typography.Text type="secondary">无</Typography.Text>;
  if (typeof value === "boolean") return <Tag>{value ? "是" : "否"}</Tag>;
  if (typeof value !== "object") return <span className="agent-value">{String(value)}</span>;
  if (depth > 4) return <Typography.Text type="secondary">请打开业务页面查看完整内容</Typography.Text>;
  if (Array.isArray(value)) return value.length ? <ol className="agent-value-list">{value.slice(0, 30).map((v, i) => <li key={i}><ValueView value={v} depth={depth + 1} /></li>)}</ol> : <Typography.Text type="secondary">无</Typography.Text>;
  return <dl className="agent-values">{Object.entries(value).filter(([key]) => key !== "business_hash").map(([key, v]) => <div key={key}><dt>{labels[key] || key}</dt><dd>{key === "download_url" && typeof v === "string" && /^\/api\/v1\/learning\/courses\/[\w-]+\/agent\/conversations\/[\w-]+\/attachments\/[\w-]+\/file$/.test(v) ? <Typography.Link href={v}>下载反馈 CSV</Typography.Link> : <ValueView value={v} depth={depth + 1} />}</dd></div>)}</dl>;
}

function RequestCard({ request, disabled, respond }: { request: Request; disabled: boolean; respond: (id: string, decision: string, values?: Record<string, unknown>) => Promise<boolean> }) {
  const [form] = Form.useForm();
  const expired = new Date(request.expires_at).getTime() <= Date.now();
  const pending = request.state === "pending" && !expired;
  const savedEditor = request.state === "answered" && request.response.editor ? request.response.editor as EditorTarget : undefined;
  const savedPath = savedEditor ? ({source:`/teacher/materials?source=${savedEditor.id}`,knowledge:`/teacher/knowledge?knowledge=${savedEditor.id}`,question:`/teacher/question-bank?bank=${savedEditor.id}`,curriculum:"/teacher/curriculum",import:`/teacher/homework/${savedEditor.id}/submissions`,diagnosis:`/teacher/insight?view=gaps&diagnosis_report=${savedEditor.id}`,paper:`/teacher/question-bank?paper_source=${savedEditor.id}`} as Record<string,string>)[savedEditor.kind] : undefined;
  useEffect(() => { if (request.state === "answered") form.setFieldsValue(request.response); }, [request.state, request.response, form]);
  return <Card size="small" className="agent-request" title={<Space wrap><Tag color={request.kind === "input" ? "blue" : "orange"}>{request.kind === "input" ? "需要补充" : "操作确认"}</Tag><span>{request.prompt}</span></Space>} extra={<StateTag state={expired && request.state === "pending" ? "expired" : request.state} />}>
    {request.snapshot.editor ? <Space direction="vertical"><Tag>{request.snapshot.editor.kind === "question" ? "题目与标准" : "业务工作台"}</Tag>{pending && <Space wrap><AgentEditor target={request.snapshot.editor} disabled={disabled} complete={() => respond(request.id, "approve")} /><Button disabled={disabled} onClick={() => void respond(request.id, "reject")}>暂不编辑</Button></Space>}{savedPath && <Space wrap><Typography.Text>{request.response.changed ? "服务端已重新读取保存结果" : "未检测到服务端对象变化"}</Typography.Text><Link to={savedPath}>打开已核对对象</Link></Space>}</Space> : request.kind === "input" ? <Form name={`agent-input-${request.id}`} form={form} layout="vertical" disabled={!pending || disabled} onFinish={(values) => void respond(request.id, "approve", values)}>
      {request.fields.map((f) => <Form.Item key={f.key} name={f.key} label={f.label} rules={[{ required: f.required, message: "请填写或选择此项" }]}>
        {f.kind === "text" ? <Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} maxLength={10000} /> : f.kind === "select" ? <Radio.Group options={f.options?.map((x) => ({ label: x, value: x }))} /> : <Select mode="multiple" options={f.options?.map((x) => ({ label: x, value: x }))} />}
      </Form.Item>)}
      {pending && <Space><Button type="primary" htmlType="submit" loading={disabled}>提交回答</Button><Button onClick={() => void respond(request.id, "reject")} disabled={disabled}>暂不提供</Button></Space>}
    </Form> : <>
      <ValueView value={request.snapshot.arguments} />
      {request.snapshot.before !== undefined && <Collapse ghost items={[{ key: "before", label: "查看当前业务对象", children: <ValueView value={request.snapshot.before} /> }]} />}
      {pending && <Space wrap><Button type="primary" disabled={disabled} loading={disabled} onClick={() => void respond(request.id, "approve")}>确认执行</Button><Button disabled={disabled} onClick={() => void respond(request.id, "reject")}>拒绝</Button><Typography.Text type="secondary">仅批准本卡列出的操作</Typography.Text></Space>}
    </>}
  </Card>;
}

function RunPanel({ run, steps, requests, toolLabels, disabled, hasActive, respond, resume }: {
  run: Run; steps: Step[]; requests: Request[]; toolLabels: Map<string, string>;
  disabled: boolean; hasActive: boolean;
  respond: (id: string, decision: string, values?: Record<string, unknown>) => Promise<boolean>;
  resume: () => Promise<boolean>;
}) {
  const pending = requests.filter((r) => r.state === "pending" && isActive(run.state));
  const completed = requests.filter((r) => !pending.includes(r));
  const card = (r: Request) => <RequestCard key={r.id} request={r} disabled={disabled || !isActive(run.state) || run.cancel_requested} respond={respond} />;
  return <div className="agent-run" data-run-id={run.id}>
    <ResultCards steps={steps} />
    {!!run.stream_text && ["running", "failed", "canceled", "unknown"].includes(run.state) && <Card size="small" className="agent-stream" title={<Tag color={run.state === "running" ? "processing" : "warning"}>{run.state === "running" ? "正在生成" : "生成中断 · 以下为未完成内容"}</Tag>}><RichContent text={run.stream_text} /></Card>}
    <Collapse size="small" items={[{ key: run.id, label: <Space wrap><StateTag state={run.state} /><span>执行记录</span><Typography.Text type="secondary">{steps.length} 步</Typography.Text></Space>, children:
      <Space direction="vertical" className="agent-full-width">{steps.map((step) => <Collapse key={step.id} size="small" items={[{
        key: step.id, label: <Space wrap><Tag>{domains[step.agent] || step.agent}</Tag><span>{toolLabels.get(step.tool) || step.tool}</span><StateTag state={step.state} /></Space>,
        children: <><Typography.Text strong>操作内容</Typography.Text><ValueView value={step.arguments} /><Typography.Text strong>执行回执</Typography.Text><ValueView value={step.result} /></>,
      }]} />)}</Space>,
    }]} />
    {run.error && <Alert showIcon type={run.state === "unknown" ? "warning" : "error"} message={run.error} />}
    {run.state === "succeeded" && steps.some((s) => ["failed", "denied", "unknown"].includes(s.state)) && <Alert showIcon type="warning" message="本轮包含失败或未执行的操作，请展开记录核对。" />}
    {run.can_resume && !hasActive && <Popconfirm title="从检查点恢复，模型请求可能再次计费；未知写操作会被拒绝重放。" onConfirm={resume}><Button disabled={disabled}>从检查点恢复</Button></Popconfirm>}
    {pending.map(card)}
    {!!completed.length && <Collapse size="small" items={[{ key: "completed", label: `已处理的确认与补充（${completed.length}）`, children: <Space direction="vertical" className="agent-full-width">{completed.map(card)}</Space> }]} />}
  </div>;
}

function ResultCards({steps}: {steps: Step[]}) {
  const {session} = useSession();
  const role = session?.user.role === "teacher" ? "teacher" : "student";
  const cards: {key:string;title:string;state:string;path:string}[] = [];
  for (const step of steps) {
    if (step.state !== "succeeded") continue;
    const status = step.result.http_status;
    const response = step.result.response as {data?: unknown} | undefined;
    const data = typeof status === "number" && status >= 200 && status < 300 ? response?.data : step.tool === "job_wait" ? step.result.job : undefined;
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    for (const [index,value] of rows.entries()) {
      if (!value || typeof value !== "object") continue;
      const row = value as Record<string,unknown>;
      if (typeof row.id !== "string") continue;
      const id = encodeURIComponent(row.id);
      let path = "", title = "";
      if (typeof row.kind === "string" && typeof row.progress === "number" && row.input) {
        const input = row.input as Record<string, unknown>;
        path = role === "teacher" ? `/teacher/materials?source_view=tasks${typeof input.source_id === "string" ? `&source=${encodeURIComponent(input.source_id)}` : ""}` : "";
        title = "后台处理任务";
      } else if (/^resource_(create|revision|publish)$|^source_publish$/.test(step.tool)) {
        path = `/${role}/${role === "teacher" ? "materials?tab=published" : "course-content?"}&resource=${id}`; title = "学习资料";
      } else if (/^knowledge_(create|update|state|decide)$/.test(step.tool)) {
        path = `/${role}/knowledge?knowledge=${id}`; title = "知识条目";
      } else if (/^question_(create|revision|confirm)$|^reference_confirm$/.test(step.tool)) {
        path = `/teacher/question-bank?bank_version=${id}`; title = "题目版本";
      } else if (/^rubric_(create|confirm)$/.test(step.tool) && typeof row.bank_question_version_id === "string") {
        path = `/teacher/question-bank?bank_version=${encodeURIComponent(row.bank_question_version_id)}`; title = "评分标准";
      } else if (step.tool === "answer_submit" || /^(grade_save|grade_state)$/.test(step.tool) && typeof row.submission_id === "string") {
        path = `/${role}/homework/submissions/${encodeURIComponent(step.tool === "answer_submit" ? row.id : row.submission_id as string)}/${role === "teacher"?"grade":"feedback"}`; title = "作答与评分";
      } else if (/^assignment_(create|update|state)$/.test(step.tool)) {
        path = `/${role}/homework/${id}`; title = "作业";
      } else if (/^intervention_(create|state)$/.test(step.tool)) {
        path = `/${role}/intervention?task=${id}`; title = "补学补练任务";
      } else if (/^regrade_(create|state)$/.test(step.tool)) {
        path = `/teacher/regrades?batch=${id}`; title = "整组重评批次";
      } else if (row.kind === "diagnosis" || row.kind === "recommendation") {
        path = row.kind === "diagnosis" ? `/teacher/insight?view=gaps&diagnosis_report=${id}` : `/student/learning?recommendation_report=${id}`; title = "分析报告";
      }
      if (path) cards.push({key:`${step.id}:${index}`, title: typeof row.title === "string" ? `${title} · ${row.title}` : title, state: String(row.state || row.status || "已保存"), path});
    }
  }
  return cards.length ? <div className="agent-result-cards" aria-label="业务处理回执">{cards.map(card=><Card key={card.key} size="small"><Space wrap><Typography.Text strong>{card.title}</Typography.Text><Tag>{({draft:"草稿已保存",published:"已发布",confirmed:"已确认",archived:"已归档",assigned:"已下发"} as Record<string,string>)[card.state] || states[card.state]?.[0] || card.state}</Tag><Link to={card.path}>打开业务对象</Link></Space></Card>)}</div> : null;
}

export function AgentPage({embedded = false, context}: {embedded?: boolean; context?: BusinessContext} = {}) {
  const { course } = useLearning();
  const { session, refresh } = useSession();
  const cache = useQueryClient();
  const { message } = App.useApp();
  const [params, setParams] = useSearchParams();
  const associationKey = `haji-agent-context:${session?.user.id}:${course!.id}:${context?.kind}:${context?.id}`;
  const [localConversation, setLocalConversation] = useState(() => { try { return embedded ? sessionStorage.getItem(associationKey) || "" : ""; } catch { return ""; } });
  const conversationID = embedded ? localConversation : params.get("conversation") || "";
  const draftKey = conversationID || (context ? `new:${context.kind}:${context.id}` : "new");
  const drafts = useEditorDraft(embedded && context ? `agent:${course!.id}:${context.kind}:${context.id}` : `agent:${course!.id}`, emptyDrafts);
  const composer = drafts.value[draftKey] || emptyDraft;
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState("");
  const [archive, setArchive] = useState<{ key: string; pages: Snapshot[] }>({ key: "", pages: [] });
  const [historyLoadingKey, setHistoryLoadingKey] = useState("");
  const [historyError, setHistoryError] = useState<{ key: string; message: string } | null>(null);
  const anchor = useRef<{ top: number; height: number } | null>(null);
  const [following, setFollowing] = useState(true);
  const [streamState, setStreamState] = useState("连接中");
  const scroll = useRef<HTMLDivElement>(null);
  const mutationLocked = useRef(false);
  const scope = `${session?.user.id}:${course!.id}`;
  const archiveKey = `${scope}:${conversationID}`;
  const currentArchiveKey = useRef(archiveKey);
  currentArchiveKey.current = archiveKey;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const prefix = `/learning/courses/${course!.id}/agent`;
  const key = ["agent", session?.user.id, course!.id];
  const get = async <T,>(path: string, signal?: AbortSignal) => (await requestJSON<{ data: T }>(`${prefix}${path}`, { signal })).data;
  const write = async <T,>(path: string, body: unknown, method = "POST") => (await requestJSON<{ data: T }>(`${prefix}${path}`, { method, body: JSON.stringify(body) }, session?.csrf_token)).data;
  const status = useQuery({ queryKey: [...key, "status"], queryFn: ({ signal }) => get<Status>("/status", signal) });
  const conversationPages = useInfiniteQuery({ queryKey: [...key, "conversations", search], initialPageParam: 0,
    queryFn: async ({ signal, pageParam }) => {
      const rows = await get<Conversation[]>(`/conversations?${new URLSearchParams({ size: "31", offset: String(pageParam), search })}`, signal);
      return { rows: rows.slice(0, 30), more: rows.length > 30, offset: pageParam };
    }, getNextPageParam: page => page.more ? page.offset + 30 : undefined,
  });
  const conversations = { ...conversationPages, data: uniqueRows(conversationPages.data?.pages.flatMap(p => p.rows) || []) };
  const latestSnapshot = useQuery({ queryKey: [...key, conversationID], enabled: !!conversationID, queryFn: ({ signal }) => get<Snapshot>(`/conversations/${conversationID}`, signal), refetchInterval: 5000 });
  const snapshot = { ...latestSnapshot, data: withHistory(latestSnapshot.data, archive.key === archiveKey ? archive.pages : []) };
  const current = snapshot.data?.conversation;
  const runs = snapshot.data?.runs || [];
  const active = runs.find((r) => isActive(r.state));
  const toolLabels = new Map(status.data?.tools.map((t) => [t.name, t.label]));
  const configured = !!status.data?.configured && status.data.profiles.some((p) => p.available);
  const inputDisabled = busy || !!active || !configured || !drafts.ready || (!!conversationID && !current);
  const bytes = new TextEncoder().encode(composer.text).length;
  const allAttachments = snapshot.data?.attachments || [];
  const reusable = allAttachments.filter((a) => a.kind === "upload" && !composer.attachments.some((selected) => selected.id === a.id));
  const exports = allAttachments.filter((a) => a.kind === "export");
  const fileURL = (id: string) => `/api/v1${prefix}/conversations/${conversationID}/attachments/${id}/file`;
  const timeline = [
    ...(snapshot.data?.messages || []).map((m) => ({ kind: "message" as const, value: m, priority: m.role === "user" ? 0 : 2 })),
    ...runs.map((r) => ({ kind: "run" as const, value: r, priority: 1 })),
  ].sort((a, b) => Date.parse(a.value.created_at) - Date.parse(b.value.created_at) || a.priority - b.priority);

  const invalidate = async () => {
    await Promise.all([
      cache.invalidateQueries({ queryKey: [...key, conversationID] }),
      cache.invalidateQueries({ queryKey: [...key, "conversations"] }),
    ]);
  };
  const selectConversation = (id: string) => {
    if (embedded) { setLocalConversation(id); try { sessionStorage.setItem(associationKey, id); } catch { /* Server history remains available. */ } }
    else setParams((p) => { p.set("conversation", id); return p; });
  };
  function updateComposer(patch: Partial<ComposerDraft>) {
    drafts.change((all) => ({ ...all, [draftKey]: { ...(all[draftKey] || emptyDraft), ...patch, requestID: undefined } }));
  }
  function clearDraft(id: string) {
    drafts.change((all) => { const next = { ...all }; delete next[id]; return next; });
  }
  async function create(preserveDraft = !conversationID) {
    const v = await write<Conversation>("/conversations", { mode: "auto-review", profile_id: status.data?.profiles.find((p) => p.available)?.id || "" });
    if (scope === currentScope.current) {
      if (preserveDraft) drafts.change((all) => { const next = { ...all, [v.id]: all[draftKey] || emptyDraft }; delete next[draftKey]; return next; });
      setSearch("");
      selectConversation(v.id);
    }
    await cache.invalidateQueries({ queryKey: [...key, "conversations"] });
    return v.id;
  }
  async function action(fn: () => Promise<unknown>) {
    if (mutationLocked.current) return false;
    mutationLocked.current = true;
    setBusy(true);
    try { await fn(); await invalidate(); return true; }
    catch (e) {
      if (e instanceof APIError && e.status === 401) void refresh();
      if (scope === currentScope.current) void message.error(e instanceof Error ? e.message : "操作失败，请刷新后核对");
      return false;
    } finally { mutationLocked.current = false; setBusy(false); }
  }
  async function send() {
    if (inputDisabled || mutationLocked.current || bytes > 12000 || (!composer.text.trim() && !composer.attachments.length)) return;
    const requestID = composer.requestID || crypto.randomUUID();
    drafts.change((all) => ({ ...all, [draftKey]: { ...composer, requestID } }));
    setFollowing(true);
    await action(async () => {
      const id = conversationID || await create(true);
      await write(`/conversations/${id}/messages`, { content: composer.text, attachment_ids: composer.attachments.map((a) => a.id), request_id: requestID, context: context ? {kind:context.kind, id:context.id} : undefined });
      if (scope === currentScope.current) clearDraft(id);
    });
  }

  async function loadHistory() {
    if (!snapshot.data?.next_cursor || historyLoadingKey === archiveKey) return;
    const cursor = snapshot.data.next_cursor;
    setHistoryLoadingKey(archiveKey); setHistoryError(null);
    try {
      const page = await get<Snapshot>(`/conversations/${conversationID}?before=${encodeURIComponent(cursor)}`);
      if (currentArchiveKey.current !== archiveKey) return;
      if (scroll.current) anchor.current = { top: scroll.current.scrollTop, height: scroll.current.scrollHeight };
      setFollowing(false);
      setArchive(previous => ({ key: archiveKey, pages: [...(previous.key === archiveKey && previous.pages.length ? previous.pages : latestSnapshot.data ? [latestSnapshot.data] : []), page] }));
    } catch (e) { if (currentArchiveKey.current === archiveKey) setHistoryError({ key: archiveKey, message: e instanceof Error ? e.message : "历史读取失败，请重试" }); }
    finally { if (currentArchiveKey.current === archiveKey) setHistoryLoadingKey(""); }
  }

  useEffect(() => { if (!embedded && !conversationID && conversations.data?.[0] && !composer.text && !composer.attachments.length) selectConversation(conversations.data[0].id); }, [conversations.data, conversationID]);
  useEffect(() => { setFollowing(true); anchor.current = null; }, [scope, conversationID]);
  useEffect(() => { setSearch(""); }, [scope]);
  useEffect(() => {
    if (!latestSnapshot.data) return;
    setArchive(previous => previous.key === archiveKey && previous.pages.length ? {
      key: archiveKey, pages: [withHistory(latestSnapshot.data, [previous.pages[0]])!, ...previous.pages.slice(1)],
    } : previous);
  }, [latestSnapshot.data, archiveKey]);
  useEffect(() => {
    if (drafts.ready && drafts.dirty && !Object.values(drafts.value).some((d) => d.text || d.attachments.length || d.requestID)) drafts.reset(emptyDrafts);
  }, [drafts.value, drafts.ready, drafts.dirty]);
  useEffect(() => {
    if (drafts.ready && composer.requestID && runs.some((r) => r.request_id === composer.requestID)) clearDraft(draftKey);
  }, [snapshot.data, drafts.ready, composer.requestID]);
  useEffect(() => {
    if (!conversationID) return;
    setStreamState("连接中");
    const stream = new EventSource(`/api/v1${prefix}/conversations/${conversationID}/events`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = (e: Event) => {
      if (e.type === "done") void cache.invalidateQueries({ queryKey: ["live", course!.id] });
      if (timer) return;
      timer = setTimeout(() => { timer = undefined; void invalidate(); }, 200);
    };
    stream.onopen = () => setStreamState("实时连接");
    stream.onerror = () => setStreamState("重连中 · 定时同步");
    for (const event of ["status", "tool", "plan", "delegated", "request", "response", "done", "text"]) stream.addEventListener(event, update);
    return () => { stream.close(); if (timer) clearTimeout(timer); };
  }, [scope, conversationID]);
  useLayoutEffect(() => {
    if (!scroll.current) return;
    if (anchor.current) {
      scroll.current.scrollTop = anchor.current.top + scroll.current.scrollHeight - anchor.current.height;
      anchor.current = null;
    } else if (following) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [latestSnapshot.data, archive, following, conversationID]);

  return <div className={`agent-workspace${embedded ? " agent-embedded" : ""}`}>
    {!embedded && <aside className="agent-conversations">
      <Button block type="primary" disabled={busy || !configured || !drafts.ready} onClick={() => void action(() => create())}>新对话</Button>
      <Input aria-label="搜索对话" placeholder="搜索对话" allowClear value={search} onChange={(e) => setSearch(e.target.value)} />
      <List loading={conversations.isPending} dataSource={conversations.data?.filter((c) => c.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) || []} locale={{ emptyText: search ? "没有匹配的对话" : "暂无对话" }} renderItem={(c) => <List.Item><Button data-conversation-id={c.id} disabled={busy} title={c.title} type={c.id === conversationID ? "text" : "default"} aria-current={c.id === conversationID ? "page" : undefined} className={c.id === conversationID ? "agent-selected" : ""} block onClick={() => selectConversation(c.id)}><span>{c.title}</span>{drafts.value[c.id]?.text || drafts.value[c.id]?.attachments.length ? <Tag>草稿</Tag> : null}</Button></List.Item>} />
      {conversationPages.hasNextPage && <Button block loading={conversationPages.isFetchingNextPage} onClick={() => void conversationPages.fetchNextPage()}>加载更多对话</Button>}
    </aside>}
    <section className="agent-main" aria-label="课程助理对话">
      <div className="agent-toolbar">
        {embedded && <Space wrap><Tag>当前：{context?.title}</Tag><Button disabled={busy || !!active || !configured || !drafts.ready} onClick={() => void action(() => create())}>为此对象新建对话</Button>{conversationID && <Link to={`/${session?.user.role === "teacher" ? "teacher" : "student"}/assistant?conversation=${conversationID}`}>完整会话记录</Link>}</Space>}
        <Space wrap>
          <Select aria-label="对话模型" placeholder="选择模型" value={current?.profile_id || status.data?.profiles.find((p) => p.available)?.id} disabled={!current || !!active || busy} onChange={(profile_id) => void action(() => write(`/conversations/${conversationID}`, { mode: current!.mode, profile_id }, "PATCH"))} options={status.data?.profiles.map((p) => ({ value: p.id, label: p.label, disabled: !p.available }))} />
          <Tooltip title="只读不写入；自动审查允许草稿并确认重要修改；完整操作仍须确认正式发布和成绩。">
            <Select aria-label="权限模式" value={current?.mode || "auto-review"} disabled={!current || !!active || busy} options={modes.filter((m) => session?.user.role === "teacher" || m.value !== "full-access")} onChange={(mode) => void action(() => write(`/conversations/${conversationID}`, { mode, profile_id: current!.profile_id }, "PATCH"))} />
          </Tooltip>
          {active && <span role="status"><StateTag state={active.state} /></span>}
          {conversationID && <Tag>{streamState}</Tag>}
        </Space>
        {active && <Popconfirm title="停止后保留已完成的操作，已发出的模型调用仍会记账。" onConfirm={() => action(() => write(`/runs/${active.id}/cancel`, {}))}><Button danger disabled={busy || active.cancel_requested}>{active.cancel_requested ? "正在停止" : "停止"}</Button></Popconfirm>}
      </div>
      {(status.error || conversations.error || snapshot.error) && <Alert showIcon type="error" message={(status.error || conversations.error || snapshot.error)?.message} action={<Button onClick={() => { void invalidate(); void status.refetch(); }}>重试</Button>} />}
      {status.data && !configured && <Alert showIcon type="warning" message="暂无可用生成模型，请联系维护者检查服务端配置。" />}
      {current?.learner_context && <Alert showIcon type="info" message="本对话已读取学习或作答数据；出题与评分标准请使用独立新对话。" />}
      <div className="agent-scroll" ref={scroll} onScroll={() => { const el = scroll.current!; setFollowing(el.scrollHeight - el.scrollTop - el.clientHeight < 100); }}>
        {snapshot.data?.has_more && <Button block loading={historyLoadingKey === archiveKey} onClick={() => void loadHistory()}>加载更早记录</Button>}
        {historyError?.key === archiveKey && <Alert type="error" showIcon message={historyError.message} action={<Button onClick={() => void loadHistory()}>重试</Button>} />}
        {snapshot.isPending && conversationID ? <Spin /> : !timeline.length ? <Empty description="发送要求或上传资料，开始处理当前课程任务" /> : timeline.map((item) => item.kind === "message" ? <article key={item.value.id} data-message-id={item.value.id} className={`agent-message agent-message-${item.value.role}`}>
          <Typography.Text strong>{item.value.role === "user" ? "你" : "课程助理"}</Typography.Text>
          {item.value.content && <RichContent text={item.value.content} />}
          <Space wrap>{item.value.attachment_ids?.map((id) => <Tag key={id}><Typography.Link href={fileURL(id)}>{allAttachments.find((a) => a.id === id)?.filename || "下载附件"}</Typography.Link></Tag>)}</Space>
        </article> : <RunPanel key={item.value.id} run={item.value} steps={snapshot.data!.steps.filter((s) => s.run_id === item.value.id)} requests={snapshot.data!.requests.filter((r) => r.run_id === item.value.id)} toolLabels={toolLabels} disabled={busy} hasActive={!!active}
          respond={(id, decision, values) => action(() => write(`/requests/${id}/respond`, { decision, values: values || {} }))} resume={() => action(() => write(`/runs/${item.value.id}/resume`, {}))} />)}
        {!!exports.length && <List className="agent-exports" size="small" header={<Typography.Text strong>导出文件</Typography.Text>} dataSource={exports} renderItem={(file) => <List.Item actions={[<Button key="download" href={fileURL(file.id)}>下载</Button>]}><Typography.Text>{file.filename}</Typography.Text></List.Item>} />}
      </div>
      {!following && <Button className="agent-jump" size="small" onClick={() => setFollowing(true)}>回到最新</Button>}
      <Form className="agent-composer" onFinish={() => void send()}>
        {(composer.text || composer.attachments.length > 0) && <DraftNotice restored={drafts.restored} storageError={drafts.storageError} />}
        <Space wrap>{composer.attachments.map((a) => <Tag key={a.id} closable={!busy} onClose={() => updateComposer({ attachments: composer.attachments.filter((x) => x.id !== a.id) })}>{a.filename}</Tag>)}</Space>
        <Input.TextArea aria-label="消息" placeholder={active?.state === "waiting_input" ? "请先回答当前问题" : active?.state === "waiting_approval" ? "请先确认或拒绝当前操作" : active ? "任务执行中，可查看执行记录或停止" : "输入要求，或上传需要导入的文件"} value={drafts.ready ? composer.text : ""} maxLength={12000} status={bytes > 12000 ? "error" : undefined} showCount={{ formatter: () => `${bytes} / 12000 字节` }} autoSize={{ minRows: 3, maxRows: 8 }} disabled={inputDisabled} onChange={(e) => updateComposer({ text: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
        {bytes > 12000 && <Typography.Text type="danger" role="alert">消息超过12000字节，请缩短后发送。</Typography.Text>}
        <div className="agent-compose-actions"><Space wrap>
          <Upload accept=".pdf,.docx,.pptx,.txt,.md,.html,.htm,.csv" showUploadList={false} disabled={inputDisabled || composer.attachments.length >= 10} beforeUpload={(file) => {
            if (mutationLocked.current) return Upload.LIST_IGNORE;
            if (file.size > 30 * 1024 * 1024 || !file.size) { void message.error("文件须为非空且不超过30MiB"); return Upload.LIST_IGNORE; }
            void action(async () => {
              setUploading(true);
              try {
                const id = conversationID || await create(true);
                const body = new FormData(); body.append("file", file);
                const a = (await requestJSON<{ data: Attachment }>(`${prefix}/conversations/${id}/attachments`, { method: "POST", body }, session?.csrf_token)).data;
                if (scope === currentScope.current) drafts.change((all) => ({ ...all, [id]: { ...(all[id] || emptyDraft), attachments: [...(all[id]?.attachments || []), a], requestID: undefined } }));
              } finally { setUploading(false); }
            });
            return false;
          }}><Button loading={uploading} disabled={inputDisabled || composer.attachments.length >= 10}>上传文件</Button></Upload>
          {!!reusable.length && <Dropdown menu={{ items: reusable.map((a) => ({ key: a.id, label: a.filename })), onClick: ({ key }) => updateComposer({ attachments: [...composer.attachments, reusable.find((a) => a.id === key)!] }) }} disabled={inputDisabled || composer.attachments.length >= 10}><Button disabled={inputDisabled || composer.attachments.length >= 10}>已上传文件</Button></Dropdown>}
        </Space><Button htmlType="submit" type="primary" loading={busy && !uploading} disabled={inputDisabled || bytes > 12000 || (!composer.text.trim() && !composer.attachments.length)}>发送</Button></div>
      </Form>
    </section>
  </div>;
}
