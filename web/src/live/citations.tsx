import { Collapse, Space, Tag } from "antd";
import { useSession } from "../shared/session";
import { Link } from "./context";
import { RichContent } from "./content-render";
import { formatLocator } from "./domain-meta";
import type { AssistAnswer, Hit } from "./types";

function resourceHref(teacher: boolean, resourceID: string) {
  return teacher
    ? `/teacher/materials?tab=published&resource=${encodeURIComponent(resourceID)}`
    : `/student/course-content?resource=${encodeURIComponent(resourceID)}`;
}

function sourceHref(sourceID: string, fragmentID?: string) {
  const params = new URLSearchParams({ source: sourceID });
  if (fragmentID) params.set("fragment", fragmentID);
  return `/teacher/materials?${params.toString()}`;
}

export function FrozenEvidence({ sources }: { sources?: Hit[] }) {
  const { session } = useSession();
  const teacher = session?.user.role === "teacher";
  if (!sources?.length) return null;
  return (
    <Collapse
      items={[
        {
          key: "content",
          label: <>引用依据（{sources.length}）</>,
          children: (
            <>
              {sources.map((hit) => {
                const loc = formatLocator(hit.locator);
                return (
                  <article className="rag-hit" key={hit.id}>
                    <strong>{hit.title}</strong>
                    {loc && <small> · {loc}</small>}
                    <p className="live-prose">{hit.body}</p>
                    <Space wrap size="small">
                      {teacher && hit.source_id && (
                        <Link to={sourceHref(hit.source_id, hit.fragment_ids?.[0])}>
                          查看引用原文
                        </Link>
                      )}
                      {hit.knowledge_id && (
                        <Link
                          to={`/${teacher ? "teacher" : "student"}/knowledge?knowledge=${encodeURIComponent(hit.knowledge_id)}`}
                        >
                          查看知识库
                        </Link>
                      )}
                      {hit.resource_id && (
                        <Link to={resourceHref(teacher, hit.resource_id)}>
                          返回学习资料
                        </Link>
                      )}
                    </Space>
                  </article>
                );
              })}
            </>
          ),
        },
      ]}
    />
  );
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
        return (
          <blockquote key={`${c.id}:${i}`}>
            <div>
              <Tag className="ui-meta-tag">[{refTag}]</Tag> {c.quote}
            </div>
            {(hit?.title || loc) && (
              <small>
                {hit?.title}
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
