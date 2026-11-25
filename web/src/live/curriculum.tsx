import { Field } from "../shared/Field";
import { useConfirm } from "../shared/confirm";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Alert,
  Button,
  Card,
  Collapse,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Tooltip,
  Tree,
} from "antd";
import { Feedback, Link, useAction, useLearning, useLiveQuery } from "./context";
import { PageHeader } from "../shared/PageHeader";
import { EmptyState, ErrorState, LoadingState, MetaTag } from "../shared/ui";
import { KnowledgeGraph } from "./graph";
import { curriculumChapters, curriculumSections } from "./curriculum-template";
import { labelFor, pointKindLabels } from "./domain-meta";
import type { Point } from "./types";
import { hasControlNull, utf8ByteLength } from "./validation";

interface TreeNode {
  key: string;
  title: ReactNode;
  children: TreeNode[];
}

function buildCurriculumTree(
  points: Point[],
  onEdit: (p: Point) => void,
  onDelete: (p: Point) => void,
  busy: boolean,
): TreeNode[] {
  const byID = new Map(points.map((p) => [p.id, p]));
  const childrenMap = new Map<string, Point[]>();
  const roots: Point[] = [];

  for (const p of points) {
    if (p.parent_id && byID.has(p.parent_id) && p.parent_id !== p.id) {
      const list = childrenMap.get(p.parent_id);
      if (list) list.push(p);
      else childrenMap.set(p.parent_id, [p]);
    } else {
      roots.push(p);
    }
  }

  const visit = (node: Point, ancestry: Set<string>): TreeNode => {
    const nextAncestry = new Set(ancestry);
    nextAncestry.add(node.id);
    const kids = (childrenMap.get(node.id) || [])
      .filter((child) => !nextAncestry.has(child.id))
      .map((child) => visit(child, nextAncestry));
    const deleteBtn = (
      <Button
        size="small"
        type="link"
        danger
        disabled={busy || kids.length > 0}
        onClick={(e) => e.stopPropagation()}
      >
        删除
      </Button>
    );
    return {
      key: node.id,
      title: (
        <Space
          size={6}
          wrap
          style={{ minWidth: 0, maxWidth: "100%" }}
          styles={{ item: { minWidth: 0, maxWidth: "100%" } }}
        >
          <span style={{ overflowWrap: "anywhere", minWidth: 0 }}>
            {node.title}
          </span>
          <MetaTag>{labelFor(pointKindLabels, node.kind, node.kind)}</MetaTag>
          <Button
            size="small"
            type="link"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              onEdit(node);
            }}
          >
            编辑
          </Button>
          {kids.length > 0 ? (
            <Tooltip title="请先删除所有子节点后再删除当前节点。">
              <span>{deleteBtn}</span>
            </Tooltip>
          ) : (
            <Popconfirm
              title={`确认删除“${node.title}”？`}
              onConfirm={() => void onDelete(node)}
            >
              {deleteBtn}
            </Popconfirm>
          )}
        </Space>
      ),
      children: kids,
    };
  };

  return roots.map((root) => visit(root, new Set()));
}

