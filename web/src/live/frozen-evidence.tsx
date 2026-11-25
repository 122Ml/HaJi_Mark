import { Collapse, Space } from "antd";
import { useSession } from "../shared/session";
import { Link } from "./context";
import {
  extractResourceTimeRangeMs,
  extractTimeRangeMs,
  formatLocator,
} from "./domain-meta";
import type { Hit } from "./types";

function resolveTimeRange(locator?: Record<string, unknown> | null) {
  if (!locator) return null;
  const direct = extractTimeRangeMs(locator);
  if (direct) return direct;
  return typeof locator.location === "string"
    ? extractResourceTimeRangeMs(locator.location)
    : null;
}

export function resourceHref(
  teacher: boolean,
  resourceID: string,
  locator?: Record<string, unknown> | null,
) {
  const range = resolveTimeRange(locator);
  const t = range ? `&t=${range.startMs}` : "";
  return teacher
    ? `/teacher/materials?tab=published&resource=${encodeURIComponent(resourceID)}${t}`
    : `/student/course-content?resource=${encodeURIComponent(resourceID)}${t}`;
}

export function sourceHref(
  sourceID: string,
  fragmentID?: string,
  locator?: Record<string, unknown> | null,
) {
  const params = new URLSearchParams({ source: sourceID });
  if (fragmentID) params.set("fragment", fragmentID);
  const range = resolveTimeRange(locator);
  if (range) params.set("t", String(range.startMs));
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
                    <strong style={{ overflowWrap: "anywhere" }}>{hit.title}</strong>
                    {loc && <small style={{ overflowWrap: "anywhere" }}> · {loc}</small>}
                    <p className="live-prose">{hit.body}</p>
                    <Space wrap size="small">
                      {teacher && hit.source_id && (
                        <Link
                          to={sourceHref(
                            hit.source_id,
                            hit.fragment_ids?.[0],
                            hit.locator,
                          )}
                        >
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
                        <Link
                          to={resourceHref(
                            teacher,
                            hit.resource_id,
                            hit.locator,
                          )}
                        >
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
