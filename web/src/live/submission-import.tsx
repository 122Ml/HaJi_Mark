import { useState } from "react";
import { Alert, Button, Drawer, Input, Select, Space, Steps, Table, Tag, Typography, Upload } from "antd";
import type { Assignment, Question } from "./assessment";
import { useAction, useLiveQuery, Feedback, when, Link } from "./context";
import { Field } from "../shared/Field";
import { DraftNotice, useEditorDraft } from "./editing";

type Row = { row: number; username: string; answer_text: string; student_name: string; next_attempt: number; error: string };
type Preview = { rows: Row[]; valid: boolean; preview_hash: string };
type Batch = { id: string; question_id: string; answer_count: number; created_at: string };

export function SubmissionImport({ assignment, questions }: { assignment: Assignment; questions: Question[] }) {
  const [open, setOpen] = useState(false);
  const draft = useEditorDraft(`submission-import:${assignment.id}`, { question: "", csv: "", request_id: crypto.randomUUID() });
  const { question, csv, request_id } = draft.value;
  const setQuestion = (question: string) => draft.change(v => ({ ...v, question, request_id: crypto.randomUUID() }));
  const setCSV = (csv: string) => draft.change(v => ({ ...v, csv, request_id: crypto.randomUUID() }));
  const [preview, setPreview] = useState<Preview | null>(null);
  const [receipt, setReceipt] = useState<{ batch: Batch; submissions: { id: string }[] } | null>(null);
  const [fileError, setFileError] = useState("");
  const [uploading, setUploading] = useState(false);
  const action = useAction();
  const batches = useLiveQuery<Batch[]>(`/assignments/${assignment.id}/imports`, open);
  const eligible = questions.filter(q => q.type !== "quiz");
  const available = assignment.status === "published" && (!assignment.due_at || Date.parse(assignment.due_at) >= Date.now());
  function changed() { setPreview(null); setReceipt(null); action.setMessage(""); }
  const locked = action.busy || uploading || !draft.ready;
  return <>
    <Button onClick={() => setOpen(true)}>导入文本作答</Button>
    <Drawer title="批量导入文本作答" open={open} width={960} onClose={() => { if (!locked) setOpen(false); }} maskClosable={!locked} closable={!locked}>
      <Space direction="vertical" size="middle" className="live-full-width">
        <DraftNotice {...draft} />
        {draft.dirty && <Button disabled={locked} onClick={() => { draft.reset({ question: "", csv: "", request_id: crypto.randomUUID() }); changed(); }}>清空导入草稿</Button>}
        <Steps size="small" current={receipt ? 2 : preview ? 1 : 0} items={[{ title: "选择题目与答案" }, { title: "核对并确认" }, { title: "查看导入结果" }]} />
        {!receipt && <>
        <Alert type="info" showIcon message="每批一道题，最多200份；使用课程内学生用户名" />
        {!available && <Alert type="warning" showIcon message="当前作业尚未发布、已关闭或已截止，不能导入" />}
        {!eligible.length && <Alert type="warning" showIcon message="本作业没有可导入文本的主观题或代码题" />}
        <Field label="导入到题目" required><Select aria-label="导入到题目" value={question || undefined} placeholder="选择一道主观题或代码题" disabled={locked || !available} options={eligible.map((q, i) => ({ value: q.id, label: `${i + 1}. ${q.prompt.slice(0, 80)}` }))} onChange={v => { setQuestion(v); changed(); }} /></Field>
        <Space wrap>
          <Upload accept=".csv,text/csv" showUploadList={false} disabled={locked || !available} beforeUpload={async file => {
            setUploading(true); setFileError("");
            try {
              if (file.size > 512 * 1024) throw new Error("文件不能超过512KiB");
              const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
              setCSV(text); changed();
            } catch (e) { setFileError(e instanceof Error ? e.message : "无法读取，请使用UTF-8 CSV"); }
            finally { setUploading(false); }
            return false;
          }}><Button loading={uploading}>选择 CSV 文件</Button></Upload>
          <Button onClick={() => {
            const file = URL.createObjectURL(new Blob(["\ufeffusername,answer_text\r\n\"学生用户名\",\"在这里填写原文，多行答案放在双引号内\"\r\n"], { type: "text/csv;charset=utf-8" }));
            const a = document.createElement("a"); a.href = file; a.download = "文本作答导入模板.csv"; a.click(); URL.revokeObjectURL(file);
          }}>下载模板</Button>
        </Space>
        <Field label="CSV内容" required><Input.TextArea aria-label="CSV内容" value={csv} rows={6} disabled={locked || !available} placeholder={'username,answer_text\n"学生用户名","原始答案"'} onChange={e => { setCSV(e.target.value); changed(); }} /></Field>
        {fileError && <Alert role="alert" showIcon type="error" message={fileError} />}
        <Feedback message={action.message} failed={action.failed} />
        <Button type={preview ? "default" : "primary"} loading={action.busy} disabled={!question || !csv.trim() || !available || locked} onClick={async () => {
          setReceipt(null);
          const v = await action.run<Preview>(`/assignments/${assignment.id}/import/preview`, { question_id: question, csv });
          setPreview(v || null);
          if (v) action.setMessage("已核对，尚未导入");
        }}>预览核对</Button>
        {preview && <>
          <Alert type={preview.valid ? "warning" : "error"} showIcon message={preview.valid ? `已核对${preview.rows.length}份答案，确认后整批追加` : "存在异常行，请修改输入后重新预览；当前未写入任何作答"} description={preview.rows.some(r => r.next_attempt > 1) ? "部分学生已有作答，将新增一次作答。请特别核对学生与题目，不会覆盖历史记录。" : undefined} />
          <Table<Row> rowKey="row" size="small" dataSource={preview.rows} scroll={{ x: 760 }} pagination={{ pageSize: 10, showSizeChanger: false }} columns={[
            { title: "源行", dataIndex: "row", width: 65 },
            { title: "学生", render: (_, r) => <Space direction="vertical" size={0}><span>{r.student_name || "未匹配"}</span><Typography.Text type="secondary">{r.username}</Typography.Text></Space> },
            { title: "原始答案", dataIndex: "answer_text", render: text => <Typography.Paragraph className="live-prose" ellipsis={{ rows: 3, expandable: "collapsible", symbol: expanded => expanded ? "收起" : "展开" }}>{text}</Typography.Paragraph> },
            { title: "核对", width: 200, render: (_, r) => r.error ? <Tag color="error">{r.error}</Tag> : <Tag color={r.next_attempt > 1 ? "warning" : "success"}>追加第{r.next_attempt}次作答</Tag> },
          ]} />
          <Button type="primary" loading={action.busy} disabled={!preview.valid || locked || !available} onClick={async () => {
            const r = await action.run<{ batch: Batch; submissions: { id: string }[] }>(`/assignments/${assignment.id}/import/confirm`, { question_id: question, csv, preview_hash: preview.preview_hash, request_id });
            if (r) { draft.reset({ question, csv: "", request_id: crypto.randomUUID() }); setReceipt(r); await batches.refetch(); }
            else { setPreview(null); await batches.refetch(); }
          }}>确认导入 {preview.rows.length} 份答案</Button>
        </>}
        </>}
        {receipt && <>
          <Alert type="success" showIcon message={`已导入${receipt.submissions.length}份答案，尚未评分`} action={<Link to={`/teacher/homework/submissions/${receipt.submissions[0]?.id}/grade`}>开始批阅</Link>} />
          <Button onClick={() => { changed(); setCSV(""); setFileError(""); }}>再导入一批</Button>
        </>}
        <Table<Batch> size="small" rowKey="id" loading={batches.isPending} dataSource={batches.data || []} locale={{ emptyText: "尚无导入记录" }} pagination={{ pageSize: 5, showSizeChanger: false }} columns={[
          { title: "导入时间", dataIndex: "created_at", render: when },
          { title: "份数", dataIndex: "answer_count" },
          { title: "题目", dataIndex: "question_id", render: id => questions.find(q => q.id === id)?.prompt.slice(0, 70) || "题目版本" },
        ]} />
        {batches.error && <Alert type="error" message={batches.error.message} action={<Button onClick={() => void batches.refetch()}>重试读取记录</Button>} />}
      </Space>
    </Drawer>
  </>;
}
