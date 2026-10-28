import { useState } from "react";
import { useLiveQuery, useAction, Feedback } from "./context";
export function LearningAssistant() {
  const status = useLiveQuery<{ configured: boolean }>("/assist");
  const action = useAction();
  const [topic, setTopic] = useState("");
  const [output, setOutput] = useState<{
    text: string;
    sources: { id: string; version: number; locator: string }[];
  } | null>(null);
  return (
    <section className="card-panel">
      <h2>课程助教</h2>
      {status.data?.configured ? (
        <>
          <p>根据本课程已发布资料回答问题，输出供学习参考。</p>
          <form
            className="live-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await action.run<{
                text: string;
                sources: { id: string; version: number; locator: string }[];
              }>("/assist", { topic });
              if (r) setOutput(r);
            }}
          >
            <label>
              问题或起草要求
              <textarea
                aria-label="问题或起草要求"
                required
                rows={3}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
              />
            </label>
            <button className="ghost-btn" disabled={action.busy}>
              {action.busy ? "正在生成…" : "请求课程助教"}
            </button>
          </form>
        </>
      ) : (
        <p>模型服务尚未配置。可阅读课程资料，或在互动答疑中向教师提问。</p>
      )}
      <Feedback error={status.error} message={action.message} />
      {output && (
        <>
          <article className="live-prose">{output.text}</article>
          <details>
            <summary>本次提供给助教的资料来源</summary>
            {output.sources.map((s) => (
              <p key={s.id}>
                {s.locator} · v{s.version} · {s.id}
              </p>
            ))}
          </details>
        </>
      )}
    </section>
  );
}
