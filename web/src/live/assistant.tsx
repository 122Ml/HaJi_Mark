import { useState } from "react";
import { useLiveQuery, useAction, Feedback } from "./context";
import { GroundedAnswer, type AssistAnswer } from "./knowledge";
export function LearningAssistant() {
  const status = useLiveQuery<{ configured: boolean }>("/assist");
  const action = useAction();
  const [topic, setTopic] = useState("");
  const [output, setOutput] = useState<AssistAnswer | null>(null);
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
              const r = await action.run<AssistAnswer>("/assist", { topic });
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
      <Feedback
        error={status.error}
        message={action.message}
        failed={action.failed}
      />
      {output && (
        <>
          <GroundedAnswer answer={output} />
        </>
      )}
    </section>
  );
}