export function CurriculumPage() {
  const { course } = useLearning();
  const confirm = useConfirm();
  const ctx = useLiveQuery<{ points: Point[] }>("");
  const action = useAction();

  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("chapter");
  const [parent, setParent] = useState("");
  const [description, setDescription] = useState("");
  const [validationError, setValidationError] = useState("");
  const [editingPoint, setEditingPoint] = useState<Point | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editError, setEditError] = useState("");
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const seenParentsRef = useRef<Set<string>>(new Set());

  const points = ctx.data?.points || [];

  async function handleDeletePoint(node: Point) {
    const res = await action.run(
      `/points/${node.id}`,
      undefined,
      "DELETE",
      `已删除“${node.title}”`,
    );
    if (res && editingPoint?.id === node.id) {
      setEditingPoint(null);
    }
  }

  async function handleSavePointEdit() {
    if (!editingPoint) return;
    const nextTitle = editTitle.trim();
    const nextDesc = editDesc.trim();
    if (!nextTitle || utf8ByteLength(nextTitle) > 500 || hasControlNull(nextTitle)) {
      setEditError("节点名称不能为空，且不超过 500 字节");
      return;
    }
    if (utf8ByteLength(nextDesc) > 10000 || hasControlNull(nextDesc)) {
      setEditError("节点说明不能超过 10000 字节且不能包含非法字符");
      return;
    }
    setEditError("");
    const saved = await action.run(
      `/points/${editingPoint.id}`,
      { title: nextTitle, description: nextDesc },
      "PUT",
      "目录节点已更新",
    );
    if (saved) {
      setEditingPoint(null);
    }
  }

  const treeData = useMemo(
    () =>
      buildCurriculumTree(
        points,
        (node) => {
          setEditingPoint(node);
          setEditTitle(node.title);
          setEditDesc(node.description || "");
          setEditError("");
        },
        (node) => {
          void handleDeletePoint(node);
        },
        action.busy,
      ),
    [points, action.busy],
  );

  // Auto-expand parents whenever new children are added or imported.
  useEffect(() => {
    const parentIDs = new Set<string>();
    for (const p of points) {
      if (p.parent_id) parentIDs.add(p.parent_id);
    }
    const newlyPopulated: string[] = [];
    for (const id of parentIDs) {
      if (!seenParentsRef.current.has(id)) {
        seenParentsRef.current.add(id);
        newlyPopulated.push(id);
      }
    }
    if (newlyPopulated.length > 0) {
      setExpandedKeys((prev) => Array.from(new Set([...prev, ...newlyPopulated])));
    }
  }, [points]);

  const parentOptions = useMemo(() => {
    if (kind === "chapter") return [];
    if (kind === "section") return points.filter((p) => p.kind === "chapter");
    return points.filter((p) => p.kind === "chapter" || p.kind === "section");
  }, [points, kind]);

  function handleKindChange(nextKind: string) {
    setValidationError("");
    setKind(nextKind);
    if (nextKind === "chapter") {
      setParent("");
      return;
    }
    if (nextKind === "section") {
      const current = points.find((p) => p.id === parent);
      if (current && current.kind !== "chapter") {
        setParent("");
      }
    }
  }

  async function handleAddNode() {
    const trimmedTitle = title.trim();
    const trimmedDesc = description.trim();
    if (
      !trimmedTitle ||
      utf8ByteLength(trimmedTitle) > 500 ||
      hasControlNull(trimmedTitle)
    ) {
      setValidationError("请填写节点名称（不能为空且不超过 500 字节）");
      return;
    }
    if (utf8ByteLength(trimmedDesc) > 10_000 || hasControlNull(trimmedDesc)) {
      setValidationError("节点说明不能超过 10,000 字节且不能包含非法空字符");
      return;
    }
    const effectiveParent = kind === "chapter" ? "" : parent;
    const siblingCount = points.filter(
      (p) => (p.parent_id || "") === effectiveParent,
    ).length;
    setValidationError("");

    const created = await action.run(
      "/points",
      {
        title: trimmedTitle,
        kind,
        parent_id: effectiveParent,
        description: trimmedDesc,
        position: siblingCount,
      },
      "POST",
      "目录节点已添加",
    );
    if (created) {
      setTitle("");
      setDescription("");
      if (effectiveParent) {
        setExpandedKeys((prev) =>
          prev.includes(effectiveParent) ? prev : [...prev, effectiveParent],
        );
      }
    }
  }

  async function handleImportTemplate() {
    if (
      !(await confirm("向当前空课程导入参考课程目录？", {
        content: "将导入默认大数据课程参考目录（不含资料与题目），确认继续？",
      }))
    ) {
      return;
    }
    await action.run(
      "/curriculum",
      {
        chapters: curriculumSections.map((sections, i) => ({
          title: curriculumChapters[i],
          sections: sections.map((s) => ({
            title: s.title,
            points: s.points,
          })),
        })),
      },
      "POST",
      "已导入参考课程目录",
    );
  }

  return (
    <div className="live-page is-wide-workspace">
      <PageHeader
        title="课程目录与知识图谱"
        subtitle={course?.title}
        meta={!ctx.isPending && !ctx.error ? <MetaTag>{points.length} 个目录节点</MetaTag> : undefined}
        extra={
          <Link className="ghost-btn" to="/teacher/materials">
            管理学习资料
          </Link>
        }
      />
      <Feedback message={action.message} failed={action.failed} />
      {ctx.isPending ? (
        <LoadingState label="正在读取课程目录…" />
      ) : ctx.error ? (
        <ErrorState
          message={ctx.error.message}
          onRetry={() => void ctx.refetch()}
        />
      ) : (
        <div className="curriculum-workspace">
          <div className="live-stack">
            <Card className="card-panel" title="章节与知识点">
              {points.length ? (
                <Tree
                  aria-label="课程目录树"
                  blockNode
                  className={
                    treeData.some((n) => n.children.length > 0)
                      ? undefined
                      : "live-flat-tree"
                  }
                  expandedKeys={expandedKeys}
                  onExpand={(keys) => setExpandedKeys(keys.map(String))}
                  treeData={treeData}
                />
              ) : (
                <EmptyState title="目录为空">
                  添加章节、小节和知识点，或导入参考课程目录。
                </EmptyState>
              )}
            </Card>
            <Card className="card-panel" title="添加目录节点">
              <Form
                className="live-form"
                onFinish={() => {
                  void handleAddNode();
                }}
                layout="vertical"
              >
                {validationError && (
                  <Alert
                    type="error"
                    showIcon
                    role="alert"
                    message={validationError}
                  />
                )}
                <Field className="ui-field" label="目录类型">
                  <Select
                    aria-label="目录类型"
                    value={kind}
                    onChange={handleKindChange}
                    showSearch
                    optionFilterProp="children"
                  >
                    <Select.Option value="chapter">章节</Select.Option>
                    <Select.Option value="section">小节</Select.Option>
                    <Select.Option value="point">知识点</Select.Option>
                  </Select>
                </Field>
                <Field
                  className="ui-field"
                  label="所属目录"
                  extra={
                    kind === "chapter"
                      ? "章节固定位于课程顶层"
                      : kind === "section"
                        ? "小节仅可挂在章节下"
                        : "知识点可挂在章节、小节下或置于顶层"
                  }
                >
                  <Select
                    aria-label="所属目录"
                    value={kind === "chapter" ? "" : parent}
                    disabled={kind === "chapter"}
                    onChange={(value) => setParent(value)}
                    showSearch
                    optionFilterProp="children"
                  >
                    <Select.Option value="">顶层目录</Select.Option>
                    {parentOptions.map((p) => (
                      <Select.Option value={p.id} key={p.id}>
                        {p.title}（{labelFor(pointKindLabels, p.kind, p.kind)}）
                      </Select.Option>
                    ))}
                  </Select>
                </Field>
                <Field className="ui-field" label="节点名称" required>
                  <Input
                    aria-label="节点名称"
                    value={title}
                    onChange={(e) => {
                      setValidationError("");
                      setTitle(e.target.value);
                    }}
                  />
                </Field>
                <Field className="ui-field" label="节点说明（选填）">
                  <Input.TextArea
                    aria-label="节点说明"
                    rows={3}
                    placeholder="补充知识点要求、重难点或学习建议"
                    value={description}
                    onChange={(e) => {
                      setValidationError("");
                      setDescription(e.target.value);
                    }}
                  />
                </Field>
                <Button
                  disabled={action.busy || !title.trim()}
                  htmlType="submit"
                  type="primary"
                >
                  添加节点
                </Button>
              </Form>
            </Card>
            {!points.length && (
              <Collapse
                className="card-panel"
                items={[
                  {
                    key: "content",
                    label: "导入参考目录",
                    children: (
                      <>
                        <p className="live-meta">
                          大数据课程目录模板，不含资料与题目。
                        </p>
                        <Button
                          disabled={action.busy}
                          onClick={() => {
                            void handleImportTemplate();
                          }}
                        >
                          导入参考课程目录
                        </Button>
                      </>
                    ),
                  },
                ]}
              />
            )}
          </div>
          <KnowledgeGraph />
        </div>
      )}
      <Modal
        open={!!editingPoint}
        title={
          <span style={{ overflowWrap: "anywhere" }}>
            {editingPoint
              ? `编辑${labelFor(pointKindLabels, editingPoint.kind, "节点")} · ${editingPoint.title}`
              : "编辑目录节点"}
          </span>
        }
        onCancel={() => {
          setEditingPoint(null);
          setEditError("");
        }}
        onOk={() => void handleSavePointEdit()}
        confirmLoading={action.busy}
        okText="保存修改"
        destroyOnHidden
      >
        {editError && (
          <Alert
            type="error"
            showIcon
            role="alert"
            message={editError}
            style={{ marginBottom: 12 }}
          />
        )}
        <Form layout="vertical">
          <Field className="ui-field" label="节点名称" required>
            <Input
              aria-label="编辑节点名称"
              value={editTitle}
              onChange={(e) => {
                setEditError("");
                setEditTitle(e.target.value);
              }}
            />
          </Field>
          <Field className="ui-field" label="节点说明（选填）">
            <Input.TextArea
              aria-label="编辑节点说明"
              rows={3}
              value={editDesc}
              onChange={(e) => {
                setEditError("");
                setEditDesc(e.target.value);
              }}
            />
          </Field>
        </Form>
      </Modal>
    </div>
  );
}
