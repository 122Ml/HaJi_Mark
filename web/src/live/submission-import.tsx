import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Drawer, Form, Input, Select, Space, Steps, Table, Tag, Tooltip, Typography } from "antd";
import { Field } from "../shared/Field";
import { FileUpload } from "../shared/FileUpload";
import { Feedback, Link, useAction, useLearning, useLiveQuery, uuid, when } from "./context";
import { DraftNotice, useEditorDraft } from "./editing";
import type { Assignment, Question } from "./types";
import { hasControlNull, utf8ByteLength } from "./validation";

const MAX_CSV_BYTES = 512 * 1024;

type Row = {
  row: number;
  username: string;
  answer_text: string;
  student_name: string;
  next_attempt: number;
  error: string;
};
type Preview = { rows: Row[]; valid: boolean; preview_hash: string };
type Batch = { id: string; question_id: string; answer_count: number; created_at: string };

interface ImportDraft {
  question: string;
  csv: string;
  request_id: string;
}

function SubmissionImportBody({
  assignment,
  questions,
  eligible,
  onLockedChange,
}: {
  assignment: Assignment;
  questions: Question[];
  eligible: Question[];
  onLockedChange: (locked: boolean) => void;
}) {
  const { course } = useLearning();
  const defaultDraft = useMemo<ImportDraft>(
    () => ({ question: "", csv: "", request_id: uuid() }),
    [],
  );
  const draft = useEditorDraft<ImportDraft>(
    `submission-import:${course?.id || "none"}:${assignment.id}`,
    defaultDraft,
  );
  const { question, csv, request_id } = draft.value;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [receipt, setReceipt] = useState<{ batch: Batch; submissions: { id: string }[] } | null>(null);
  const [fileError, setFileError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadResetKey, setUploadResetKey] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const action = useAction();
  const batches = useLiveQuery<Batch[]>(`/assignments/${assignment.id}/imports`, !!course);

  useEffect(() => {
    if (assignment.status !== "published" || !assignment.due_at) return;
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, [assignment.status, assignment.due_at]);

  const available =
    !!course &&
    assignment.status === "published" &&
    (!assignment.due_at || now <= Date.parse(assignment.due_at));
  const locked = action.busy || uploading || !draft.ready || !course;

  useEffect(() => {
    onLockedChange(locked);
    return () => onLockedChange(false);
  }, [locked, onLockedChange]);

  const csvBytes = useMemo(() => utf8ByteLength(csv), [csv]);
  const csvTooLarge = csvBytes > MAX_CSV_BYTES;
  const csvHasNull = useMemo(() => hasControlNull(csv), [csv]);

  function clearFeedbackState() {
    setPreview(null);
    setReceipt(null);
    action.setMessage("");
  }

  function setQuestion(nextQuestion: string) {
    draft.change((v) => ({ ...v, question: nextQuestion, request_id: uuid() }));
    clearFeedbackState();
  }

  function setCSV(nextCSV: string) {
    draft.change((v) => ({ ...v, csv: nextCSV, request_id: uuid() }));
    clearFeedbackState();
  }

  function resetForm(keepQuestion = "") {
    draft.reset({ question: keepQuestion, csv: "", request_id: uuid() });
    setUploadResetKey((k) => k + 1);
    setFileError("");
    clearFeedbackState();
  }

  function downloadTemplate() {
    const blob = new Blob(
      ["\ufeffusername,answer_text\r\n\"学生用户名\",\"在这里填写原文，多行答案放在双引号内\"\r\n"],
      { type: "text/csv;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "文本作答导入模板.csv";
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  return (
    <Form layout="vertical" component={false}>
      <Space direction="vertical" size="middle" className="live-full-width">
      {!course && (
        <Alert type="error" showIcon message="未选择当前课程，无法执行作答导入。" />
      )}
      <DraftNotice
        restored={draft.restored}
        storageError={draft.storageError}
        onDiscard={() => resetForm("")}
      />
      {draft.dirty && (
        <Button disabled={locked} htmlType="button" onClick={() => resetForm("")}>
          清空导入草稿
        </Button>
      )}
      <Steps
        size="small"
        current={receipt ? 2 : preview ? 1 : 0}
        items={[
          { title: "选择题目与答案" },
          { title: "核对并确认" },
          { title: "查看导入结果" },
        ]}
      />
      {!receipt && (
        <>
          <Alert
            type="info"
            showIcon
            message="每批一道题，最多 200 份，文件不超过 512 KiB；请使用 UTF-8 编码的 CSV（首行表头为 username,answer_text，多行答案需用双引号包裹）。"
          />
          {!available && course && (
            <Alert
              type="warning"
              showIcon
              message="当前作业尚未发布、已关闭或已过截止时间，不能导入作答。"
            />
          )}
          {!eligible.length && (
            <Alert
              type="warning"
              showIcon
              message="本作业没有可导入文本的主观题或代码题。"
            />
          )}
          <Field className="ui-field" label="导入到题目" required>
            <Select
              aria-label="导入到题目"
              value={question || undefined}
              placeholder="选择一道主观题或代码题"
              disabled={locked || !available}
              options={eligible.map((q, i) => ({
                value: q.id,
                label: `${i + 1}. ${q.prompt.slice(0, 80)}`,
              }))}
              onChange={(v) => setQuestion(v)}
            />
          </Field>
          <Space wrap align="center">
            <FileUpload
              aria-label="选择 CSV 文件"
              accept=".csv,text/csv"
              resetKey={uploadResetKey}
              disabled={locked || !available}
              onChange={async (files) => {
                const file = files[0];
                if (!file) return;
                setUploading(true);
                setFileError("");
                try {
                  if (file.size > MAX_CSV_BYTES) {
                    throw new Error("CSV 文件不能超过 512 KiB，请拆分批次后再导入。");
                  }
                  const buf = await file.arrayBuffer();
                  const text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
                  if (hasControlNull(text)) {
                    throw new Error("文件包含非法空字符（NUL），请检查是否为纯文本 UTF-8 CSV。");
                  }
                  setCSV(text);
                } catch (e) {
                  setUploadResetKey((k) => k + 1);
                  if (e instanceof TypeError) {
                    setFileError(
                      "文件不是有效的 UTF-8 编码。如果使用 Excel 导出，请另存为「CSV UTF-8 (逗号分隔)」格式后重新上传。",
                    );
                  } else {
                    setFileError(
                      e instanceof Error
                        ? e.message
                        : "无法读取文件，请确认其为 UTF-8 编码的 CSV 文件。",
                    );
                  }
                } finally {
                  setUploading(false);
                }
              }}
            />
            <Button htmlType="button" onClick={downloadTemplate}>
              下载 UTF-8 模板
            </Button>
          </Space>
          <Field
            className="ui-field"
            label={`CSV 内容（${Math.ceil(csvBytes / 1024)} / 512 KiB）`}
            required
          >
            <Input.TextArea
              aria-label="CSV内容"
              value={csv}
              rows={6}
              disabled={locked || !available}
              placeholder={'username,answer_text\n"学生用户名","原始答案"'}
              onChange={(e) => {
                setFileError("");
                setCSV(e.target.value);
              }}
            />
          </Field>
          {csvTooLarge && (
            <Alert
              role="alert"
              showIcon
              type="error"
              message={`CSV 内容超过 512 KiB 上限（当前约 ${Math.ceil(csvBytes / 1024)} KiB），请精简或分批导入。`}
            />
          )}
          {csvHasNull && (
            <Alert
              role="alert"
              showIcon
              type="error"
              message="CSV 内容包含非法空字符，请清理后重试。"
            />
          )}
          {fileError && <Alert role="alert" showIcon type="error" message={fileError} />}
          <Feedback message={action.message} failed={action.failed} />
          {action.error?.code === "request_conflict" && (
            <Alert
              type="warning"
              showIcon
              message="当前导入请求号与历史批次冲突，请重置请求号后重新预览。"
              action={
                <Button
                  size="small"
                  htmlType="button"
                  onClick={() => {
                    draft.change((v) => ({ ...v, request_id: uuid() }));
                    setPreview(null);
                    action.setMessage("");
                  }}
                >
                  重置请求号
                </Button>
              }
            />
          )}
          <Button
            type={preview ? "default" : "primary"}
            loading={action.busy}
            htmlType="button"
            disabled={
              !question ||
              !csv.trim() ||
              csvTooLarge ||
              csvHasNull ||
              !available ||
              locked
            }
            onClick={async () => {
              setReceipt(null);
              const v = await action.run<Preview>(
                `/assignments/${assignment.id}/import/preview`,
                { question_id: question, csv },
                "POST",
                "已核对，尚未导入",
                { invalidate: false },
              );
              setPreview(v || null);
            }}
          >
            预览核对
          </Button>
          {preview && (
            <>
              <Alert
                type={preview.valid ? "warning" : "error"}
                showIcon
                message={
                  preview.valid
                    ? `已核对 ${preview.rows.length} 份答案，确认后整批追加`
                    : "存在异常行，请修改输入后重新预览；当前未写入任何作答"
                }
                description={
                  preview.rows.some((r) => r.next_attempt > 1)
                    ? "部分学生已有作答，将新增一次作答。请特别核对学生与题目，不会覆盖历史记录。"
                    : undefined
                }
              />
              <Table<Row>
                rowKey="row"
                size="small"
                dataSource={preview.rows}
                scroll={{ x: 760 }}
                pagination={{ pageSize: 10, showSizeChanger: false }}
                columns={[
                  { title: "源行", dataIndex: "row", width: 65 },
                  {
                    title: "学生",
                    render: (_, r) => (
                      <Space direction="vertical" size={0}>
                        <span>{r.student_name || "未匹配"}</span>
                        <Typography.Text type="secondary">{r.username}</Typography.Text>
                      </Space>
                    ),
                  },
                  {
                    title: "原始答案",
                    dataIndex: "answer_text",
                    render: (text: string) => (
                      <Typography.Paragraph
                        className="live-prose"
                        ellipsis={{
                          rows: 3,
                          expandable: "collapsible",
                          symbol: (expanded) => (expanded ? "收起" : "展开"),
                        }}
                      >
                        {text}
                      </Typography.Paragraph>
                    ),
                  },
                  {
                    title: "核对",
                    width: 200,
                    render: (_, r) =>
                      r.error ? (
                        <Tag
                          className="ui-meta-tag"
                          color="error"
                          style={{
                            whiteSpace: "normal",
                            overflowWrap: "anywhere",
                            maxWidth: "100%",
                          }}
                        >
                          {r.error}
                        </Tag>
                      ) : (
                        <Tag
                          className="ui-meta-tag"
                          color={r.next_attempt > 1 ? "warning" : "success"}
                          style={{
                            whiteSpace: "normal",
                            overflowWrap: "anywhere",
                            maxWidth: "100%",
                          }}
                        >
                          追加第 {r.next_attempt} 次作答
                        </Tag>
                      ),
                  },
                ]}
              />
              <Button
                type="primary"
                loading={action.busy}
                htmlType="button"
                disabled={!preview.valid || locked || !available}
                onClick={async () => {
                  const r = await action.run<{ batch: Batch; submissions: { id: string }[] }>(
                    `/assignments/${assignment.id}/import/confirm`,
                    {
                      question_id: question,
                      csv,
                      preview_hash: preview.preview_hash,
                      request_id,
                    },
                    "POST",
                    "已完成批量作答导入",
                  );
                  if (r) {
                    draft.reset({ question, csv: "", request_id: uuid() });
                    setUploadResetKey((k) => k + 1);
                    setPreview(null);
                    setFileError("");
                    setReceipt(r);
                    await batches.refetch();
                  } else {
                    setPreview(null);
                    await batches.refetch();
                  }
                }}
              >
                确认导入 {preview.rows.length} 份答案
              </Button>
            </>
          )}
        </>
      )}
      {receipt && (
        <>
          <Alert
            type="success"
            showIcon
            message={`已导入 ${receipt.submissions.length} 份答案，尚未评分`}
            action={
              receipt.submissions[0]?.id ? (
                <Link to={`/teacher/homework/submissions/${receipt.submissions[0].id}/grade`}>
                  开始批阅
                </Link>
              ) : undefined
            }
          />
          <Button htmlType="button" onClick={() => resetForm(question)}>
            再导入一批
          </Button>
        </>
      )}
      <Table<Batch>
        size="small"
        rowKey="id"
        loading={batches.isPending}
        dataSource={batches.data || []}
        scroll={{ x: 640 }}
        locale={{ emptyText: "尚无导入记录" }}
        pagination={{ pageSize: 5, showSizeChanger: false }}
        columns={[
          {
            title: "导入时间",
            dataIndex: "created_at",
            width: 165,
            onCell: () => ({ style: { whiteSpace: "nowrap" } }),
            render: when,
          },
          { title: "份数", dataIndex: "answer_count", width: 72 },
          {
            title: "题目",
            dataIndex: "question_id",
            render: (id: string) =>
              questions.find((q) => q.id === id)?.prompt.slice(0, 70) || "题目版本",
          },
        ]}
      />
      {batches.error && (
        <Alert
          type="error"
          message={batches.error.message}
          action={
            <Button htmlType="button" onClick={() => void batches.refetch()}>
              重试读取记录
            </Button>
          }
        />
      )}
      </Space>
    </Form>
  );
}

export function SubmissionImport({
  assignment,
  questions,
}: {
  assignment: Assignment;
  questions: Question[];
}) {
  const { course } = useLearning();
  const [open, setOpen] = useState(false);
  const [locked, setLocked] = useState(false);
  const eligible = useMemo(
    () => questions.filter((q) => q.type !== "quiz"),
    [questions],
  );
  const disabledReason = !course
    ? "请先选择当前课程"
    : !eligible.length
      ? "客观测验不支持批量导入文本作答"
      : "";

  return (
    <>
      <Tooltip title={disabledReason || undefined}>
        <Button
          htmlType="button"
          disabled={!course || !eligible.length}
          onClick={() => setOpen(true)}
        >
          导入文本作答
        </Button>
      </Tooltip>
      <Drawer
        title="批量导入文本作答"
        open={open}
        width="min(100%, 960px)"
        destroyOnHidden
        onClose={() => {
          if (!locked) setOpen(false);
        }}
        maskClosable={!locked}
        closable={!locked}
      >
        {open && (
          <SubmissionImportBody
            assignment={assignment}
            questions={questions}
            eligible={eligible}
            onLockedChange={setLocked}
          />
        )}
      </Drawer>
    </>
  );
}
