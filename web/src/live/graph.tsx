import { Field } from "../shared/Field";
import { useConfirm } from "../shared/confirm";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
  Form,
  Input,
  List,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "../shared/session";
import { Feedback, useAction, useLearning, useLiveQuery } from "./context";
import { EmptyState, ErrorState, LoadingState, MetaTag, MetaTags } from "../shared/ui";
import type { Point } from "./types";

interface Edge {
  from_id: string;
  to_id: string;
}

interface NodePos {
  node: Point;
  x: number;
  y: number;
  col: number;
}

const NODE_W = 192;
const NODE_H = 68;
const COL_GAP = 84;
const ROW_GAP = 26;
const PAD_X = 28;
const PAD_Y = 28;
const LAYER_STEP = NODE_W + COL_GAP;

function computeLayeredLayout(nodes: Point[], edges: Edge[]) {
  const byID = new Map(nodes.map((n) => [n.id, n]));
  const outMap = new Map<string, string[]>();
  const inMap = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const n of nodes) {
    outMap.set(n.id, []);
    inMap.set(n.id, []);
    inDegree.set(n.id, 0);
  }
  for (const e of edges) {
    if (!byID.has(e.from_id) || !byID.has(e.to_id)) continue;
    outMap.get(e.from_id)!.push(e.to_id);
    inMap.get(e.to_id)!.push(e.from_id);
    inDegree.set(e.to_id, (inDegree.get(e.to_id) || 0) + 1);
  }

  // When there are no edges yet, lay out in a compact multi-column grid (up to 4 cols).
  if (edges.length === 0 && nodes.length > 4) {
    const sorted = [...nodes].sort((a, b) =>
      a.position === b.position ? a.id.localeCompare(b.id) : a.position - b.position,
    );
    const cols = Math.min(4, Math.ceil(Math.sqrt(sorted.length)));
    const rows = Math.ceil(sorted.length / cols);
    const positions = new Map<string, NodePos>();
    sorted.forEach((node, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      positions.set(node.id, {
        node,
        col,
        x: PAD_X + col * (NODE_W + 24),
        y: PAD_Y + row * (NODE_H + ROW_GAP),
      });
    });
    const width = Math.max(560, PAD_X * 2 + cols * NODE_W + (cols - 1) * 24);
    const height = Math.max(120, PAD_Y * 2 + rows * NODE_H + Math.max(0, rows - 1) * ROW_GAP);
    return { positions, width, height };
  }

  // Kahn's topological layering: prerequisites on the left, dependents on the right.
  const layer = new Map<string, number>();
  const queue: string[] = [];
  const sortedInit = [...nodes].sort((a, b) =>
    a.position === b.position ? a.id.localeCompare(b.id) : a.position - b.position,
  );
  for (const n of sortedInit) {
    layer.set(n.id, 0);
    if ((inDegree.get(n.id) || 0) === 0) {
      queue.push(n.id);
    }
  }

  const visited = new Set<string>();
  let head = 0;
  while (head < queue.length) {
    const u = queue[head++];
    visited.add(u);
    const uLayer = layer.get(u) || 0;
    for (const v of outMap.get(u) || []) {
      layer.set(v, Math.max(layer.get(v) || 0, uLayer + 1));
      const nextDeg = (inDegree.get(v) || 1) - 1;
      inDegree.set(v, nextDeg);
      if (nextDeg === 0) queue.push(v);
    }
  }

  let maxLayer = 0;
  for (const val of layer.values()) {
    if (val > maxLayer) maxLayer = val;
  }
  for (const n of nodes) {
    if (!visited.has(n.id)) {
      layer.set(n.id, maxLayer + 1);
    }
  }

  const columns = new Map<number, Point[]>();
  for (const n of nodes) {
    const col = layer.get(n.id) || 0;
    const list = columns.get(col);
    if (list) list.push(n);
    else columns.set(col, [n]);
  }

  const colIndices = [...columns.keys()].sort((a, b) => a - b);
  const rowIndexByNode = new Map<string, number>();

  for (const col of colIndices) {
    const colNodes = columns.get(col)!;
    colNodes.sort((a, b) => {
      const aParents = inMap.get(a.id) || [];
      const bParents = inMap.get(b.id) || [];
      const aBary =
        aParents.length > 0
          ? aParents.reduce((sum, p) => sum + (rowIndexByNode.get(p) ?? 0), 0) /
            aParents.length
          : Number.MAX_SAFE_INTEGER;
      const bBary =
        bParents.length > 0
          ? bParents.reduce((sum, p) => sum + (rowIndexByNode.get(p) ?? 0), 0) /
            bParents.length
          : Number.MAX_SAFE_INTEGER;
      if (aBary !== bBary) return aBary - bBary;
      return a.position === b.position
        ? a.id.localeCompare(b.id)
        : a.position - b.position;
    });
    colNodes.forEach((node, idx) => rowIndexByNode.set(node.id, idx));
  }

  const maxRows = Math.max(
    1,
    ...colIndices.map((c) => (columns.get(c) || []).length),
  );
  const layerCount = Math.max(1, colIndices.length);
  const width = Math.max(
    560,
    PAD_X * 2 + layerCount * NODE_W + Math.max(0, layerCount - 1) * COL_GAP,
  );
  const contentHeight =
    maxRows * NODE_H + Math.max(0, maxRows - 1) * ROW_GAP;
  const height = Math.max(120, PAD_Y * 2 + contentHeight);

  const positions = new Map<string, NodePos>();
  colIndices.forEach((colKey, visualCol) => {
    const colNodes = columns.get(colKey)!;
    const colHeight =
      colNodes.length * NODE_H + Math.max(0, colNodes.length - 1) * ROW_GAP;
    const offsetY = PAD_Y + Math.max(0, (contentHeight - colHeight) / 2);
    colNodes.forEach((node, row) => {
      positions.set(node.id, {
        node,
        col: visualCol,
        x: PAD_X + visualCol * (NODE_W + COL_GAP),
        y: offsetY + row * (NODE_H + ROW_GAP),
      });
    });
  });

  return { positions, width, height };
}

