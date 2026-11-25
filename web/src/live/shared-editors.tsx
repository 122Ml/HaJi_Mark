import { Alert, Button, Form, Input, InputNumber, Radio, Space } from "antd";
import { Field } from "../shared/Field";
import type { Criterion } from "./types";

export function IntegerInput({
  value,
  onChange,
  min = 0,
  max = 10000,
  disabled,
  id,
  "aria-label": ariaLabel,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
}) {
  return (
    <InputNumber
      id={id}
      aria-label={ariaLabel}
      min={min}
      max={max}
      precision={0}
      step={1}
      disabled={disabled}
      value={value}
      onChange={(next) => {
        if (typeof next === "number" && Number.isFinite(next)) {
          onChange(Math.round(next));
        }
      }}
    />
  );
}

export function nextCriterionID(criteria: Criterion[]): string {
  const used = new Set(criteria.map((c) => c.id));
  let n = criteria.length + 1;
  while (used.has(`D${n}`)) n += 1;
  return `D${n}`;
}

export function CriteriaEditor({
  criteria,
  maxScore,
  onChange,
  extended = false,
  disabled = false,
}: {
  criteria: Criterion[];
  maxScore: number;
  onChange: (next: Criterion[]) => void;
  extended?: boolean;
  disabled?: boolean;
}) {
  const total = criteria.reduce((sum, item) => sum + (Number(item.max_score) || 0), 0);
  const mismatch = total !== maxScore;

  function update(index: number, patch: Partial<Criterion>) {
    onChange(criteria.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= criteria.length) return;
    const copy = [...criteria];
    const [picked] = copy.splice(index, 1);
    copy.splice(target, 0, picked);
    onChange(copy);
  }

  function remove(index: number) {
    onChange(criteria.filter((_, i) => i !== index));
  }

  return (
    <Form layout="vertical" component={false}>
      <div className="live-form">
        {criteria.map((item, index) => (
          <fieldset key={item.id} className="live-point-fields">
            <legend>
              评分点 {item.id}（第 {index + 1} 项）
            </legend>
            <div className="live-stack" style={{ gap: 12 }}>
              <div className="live-inline">
                <Field className="ui-field" label="名称" required>
                  <Input
                    disabled={disabled}
                    value={item.title}
                    onChange={(e) => update(index, { title: e.target.value })}
                    placeholder="例如：概念完整性、核心推导步骤"
                  />
                </Field>
                <Field className="ui-field" label="分值" required>
                  <IntegerInput
                    disabled={disabled}
                    min={1}
                    max={maxScore}
                    value={item.max_score}
                    onChange={(v) => update(index, { max_score: v })}
                  />
                </Field>
              </div>
              <Field className="ui-field" label="评分规则" required>
                <Input.TextArea
                  rows={2}
                  disabled={disabled}
                  value={item.rule}
                  onChange={(e) => update(index, { rule: e.target.value })}
                  placeholder="明确得分条件、关键要点与扣分边界"
                />
              </Field>
              {extended && (
                <>
                  <Field className="ui-field" label="作答要求">
                    <Input
                      disabled={disabled}
                      value={item.requirement || ""}
                      onChange={(e) => update(index, { requirement: e.target.value })}
                    />
                  </Field>
                  <Field className="ui-field" label="部分给分说明">
                    <Input
                      disabled={disabled}
                      value={item.partial_credit || ""}
                      onChange={(e) => update(index, { partial_credit: e.target.value })}
                    />
                  </Field>
                  <Field className="ui-field" label="可接受等价表述">
                    <Input
                      disabled={disabled}
                      value={item.acceptable_answers || ""}
                      onChange={(e) => update(index, { acceptable_answers: e.target.value })}
                    />
                  </Field>
                  <Field className="ui-field" label="典型错误与扣分条件">
                    <Input
                      disabled={disabled}
                      value={item.error_conditions || ""}
                      onChange={(e) => update(index, { error_conditions: e.target.value })}
                    />
                  </Field>
                </>
              )}
              <Space wrap size="small">
                <Button
                  size="small"
                  disabled={disabled || index === 0}
                  onClick={() => move(index, -1)}
                  htmlType="button"
                >
                  上移
                </Button>
                <Button
                  size="small"
                  disabled={disabled || index === criteria.length - 1}
                  onClick={() => move(index, 1)}
                  htmlType="button"
                >
                  下移
                </Button>
                {criteria.length > 1 && (
                  <Button
                    size="small"
                    danger
                    disabled={disabled}
                    onClick={() => remove(index)}
                    htmlType="button"
                  >
                    删除评分点
                  </Button>
                )}
              </Space>
            </div>
          </fieldset>
        ))}
      <Space wrap align="center">
        <Button
          disabled={disabled}
          onClick={() =>
            onChange([
              ...criteria,
              {
                id: nextCriterionID(criteria),
                title: "",
                max_score: Math.max(1, maxScore - total),
                rule: "",
              },
            ])
          }
          htmlType="button"
        >
          新增评分点
        </Button>
        <span className="live-meta">
          当前合计 {total} / {maxScore} 分
        </span>
      </Space>
      {mismatch && (
        <Alert
          type="warning"
          showIcon
          message={`评分点合计 ${total} 分与题目满分 ${maxScore} 分不一致，请调整后再保存。`}
        />
      )}
      </div>
    </Form>
  );
}

