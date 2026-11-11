import { Fragment } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { useLearning, useLiveQuery } from "./context";

export type Asset = {
  id: string;
  kind: string;
  source_id: string;
  fragment_id: string;
  locator: Record<string, unknown>;
  native_data: unknown;
};
export function RichContent({ text }: { text: string }) {
  const parts = text.split(/(\$\$[\s\S]*?\$\$|\\\([\s\S]*?\\\))/g);
  return (
    <div className="live-prose rich-content">
      {parts.map((p, i) => {
        const block = p.startsWith("$$");
        if (!block && !p.startsWith("\\("))
          return <Fragment key={i}>{p}</Fragment>;
        const html = katex.renderToString(p.slice(2, -2), {
          displayMode: block,
          throwOnError: false,
          trust: false,
          strict: "warn",
          maxExpand: 1000,
          maxSize: 20,
        });
        return (
          <span
            key={i}
            className={block ? "formula-block" : undefined}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      })}
    </div>
  );
}
export function PublishedAssets({
  kind,
  id,
}: {
  kind: "resources" | "questions";
  id: string;
}) {
  const q = useLiveQuery<Asset[]>(`/${kind}/${id}/assets`);
  const { course } = useLearning();
  if (q.error) return <p role="alert">图像读取失败：{q.error.message}</p>;
  return (
    <div className="published-assets">
      {q.data?.map((a) => (
        <figure key={a.id}>
          <img
            loading="lazy"
            src={`/api/v1/learning/courses/${course!.id}/assets/${a.id}/file`}
            alt={String(a.locator.alt || "课程图像")}
          />
        </figure>
      ))}
    </div>
  );
}
