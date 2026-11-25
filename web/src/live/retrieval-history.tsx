import { useEffect, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Drawer,
  Pagination,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import { requestJSON } from "../shared/api";
import { useSession } from "../shared/session";
import { ErrorState, LoadingState, MetaTag } from "../shared/ui";
import { GroundedAnswer } from "./citations";
import { Link, useLearning, useLiveQuery, when } from "./context";
import type { AssistAnswer } from "./types";

interface TurnSummary {
  id: string;
  question: string;
  state: string;
  created_at: string;
  total?: number;
}

interface TurnDetail {
  id: string;
  question: string;
  state: string;
  created_at: string;
  profile_id?: string;
  resource_id?: string | null;
  response?: Partial<AssistAnswer> | null;
}

const LEGACY_RESOURCE_RE = /\n?\[限定学习资料：([^\]\s]+)\]\s*$/;

function parseTurnQuestion(
  rawQuestion: string,
  columnResourceID?: string | null,
): { question: string; resourceID: string } {
  const match = rawQuestion.match(LEGACY_RESOURCE_RE);
  const cleaned = match
    ? rawQuestion.replace(LEGACY_RESOURCE_RE, "").trim()
    : rawQuestion;
  const resourceID = (columnResourceID || match?.[1] || "").trim();
  return { question: cleaned, resourceID };
}

function resourceHref(teacher: boolean, resourceID: string): string {
  return teacher
    ? `/teacher/materials?tab=published&resource=${encodeURIComponent(resourceID)}`
    : `/student/course-content?resource=${encodeURIComponent(resourceID)}`;
}

function hasValidAnswer(
  response?: Partial<AssistAnswer> | null,
): response is AssistAnswer {
  return !!response && typeof response.text === "string" && response.text.length > 0;
}

