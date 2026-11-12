import { Alert } from "antd";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
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
  const content = text.replace(/\\\(([\s\S]*?)\\\)/g, (_, math: string) => `$${math}$`).replace(/\\\[([\s\S]*?)\\\]/g, (_, math: string) => `\n$$\n${math}\n$$\n`);
  return (
    <div className="live-prose rich-content">
      <Markdown skipHtml remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, { trust: false, throwOnError: false, maxExpand: 1000, maxSize: 20 }]]}
        components={{ img: () => null, a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer">{children}</a> }}>
        {content}
      </Markdown>
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
  if (q.error) return <Alert type="error" showIcon role="alert" message={<>图像读取失败：{q.error.message}</>} />;
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
