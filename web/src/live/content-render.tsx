import { memo } from "react";
import { Alert, Image, Typography } from "antd";
import Markdown, { type Components } from "react-markdown";
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

const REMARK_PLUGINS = [remarkGfm, remarkMath];
const REHYPE_PLUGINS = [
  [rehypeKatex, { trust: false, throwOnError: false, maxExpand: 1000, maxSize: 20 }] as const,
];

function isSafeHref(href?: string): boolean {
  if (!href) return false;
  const trimmed = href.trim();
  return /^(https?:\/\/|mailto:|#)/i.test(trimmed);
}

const MARKDOWN_COMPONENTS: Components = {
  img: () => null,
  a: ({ children, href }) =>
    isSafeHref(href) ? (
      <Typography.Link href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </Typography.Link>
    ) : (
      <span>{children}</span>
    ),
};

// Convert \(...\) and \[...\] math delimiters outside fenced and inline code spans.
function normalizeMathOutsideCode(text: string): string {
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]+`)/g);
  return parts
    .map((part, index) => {
      if (index % 2 === 1) return part;
      return part
        .replace(/\\\(([\s\S]*?)\\\)/g, (_, math: string) => `$${math}$`)
        .replace(/\\\[([\s\S]*?)\\\]/g, (_, math: string) => `\n$$\n${math}\n$$\n`);
    })
    .join("");
}

export const RichContent = memo(function RichContent({ text }: { text: string }) {
  const content = normalizeMathOutsideCode(text || "");
  return (
    <div className="live-prose rich-content">
      <Markdown
        skipHtml
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS as never}
        components={MARKDOWN_COMPONENTS}
      >
        {content}
      </Markdown>
    </div>
  );
});

export function PublishedAssets({
  kind,
  id,
}: {
  kind: "resources" | "questions";
  id: string;
}) {
  const q = useLiveQuery<Asset[]>(`/${kind}/${id}/assets`);
  const { course } = useLearning();
  if (q.error) return <Alert type="error" showIcon role="alert" message={`图像读取失败：${q.error.message}`} />;
  if (!course || !q.data?.length) return null;
  return (
    <div className="published-assets">
      <Image.PreviewGroup>
        {q.data.map((a) => (
          <figure key={a.id}>
            <Image
              loading="lazy"
              src={`/api/v1/learning/courses/${course.id}/assets/${a.id}/file`}
              alt={String(a.locator?.alt || "课程图像")}
            />
          </figure>
        ))}
      </Image.PreviewGroup>
    </div>
  );
}
