import { useEffect, useRef, useState } from "react";
import { Alert, App, Button, Card, Collapse, Empty, Form, Input, List, Popconfirm, Radio, Select, Space, Spin, Tag, Tooltip, Typography, Upload } from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { APIError, requestJSON } from "../shared/api";
import { useSession } from "../shared/session";
import { useLearning } from "./context";
import { RichContent } from "./content-render";
import "./agent.css";

type Conversation = { id: string; title: string; mode: string; profile_id: string; learner_context: boolean };
type Attachment = { id: string; filename: string; kind: string; size_bytes: number };
type Run = { id: string; state: string; error: string; cancel_requested: boolean; can_resume: boolean };
type Step = { id: string; run_id: string; agent: string; tool: string; state: string; arguments: Record<string, unknown>; result: Record<string, unknown> };
type Field = { key: string; label: string; kind: string; required: boolean; options?: string[] };
type Request = { id: string; run_id: string; step_id: string; kind: string; prompt: string; fields: Field[]; snapshot: { arguments?: Record<string, unknown>; before?: unknown }; response: Record<string, unknown>; state: string; expires_at: string };
type Snapshot = { conversation: Conversation; messages: { id: string; role: string; content: string; attachment_ids: string[] }[]; runs: Run[]; steps: Step[]; requests: Request[]; attachments: Attachment[] };
type Status = { configured: boolean; profiles: { id: string; label: string; available: boolean; model: string }[]; tools: { name: string; label: string }[] };

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
  return <dl className="agent-values">{Object.entries(value).filter(([key]) => key !== "business_hash").map(([key, v]) => <div key={key}><dt>{labels[key] || key}</dt><dd>{key === "download_url" && typeof v === "string" && /^\/api\/v1\/learning\/courses\/[\w-]+\/agent\/conversations\/[\w-]+\/attachments\/[\w-]+\/file$/.test(v) ? <a href={v}>下载反馈 CSV</a> : <ValueView value={v} depth={depth + 1} />}</dd></div>)}</dl>;
}