function reachableSet(startID: string, adjacency: Map<string, string[]>): Set<string> {
  const visited = new Set<string>();
  const stack = [startID];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (visited.has(cur)) continue;
    visited.add(cur);
    for (const next of adjacency.get(cur) || []) {
      if (!visited.has(next)) stack.push(next);
    }
  }
  return visited;
}

function cubicBezierExtrema(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
): [number, number] {
  let min = Math.min(p0, p3);
  let max = Math.max(p0, p3);
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const evalAt = (t: number) => {
    if (t <= 0 || t >= 1) return;
    const mt = 1 - t;
    const val =
      mt * mt * mt * p0 +
      3 * mt * mt * t * p1 +
      3 * mt * t * t * p2 +
      t * t * t * p3;
    if (val < min) min = val;
    if (val > max) max = val;
  };
  if (Math.abs(a) < 1e-6) {
    if (Math.abs(b) > 1e-6) evalAt(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      evalAt((-b + sq) / (2 * a));
      evalAt((-b - sq) / (2 * a));
    }
  }
  return [min, max];
}

function evalCubic(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const mt = 1 - t;
  return (
    mt * mt * mt * p0 +
    3 * mt * mt * t * p1 +
    3 * mt * t * t * p2 +
    t * t * t * p3
  );
}

function pickForwardArcOffset(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  dx: number,
  startCol: number,
  endCol: number,
  arcMag: number,
  positions: Map<string, NodePos>,
  layoutHeight: number,
): number {
  const intermediates = [...positions.values()].filter(
    (p) => p.col > startCol && p.col < endCol,
  );
  const scoreOffset = (offset: number) => {
    let hits = 0;
    for (const t of [0.25, 0.5, 0.75]) {
      const bx = evalCubic(x1, x1 + dx, x2 - dx, x2, t);
      const by = evalCubic(y1, y1 + offset, y2 + offset, y2, t);
      for (const node of intermediates) {
        if (
          bx >= node.x - 8 &&
          bx <= node.x + NODE_W + 8 &&
          by >= node.y - 10 &&
          by <= node.y + NODE_H + 10
        ) {
          hits += 1;
        }
      }
    }
    return hits;
  };
  const upHits = scoreOffset(-arcMag);
  const downHits = scoreOffset(arcMag);
  if (upHits !== downHits) return upHits < downHits ? -arcMag : arcMag;
  return (y1 + y2) / 2 <= layoutHeight / 2 ? -arcMag : arcMag;
}

