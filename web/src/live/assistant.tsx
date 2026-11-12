import { Field } from "../shared/Field";
import { Card, Form, Input, Button } from "antd";
import { useState } from "react";
import { useLiveQuery, useAction, Feedback } from "./context";
import { GroundedAnswer, type AssistAnswer } from "./knowledge";
export function LearningAssistant() {
  const status = useLiveQuery<{ configured: boolean }>("/assist");
  const action = useAction();
  const [topic, setTopic] = useState("");
  const [output, setOutput] = useState<AssistAnswer | null>(null);
  return (
    <Card className="card-panel" title={<h2>课程助教</h2>}>

      {status.data?.configured ? (
        <>
          <p>根据本课程已发布资料回答问题，输出供学习参考。</p>
          <Form
            className="live-form"
            onFinish={async () => {
              const r = await action.run<AssistAnswer>("/assist", { topic });
              if (r) setOutput(r);
            }}
            layout="vertical"
          >
            <Field
              className="ui-field"
              label={<>问题或起草要求</>}
              required={true}
            >
              <Input.TextArea
                aria-label="问题或起草要求"
                required
                rows={3}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
              />
            </Field>
            <Button disabled={action.busy} htmlType="submit">
              {action.busy ? "正在生成…" : "请求课程助教"}
            </Button>
          </Form>
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
    </Card>
  );
}