function RequestCard({ request, disabled, respond }: { request: Request; disabled: boolean; respond: (id: string, decision: string, values?: Record<string, unknown>) => Promise<void> }) {
  const [form] = Form.useForm();
  const expired = new Date(request.expires_at).getTime() <= Date.now();
  const pending = request.state === "pending" && !expired;
  useEffect(() => { if (request.state === "answered") form.setFieldsValue(request.response); }, [request.state, request.response, form]);
  return <Card size="small" className="agent-request" title={<Space wrap><Tag color={request.kind === "input" ? "blue" : "orange"}>{request.kind === "input" ? "需要补充" : "操作确认"}</Tag><span>{request.prompt}</span></Space>} extra={<StateTag state={expired && request.state === "pending" ? "expired" : request.state} />}>
    {request.kind === "input" ? <Form form={form} layout="vertical" disabled={!pending || disabled} onFinish={(values) => void respond(request.id, "approve", values)}>
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

export function AgentPage() {
  const { course } = useLearning(); const { session, refresh } = useSession(); const cache = useQueryClient(); const { message } = App.useApp();
  const [params, setParams] = useSearchParams(); const conversationID = params.get("conversation") || "";
  const [text, setText] = useState(""); const [attachments, setAttachments] = useState<Attachment[]>([]); const [busy, setBusy] = useState(false); const [uploading, setUploading] = useState(false);
  const [streamState, setStreamState] = useState("连接中"); const bottom = useRef<HTMLDivElement>(null); const scroll = useRef<HTMLDivElement>(null);
  const pendingSend = useRef<{ signature: string; requestID: string } | null>(null);
  const prefix = `/learning/courses/${course!.id}/agent`;
  const key = ["agent", session?.user.id, course!.id];
  const get = async <T,>(path: string, signal?: AbortSignal) => (await requestJSON<{ data: T }>(`${prefix}${path}`, { signal })).data;
  const status = useQuery({ queryKey: [...key, "status"], queryFn: ({ signal }) => get<Status>("/status", signal) });
  const conversations = useQuery({ queryKey: [...key, "conversations"], queryFn: ({ signal }) => get<Conversation[]>("/conversations", signal) });
  const snapshot = useQuery({ queryKey: [...key, conversationID], enabled: !!conversationID, queryFn: ({ signal }) => get<Snapshot>(`/conversations/${conversationID}`, signal), refetchInterval: 5000 });
  const current = snapshot.data?.conversation;
  const runs = snapshot.data?.runs || []; const active = runs.find((r) => isActive(r.state));
  const toolLabels = new Map(status.data?.tools.map((t) => [t.name, t.label]));
  const invalidate = async () => { await cache.invalidateQueries({ queryKey: key }); await cache.invalidateQueries({ queryKey: ["live", course!.id] }); };
  const write = async <T,>(path: string, body: unknown, method = "POST") => (await requestJSON<{ data: T }>(`${prefix}${path}`, { method, body: JSON.stringify(body) }, session?.csrf_token)).data;
  const handleError = (e: unknown) => { if (e instanceof APIError && e.status === 401) void refresh(); void message.error(e instanceof Error ? e.message : "操作失败，请刷新后核对"); };
  const selectConversation = (id: string, preserveDraft = false) => { setParams((p) => { p.set("conversation", id); return p; }); if (!preserveDraft) { setText(""); setAttachments([]); pendingSend.current = null; } };
  const create = async (preserveDraft = false) => { const v = await write<Conversation>("/conversations", { mode: "auto-review", profile_id: status.data?.profiles.find((p) => p.available)?.id || "" }); selectConversation(v.id, preserveDraft); await cache.invalidateQueries({ queryKey: [...key, "conversations"] }); return v.id; };
  useEffect(() => { if (!conversationID && conversations.data?.[0]) selectConversation(conversations.data[0].id); }, [conversations.data, conversationID]);
  useEffect(() => { setAttachments([]); setText(""); pendingSend.current = null; }, [course?.id]);
  useEffect(() => {
    if (!conversationID) return;
    const stream = new EventSource(`/api/v1${prefix}/conversations/${conversationID}/events`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => { if (timer) return; timer = setTimeout(() => { timer = undefined; void cache.invalidateQueries({ queryKey: [...key, conversationID] }); void cache.invalidateQueries({ queryKey: [...key, "conversations"] }); void cache.invalidateQueries({ queryKey: ["live", course!.id] }); }, 200); };
    stream.onopen = () => setStreamState("实时连接"); stream.onerror = () => setStreamState("重新连接中");
    for (const event of ["status", "tool", "plan", "delegated", "request", "response", "done"]) stream.addEventListener(event, update);
    return () => { stream.close(); if (timer) clearTimeout(timer); };
  }, [course?.id, conversationID, session?.user.id]);
  useEffect(() => { const el = scroll.current; if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 250) bottom.current?.scrollIntoView({ block: "nearest" }); }, [snapshot.data?.messages.length, snapshot.data?.steps.length]);
  async function action(fn: () => Promise<unknown>) { setBusy(true); try { await fn(); await invalidate(); } catch (e) { handleError(e); } finally { setBusy(false); } }
  async function send() {
    if (!text.trim() && !attachments.length) return;
    if (busy || uploading || active) return;
    const signature = JSON.stringify([course!.id, text, attachments.map((a) => a.id)]);
    if (pendingSend.current?.signature !== signature) pendingSend.current = { signature, requestID: crypto.randomUUID() };
    const requestID = pendingSend.current.requestID;
    await action(async () => { const id = conversationID || await create(true); await write(`/conversations/${id}/messages`, { content: text, attachment_ids: attachments.map((a) => a.id), request_id: requestID }); pendingSend.current = null; setText(""); setAttachments([]); });
  }
  return <div className="agent-workspace">
    <aside className="agent-conversations">
      <Button block type="primary" disabled={busy || uploading || !status.data?.configured} onClick={() => void action(() => create())}>新对话</Button>
      <List loading={conversations.isPending} dataSource={conversations.data || []} locale={{ emptyText: "暂无对话" }} renderItem={(c) => <List.Item><Button type={c.id === conversationID ? "text" : "default"} aria-current={c.id === conversationID ? "page" : undefined} className={c.id === conversationID ? "agent-selected" : ""} block onClick={() => selectConversation(c.id)}><span>{c.title}</span></Button></List.Item>} />
    </aside>
    <section className="agent-main" aria-label="课程助理对话">
      <div className="agent-toolbar">
        <Space wrap>
          <Select aria-label="对话模型" placeholder="选择模型" value={current?.profile_id || status.data?.profiles.find((p) => p.available)?.id} disabled={!current || !!active || busy} onChange={(profile_id) => void action(() => write(`/conversations/${conversationID}`, { mode: current!.mode, profile_id }, "PATCH"))} options={status.data?.profiles.map((p) => ({ value: p.id, label: `${p.label} · ${p.model}`, disabled: !p.available }))} />
          <Tooltip title="只读不写入；自动审查允许草稿并确认重要修改；完整操作仍须确认正式发布和成绩。">
            <Select aria-label="权限模式" value={current?.mode || "auto-review"} disabled={!current || !!active || busy} options={modes.filter((m) => session?.user.role === "teacher" || m.value !== "full-access")} onChange={(mode) => void action(() => write(`/conversations/${conversationID}`, { mode, profile_id: current!.profile_id }, "PATCH"))} />
          </Tooltip>
          {active && <StateTag state={active.state} />}
          {conversationID && <Tag>{streamState}</Tag>}
        </Space>
        {active && <Popconfirm title="停止后保留已完成的操作，已发出的模型调用仍会记账。" onConfirm={() => action(() => write(`/runs/${active.id}/cancel`, {}))}><Button danger disabled={busy || active.cancel_requested}>{active.cancel_requested ? "正在停止" : "停止"}</Button></Popconfirm>}
      </div>
      {(status.error || conversations.error || snapshot.error) && <Alert showIcon type="error" message={(status.error || conversations.error || snapshot.error)?.message} action={<Button onClick={() => void invalidate()}>重试</Button>} />}
      {status.data && !status.data.configured && <Alert showIcon type="warning" message="课程助理尚未配置生成模型，请联系维护者启用服务端接口。" />}
      {current?.learner_context && <Alert showIcon type="info" message="本对话已读取学习或作答数据；出题与评分标准请使用独立新对话。" />}
      <div className="agent-scroll" ref={scroll}>
        {snapshot.isPending && conversationID ? <Spin /> : !snapshot.data?.messages?.length ? <Empty description="发送要求或上传资料，开始处理当前课程任务" /> : snapshot.data.messages.map((m) => <article key={m.id} className={`agent-message agent-message-${m.role}`}>
          <Typography.Text strong>{m.role === "user" ? "你" : "课程助理"}</Typography.Text>
          {m.content && <RichContent text={m.content} />}
          <Space wrap>{m.attachment_ids?.map((id) => <Tag key={id}>{snapshot.data?.attachments.find((a) => a.id === id)?.filename || "附件"}</Tag>)}</Space>
        </article>)}
        {[...runs].reverse().map((run) => <div className="agent-run" key={run.id}>
          <Collapse size="small" items={[{ key: run.id, label: <Space wrap><StateTag state={run.state} /><span>执行记录</span><Typography.Text type="secondary">{snapshot.data?.steps.filter((s) => s.run_id === run.id).length || 0} 步</Typography.Text></Space>, children: <Space direction="vertical" className="agent-full-width">{snapshot.data?.steps.filter((s) => s.run_id === run.id).map((step) => <Collapse key={step.id} size="small" items={[{ key: step.id, label: <Space wrap><Tag>{domains[step.agent] || step.agent}</Tag><span>{toolLabels.get(step.tool) || step.tool}</span><StateTag state={step.state} /></Space>, children: <><Typography.Text strong>操作内容</Typography.Text><ValueView value={step.arguments} /><Typography.Text strong>执行回执</Typography.Text><ValueView value={step.result} /></> }]} />)}</Space> }]} />
          {run.error && <Alert showIcon type={run.state === "unknown" ? "warning" : "error"} message={run.error} />}
          {run.state === "succeeded" && snapshot.data?.steps.some((s) => s.run_id === run.id && ["failed", "denied", "unknown"].includes(s.state)) && <Alert showIcon type="warning" message="本轮包含失败或未执行的操作，请展开记录核对。" />}
          {run.can_resume && !active && <Popconfirm title="从检查点恢复，模型请求可能再次计费；未知写操作会被拒绝重放。" onConfirm={() => action(() => write(`/runs/${run.id}/resume`, {}))}><Button disabled={busy}>从检查点恢复</Button></Popconfirm>}
          {snapshot.data?.requests.filter((r) => r.run_id === run.id).map((r) => <RequestCard key={r.id} request={r} disabled={busy || !isActive(run.state) || run.cancel_requested} respond={(id, decision, values) => action(() => write(`/requests/${id}/respond`, { decision, values: values || {} }))} />)}
        </div>)}
        <div ref={bottom} />
      </div>
      <form className="agent-composer" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <Space wrap>{attachments.map((a) => <Tag key={a.id} closable onClose={() => setAttachments((old) => old.filter((x) => x.id !== a.id))}>{a.filename}</Tag>)}</Space>
        <Input.TextArea aria-label="消息" placeholder={active ? "先处理上方问题或等待任务完成" : "输入要求，或上传需要导入的文件"} value={text} maxLength={12000} showCount autoSize={{ minRows: 3, maxRows: 8 }} disabled={busy || !!active || !status.data?.configured} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(); } }} />
        <div className="agent-compose-actions"><Upload accept=".pdf,.docx,.pptx,.txt,.md,.html,.htm,.csv" showUploadList={false} disabled={busy || uploading || !!active || !status.data?.configured} beforeUpload={(file) => {
          if (file.size > 30 * 1024 * 1024 || !file.size) { void message.error("文件须为非空且不超过30MiB"); return Upload.LIST_IGNORE; }
          setUploading(true);
          void (async () => { try { const id = conversationID || await create(true); const body = new FormData(); body.append("file", file); const a = (await requestJSON<{ data: Attachment }>(`${prefix}/conversations/${id}/attachments`, { method: "POST", body }, session?.csrf_token)).data; setAttachments((old) => [...old, a]); } catch (e) { handleError(e); } finally { setUploading(false); } })();
          return false;
        }}><Button loading={uploading} disabled={busy || !!active || !status.data?.configured}>上传文件</Button></Upload><Button htmlType="submit" type="primary" loading={busy} disabled={uploading || !!active || !status.data?.configured || (!text.trim() && !attachments.length)}>发送</Button></div>
      </form>
    </section>
  </div>;
}
