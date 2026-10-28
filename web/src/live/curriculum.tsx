import { useState } from "react";
import tree from "../replica/student/course-tree.json";
import { chapters } from "../replica/demo";
import { useAction, useLearning, useLiveQuery, Feedback } from "./context";
import type { Point } from "./course";
export function CurriculumTools() {
  const { course } = useLearning();
  const ctx = useLiveQuery<{ points: Point[] }>("");
  const action = useAction();
  const [name, setName] = useState(course?.title || "");
  return (
    <section className="card-panel">
      <h2>课程配置</h2>
      <form
        className="live-inline"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run("", { title: name }, "PUT");
        }}
      >
        <label>
          课程名称
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button className="ghost-btn" disabled={action.busy}>
          保存课程名称
        </button>
      </form>
      <Feedback message={action.message} />
      {ctx.data?.points.length === 0 && (
        <>
          <h3>从参考课程目录开始</h3>
          <p>
            导入大数据课程的章节、小节与知识点名称。资料内容与题目需教师另行审核录入。
          </p>
          <button
            className="ghost-btn"
            disabled={action.busy}
            onClick={() => {
              if (confirm("向当前空课程导入参考课程目录？"))
                void action.run("/curriculum", {
                  chapters: tree.map((sections, i) => ({
                    title: chapters[i],
                    sections: sections.map((s) => ({
                      title: s.title,
                      points: s.points,
                    })),
                  })),
                });
            }}
          >
            导入参考课程目录
          </button>
        </>
      )}
    </section>
  );
}