export function QuizOptionsEditor({
  options,
  correctAnswer,
  onChange,
  disabled = false,
}: {
  options: string[];
  correctAnswer: string;
  onChange: (nextOptions: string[], nextCorrect: string) => void;
  disabled?: boolean;
}) {
  const safeOptions = options.length >= 2 ? options : ["", ""];

  function updateOption(index: number, nextValue: string) {
    const oldVal = safeOptions[index];
    const next = safeOptions.map((item, i) => (i === index ? nextValue : item));
    const nextCorrect =
      correctAnswer !== "" && correctAnswer === oldVal
        ? nextValue
        : correctAnswer;
    onChange(next, nextCorrect);
  }

  function removeOption(index: number) {
    if (safeOptions.length <= 2) return;
    const removed = safeOptions[index];
    const next = safeOptions.filter((_, i) => i !== index);
    onChange(next, correctAnswer === removed ? "" : correctAnswer);
  }

  return (
    <div className="live-form">
      <Radio.Group
        disabled={disabled}
        value={correctAnswer}
        onChange={(e) => onChange(safeOptions, String(e.target.value))}
        style={{ width: "100%" }}
      >
        <Space direction="vertical" className="live-full-width">
          {safeOptions.map((opt, idx) => (
            <div
              className="live-inline"
              key={idx}
              style={{ flexWrap: "nowrap", alignItems: "center" }}
            >
              <Radio
                value={opt}
                disabled={disabled || !opt.trim()}
                style={{ flexShrink: 0, whiteSpace: "nowrap" }}
              >
                设为正确答案
              </Radio>
              <Input
                disabled={disabled}
                aria-label={`选项 ${idx + 1}`}
                placeholder={`选项 ${String.fromCharCode(65 + idx)}`}
                value={opt}
                onChange={(e) => updateOption(idx, e.target.value)}
                style={{ flex: 1, minWidth: 0, width: "auto" }}
              />
              {safeOptions.length > 2 && (
                <Button
                  size="small"
                  danger
                  disabled={disabled}
                  onClick={() => removeOption(idx)}
                  htmlType="button"
                  style={{ flexShrink: 0 }}
                >
                  移除
                </Button>
              )}
            </div>
          ))}
        </Space>
      </Radio.Group>
      <Button
        size="small"
        disabled={disabled || safeOptions.length >= 8}
        onClick={() => onChange([...safeOptions, ""], correctAnswer)}
        htmlType="button"
      >
        添加选项
      </Button>
    </div>
  );
}