export function RetrievalHistory({
  reuse,
  renderAnswer,
}: {
  reuse: (question: string, resourceID?: string) => void;
  renderAnswer?: (answer: AssistAnswer) => ReactNode;
}) {
  const { session } = useSession();
  const { course } = useLearning();
  const teacher = session?.user.role === "teacher";
  const [params, setParams] = useSearchParams();
  const rawPage = Number(params.get("history_page"));
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const selected = params.get("turn") || "";

  const history = useLiveQuery<{ rows: TurnSummary[]; total: number }>(
    `/assist/history?page=${page}&size=10`,
  );

  const detail = useQuery({
    queryKey: ["live", course?.id, `/assist/history/${selected}`],
    enabled: !!course && !!selected,
    refetchOnMount: "always",
    queryFn: async ({ signal }) =>
      (
        await requestJSON<{ data: TurnDetail }>(
          `/learning/courses/${course!.id}/assist/history/${encodeURIComponent(selected)}`,
          { signal },
        )
      ).data,
    refetchInterval: (q) =>
      !q.state.error && q.state.data?.state === "running" ? 2500 : false,
  });

  const total = history.data?.total || 0;
  const maxPage = Math.max(1, Math.ceil(total / 10));

  useEffect(() => {
    if (history.data && page > maxPage) {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("history_page", String(maxPage));
          return next;
        },
        { replace: true },
      );
    }
  }, [history.data, page, maxPage, setParams]);

  function select(id: string) {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id) next.set("turn", id);
      else next.delete("turn");
      return next;
    });
  }

  function renderStateTag(value: string) {
    return (
      <Tag
        color={
          value === "succeeded"
            ? "success"
            : value === "failed"
              ? "error"
              : "processing"
        }
      >
        {value === "succeeded"
          ? "已保存"
          : value === "failed"
            ? "生成未完成"
            : value === "running"
              ? "正在生成"
              : "结果待核对"}
      </Tag>
    );
  }

  const parsedDetail = detail.data
    ? parseTurnQuestion(detail.data.question, detail.data.resource_id)
    : null;

  return (
    <>
      <Card
        className="card-panel"
        title="我的问答历史"
        extra={
          <Button
            htmlType="button"
            loading={history.isFetching}
            onClick={() => void history.refetch()}
          >
            刷新
          </Button>
        }
      >
        {history.error ? (
          <ErrorState
            message={history.error.message}
            onRetry={() => void history.refetch()}
          />
        ) : (
          <>
            <Table<TurnSummary>
              rowKey="id"
              loading={history.isPending}
              dataSource={history.data?.rows || []}
              pagination={false}
              scroll={{ x: 520 }}
              locale={{ emptyText: "完成一次资料问答后，记录会保存在这里" }}
              columns={[
                {
                  title: "问题",
                  dataIndex: "question",
                  render: (text: string, row) => {
                    const parsed = parseTurnQuestion(text);
                    const preview =
                      parsed.question.length > 90
                        ? `${parsed.question.slice(0, 90)}…`
                        : parsed.question;
                    return (
                      <Space wrap size="small">
                        <Button
                          htmlType="button"
                          type="link"
                          className="table-text-action"
                          onClick={() => select(row.id)}
                        >
                          {preview || "查看问答记录"}
                        </Button>
                        {parsed.resourceID && (
                          <MetaTag>限定资料</MetaTag>
                        )}
                      </Space>
                    );
                  },
                },
                {
                  title: "状态",
                  dataIndex: "state",
                  width: 120,
                  render: renderStateTag,
                },
                {
                  title: "时间",
                  dataIndex: "created_at",
                  width: 180,
                  render: when,
                },
              ]}
            />
            <Pagination
              current={Math.min(page, maxPage)}
              pageSize={10}
              total={total}
              showSizeChanger={false}
              hideOnSinglePage
              onChange={(v) =>
                setParams((prev) => {
                  const next = new URLSearchParams(prev);
                  next.set("history_page", String(v));
                  return next;
                })
              }
            />
          </>
        )}
      </Card>
      <Drawer
        open={!!selected}
        title="问答记录"
        width="min(100vw, 720px)"
        onClose={() => select("")}
        destroyOnHidden
      >
        {detail.isPending ? (
          <LoadingState />
        ) : detail.error ? (
          <ErrorState
            message={detail.error.message}
            onRetry={() => void detail.refetch()}
          />
        ) : detail.data && parsedDetail ? (
          <Space
            direction="vertical"
            size="middle"
            className="live-full-width"
            styles={{ item: { maxWidth: "100%", minWidth: 0 } }}
          >
            <Typography.Paragraph
              strong
              style={{ maxWidth: "100%", overflowWrap: "anywhere", marginBottom: 0 }}
            >
              {parsedDetail.question}
            </Typography.Paragraph>
            <Space wrap>
              {renderStateTag(detail.data.state)}
              <Typography.Text type="secondary">
                {when(detail.data.created_at)}
              </Typography.Text>
              {parsedDetail.resourceID && (
                <>
                  <MetaTag>限定学习资料</MetaTag>
                  <Link to={resourceHref(teacher, parsedDetail.resourceID)}>
                    查看限定资料
                  </Link>
                </>
              )}
            </Space>
            {detail.data.state === "succeeded" &&
            hasValidAnswer(detail.data.response) ? (
              renderAnswer ? (
                renderAnswer(detail.data.response)
              ) : (
                <GroundedAnswer answer={detail.data.response} />
              )
            ) : detail.data.state === "running" ? (
              <Alert
                type="info"
                showIcon
                message="回答正在生成中，页面会自动刷新查看结果。"
                action={
                  <Button
                    htmlType="button"
                    size="small"
                    onClick={() => void detail.refetch()}
                  >
                    立即刷新
                  </Button>
                }
              />
            ) : (
              <Alert
                type="warning"
                showIcon
                message="尚无已保存回答"
                action={
                  <Button
                    htmlType="button"
                    size="small"
                    onClick={() => void detail.refetch()}
                  >
                    刷新记录
                  </Button>
                }
              />
            )}
            <Button
              htmlType="button"
              onClick={() => {
                reuse(
                  parsedDetail.question,
                  parsedDetail.resourceID || undefined,
                );
                select("");
              }}
            >
              带回输入框
            </Button>
          </Space>
        ) : null}
      </Drawer>
    </>
  );
}
