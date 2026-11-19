import { Button, Card, Collapse, List, Tag } from "antd";
import { useMemo } from "react";
import { PageHeader } from "../shared/PageHeader";
import {
  EmptyState,
  ErrorState,
  FeatureNotice,
  LoadingState,
  MetaTag,
  MetaTags,
  StatusTag,
} from "../shared/ui";
import { Feedback, Link, useAction, useLearning, useLiveQuery, when } from "./context";
import type { Knowledge, Resource } from "./types";
import { RecommendationPanel } from "./intelligence";

interface PathItem {
  knowledge_point_id: string;
  title: string;
  description: string;
  reason: string;
  position: number;
  assignment_id?: string | null;
}

interface PathData {
  path: { id: string; created_at: string; rule_version: string };
  items: PathItem[];
  total_points?: number;
}

interface PathEvent {
  resource_id: string | null;
  verb: string;
}

export function StudyPath() {
  const { course } = useLearning();
  const query = useLiveQuery<PathData | null>("/path");
  const resources = useLiveQuery<Resource[]>("/resources");
  const events = useLiveQuery<PathEvent[]>("/events");
  const ragStatus = useLiveQuery<{ configured: boolean }>("/retrieval/status");
  const ragEnabled = !!ragStatus.data?.configured;
  const knowledge = useLiveQuery<Knowledge[]>("/knowledge", ragEnabled);
  const action = useAction();

  const completedSet = useMemo(() => {
    const set = new Set<string>();
    for (const e of events.data || []) {
      if (e.resource_id && e.verb === "completed") {
        set.add(e.resource_id);
      }
    }
    return set;
  }, [events.data]);

  const progressSummary = useMemo(() => {
    if (!query.data?.items.length) return { total: 0, completed: 0 };
    const seen = new Set<string>();
    let completed = 0;
    for (const item of query.data.items) {
      for (const r of resources.data || []) {
        if (r.knowledge_point_id === item.knowledge_point_id && !seen.has(r.id)) {
          seen.add(r.id);
          if (completedSet.has(r.id)) completed += 1;
        }
      }
    }
    return { total: seen.size, completed };
  }, [query.data?.items, resources.data, completedSet]);

  if (query.isPending || resources.isPending || events.isPending) {
    return (
      <div className="live-page">
        <PageHeader title="学习路径" subtitle={course?.title} />
        <LoadingState label="正在读取学习路径…" />
      </div>
    );
  }
  if (query.error || resources.error || events.error) {
    return (
      <div className="live-page">
        <PageHeader title="学习路径" subtitle={course?.title} />
        <ErrorState
          message={(query.error || resources.error || events.error)!.message}
          onRetry={() => {
            void query.refetch();
            void resources.refetch();
            void events.refetch();
            if (ragEnabled) void knowledge.refetch();
          }}
        />
      </div>
    );
  }

  return (
    <div className="live-page">
      <PageHeader
        title="学习路径"
        subtitle={course?.title}
        extra={
          <Button
            disabled={action.busy}
            onClick={() =>
              void action.run("/path", {}, "POST", "学习路径已更新", {
                invalidatePrefixes: ["path", "intelligence"],
              })
            }
            type="primary"
          >
            {query.data ? "重新规划" : "生成学习路径"}
          </Button>
        }
      />
      <Feedback message={action.message} failed={action.failed} />
      {ragEnabled ? (
        <RecommendationPanel
          pathReady={!!query.data?.items.length}
          pathExists={!!query.data}
        />
      ) : (
        !ragStatus.isPending && (
          <FeatureNotice
            title="已使用规则规划学习路径"
            description="当前环境未启用 AI 智能排序推荐，路径严格按照课程先修依赖关系与正式成绩规则自动规划。"
          />
        )
      )}
      {query.data ? (
        <>
          <Card className="card-panel" title="当前路径">
            <MetaTags>
              <MetaTag>规划于 {when(query.data.path.created_at)}</MetaTag>
              <MetaTag>
                {typeof query.data.total_points === "number"
                  ? `待学 ${query.data.items.length} / 共 ${query.data.total_points} 个知识点`
                  : `共 ${query.data.items.length} 个知识点`}
              </MetaTag>
              {progressSummary.total > 0 && (
                <MetaTag>
                  关联资料已完成 {progressSummary.completed}/{progressSummary.total}
                </MetaTag>
              )}
              {query.data.path.rule_version && (
                <MetaTag>规则：{query.data.path.rule_version}</MetaTag>
              )}
            </MetaTags>
            <div style={{ marginTop: 12 }}>
              <Collapse
                items={[
                  {
                    key: "content",
                    label: "查看规划依据",
                    children: (
                      <p>
                        优先按先修依赖拓扑顺序排列尚无评分或表现低于 60%
                        的知识点，并自动前置补齐相关基础知识点。
                      </p>
                    ),
                  },
                ]}
              />
            </div>
          </Card>
          {!query.data.items.length && (
            <Card className="card-panel">
              <EmptyState title="已完成当前学习路径" />
            </Card>
          )}
          {query.data.items.map((p, i) => {
            const linked =
              resources.data?.filter(
                (r) => r.knowledge_point_id === p.knowledge_point_id,
              ) || [];
            const relatedKnowledge =
              ragEnabled && !knowledge.error
                ? (knowledge.data || []).filter((k) =>
                    k.knowledge_point_ids.includes(p.knowledge_point_id),
                  )
                : [];
            const encodedPoint = encodeURIComponent(p.knowledge_point_id);
            return (
              <Card
                className="card-panel"
                key={p.knowledge_point_id}
                title={`${i + 1}. ${p.title}`}
                extra={<Tag color="processing">先修顺序 #{i + 1}</Tag>}
              >
                <p>{p.reason}</p>
                {p.description && <p className="live-meta">{p.description}</p>}
                {ragEnabled && !knowledge.error && (
                  <Collapse
                    style={{ marginBottom: 12 }}
                    items={[
                      {
                        key: "knowledge",
                        label: `关联精炼知识（${relatedKnowledge.length}）`,
                        children: relatedKnowledge.length ? (
                          <List
                            dataSource={relatedKnowledge}
                            pagination={{
                              pageSize: 5,
                              size: "small",
                              hideOnSinglePage: true,
                              showSizeChanger: false,
                            }}
                            renderItem={(k) => (
                              <List.Item
                                actions={[
                                  <Link
                                    key="read"
                                    to={`/student/knowledge?knowledge=${encodeURIComponent(k.id)}`}
                                  >
                                    阅读知识
                                  </Link>,
                                ]}
                              >
                                <List.Item.Meta
                                  title={
                                    <>
                                      {k.title} <Tag>v{k.version}</Tag>
                                    </>
                                  }
                                  description={k.conditions || undefined}
                                />
                              </List.Item>
                            )}
                          />
                        ) : (
                          <EmptyState title="暂无关联知识" />
                        ),
                      },
                    ]}
                  />
                )}
                {linked.length ? (
                  linked.map((r) => {
                    const done = completedSet.has(r.id);
                    return (
                      <div className="live-row" key={r.id}>
                        <div>
                          <Link
                            to={`/student/course-content?node=${encodedPoint}&resource=${encodeURIComponent(r.id)}`}
                          >
                            {r.title}
                          </Link>
                          <MetaTags>
                            <StatusTag
                              status={done ? "completed" : "pending"}
                              label={done ? "已完成学习" : "待学习"}
                            />
                            {r.locator && <MetaTag>{r.locator}</MetaTag>}
                          </MetaTags>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="live-meta">
                    当前缺少已审核的对应学习资料，请联系教师补充。
                  </p>
                )}
                <div className="live-inline" style={{ marginTop: 14 }}>
                  {p.assignment_id ? (
                    <Link
                      className="ghost-btn"
                      to={`/student/homework/${encodeURIComponent(p.assignment_id)}`}
                    >
                      进入相关练习
                    </Link>
                  ) : (
                    <>
                      <Link
                        className="ghost-btn"
                        to={`/student/homework?point=${encodedPoint}`}
                      >
                        查看相关作业与反馈
                      </Link>
                      <Link
                        className="ghost-btn"
                        to={`/student/quiz?point=${encodedPoint}`}
                      >
                        查看相关测验
                      </Link>
                    </>
                  )}
                </div>
              </Card>
            );
          })}
        </>
      ) : (
        <Card className="card-panel">
          <EmptyState title="尚未生成学习路径">
            点击上方“生成学习路径”按钮，根据课程知识图谱与成绩规则自动规划。
          </EmptyState>
        </Card>
      )}
    </div>
  );
}
