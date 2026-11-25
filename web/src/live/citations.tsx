import { Space, Tag } from "antd";
import { useSession } from "../shared/session";
import { Link } from "./context";
import { RichContent } from "./content-render";
import { formatLocator } from "./domain-meta";
import { resourceHref, sourceHref } from "./frozen-evidence";
import type { AssistAnswer } from "./types";

export { FrozenEvidence } from "./frozen-evidence";

export function displayCitationTitle(title: string | undefined, teacher: boolean): string {
  const raw = (title || "").trim();
  if (!raw || teacher) return raw;
  return raw.replace(/\.(md|markdown|pdf|txt|docx?|pptx?|csv|html?)$/i, "");
}

export function GroundedAnswer({ answer }: { answer: AssistAnswer }) {
  const { session } = useSession();
  const teacher = session?.user.role === "teacher";
  const sources = answer.sources || [];
  return (
    <>
      <RichContent text={answer.text} />
      {answer.citations?.map((c, i) => {
        const refTag = c.ref || `R${i + 1}`;
        const hit =
          sources.find((h) => h.id === c.id) ||
          (/^R\d+$/.test(c.id) ? sources[Number(c.id.slice(1)) - 1] : undefined);
        const loc = formatLocator(hit?.locator);
        const titleText = displayCitationTitle(hit?.title, teacher);
        return (
          <blockquote
            key={`${c.id}:${i}`}
            style={{ maxWidth: "100%", overflowWrap: "anywhere" }}
          >
            <div style={{ overflowWrap: "anywhere" }}>
              <Tag className="ui-meta-tag">[{refTag}]</Tag> {c.quote}
            </div>
            {(titleText || loc) && (
              <small style={{ display: "block", marginBottom: 4, overflowWrap: "anywhere" }}>
                {titleText}
                {loc ? ` · ${loc}` : ""}
              </small>
            )}
            <Space wrap size="small">
              {teacher && hit?.source_id && (
                <Link to={sourceHref(hit.source_id, hit.fragment_ids?.[0])}>
                  查看原文
                </Link>
              )}
              {hit?.knowledge_id && (
                <Link
                  to={`/${teacher ? "teacher" : "student"}/knowledge?knowledge=${encodeURIComponent(hit.knowledge_id)}`}
                >
                  查看知识库
                </Link>
              )}
              {hit?.resource_id && (
                <Link to={resourceHref(teacher, hit.resource_id)}>
                  查看引用学习资料
                </Link>
              )}
            </Space>
          </blockquote>
        );
      })}
    </>
  );
}
