import { useMemo, useState } from "react";
import {
  Button,
  Card,
  Checkbox,
  Drawer,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { Link } from "./context";
import type { Member, PointFeedback } from "./types";

export interface ReleasedEvidence {
  submission_id: string;
  student_id: string;
  student_name?: string;
  question_id: string;
  assignment_id?: string;
  assignment_title: string;
  answer_text: string;
  attempt: number;
  revision_id: string;
  score: number;
  feedback: string;
  max_score: number;
  prompt: string;
  knowledge_point_id: string | null;
  resource_id: string | null;
  released_at: string;
  rubric_id: string | null;
  rubric_version: number | null;
  point_scores: PointFeedback[];
}

type GapEvidence = Pick<
  ReleasedEvidence,
  | "submission_id"
  | "revision_id"
  | "question_id"
  | "student_id"
  | "student_name"
  | "assignment_title"
  | "prompt"
  | "rubric_id"
  | "rubric_version"
  | "point_scores"
  | "knowledge_point_id"
>;

type GapMember = { evidence: GapEvidence; point: PointFeedback };

type Gap = {
  key: string;
  assignmentTitle: string;
  prompt: string;
  title: string;
  rubric: string;
  affected: GapMember[];
  compared: number;
  lossRate: number;
  other: number;
  without: number;
};

export function LearningGaps({
  evidence,
  members,
}: {
  evidence: GapEvidence[];
  members: Member[];
}) {
  const [onlyGaps, setOnlyGaps] = useState(true);
  const [selected, setSelected] = useState("");

  const names = useMemo(
    () => new Map((members || []).map((m) => [m.id, m.display_name])),
    [members],
  );

  const groups = useMemo(() => {
    const safeMembers = members || [];
    const enrolled = new Set(safeMembers.map((m) => m.id));
    const current = (evidence || []).filter(
      (e) => e && enrolled.has(e.student_id) && Boolean(e.question_id),
    );
    if (!current.length) return [] as Gap[];

    // Pre-index students per question and per (question, rubric) in O(N).
    const questionStudents = new Map<string, Set<string>>();
    const standardStudents = new Map<string, Set<string>>();
    for (const r of current) {
      let qSet = questionStudents.get(r.question_id);
      if (!qSet) {
        qSet = new Set<string>();
        questionStudents.set(r.question_id, qSet);
      }
      qSet.add(r.student_id);

      const stdKey = `${r.question_id}:${r.rubric_id || ""}`;
      let sSet = standardStudents.get(stdKey);
      if (!sSet) {
        sSet = new Set<string>();
        standardStudents.set(stdKey, sSet);
      }
      sSet.add(r.student_id);
    }

    const map = new Map<string, Gap>();
    for (const e of current) {
      const points = Array.isArray(e.point_scores) ? e.point_scores : [];
      if (!points.length) continue;
      const stdKey = `${e.question_id}:${e.rubric_id || ""}`;
      const qCount = questionStudents.get(e.question_id)?.size || 0;
      const sCount = standardStudents.get(stdKey)?.size || 0;

      for (const p of points) {
        if (!p || !p.criterion_id) continue;
        const key = `${e.question_id}:${e.rubric_id || ""}:${p.criterion_id}`;
        let group = map.get(key);
        if (!group) {
          group = {
            key,
            assignmentTitle: e.assignment_title || "",
            prompt: e.prompt || "未命名题目",
            title: p.title || p.criterion_id,
            rubric: e.rubric_version ? `标准 v${e.rubric_version}` : "整题标准",
            affected: [],
            compared: 0,
            lossRate: 0,
            other: Math.max(0, qCount - sCount),
            without: Math.max(0, safeMembers.length - qCount),
          };
          map.set(key, group);
        }
        group.compared += 1;
        if (p.score < p.max_score) {
          group.affected.push({ evidence: e, point: p });
        }
      }
    }

    const list = [...map.values()].map((g) => ({
      ...g,
      lossRate: g.compared > 0 ? g.affected.length / g.compared : 0,
    }));
    return list.sort(
      (a, b) =>
        b.affected.length - a.affected.length ||
        b.lossRate - a.lossRate ||
        a.key.localeCompare(b.key),
    );
  }, [evidence, members]);

  const detail = useMemo(
    () => groups.find((g) => g.key === selected),
    [groups, selected],
  );

  const visibleGroups = useMemo(
    () => groups.filter((g) => !onlyGaps || g.affected.length > 0),
    [groups, onlyGaps],
  );

  return (
    <Card
      className="card-panel diagnosis-section"
      title="评分点缺口"
      extra={
        <Checkbox
          checked={onlyGaps}
          onChange={(e) => setOnlyGaps(e.target.checked)}
        >
          仅看失分项
        </Checkbox>
      }
    >
      <Table<Gap>
        rowKey="key"
        dataSource={visibleGroups}
        scroll={{ x: 640 }}
        pagination={{ pageSize: 8, showSizeChanger: false, hideOnSinglePage: true }}
        locale={{
          emptyText: groups.length
            ? "当前逐点正式结果没有失分项"
            : "尚无可比较的逐点正式结果；整题评分、待评及未提交不补算",
        }}
        columns={[
          {
            title: "题目",
            key: "prompt",
            ellipsis: true,
            render: (_, g) => (
              <Space direction="vertical" size={0} className="live-full-width">
                {g.assignmentTitle && (
                  <Typography.Text type="secondary">
                    {g.assignmentTitle}
                  </Typography.Text>
                )}
                <Tooltip title={g.prompt}>
                  <Typography.Text ellipsis>{g.prompt}</Typography.Text>
                </Tooltip>
              </Space>
            ),
          },
          {
            title: "评分点",
            key: "criterion",
            render: (_, g) => (
              <Space direction="vertical" size={0}>
                <span>{g.title}</span>
                <Typography.Text type="secondary">{g.rubric}</Typography.Text>
              </Space>
            ),
          },
          {
            title: (
              <Tooltip
                title="同题、同标准的正式结果；失分不代表整体掌握程度"
                trigger={["hover", "focus"]}
              >
                <Typography.Text tabIndex={0}>失分 / 有效人数</Typography.Text>
              </Tooltip>
            ),
            key: "affected",
            render: (_, g) => (
              <Space wrap>
                <Tag color={g.affected.length ? "warning" : "success"}>
                  {g.affected.length} / {g.compared} 人
                  {g.compared > 0 ? ` (${Math.round(g.lossRate * 100)}%)` : ""}
                </Tag>
                <Button
                  type="link"
                  disabled={!g.affected.length}
                  onClick={() => setSelected(g.key)}
                >
                  查看证据
                </Button>
              </Space>
            ),
          },
        ]}
      />
      <Drawer
        title={detail?.title || "评分点证据"}
        width="min(100vw, 900px)"
        open={!!detail}
        onClose={() => setSelected("")}
        destroyOnHidden
      >
        {detail && (
          <Space direction="vertical" size="middle" className="live-full-width">
            {detail.assignmentTitle && (
              <Typography.Text type="secondary">
                {detail.assignmentTitle}
              </Typography.Text>
            )}
            <Typography.Paragraph strong>{detail.prompt}</Typography.Paragraph>
            <Space wrap>
              <Tag>{detail.rubric}</Tag>
              <Tag>同标准有效人数 {detail.compared}</Tag>
              <Tag color="warning">
                失分率 {Math.round(detail.lossRate * 100)}%
              </Tag>
              <Tag>其他标准 {detail.other} 人</Tag>
              <Tag>无该题正式结果 {detail.without} 人</Tag>
            </Space>
            <Table<GapMember>
              rowKey={(r) => r.evidence.submission_id}
              dataSource={detail.affected}
              scroll={{ x: 740 }}
              pagination={{
                pageSize: 8,
                showSizeChanger: false,
                hideOnSinglePage: true,
              }}
              columns={[
                {
                  title: "学生",
                  key: "student",
                  render: (_, r) =>
                    r.evidence.student_name ||
                    names.get(r.evidence.student_id) ||
                    r.evidence.student_id,
                },
                {
                  title: "得分",
                  key: "score",
                  render: (_, r) => `${r.point.score}/${r.point.max_score}`,
                },
                {
                  title: "正式反馈与原句",
                  key: "feedback",
                  render: (_, r) => (
                    <>
                      <Typography.Paragraph>
                        {r.point.feedback || "未填写逐点评语"}
                      </Typography.Paragraph>
                      {r.point.quote && (
                        <Typography.Paragraph className="live-prose">
                          “{r.point.quote}”
                        </Typography.Paragraph>
                      )}
                    </>
                  ),
                },
                {
                  title: "操作",
                  key: "actions",
                  render: (_, r) => (
                    <Space direction="vertical">
                      <Link
                        to={`/teacher/homework/submissions/${encodeURIComponent(r.evidence.submission_id)}/grade`}
                      >
                        查看原文与评分
                      </Link>
                      <Link
                        to={`/teacher/intervention?new=1&student=${encodeURIComponent(r.evidence.student_id)}&submission=${encodeURIComponent(r.evidence.submission_id)}&point=${encodeURIComponent(r.evidence.knowledge_point_id || "")}`}
                      >
                        安排补学补练
                      </Link>
                    </Space>
                  ),
                },
              ]}
            />
          </Space>
        )}
      </Drawer>
    </Card>
  );
}
