import { useMemo, useState } from "react";
import { Button, Card, Checkbox, Drawer, Space, Table, Tag, Typography } from "antd";
import { Link } from "./context";
import type { PointFeedback } from "./rubrics";

type Evidence = { submission_id: string; revision_id: string; question_id: string; student_id: string; prompt: string; rubric_id: string | null; rubric_version: number | null; point_scores: PointFeedback[]; knowledge_point_id: string | null };
type Member = { id: string; display_name: string };
type GapMember = { evidence: Evidence; point: PointFeedback };
type Gap = { key: string; prompt: string; title: string; rubric: string; affected: GapMember[]; compared: number; other: number; without: number };

export function LearningGaps({ evidence, members }: { evidence: Evidence[]; members: Member[] }) {
  const [onlyGaps, setOnlyGaps] = useState(true);
  const [selected, setSelected] = useState("");
  const names = new Map(members.map(m => [m.id, m.display_name]));
  const groups = useMemo(() => {
    const enrolled = new Set(members.map(m => m.id));
    const current = evidence.filter(e => enrolled.has(e.student_id));
    const map = new Map<string, Gap>();
    for (const e of current) for (const p of e.point_scores || []) {
      const key = `${e.question_id}:${e.rubric_id}:${p.criterion_id}`;
      let group = map.get(key);
      if (!group) {
        const questionStudents = new Set(current.filter(r => r.question_id === e.question_id).map(r => r.student_id));
        const standardStudents = new Set(current.filter(r => r.question_id === e.question_id && r.rubric_id === e.rubric_id).map(r => r.student_id));
        group = { key, prompt: e.prompt, title: p.title, rubric: e.rubric_version ? `标准 v${e.rubric_version}` : "整题标准", affected: [], compared: 0, other: questionStudents.size - standardStudents.size, without: members.length - questionStudents.size };
        map.set(key, group);
      }
      group.compared++;
      if (p.score < p.max_score) group.affected.push({ evidence: e, point: p });
    }
    return [...map.values()].sort((a, b) => b.affected.length - a.affected.length || a.key.localeCompare(b.key));
  }, [evidence, members]);
  const detail = groups.find(g => g.key === selected);
  return <Card className="card-panel diagnosis-section" title="评分点缺口" extra={<Checkbox checked={onlyGaps} onChange={e => setOnlyGaps(e.target.checked)}>仅看失分项</Checkbox>}>
    <Typography.Paragraph type="secondary">按同一道题、同一标准的正式结果统计。失分表示该次作答存在评分缺口，不能据此断定错因或整体掌握程度。</Typography.Paragraph>
    <Table<Gap> rowKey="key" dataSource={groups.filter(g => !onlyGaps || g.affected.length)} scroll={{ x: 640 }} pagination={{ pageSize: 8, showSizeChanger: false }} locale={{ emptyText: groups.length ? "当前逐点正式结果没有失分项" : "尚无可比较的逐点正式结果；整题评分、待评及未提交不补算" }} columns={[
      { title: "题目", dataIndex: "prompt", ellipsis: true },
      { title: "评分点", render: (_, g) => <Space direction="vertical" size={0}><span>{g.title}</span><Typography.Text type="secondary">{g.rubric}</Typography.Text></Space> },
      { title: "失分 / 有效人数", render: (_, g) => <Space><Tag color={g.affected.length ? "warning" : "success"}>{g.affected.length} / {g.compared} 人</Tag><Button type="link" disabled={!g.affected.length} onClick={() => setSelected(g.key)}>查看证据</Button></Space> },
    ]} />
    <Drawer title={detail?.title || "评分点证据"} width={900} open={!!detail} onClose={() => setSelected("")} destroyOnHidden>
      {detail && <Space direction="vertical" size="middle" className="live-full-width">
        <Typography.Paragraph strong>{detail.prompt}</Typography.Paragraph>
        <Space wrap><Tag>{detail.rubric}</Tag><Tag>同标准有效人数 {detail.compared}</Tag><Tag>其他标准 {detail.other} 人</Tag><Tag>无该题正式结果 {detail.without} 人</Tag></Space>
        <Table<GapMember> rowKey={r => r.evidence.submission_id} dataSource={detail.affected} scroll={{ x: 740 }} pagination={{ pageSize: 8, showSizeChanger: false }} columns={[
          { title: "学生", render: (_, r) => names.get(r.evidence.student_id) },
          { title: "得分", render: (_, r) => `${r.point.score}/${r.point.max_score}` },
          { title: "正式反馈与原句", render: (_, r) => <><Typography.Paragraph>{r.point.feedback || "未填写逐点评语"}</Typography.Paragraph>{r.point.quote && <Typography.Paragraph className="live-prose">“{r.point.quote}”</Typography.Paragraph>}</> },
          { title: "操作", render: (_, r) => <Space direction="vertical"><Link to={`/teacher/homework/submissions/${r.evidence.submission_id}/grade`}>查看原文与评分</Link><Link to={`/teacher/intervention?new=1&student=${r.evidence.student_id}&submission=${r.evidence.submission_id}&point=${r.evidence.knowledge_point_id || ""}`}>安排补学补练</Link></Space> },
        ]} />
      </Space>}
    </Drawer>
  </Card>;
}
