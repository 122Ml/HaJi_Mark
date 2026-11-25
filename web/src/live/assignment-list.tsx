import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Button, Card, Input, Pagination, Select, Typography } from "antd";
import { Plus } from "lucide-react";
import { requestJSON } from "../shared/api";
import { useConfirm } from "../shared/confirm";
import { PageHeader } from "../shared/PageHeader";
import { useSession } from "../shared/session";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  MetaTag,
  MetaTags,
  StatusTag,
} from "../shared/ui";
import { Feedback, Link, useAction, useLearning, when } from "./context";
import { labelFor, questionTypeLabels, stateLabels } from "./domain-meta";
import type { Assignment } from "./types";

export type LiveAssignment = Assignment & {
  submitted_count?: number;
  draft_count?: number;
  feedback_count?: number;
};

export function AssignmentList({ quiz = false }: { quiz?: boolean }) {
  const confirm = useConfirm();
  const { course } = useLearning();
  const { session } = useSession();
  const teacher = session?.user.role === "teacher";
  const root = teacher ? "teacher" : "student";
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("page")) || 1);
  const search = params.get("search") || "";
  const state = params.get("state") || "";
  const sort = params.get("sort") || "new";
  const point = params.get("point") || "";
  const [searchInput, setSearchInput] = useState(search);

  useEffect(() => {
    setSearchInput(search);
  }, [search]);

  const path = useMemo(
    () =>
      `/assignment-worklist?${new URLSearchParams({
        page: String(page),
        size: "12",
        search,
        state,
        sort,
        point,
        kind: quiz ? "quiz" : "homework",
      })}`,
    [page, search, state, sort, point, quiz],
  );

  const query = useQuery({
    queryKey: ["live", course?.id, path],
    enabled: !!course,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) =>
      (
        await requestJSON<{ data: { rows: LiveAssignment[]; total: number } }>(
          `/learning/courses/${course!.id}${path}`,
          { signal },
        )
      ).data,
  });

  const action = useAction();
  const list = query.data?.rows || [];
  const returnTo = `/${root}/${quiz ? "quiz" : "homework"}?${params}`;

  function filter(values: Record<string, string>) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(values)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  }

  return (
    <div className="live-page">
      <PageHeader
        title={quiz ? "测验" : "作业中心"}
        subtitle={course?.title}
        meta={
          query.data ? (
            <MetaTag>共 {query.data.total} 项</MetaTag>
          ) : undefined
        }
        extra={
          teacher ? (
            <Link
              className="primary-link"
              to={quiz ? "/teacher/quiz/new" : "/teacher/homework/new"}
            >
              <Plus size={14} aria-hidden="true" />
              {quiz ? "新建测验" : "新建作业"}
            </Link>
          ) : undefined
        }
      />
      <div className="filter-bar">
        <Input.Search
          aria-label="搜索作业"
          placeholder={quiz ? "搜索测验名称" : "搜索作业名称"}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onSearch={(v) => filter({ search: v, page: "1" })}
          allowClear
        />
        <Select
          aria-label="作业状态"
          value={state}
          options={[
            { value: "", label: "全部状态" },
            ...(teacher ? [{ value: "draft", label: "草稿" }] : []),
            { value: "published", label: "已发布" },
            { value: "closed", label: "已关闭" },
          ]}
          onChange={(v) => filter({ state: v, page: "1" })}
        />
        <Select
          aria-label="作业排序"
          value={sort}
          options={[
            { value: "new", label: "最近创建" },
            { value: "due", label: "截止时间优先" },
          ]}
          onChange={(v) => filter({ sort: v, page: "1" })}
        />
        {point && (
          <Button htmlType="button" onClick={() => filter({ point: "", page: "1" })}>
            清除知识点筛选
          </Button>
        )}
      </div>

      <Feedback message={action.message} failed={action.failed} />

      {query.error ? (
        <Card className="card-panel">
          <ErrorState
            message={query.error.message}
            onRetry={() => void query.refetch()}
          />
        </Card>
      ) : query.isPending && !query.data ? (
        <Card className="card-panel">
          <LoadingState />
        </Card>
      ) : !list.length ? (
        <Card className="card-panel">
          <EmptyState title={`当前没有${quiz ? "测验" : "作业"}`}>
            {teacher
              ? "新建后先保存为草稿，确认题目与标准后再发布。"
              : "教师发布后会显示在这里。"}
          </EmptyState>
        </Card>
      ) : (
        <Card className="card-panel">
          {list.map((a) => {
            const qCount = a.question_count ?? 0;
            const subCount = a.submitted_count ?? 0;
            const fbCount = a.feedback_count ?? 0;
            const draftCount = a.draft_count ?? 0;
            const allSubmitted = qCount > 0 && subCount >= qCount;
            const studentStatus =
              allSubmitted && fbCount >= qCount
                ? { status: "released", label: "反馈已发布" }
                : allSubmitted
                  ? { status: "submitted", label: "已提交" }
                  : subCount > 0
                    ? { status: "partial", label: "部分提交" }
                    : draftCount > 0
                      ? { status: "draft", label: "草稿" }
                      : { status: "pending", label: "未开始" };

            return (
              <article className="live-row" key={a.id}>
                <div>
                  <Typography.Text strong className="item-title">
                    {a.title}
                  </Typography.Text>
                  {a.description && <p>{a.description}</p>}
                  {!teacher && (
                    <MetaTags>
                      <StatusTag
                        status={studentStatus.status}
                        label={studentStatus.label}
                      />
                      <MetaTag>
                        已提交 {subCount}/{qCount} 题
                      </MetaTag>
                      {fbCount > 0 && <MetaTag>{fbCount} 题有反馈</MetaTag>}
                    </MetaTags>
                  )}
                  <MetaTags>
                    <StatusTag
                      status={a.status}
                      label={labelFor(stateLabels, a.status)}
                    />
                    <MetaTag>{labelFor(questionTypeLabels, a.type)}</MetaTag>
                    {a.question_count !== undefined && (
                      <MetaTag>{a.question_count} 题</MetaTag>
                    )}
                    <MetaTag>满分 {a.max_score}</MetaTag>
                    <span className="live-meta">截止 {when(a.due_at)}</span>
                  </MetaTags>
                </div>
                <div className="live-inline">
                  <Link
                    className="ghost-btn"
                    to={`/${root}/homework/${a.id}?from=${encodeURIComponent(returnTo)}`}
                  >
                    {teacher
                      ? "查看题目"
                      : a.status === "closed"
                        ? "查看作答与反馈"
                        : "进入作答"}
                  </Link>
                  {teacher && (
                    <>
                      {a.status === "draft" && (
                        <Link
                          className="ghost-btn"
                          to={`/teacher/homework/${a.id}/edit?from=${encodeURIComponent(returnTo)}`}
                        >
                          编辑草稿
                        </Link>
                      )}
                      <Link
                        className="ghost-btn"
                        to={`/teacher/homework/${a.id}/submissions?from=${encodeURIComponent(returnTo)}`}
                      >
                        查看提交
                      </Link>
                      {a.status === "draft" && (
                        <Button
                          htmlType="button"
                          disabled={action.busy}
                          onClick={async () => {
                            if (
                              !(await confirm(
                                "发布后题目与评分标准将冻结，确认发布？",
                              ))
                            ) {
                              return;
                            }
                            await action.run(`/assignments/${a.id}/state`, {
                              state: "published",
                            });
                          }}
                          type="primary"
                        >
                          发布
                        </Button>
                      )}
                      {a.status === "published" && (
                        <Button
                          htmlType="button"
                          disabled={action.busy}
                          onClick={async () => {
                            if (
                              !(await confirm(
                                "关闭后将停止接收学生新提交，确认关闭？",
                                { danger: true },
                              ))
                            ) {
                              return;
                            }
                            await action.run(`/assignments/${a.id}/state`, {
                              state: "closed",
                            });
                          }}
                        >
                          关闭
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </article>
            );
          })}
          <Pagination
            responsive
            hideOnSinglePage
            current={page}
            pageSize={12}
            total={query.data?.total || 0}
            onChange={(v) => filter({ page: String(v) })}
            showSizeChanger={false}
          />
        </Card>
      )}
    </div>
  );
}
