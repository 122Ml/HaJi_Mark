import { Button } from "antd";
import type { PointFeedback } from "./types";

export function RevisionPoints({
  points,
  onLocate,
}: {
  points?: PointFeedback[];
  onLocate?: (quote: string) => void;
}) {
  if (!points?.length) return null;
  return (
    <ul className="live-point-results">
      {points.map((p) => (
        <li key={p.criterion_id}>
          <strong>
            {p.title}：{p.score} / {p.max_score}
          </strong>
          <p className="live-prose">{p.feedback}</p>
          {p.quote && (
            <blockquote className="live-prose">
              {p.quote}
              {onLocate && (
                <div style={{ marginTop: 6 }}>
                  <Button htmlType="button" onClick={() => onLocate(p.quote)}>
                    定位原文
                  </Button>
                </div>
              )}
            </blockquote>
          )}
        </li>
      ))}
    </ul>
  );
}
