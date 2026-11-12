import { Field } from "../shared/Field";
import { useConfirm } from "../shared/confirm";
import { useState } from "react";
import {
  Select,
  Form,
  Input,
  Checkbox,
  Button,
  Collapse,
  Card,
  InputNumber,
} from "antd";
import { Feedback, Link, useAction, useLiveQuery } from "./context";
import { WorkflowJob } from "./workflow-job";
import { type TopicData } from "./content-topics";
import { RichContent } from "./content-render";
import { DraftNotice, useEditorDraft } from "./editing";

export function URLImport({ onDone }: { onDone: () => void }) {
  const [url, setURL] = useState(""),
    [title, setTitle] = useState(""),
    [note, setNote] = useState(""),
    [allow, setAllow] = useState(false),
    action = useAction();
  return (
    <Form
      className="live-form"
      onFinish={async () => {
        if (
          await action.run("/sources/url", {
            url,
            title,
            source_note: note,
            allow_derived: allow,
          })
        )
          onDone();
      }}
      layout="vertical"
    >
      <Field
        className="ui-field"
        label={<>公开网页／直链文档</>}
        required={true}
      >
        <Input
          aria-label="公开网页／直链文档"
          type="url"
          required
          value={url}
          onChange={(e) => setURL(e.target.value)}
        />
      </Field>
      <Field className="ui-field" label={<>标题</>}>
        <Input
          aria-label="标题"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </Field>
      <Field className="ui-field" label={<>来源说明</>} required={true}>
        <Input.TextArea
          aria-label="来源说明"
          required
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <Checkbox
        className="rag-check"
        checked={allow}
        onChange={(e) => setAllow(e.target.checked)}
      >
        允许知识提炼
      </Checkbox>
      <Feedback message={action.message} failed={action.failed} />
      <Button disabled={action.busy} htmlType="submit" type="primary">
        {action.busy ? "保存快照中…" : "导入并解析"}
      </Button>
    </Form>
  );
}
type Suggestions = {
  outline: { title: string; fragment_ids: string[] }[];
  topic_ids: string[];
  new_topic_names: string[];
  tags: string[];
  knowledge_point_ids: string[];
  similar_knowledge_ids: string[];
  reason: string;
};
export function SourceSuggestions({ id }: { id: string }) {
  const action = useAction(),
    topics = useLiveQuery<TopicData>("/topics"),
    known = useLiveQuery<{ id: string; title: string }[]>("/knowledge"),
    points = useLiveQuery<{
      points: { id: string; title: string; kind: string }[];
    }>("");
  const [candidate, setCandidate] = useState<Suggestions | null>(null),
    [job, setJob] = useState("");
  const [outline, setOutline] = useState<string[]>([]),
    [topicIDs, setTopics] = useState<string[]>([]),
    [newTopics, setNewTopics] = useState<string[]>([]),
    [tags, setTags] = useState<string[]>([]),
    [pointIDs, setPoints] = useState<string[]>([]);
  return (
    <Collapse
      className="card-panel"
      items={[
        {
          key: "content",
          label: <>目录与归类建议</>,
          children: (
            <>
              <WorkflowJob
                kind="source_suggest"
                target={{ source_id: id }}
                onAdopt={(o, j) => {
                  const s = o as unknown as Suggestions;
                  setCandidate(s);
                  setJob(j);
                  setOutline([]);
                  setTopics(s.topic_ids || []);
                  setNewTopics([]);
                  setTags(s.tags || []);
                  setPoints(s.knowledge_point_ids || []);
                }}
              />
              {candidate && (
                <div className="live-form">
                  <p>{candidate.reason}</p>
                  <Card size="small" title={<>追加目录</>}>
                    {candidate.outline?.map((s, i) => (
                      <Checkbox
                        key={i}
                        className="rag-check"
                        checked={outline.includes(s.title)}
                        onChange={(e) =>
                          setOutline(
                            e.target.checked
                              ? [...outline, s.title]
                              : outline.filter((v) => v !== s.title),
                          )
                        }
                      >
                        {s.title}
                      </Checkbox>
                    ))}
                  </Card>
                  <Field className="ui-field" label={<>专题</>}>
                    <Select
                      aria-label="建议专题"
                      mode="multiple"
                      value={topicIDs}
                      onChange={setTopics}
                      options={topics.data?.topics
                        .filter((t) => t.active)
                        .map((t) => ({ value: t.id, label: t.title }))}
                    />
                  </Field>
                  {!!candidate.new_topic_names?.length && (
                    <Card size="small" title={<>新增专题</>}>
                      {candidate.new_topic_names.map((n) => (
                        <Checkbox
                          key={n}
                          className="rag-check"
                          checked={newTopics.includes(n)}
                          onChange={(e) =>
                            setNewTopics(
                              e.target.checked
                                ? [...newTopics, n]
                                : newTopics.filter((v) => v !== n),
                            )
                          }
                        >
                          {n}
                        </Checkbox>
                      ))}
                    </Card>
                  )}
                  <Field className="ui-field" label={<>标签</>}>
                    <Select
                      aria-label="建议标签"
                      mode="tags"
                      value={tags}
                      onChange={setTags}
                    />
                  </Field>
                  <Field className="ui-field" label={<>课程知识点</>}>
                    <Select
                      aria-label="建议知识点"
                      mode="multiple"
                      value={pointIDs}
                      onChange={setPoints}
                      options={points.data?.points
                        .filter((p) => p.kind === "point")
                        .map((p) => ({ value: p.id, label: p.title }))}
                    />
                  </Field>
                  {!!candidate.similar_knowledge_ids?.length && (
                    <div>
                      相似知识：
                      {candidate.similar_knowledge_ids.map((k) => (
                        <Link key={k} to={`/teacher/knowledge?knowledge=${k}`}>
                          {known.data?.find((v) => v.id === k)?.title ||
                            "查看知识"}{" "}
                        </Link>
                      ))}
                    </div>
                  )}
                  <Button
                    disabled={action.busy}
                    onClick={async () => {
                      if (
                        await action.run(`/sources/${id}/suggestions/adopt`, {
                          job_id: job,
                          topic_ids: topicIDs,
                          tags,
                          knowledge_point_ids: pointIDs,
                          new_topics: newTopics,
                          outline,
                          reason: "教师核对后采纳所选建议",
                        })
                      )
                        setCandidate(null);
                    }}
                    type="primary"
                  >
                    采纳所选建议
                  </Button>
                </div>
              )}
              <Feedback message={action.message} failed={action.failed} />
            </>
          ),
        },
      ]}
    />
  );
}