export function KnowledgeGraph() {
  const confirm = useConfirm();
  const { course } = useLearning();
  const query = useLiveQuery<{
    nodes: Point[];
    edges: Edge[];
  }>("/graph");
  const { session } = useSession();
  const teacher = session?.user.role === "teacher";
  const action = useAction();

  const [selectedID, setSelectedID] = useState("");
  const [search, setSearch] = useState("");
  const [onlyLinked, setOnlyLinked] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    setSelectedID("");
    setSearch("");
    setOnlyLinked(false);
    setFrom("");
    setTo("");
    setFormError("");
  }, [course?.id]);

  const allNodes = useMemo(
    () => (query.data?.nodes || []).filter((p) => p.kind === "point"),
    [query.data?.nodes],
  );
  const nodeMap = useMemo(
    () => new Map(allNodes.map((n) => [n.id, n])),
    [allNodes],
  );
  const edges = useMemo(
    () =>
      (query.data?.edges || []).filter(
        (e) => nodeMap.has(e.from_id) && nodeMap.has(e.to_id),
      ),
    [query.data?.edges, nodeMap],
  );

  const { inMap, outMap, edgeSet } = useMemo(() => {
    const incoming = new Map<string, string[]>();
    const outgoing = new Map<string, string[]>();
    const pairs = new Set<string>();
    for (const n of allNodes) {
      incoming.set(n.id, []);
      outgoing.set(n.id, []);
    }
    for (const e of edges) {
      incoming.get(e.to_id)?.push(e.from_id);
      outgoing.get(e.from_id)?.push(e.to_id);
      pairs.add(`${e.from_id}->${e.to_id}`);
    }
    return { inMap: incoming, outMap: outgoing, edgeSet: pairs };
  }, [allNodes, edges]);

  const linkedNodeIDs = useMemo(() => {
    const ids = new Set<string>();
    for (const e of edges) {
      ids.add(e.from_id);
      ids.add(e.to_id);
    }
    return ids;
  }, [edges]);

  const visibleNodes = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    let base = allNodes;
    if (onlyLinked && edges.length > 0) {
      base = base.filter((n) => linkedNodeIDs.has(n.id));
    }
    if (!keyword) return base;
    const matched = new Set(
      base
        .filter(
          (n) =>
            n.title.toLowerCase().includes(keyword) ||
            n.description.toLowerCase().includes(keyword),
        )
        .map((n) => n.id),
    );
    // Keep direct neighbors so edges attached to matched nodes stay visible.
    const expanded = new Set(matched);
    for (const id of matched) {
      for (const pre of inMap.get(id) || []) expanded.add(pre);
      for (const dep of outMap.get(id) || []) expanded.add(dep);
    }
    return base.filter((n) => expanded.has(n.id));
  }, [allNodes, edges.length, inMap, linkedNodeIDs, onlyLinked, outMap, search]);

  const visibleNodeSet = useMemo(
    () => new Set(visibleNodes.map((n) => n.id)),
    [visibleNodes],
  );
  const visibleEdges = useMemo(
    () =>
      edges.filter(
        (e) => visibleNodeSet.has(e.from_id) && visibleNodeSet.has(e.to_id),
      ),
    [edges, visibleNodeSet],
  );

  const layout = useMemo(
    () => computeLayeredLayout(visibleNodes, visibleEdges),
    [visibleNodes, visibleEdges],
  );

  const { routedEdges, svgBounds } = useMemo(() => {
    const sorted = [...visibleEdges].sort((a, b) => {
      const aActive =
        !!selectedID && (a.from_id === selectedID || a.to_id === selectedID) ? 1 : 0;
      const bActive =
        !!selectedID && (b.from_id === selectedID || b.to_id === selectedID) ? 1 : 0;
      return aActive - bActive;
    });

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const pos of layout.positions.values()) {
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + NODE_W);
      maxY = Math.max(maxY, pos.y + NODE_H);
    }
    if (!Number.isFinite(minX)) {
      minX = PAD_X;
      minY = PAD_Y;
      maxX = layout.width - PAD_X;
      maxY = layout.height - PAD_Y;
    }

    const routed: Array<{ edge: Edge; d: string; isActive: boolean }> = [];
    for (const edge of sorted) {
      const start = layout.positions.get(edge.from_id);
      const end = layout.positions.get(edge.to_id);
      if (!start || !end) continue;

      const x1 = start.x + NODE_W;
      const y1 = start.y + NODE_H / 2;
      const x2 = end.x - 4;
      const y2 = end.y + NODE_H / 2;

      let cx1: number;
      let cy1: number;
      let cx2: number;
      let cy2: number;

      if (x1 >= x2) {
        // Backward or same-column cycle edge: arc clearly around node rows.
        const loopDx = Math.min(84, Math.max(44, Math.abs(x1 - x2) * 0.22));
        const arcY = (y1 + y2) / 2 <= layout.height / 2 ? -(NODE_H + 24) : NODE_H + 24;
        cx1 = x1 + loopDx;
        cy1 = y1 + arcY;
        cx2 = x2 - loopDx;
        cy2 = y2 + arcY;
      } else if (x2 - x1 > LAYER_STEP) {
        // Multi-layer span: bow smoothly above or below intermediate-layer nodes.
        const dx = Math.max(40, (x2 - x1) * 0.42);
        const spanCols = Math.max(2, end.col - start.col);
        const arcMag = 84 + Math.min(2, spanCols - 2) * 18;
        const arcOffset = pickForwardArcOffset(
          x1,
          y1,
          x2,
          y2,
          dx,
          start.col,
          end.col,
          arcMag,
          layout.positions,
          layout.height,
        );
        cx1 = x1 + dx;
        cy1 = y1 + arcOffset;
        cx2 = x2 - dx;
        cy2 = y2 + arcOffset;
      } else {
        const dx = Math.max(36, Math.abs(x2 - x1) * 0.45);
        cx1 = x1 + dx;
        cy1 = y1;
        cx2 = x2 - dx;
        cy2 = y2;
      }

      const [eMinX, eMaxX] = cubicBezierExtrema(x1, cx1, cx2, x2);
      const [eMinY, eMaxY] = cubicBezierExtrema(y1, cy1, cy2, y2);
      minX = Math.min(minX, eMinX - 8);
      maxX = Math.max(maxX, eMaxX + 8);
      minY = Math.min(minY, eMinY - 8);
      maxY = Math.max(maxY, eMaxY + 8);

      const isActive =
        !!selectedID && (edge.from_id === selectedID || edge.to_id === selectedID);
      routed.push({
        edge,
        d: `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`,
        isActive,
      });
    }

    const viewMinX = Math.min(0, Math.floor(minX - PAD_X));
    const viewMinY = Math.min(0, Math.floor(minY - PAD_Y));
    const viewMaxX = Math.max(layout.width, Math.ceil(maxX + PAD_X));
    const viewMaxY = Math.max(layout.height, Math.ceil(maxY + PAD_Y));

    return {
      routedEdges: routed,
      svgBounds: {
        minX: viewMinX,
        minY: viewMinY,
        width: Math.max(560, viewMaxX - viewMinX),
        height: Math.max(120, viewMaxY - viewMinY),
      },
    };
  }, [visibleEdges, layout, selectedID]);

  const selectedNode = selectedID ? nodeMap.get(selectedID) || null : null;
  const selectedPrereqs = useMemo(
    () => new Set(selectedNode ? inMap.get(selectedNode.id) || [] : []),
    [selectedNode, inMap],
  );
  const selectedDependents = useMemo(
    () => new Set(selectedNode ? outMap.get(selectedNode.id) || [] : []),
    [selectedNode, outMap],
  );

  // Ancestors of `from` cannot become `to` without forming a cycle.
  const ancestorsOfFrom = useMemo(
    () => (from ? reachableSet(from, inMap) : new Set<string>()),
    [from, inMap],
  );
  // Descendants of `to` cannot become `from` without forming a cycle.
  const descendantsOfTo = useMemo(
    () => (to ? reachableSet(to, outMap) : new Set<string>()),
    [to, outMap],
  );

  const fromOptions = useMemo(
    () =>
      allNodes.filter((n) => {
        if (!to) return true;
        if (n.id === to) return false;
        if (edgeSet.has(`${n.id}->${to}`)) return false;
        if (descendantsOfTo.has(n.id)) return false;
        return true;
      }),
    [allNodes, descendantsOfTo, edgeSet, to],
  );

  const toOptions = useMemo(
    () =>
      allNodes.filter((n) => {
        if (!from) return true;
        if (n.id === from) return false;
        if (edgeSet.has(`${from}->${n.id}`)) return false;
        if (ancestorsOfFrom.has(n.id)) return false;
        return true;
      }),
    [allNodes, ancestorsOfFrom, edgeSet, from],
  );

  async function handleAddEdge() {
    if (!from || !to) {
      setFormError("请同时选择前置知识点与后续知识点");
      return;
    }
    if (from === to) {
      setFormError("前置知识点与后续知识点不能相同");
      return;
    }
    if (edgeSet.has(`${from}->${to}`)) {
      setFormError("该先修关系已存在");
      return;
    }
    if (ancestorsOfFrom.has(to)) {
      setFormError("该依赖关系会形成循环，请调整方向");
      return;
    }
    setFormError("");
    const saved = await action.run(
      "/edges",
      { from_id: from, to_id: to },
      "POST",
      "已添加先修关系",
    );
    if (saved) {
      setFrom("");
      setTo("");
    }
  }

  async function handleDeleteEdge(fromID: string, toID: string) {
    const fromTitle = nodeMap.get(fromID)?.title || fromID;
    const toTitle = nodeMap.get(toID)?.title || toID;
    if (
      !(await confirm(`确认删除先修关系“${fromTitle} → ${toTitle}”？`, {
        content: "删除后将影响基于知识图谱生成的学习路径顺序。",
        danger: true,
      }))
    ) {
      return;
    }
    await action.run(
      "/edges",
      { from_point_id: fromID, to_point_id: toID },
      "DELETE",
      "已删除先修关系",
    );
  }

  if (query.isPending) {
    return <LoadingState label="正在读取知识图谱…" />;
  }
  if (query.error) {
    return (
      <ErrorState
        message={query.error.message}
        onRetry={() => void query.refetch()}
      />
    );
  }

  return (
    <div className="live-page">
      {!allNodes.length ? (
        <Card className="card-panel" title="知识依赖图谱">
          <EmptyState title="尚未维护知识点">
            在课程目录中添加知识点后，可在此查看并配置先修依赖图谱。
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card
            className="card-panel"
            title="知识依赖图谱"
            extra={
              <MetaTags>
                <MetaTag>{allNodes.length} 个知识点</MetaTag>
                <MetaTag>{edges.length} 条先修关系</MetaTag>
              </MetaTags>
            }
          >
            <div className="filter-bar is-inline">
              <Input.Search
                aria-label="搜索图谱知识点"
                placeholder="按知识点名称或说明筛选"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                allowClear
              />
              {edges.length > 0 && allNodes.length > 8 && (
                <Checkbox
                  checked={onlyLinked}
                  onChange={(e) => setOnlyLinked(e.target.checked)}
                >
                  仅显示已建立依赖的知识点（{linkedNodeIDs.size}/{allNodes.length}）
                </Checkbox>
              )}
            </div>

            <div className="dag-legend" aria-label="知识图谱图例">
              <span>
                <span className="dag-swatch is-selected" aria-hidden="true" />
                当前选中
              </span>
              <span>
                <span className="dag-swatch is-prereq" aria-hidden="true" />
                前置依赖
              </span>
              <span>
                <span className="dag-swatch is-dependent" aria-hidden="true" />
                后续知识点
              </span>
              <span>点击节点高亮关联依赖并查看详情</span>
            </div>

            {!visibleNodes.length ? (
              <EmptyState title="没有匹配的知识点" />
            ) : (
              <div className="dag-canvas">
              <svg
                className="dag-svg"
                width={svgBounds.width}
                height={svgBounds.height}
                viewBox={`${svgBounds.minX} ${svgBounds.minY} ${svgBounds.width} ${svgBounds.height}`}
                role="img"
                aria-label="课程知识点先修依赖关系图"
              >
                <defs>
                  <marker
                    id="dag-arrow"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="7"
                    markerHeight="7"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="var(--mint-line)" />
                  </marker>
                  <marker
                    id="dag-arrow-active"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="7"
                    markerHeight="7"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="var(--teal)" />
                  </marker>
                </defs>
                <g>
                  {routedEdges.map(({ edge, d, isActive }) => (
                    <path
                      key={`${edge.from_id}->${edge.to_id}`}
                      className={`dag-edge-line${isActive ? " is-active" : ""}`}
                      d={d}
                      markerEnd={
                        isActive
                          ? "url(#dag-arrow-active)"
                          : "url(#dag-arrow)"
                      }
                    />
                  ))}
                </g>
                <g>
                  {visibleNodes.map((node) => {
                    const pos = layout.positions.get(node.id);
                    if (!pos) return null;
                    const inCount = (inMap.get(node.id) || []).length;
                    const outCount = (outMap.get(node.id) || []).length;
                    const stateClass =
                      selectedID === node.id
                        ? " is-selected"
                        : selectedPrereqs.has(node.id)
                          ? " is-prereq"
                          : selectedDependents.has(node.id)
                            ? " is-dependent"
                            : "";
                    return (
                      <foreignObject
                        key={node.id}
                        x={pos.x}
                        y={pos.y}
                        width={NODE_W}
                        height={NODE_H}
                      >
                        <Button
                          size="small"
                          className={`dag-node-btn${stateClass}`}
                          aria-pressed={selectedID === node.id}
                          onClick={() =>
                            setSelectedID((prev) =>
                              prev === node.id ? "" : node.id,
                            )
                          }
                        >
                          <span className="dag-node-title" title={node.title}>
                            {node.title}
                          </span>
                          <span className="dag-node-meta">
                            前置 {inCount} · 后续 {outCount}
                          </span>
                        </Button>
                      </foreignObject>
                    );
                  })}
                </g>
              </svg>
            </div>
            )}
          </Card>

          {selectedNode && (
            <Card
              size="small"
              className="card-panel"
              title={
                <span style={{ overflowWrap: "anywhere" }}>
                  节点详情：{selectedNode.title}
                </span>
              }
              extra={
                <Button size="small" onClick={() => setSelectedID("")}>
                  取消选中
                </Button>
              }
            >
              <p className="live-meta">
                {selectedNode.description || "课程知识点"}
              </p>
              <div className="live-grid is-even" style={{ marginTop: 12 }}>
                <div>
                  <Typography.Text strong className="item-title">
                    前置依赖（{selectedPrereqs.size}）
                  </Typography.Text>
                  {selectedPrereqs.size === 0 ? (
                    <p className="live-meta">无前置知识点</p>
                  ) : (
                    <List
                      size="small"
                      dataSource={[...selectedPrereqs]}
                      renderItem={(preID) => {
                        const pre = nodeMap.get(preID);
                        if (!pre) return null;
                        return (
                          <List.Item
                            key={preID}
                            actions={
                              teacher
                                ? [
                                    <Button
                                      key="del"
                                      size="small"
                                      danger
                                      disabled={action.busy}
                                      onClick={() =>
                                        void handleDeleteEdge(
                                          preID,
                                          selectedNode.id,
                                        )
                                      }
                                    >
                                      删除关系
                                    </Button>,
                                  ]
                                : undefined
                            }
                          >
                            <Button
                              size="small"
                              type="link"
                              className="table-text-action"
                              onClick={() => setSelectedID(preID)}
                            >
                              {pre.title}
                            </Button>
                          </List.Item>
                        );
                      }}
                    />
                  )}
                </div>
                <div>
                  <Typography.Text strong className="item-title">
                    后续知识点（{selectedDependents.size}）
                  </Typography.Text>
                  {selectedDependents.size === 0 ? (
                    <p className="live-meta">无后续知识点</p>
                  ) : (
                    <List
                      size="small"
                      dataSource={[...selectedDependents]}
                      renderItem={(depID) => {
                        const dep = nodeMap.get(depID);
                        if (!dep) return null;
                        return (
                          <List.Item
                            key={depID}
                            actions={
                              teacher
                                ? [
                                    <Button
                                      key="del"
                                      size="small"
                                      danger
                                      disabled={action.busy}
                                      onClick={() =>
                                        void handleDeleteEdge(
                                          selectedNode.id,
                                          depID,
                                        )
                                      }
                                    >
                                      删除关系
                                    </Button>,
                                  ]
                                : undefined
                            }
                          >
                            <Button
                              size="small"
                              type="link"
                              className="table-text-action"
                              onClick={() => setSelectedID(depID)}
                            >
                              {dep.title}
                            </Button>
                          </List.Item>
                        );
                      }}
                    />
                  )}
                </div>
              </div>
            </Card>
          )}

          {edges.length > 0 && (
            <Card className="card-panel" title="已登记先修关系">
              <List
                size="small"
                dataSource={edges}
                pagination={{
                  pageSize: 10,
                  hideOnSinglePage: true,
                  showSizeChanger: false,
                  responsive: true,
                }}
                renderItem={(edge) => {
                  const fromNode = nodeMap.get(edge.from_id);
                  const toNode = nodeMap.get(edge.to_id);
                  if (!fromNode || !toNode) return null;
                  return (
                    <List.Item
                      key={`${edge.from_id}->${edge.to_id}`}
                      actions={
                        teacher
                          ? [
                              <Button
                                key="delete"
                                size="small"
                                danger
                                disabled={action.busy}
                                onClick={() =>
                                  void handleDeleteEdge(
                                    edge.from_id,
                                    edge.to_id,
                                  )
                                }
                              >
                                删除
                              </Button>,
                            ]
                          : undefined
                      }
                    >
                      <Space wrap size="small">
                        <MetaTag>前置：{fromNode.title}</MetaTag>
                        <span aria-hidden="true">→</span>
                        <Tag className="ui-meta-tag" color="processing">
                          {toNode.title}
                        </Tag>
                      </Space>
                    </List.Item>
                  );
                }}
              />
            </Card>
          )}
        </>
      )}

      {teacher && allNodes.length >= 2 && (
        <>
          <Feedback message={action.message} failed={action.failed} />
          <Collapse
            className="card-panel"
            items={[
              {
                key: "add-edge",
                label: "知识依赖关系（添加先修关系）",
                children: (
                  <>
                    {formError && (
                      <Alert
                        type="error"
                        showIcon
                        role="alert"
                        message={formError}
                        style={{ marginBottom: 12 }}
                      />
                    )}
                    <Form
                      className="live-inline"
                      onFinish={() => {
                        void handleAddEdge();
                      }}
                      layout="vertical"
                    >
                      <Field className="ui-field" label="前置知识点" required>
                        <Select
                          aria-label="前置知识点"
                          value={from || undefined}
                          placeholder="请选择前置知识点"
                          allowClear
                          onChange={(val) => {
                            setFormError("");
                            const nextFrom = val || "";
                            setFrom(nextFrom);
                            if (
                              nextFrom &&
                              to &&
                              (nextFrom === to ||
                                edgeSet.has(`${nextFrom}->${to}`) ||
                                reachableSet(nextFrom, inMap).has(to))
                            ) {
                              setTo("");
                            }
                          }}
                          showSearch
                          optionFilterProp="children"
                        >
                          {fromOptions.map((p) => (
                            <Select.Option value={p.id} key={p.id}>
                              {p.title}
                            </Select.Option>
                          ))}
                        </Select>
                      </Field>
                      <Field className="ui-field" label="后续知识点" required>
                        <Select
                          aria-label="后续知识点"
                          value={to || undefined}
                          placeholder="请选择后续知识点"
                          allowClear
                          onChange={(val) => {
                            setFormError("");
                            setTo(val || "");
                          }}
                          showSearch
                          optionFilterProp="children"
                        >
                          {toOptions.map((p) => (
                            <Select.Option value={p.id} key={p.id}>
                              {p.title}
                            </Select.Option>
                          ))}
                        </Select>
                      </Field>
                      <Button
                        disabled={action.busy || !from || !to}
                        htmlType="submit"
                        type="primary"
                      >
                        保存依赖
                      </Button>
                    </Form>
                  </>
                ),
              },
            ]}
          />
        </>
      )}
    </div>
  );
}
