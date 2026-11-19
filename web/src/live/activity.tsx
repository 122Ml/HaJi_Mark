import { useEffect, useMemo, useState } from "react";
import { Alert, Card, Collapse, Pagination, Select, Typography } from "antd";
import { Link, useLiveQuery, when } from "./context";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  MetaTag,
  MetaTags,
  StatusTag,
} from "../shared/ui";

interface Activity {
  id: string;
  actor_id?: string;
  display_name: string;
  actor_name?: string;
  verb: string;
  resource_id: string | null;
  submission_id: string | null;
  object_version: number;
  occurred_at: string;
  title: string;
  locator: string;
  source_note: string;
  source_url: string;
  attempt: number;
  answer_sha256: string;
}

const VERB_META: Record<string, { status: string; label: string }> = {
  "submission.imported": { status: "submitted", label: "教师导入作答" },
  "submission.submitted": { status: "submitted", label: "提交作答" },
  completed: { status: "completed", label: "完成学习" },
  opened: { status: "active", label: "打开资料" },
};

const PAGE_SIZE = 10;

export function ActivityTimeline({
  teacher,
  studentID,
  enabled = true,
}: {
  teacher: boolean;
  studentID: string;
  enabled?: boolean;
}) {
  const [page, setPage] = useState(1);
  const [verbFilter, setVerbFilter] = useState("");
  const query = useLiveQuery<Activity[]>(
    `/activity${studentID ? `?student_id=${encodeURIComponent(studentID)}` : ""}`,
    enabled,
  );

  const filtered = useMemo(() => {
    const rows = query.data || [];
    if (!verbFilter) return rows;
    return rows.filter((row) => row.verb === verbFilter);
  }, [query.data, verbFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const visibleRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <Card
      className="card-panel activity-section"
      title={teacher ? "学生学习与提交记录" : "我的学习与提交记录"}
      extra={
        query.data && query.data.length > 0 ? (
          <Select
            aria-label="筛选记录类型"
            size="small"
            value={verbFilter}
            onChange={(value) => {
              setVerbFilter(value);
              setPage(1);
            }}
            style={{ minWidth: 140 }}
            options={[
              { value: "", label: "全部类型" },
              { value: "submission.submitted", label: "提交作答" },
              { value: "submission.imported", label: "教师导入作答" },
              { value: "completed", label: "完成学习" },
              { value: "opened", label: "打开资料" },
            ]}
          />
        ) : undefined
      }
    >
      {query.error && (
        <ErrorState
          message={query.error.message}
          onRetry={() => void query.refetch()}
        />
      )}
      {enabled && query.isPending && <LoadingState label="正在读取记录…" />}
      {query.data && query.data.length >= 500 && (
        <Alert
          type="info"
          showIcon
          message="当前仅展示最近 500 条学习与提交记录，可按学生或类型缩小范围。"
          style={{ marginBottom: 12 }}
        />
      )}
      {query.isSuccess && filtered.length === 0 && (
        <EmptyState
          title={verbFilter ? "当前筛选条件下暂无记录" : "暂无记录"}
        />
      )}
      {visibleRows.map((event) => {
        const meta = VERB_META[event.verb] || {
          status: "default",
          label: event.verb || "学习记录",
        };
        const showActor =
          !!event.actor_name && event.actor_name !== event.display_name;
        const actorPrefix =
          event.verb === "submission.imported" ? "导入教师：" : "操作人：";
        return (
          <article className="live-row" key={event.id}>
            <div>
              <Typography.Text strong className="item-title">
                {event.title || "未命名记录"}
              </Typography.Text>
              <MetaTags>
                <StatusTag status={meta.status} label={meta.label} />
                <MetaTag>{event.display_name || "未知用户"}</MetaTag>
                {showActor && (
                  <MetaTag>
                    {actorPrefix}
                    {event.actor_name}
                  </MetaTag>
                )}
                <MetaTag>v{event.object_version}</MetaTag>
                <span className="live-meta">{when(event.occurred_at)}</span>
              </MetaTags>
              {event.resource_id && (
                <p>
                  来源：
                  {event.source_note || event.source_url || "尚未登记来源"}
                  {event.locator ? ` · ${event.locator}` : ""}
                </p>
              )}
              {event.submission_id && (
                <p>
                  第{event.attempt}次作答 · 原文指纹{" "}
                  {event.answer_sha256.slice(0, 12)}…
                </p>
              )}
              <Collapse
                items={[
                  {
                    key: "content",
                    label: "核对记录编号",
                    children: (
                      <>
                        <p>
                          事件：
                          <Typography.Text code copyable>
                            {event.id}
                          </Typography.Text>
                        </p>
                        <p>
                          对象：
                          <Typography.Text code copyable>
                            {event.submission_id || event.resource_id || "无"}
                          </Typography.Text>
                        </p>
                      </>
                    ),
                  },
                ]}
              />
            </div>
            {(event.submission_id || event.resource_id) && (
              <Link
                to={
                  event.submission_id
                    ? `/${teacher ? "teacher" : "student"}/homework/submissions/${event.submission_id}/${teacher ? "grade" : "feedback"}`
                    : `/${teacher ? "teacher/materials?tab=published&" : "student/course-content?"}resource=${event.resource_id}`
                }
              >
                查看{event.submission_id ? "原始作答" : "资料原文"}
              </Link>
            )}
          </article>
        );
      })}
      <Pagination
        current={page}
        pageSize={PAGE_SIZE}
        total={filtered.length}
        onChange={setPage}
        showSizeChanger={false}
        hideOnSinglePage
        responsive
      />
    </Card>
  );
}