type PaperQuestion = {
  title: string;
  prompt: string;
  type: string;
  max_score: number;
  options: string[];
  correct_answer: string;
  reference_answer: string;
  answer_origin: string;
  source_fragment_ids: string[];
  asset_ids: string[];
  uncertain: string[];
};
type Paper = {
  questions: PaperQuestion[];
  excluded: { fragment_id: string; reason: string }[];
  review_status: string;
  job_id?: string;
};
export function PaperImport({
  id,
  fragments,
}: {
  id: string;
  fragments: { id: string; body: string }[];
}) {
  const confirm = useConfirm();
  const [job, setJob] = useState("");
  const action = useAction();
  const assets = useLiveQuery<{
    assets: { id: string; kind: string }[];
    revisions: { asset_id: string; state: string }[];
  }>(`/sources/${id}/assets`);
  const draft = useEditorDraft<Paper>(`paper:${id}`, {
      questions: [],
      excluded: [],
      review_status: "pending_teacher_review",
    }),
    p = draft.value;
  const [selected, setSelected] = useState(0);
  const [splitAt, setSplitAt] = useState(0);
  const current = p.questions[selected];
  function update(v: Partial<PaperQuestion>) {
    draft.change({
      ...p,
      questions: p.questions.map((q, i) =>
        i === selected ? { ...q, ...v } : q,
      ),
    });
  }
  function swap(delta: number) {
    const j = selected + delta;
    if (j < 0 || j >= p.questions.length) return;
    const qs = [...p.questions];
    [qs[selected], qs[j]] = [qs[j], qs[selected]];
    draft.change({ ...p, questions: qs });
    setSelected(j);
  }
  const covered = new Set([
      ...p.questions.flatMap((q) => q.source_fragment_ids),
      ...p.excluded.map((x) => x.fragment_id),
    ]),
    missing = fragments.filter((f) => !covered.has(f.id));
  return (
    <Collapse
      className="card-panel"
      items={[
        {
          key: "content",
          label: <>整卷拆题</>,
          children: (
            <>
              <WorkflowJob
                kind="paper_split"
                target={{ source_id: id }}
                onAdopt={async (o, j) => {
                  if (draft.dirty && !await confirm("载入拆题候选并替换当前编辑？"))
                    return;
                  setJob(j);
                  draft.change({ ...(o as unknown as Paper), job_id: j });
                  setSelected(0);
                }}
              />
              {!!p.questions.length && (
                <div className="live-form">
                  <DraftNotice {...draft} />
                  <div className="live-inline">
                    <Field className="ui-field" label={<>题目</>}>
                      <Select
                        aria-label="题目"
                        value={selected}
                        onChange={(e) => setSelected(Number(e))}
                        showSearch
                        optionFilterProp="children"
                      >
                        {p.questions.map((q, i) => (
                          <Select.Option key={i} value={i}>
                            {i + 1}. {q.title}
                          </Select.Option>
                        ))}
                      </Select>
                    </Field>
                    <Button disabled={!selected} onClick={() => swap(-1)}>
                      上移
                    </Button>
                    <Button
                      disabled={selected === p.questions.length - 1}
                      onClick={() => swap(1)}
                    >
                      下移
                    </Button>
                    <Button
                      disabled={selected === p.questions.length - 1}
                      onClick={() => {
                        const next = p.questions[selected + 1];
                        const qs = p.questions.filter(
                          (_, i) => i !== selected + 1,
                        );
                        qs[selected] = {
                          ...current,
                          prompt: current.prompt + "\n\n" + next.prompt,
                          source_fragment_ids: [
                            ...new Set([
                              ...current.source_fragment_ids,
                              ...next.source_fragment_ids,
                            ]),
                          ],
                          asset_ids: [
                            ...new Set([
                              ...current.asset_ids,
                              ...next.asset_ids,
                            ]),
                          ],
                        };
                        draft.change({ ...p, questions: qs });
                      }}
                    >
                      与下一题合并
                    </Button>
                  </div>
                  {current && (
                    <>
                      <Field className="ui-field" label={<>题目名称</>}>
                        <Input
                          aria-label="题目名称"
                          value={current.title}
                          onChange={(e) => update({ title: e.target.value })}
                        />
                      </Field>
                      <div className="live-inline">
                        <Field className="ui-field" label={<>题型</>}>
                          <Select
                            aria-label="题型"
                            value={current.type}
                            onChange={(e) => update({ type: e })}
                            showSearch
                            optionFilterProp="children"
                          >
                            <Select.Option value="quiz">单选</Select.Option>
                            <Select.Option value="subjective">
                              主观
                            </Select.Option>
                            <Select.Option value="code">代码文本</Select.Option>
                          </Select>
                        </Field>
                        <Field className="ui-field" label={<>满分</>}>
                          <InputNumber
                            aria-label="满分"
                            min={1}
                            max={10000}
                            value={current.max_score}
                            onChange={(e) =>
                              update({ max_score: Number(String(e ?? "")) })
                            }
                          />
                        </Field>
                      </div>
                      <Field className="ui-field" label={<>题干</>}>
                        <Input.TextArea
                          aria-label="题干"
                          rows={9}
                          value={current.prompt}
                          onChange={(e) => update({ prompt: e.target.value })}
                          onSelect={(e) =>
                            setSplitAt(e.currentTarget.selectionStart)
                          }
                        />
                      </Field>
                      <Button
                        disabled={
                          splitAt <= 0 || splitAt >= current.prompt.length
                        }
                        onClick={() => {
                          const qs = [...p.questions];
                          qs.splice(
                            selected,
                            1,
                            {
                              ...current,
                              prompt: current.prompt.slice(0, splitAt),
                            },
                            {
                              ...current,
                              title: current.title + "（拆分）",
                              prompt: current.prompt.slice(splitAt),
                              reference_answer: "",
                              correct_answer: "",
                              answer_origin: "missing",
                            },
                          );
                          draft.change({ ...p, questions: qs });
                          setSplitAt(0);
                        }}
                      >
                        在光标位置拆题
                      </Button>
                      <RichContent text={current.prompt} />
                      {current.type === "quiz" && (
                        <>
                          <Field
                            className="ui-field"
                            label={<>选项（每行一个）</>}
                          >
                            <Input.TextArea
                              aria-label="选项（每行一个）"
                              value={current.options.join("\n")}
                              onChange={(e) =>
                                update({ options: e.target.value.split("\n") })
                              }
                            />
                          </Field>
                          <Field className="ui-field" label={<>正确选项</>}>
                            <Select
                              aria-label="正确选项"
                              value={current.correct_answer}
                              onChange={(e) =>
                                update({
                                  correct_answer: e,
                                  answer_origin: "teacher",
                                })
                              }
                              showSearch
                              optionFilterProp="children"
                            >
                              <Select.Option value="">待补全</Select.Option>
                              {current.options.map((o, i) => (
                                <Select.Option key={i} value={o}>
                                  {o}
                                </Select.Option>
                              ))}
                            </Select>
                          </Field>
                        </>
                      )}
                      <Field className="ui-field" label={<>参考解答</>}>
                        <Input.TextArea
                          aria-label="参考解答"
                          value={current.reference_answer}
                          onChange={(e) =>
                            update({
                              reference_answer: e.target.value,
                              answer_origin: "teacher",
                            })
                          }
                        />
                      </Field>
                      <Field className="ui-field" label={<>解答来源</>}>
                        <Select
                          aria-label="解答来源"
                          value={current.answer_origin}
                          onChange={(e) => update({ answer_origin: e })}
                          showSearch
                          optionFilterProp="children"
                        >
                          <Select.Option value="missing">
                            原卷未提供
                          </Select.Option>
                          <Select.Option value="extracted">
                            原卷逐字提取
                          </Select.Option>
                          <Select.Option value="teacher">
                            教师补录
                          </Select.Option>
                        </Select>
                      </Field>
                      <Field className="ui-field" label={<>出处片段</>}>
                        <Select
                          aria-label="拆题出处片段"
                          mode="multiple"
                          value={current.source_fragment_ids}
                          onChange={(v) => update({ source_fragment_ids: v })}
                          options={fragments.map((f, i) => ({
                            value: f.id,
                            label: `${i + 1} ${f.body.slice(0, 70)}`,
                          }))}
                        />
                      </Field>
                      <Field className="ui-field" label={<>题图</>}>
                        <Select
                          mode="multiple"
                          aria-label="题目图像"
                          value={current.asset_ids}
                          onChange={(v) => update({ asset_ids: v })}
                          options={assets.data?.assets
                            .filter(
                              (a) =>
                                a.kind !== "page" &&
                                assets.data.revisions.some(
                                  (r) =>
                                    r.asset_id === a.id &&
                                    r.state === "confirmed",
                                ),
                            )
                            .map((a, i) => ({
                              value: a.id,
                              label: `图${i + 1} · ${a.kind}`,
                            }))}
                        />
                      </Field>
                      {!!current.uncertain?.length && (
                        <p className="rag-warning">
                          待核对：{current.uncertain.join("；")}
                        </p>
                      )}
                    </>
                  )}
                  <Collapse
                    items={[
                      {
                        key: "content",
                        label: <>公共说明／排除片段 · {p.excluded.length}</>,
                        children: (
                          <>
                            {p.excluded.map((x, i) => (
                              <Field
                                className="ui-field"
                                key={x.fragment_id}
                                label={
                                  <>
                                    {fragments
                                      .find((f) => f.id === x.fragment_id)
                                      ?.body.slice(0, 130)}
                                    <Button
                                      onClick={() =>
                                        draft.change({
                                          ...p,
                                          excluded: p.excluded.filter(
                                            (_, j) => j !== i,
                                          ),
                                        })
                                      }
                                    >
                                      恢复待分配
                                    </Button>
                                  </>
                                }
                              >
                                <Input
                                  aria-label="排除原因"
                                  value={x.reason}
                                  onChange={(e) =>
                                    draft.change({
                                      ...p,
                                      excluded: p.excluded.map((v, j) =>
                                        i === j
                                          ? { ...v, reason: e.target.value }
                                          : v,
                                      ),
                                    })
                                  }
                                />
                              </Field>
                            ))}
                          </>
                        ),
                      },
                    ]}
                  />
                  {!!missing.length && (
                    <div role="alert">
                      <strong>{missing.length}个片段未归题</strong>
                      {missing.map((f) => (
                        <div key={f.id}>
                          <p>{f.body.slice(0, 150)}</p>
                          <Button
                            onClick={() =>
                              update({
                                source_fragment_ids: [
                                  ...current.source_fragment_ids,
                                  f.id,
                                ],
                              })
                            }
                          >
                            加入当前题
                          </Button>
                          <Button
                            onClick={() =>
                              draft.change({
                                ...p,
                                excluded: [
                                  ...p.excluded,
                                  {
                                    fragment_id: f.id,
                                    reason: "公共说明（请核对）",
                                  },
                                ],
                              })
                            }
                          >
                            标记排除
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                  <Button
                    disabled={
                      action.busy || !!missing.length || !(p.job_id || job)
                    }
                    onClick={async () => {
                      const snapshot = draft.value;
                      const r = await action.run(`/sources/${id}/paper/adopt`, {
                        ...p,
                        job_id: p.job_id || job,
                      });
                      if (r) {
                        draft.saved(snapshot);
                      }
                    }}
                    type="primary"
                  >
                    保存整组题库草稿
                  </Button>
                  <Link to="/teacher/question-bank">进入题库确认</Link>
                </div>
              )}
              <Feedback message={action.message} failed={action.failed} />
            </>
          ),
        },
      ]}
    />
  );
}
