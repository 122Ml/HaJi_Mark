import { useMemo, useState } from "react";
import { Button, Card, Input, Space, Table, Tag, Typography } from "antd";
import { Link } from "./context";
import type { Overview } from "./insight";
import type { ReleasedEvidence } from "./learning-gaps";

interface StudentRiskRow extends Overview {
  releasedCount: number;
  avgPct: number | null;
  minPct: number | null;
}

export function InsightStudents({
  overview,
  evidence,
  validStudentFilter,
  onSelectStudent,
}: {
  overview: Overview[];
  evidence: ReleasedEvidence[];
  validStudentFilter: string;
  onSelectStudent: (id: string) => void;
}) {
  const [studentSearch, setStudentSearch] = useState("");

  const studentRiskRows = useMemo<StudentRiskRow[]>(() => {
    const byStudent = new Map<
      string,
      { count: number; scoreSum: number; maxSum: number; minPct: number | null }
    >();
    for (const r of evidence) {
      const cur = byStudent.get(r.student_id) || {
        count: 0,
        scoreSum: 0,
        maxSum: 0,
        minPct: null,
      };
      cur.count += 1;
      cur.scoreSum += r.score;
      cur.maxSum += r.max_score;
      if (r.max_score > 0) {
        const pct = Math.round((r.score / r.max_score) * 100);
        cur.minPct = cur.minPct === null ? pct : Math.min(cur.minPct, pct);
      }
      byStudent.set(r.student_id, cur);
    }
    const needle = studentSearch.trim().toLocaleLowerCase();
    return overview
      .filter(
        (s) =>
          (!validStudentFilter || s.id === validStudentFilter) &&
          (!needle || s.display_name.toLocaleLowerCase().includes(needle)),
      )
      .map((s) => {
        const stats = byStudent.get(s.id);
        const avgPct =
          stats && stats.maxSum > 0
            ? Math.round((stats.scoreSum / stats.maxSum) * 100)
            : null;
        return {
          ...s,
          releasedCount: stats?.count || 0,
          avgPct,
          minPct: stats?.minPct ?? null,
        };
      });
  }, [evidence, overview, validStudentFilter, studentSearch]);

  return (
    <Card
      className="card-panel student-section"
      title={<>{validStudentFilter ? "该学生完成情况" : "班级完成与风险"}</>}
    >
      <Space direction="vertical" className="live-full-width" size="middle">
        {!validStudentFilter && (
          <Input.Search
            aria-label="搜索学生姓名"
            placeholder="搜索学生姓名"
            allowClear
            value={studentSearch}
            onChange={(e) => setStudentSearch(e.target.value)}
          />
        )}
        <Table<StudentRiskRow>
          rowKey="id"
          scroll={{ x: 760 }}
          pagination={{
            pageSize: 10,
            showSizeChanger: false,
            hideOnSinglePage: true,
          }}
          dataSource={studentRiskRows}
          locale={{ emptyText: "暂无匹配的学生数据" }}
          columns={[
            {
              title: "学生",
              key: "student",
              sorter: (a, b) =>
                a.display_name.localeCompare(b.display_name, "zh-CN"),
              render: (_, s) => (
                <Space wrap size={4}>
                  <Button
                    type="link"
                    className="table-text-action"
                    onClick={() => onSelectStudent(s.id)}
                  >
                    {s.display_name}
                  </Button>
                  {s.avgPct !== null && s.avgPct < 60 && (
                    <Tag color="error">需关注</Tag>
                  )}
                  {s.pending_interventions > 0 && (
                    <Tag color="warning">待补学</Tag>
                  )}
                </Space>
              ),
            },
            {
              title: "正式结果数",
              dataIndex: "releasedCount",
              sorter: (a, b) => a.releasedCount - b.releasedCount,
            },
            {
              title: "平均得分率",
              dataIndex: "avgPct",
              sorter: (a, b) => (a.avgPct ?? -1) - (b.avgPct ?? -1),
              render: (v: number | null) =>
                v !== null ? (
                  <Tag color={v < 60 ? "error" : v < 80 ? "warning" : "success"}>
                    {v}%
                  </Tag>
                ) : (
                  <Typography.Text type="secondary">暂无</Typography.Text>
                ),
            },
            {
              title: "最低得分率",
              dataIndex: "minPct",
              sorter: (a, b) => (a.minPct ?? -1) - (b.minPct ?? -1),
              render: (v: number | null) =>
                v !== null ? (
                  `${v}%`
                ) : (
                  <Typography.Text type="secondary">暂无</Typography.Text>
                ),
            },
            {
              title: "已提交作业",
              dataIndex: "submitted_assignments",
              sorter: (a, b) =>
                a.submitted_assignments - b.submitted_assignments,
            },
            {
              title: "完成学习",
              dataIndex: "completed_events",
              sorter: (a, b) => a.completed_events - b.completed_events,
            },
            {
              title: "待执行任务",
              dataIndex: "pending_interventions",
              sorter: (a, b) =>
                a.pending_interventions - b.pending_interventions,
            },
            {
              title: "操作",
              key: "actions",
              render: (_, s) => (
                <Link
                  to={`/teacher/intervention?new=1&student=${encodeURIComponent(s.id)}`}
                >
                  创建补学任务
                </Link>
              ),
            },
          ]}
        />
      </Space>
    </Card>
  );
}
