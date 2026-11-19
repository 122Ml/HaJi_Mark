import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Alert, Button, Collapse, Input, InputNumber, Select, Space } from "antd";
import { Field } from "../shared/Field";
import { useConfirm } from "../shared/confirm";
import {
  EmptyState,
  LoadingState,
  MetaTag,
  MetaTags,
  StatusTag,
} from "../shared/ui";
import { Feedback, useAction, useLearning, useLiveQuery } from "./context";
import { RichContent, type Asset } from "./content-render";
import { DraftNotice, useEditorDraft } from "./editing";
import { hasControlNull, utf8ByteLength } from "./validation";
import { WorkflowJob } from "./workflow-job";

type AssetRevision = {
  id: string;
  asset_id: string;
  revision: number;
  body: string;
  state: string;
  model_job_id: string | null;
  structured: unknown;
};

type CropBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const ASSET_KIND_LABELS: Record<string, string> = {
  page: "原页预览",
  image: "图片",
  formula: "公式",
  chart: "数据图表",
  diagram: "结构／流程图",
};

const CROP_KIND_OPTIONS = [
  { value: "image", label: "图片" },
  { value: "formula", label: "公式" },
  { value: "chart", label: "数据图表" },
  { value: "diagram", label: "结构／流程图" },
];

const CROP_FIELDS: readonly {
  key: keyof CropBox;
  label: string;
  ariaLabel: string;
}[] = [
  { key: "x", label: "左%", ariaLabel: "左偏移百分比" },
  { key: "y", label: "上%", ariaLabel: "上偏移百分比" },
  { key: "width", label: "宽%", ariaLabel: "宽度百分比" },
  { key: "height", label: "高%", ariaLabel: "高度百分比" },
];

const FULL_CROP: CropBox = { x: 0, y: 0, width: 1, height: 1 };

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function clampCrop(raw: CropBox): CropBox {
  const safe = (v: number, fallback: number) =>
    Number.isFinite(v) ? v : fallback;
  const x = round4(Math.max(0, Math.min(0.99, safe(raw.x, 0))));
  const y = round4(Math.max(0, Math.min(0.99, safe(raw.y, 0))));
  const maxWidth = round4(Math.max(0.01, 1 - x));
  const maxHeight = round4(Math.max(0.01, 1 - y));
  const width = round4(Math.max(0.01, Math.min(maxWidth, safe(raw.width, maxWidth))));
  const height = round4(
    Math.max(0.01, Math.min(maxHeight, safe(raw.height, maxHeight))),
  );
  return { x, y, width, height };
}

export function MaterialAssets({
  sourceID,
  revision,
  editable,
  activeFragmentAssetIDs,
}: {
  sourceID: string;
  revision: number;
  editable: boolean;
  activeFragmentAssetIDs?: Set<string>;
}) {
  const [open, setOpen] = useState(false);
  const q = useLiveQuery<{ assets: Asset[]; revisions: AssetRevision[] }>(
    `/sources/${sourceID}/assets`,
    open && !!sourceID,
  );
  const [id, setID] = useState("");
  const assets = q.data?.assets || [];
  const revisions = q.data?.revisions || [];
  const asset = assets.find((a) => a.id === id) || assets[0];

  const hasActiveFilter =
    !!activeFragmentAssetIDs && activeFragmentAssetIDs.size > 0;

  return (
    <Collapse
      className="card-panel"
      onChange={(keys) =>
        setOpen(Array.isArray(keys) ? keys.length > 0 : Boolean(keys))
      }
      items={[
        {
          key: "content",
          label: (
            <>公式与图像{q.data ? ` · ${assets.length}` : ""}</>
          ),
          children: (
            <>
              <Feedback error={q.error} />
              {q.isPending ? (
                <LoadingState label="正在加载公式与图像…" />
              ) : !assets.length ? (
                <EmptyState title="当前原件没有可核对的公式或图像" />
              ) : (
                <>
                  <Select
                    aria-label="原图选择"
                    value={asset?.id}
                    className="live-full-width"
                    showSearch
                    optionFilterProp="label"
                    onChange={setID}
                    options={assets.map((a, i) => {
                      const loc = a.locator?.page
                        ? ` 第${String(a.locator.page)}页`
                        : a.locator?.slide
                          ? ` 幻灯片${String(a.locator.slide)}`
                          : "";
                      const historicalAsset =
                        hasActiveFilter &&
                        a.kind !== "page" &&
                        !activeFragmentAssetIDs.has(a.id);
                      return {
                        value: a.id,
                        label: `${i + 1} · ${ASSET_KIND_LABELS[a.kind] || a.kind}${loc}${historicalAsset ? "（旧解析版本）" : ""}`,
                      };
                    })}
                  />
                  {asset && (
                    <AssetEditor
                      key={asset.id}
                      asset={asset}
                      revisions={revisions.filter(
                        (r) => r.asset_id === asset.id,
                      )}
                      sourceRevision={revision}
                      editable={editable}
                      inCurrentRevision={
                        !hasActiveFilter || activeFragmentAssetIDs.has(asset.id)
                      }
                      onCreated={setID}
                      onRefresh={async () => {
                        await q.refetch();
                      }}
                    />
                  )}
                </>
              )}
            </>
          ),
        },
      ]}
    />
  );
}

function AssetEditor({
  asset,
  revisions,
  sourceRevision,
  editable,
  inCurrentRevision,
  onCreated,
  onRefresh,
}: {
  asset: Asset;
  revisions: AssetRevision[];
  sourceRevision: number;
  editable: boolean;
  inCurrentRevision: boolean;
  onCreated: (id: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const confirm = useConfirm();
  const { course } = useLearning();
  const action = useAction();
  const latest = revisions[0];

  const [initialDraft] = useState(() => ({
    body: latest?.body || "",
    model_job_id: latest?.model_job_id || "",
  }));

  const draft = useEditorDraft(
    `asset:${course?.id || ""}:${asset.id}`,
    initialDraft,
    !!course,
  );

  const resetRef = useRef(draft.reset);
  resetRef.current = draft.reset;
  const lastSyncedRevRef = useRef<number>(latest?.revision ?? -1);
  useEffect(() => {
    const rev = latest?.revision ?? -1;
    if (rev !== lastSyncedRevRef.current) {
      lastSyncedRevRef.current = rev;
      if (!draft.dirty) {
        resetRef.current({
          body: latest?.body || "",
          model_job_id: latest?.model_job_id || "",
        });
      }
    }
  }, [latest?.revision, latest?.body, latest?.model_job_id, draft.dirty]);

  const [crop, setCrop] = useState<CropBox>(FULL_CROP);
  const [dragState, setDragState] = useState<{
    startNorm: { x: number; y: number };
    startClient: { x: number; y: number };
    moved: boolean;
  } | null>(null);
  const [kind, setKind] = useState("image");
  const [natural, setNatural] = useState<{ w: number; h: number }>({
    w: 0,
    h: 0,
  });
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setCrop(FULL_CROP);
    setDragState(null);
    setNatural({ w: 0, h: 0 });
    setImgError(false);
  }, [asset.id, sourceRevision]);

  if (!course) {
    return (
      <Alert type="warning" showIcon message="请先选择当前课程后再查看图像。" />
    );
  }

  const canTranscribe = editable && inCurrentRevision;
  const imgVersion = `${sourceRevision}-${latest?.revision || 0}`;
  const imgSrc = `/api/v1/learning/courses/${encodeURIComponent(course.id)}/assets/${encodeURIComponent(asset.id)}/file?v=${encodeURIComponent(imgVersion)}`;

  function pointerToNorm(e: PointerEvent<HTMLDivElement>) {
    const b = e.currentTarget.getBoundingClientRect();
    if (b.width <= 0 || b.height <= 0) return null;
    return {
      x: Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)),
      y: Math.max(0, Math.min(1, (e.clientY - b.top) / b.height)),
    };
  }

  function endDrag(e: PointerEvent<HTMLDivElement>) {
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore if capture was already released.
      }
    }
    setDragState(null);
  }

  const cropPxW = natural.w > 0 ? Math.round(crop.width * natural.w) : 0;
  const cropPxH = natural.h > 0 ? Math.round(crop.height * natural.h) : 0;
  const cropSizeValid =
    !imgError &&
    natural.w > 0 &&
    natural.h > 0 &&
    cropPxW >= 10 &&
    cropPxH >= 10 &&
    crop.x + crop.width <= 1.000001 &&
    crop.y + crop.height <= 1.000001;

  const bodyTooLong =
    utf8ByteLength(draft.value.body) > 60000 ||
    hasControlNull(draft.value.body);
  const staleConflict = action.error?.status === 409;

  return (
    <div className="live-form">
      {!inCurrentRevision && editable && (
        <Alert
          type="warning"
          showIcon
          message="此图像不属于当前解析版本的原文片段，仅支持查看历史转写"
          description={
            asset.kind === "page"
              ? "原页预览仍可重新裁剪生成新的题图／公式片段。"
              : "请在当前解析版本的原图或新裁剪区域上进行核对。"
          }
        />
      )}
      {imgError ? (
        <Alert
          type="error"
          showIcon
          role="alert"
          message="图像加载失败，请刷新页面或检查原件文件。"
          action={
            <Button
              size="small"
              htmlType="button"
              onClick={() => {
                setImgError(false);
                void onRefresh();
              }}
            >
              重试加载
            </Button>
          }
        />
      ) : (
        <div
          className="asset-crop"
          onPointerDown={(e) => {
            if (!editable || imgError) return;
            const norm = pointerToNorm(e);
            if (!norm) return;
            e.currentTarget.setPointerCapture?.(e.pointerId);
            setDragState({
              startNorm: norm,
              startClient: { x: e.clientX, y: e.clientY },
              moved: false,
            });
          }}
          onPointerMove={(e) => {
            if (!dragState) return;
            const dx = Math.abs(e.clientX - dragState.startClient.x);
            const dy = Math.abs(e.clientY - dragState.startClient.y);
            if (!dragState.moved && dx < 4 && dy < 4) return;
            const p = pointerToNorm(e);
            if (!p) return;
            if (!dragState.moved) {
              setDragState({ ...dragState, moved: true });
            }
            const x = Math.min(p.x, dragState.startNorm.x);
            const y = Math.min(p.y, dragState.startNorm.y);
            const width = Math.abs(p.x - dragState.startNorm.x);
            const height = Math.abs(p.y - dragState.startNorm.y);
            if (width >= 0.01 && height >= 0.01) {
              setCrop(clampCrop({ x, y, width, height }));
            }
          }}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <img
            draggable={false}
            src={imgSrc}
            alt={editable ? "原始图像，拖动选择裁剪区域" : "原始图像预览"}
            onLoad={(e) => {
              setNatural({
                w: e.currentTarget.naturalWidth,
                h: e.currentTarget.naturalHeight,
              });
              setImgError(false);
            }}
            onError={() => {
              setImgError(true);
              setNatural({ w: 0, h: 0 });
            }}
          />
          {editable && natural.w > 0 && natural.h > 0 && (
            <span
              className="asset-crop-box"
              style={{
                left: `${crop.x * 100}%`,
                top: `${crop.y * 100}%`,
                width: `${crop.width * 100}%`,
                height: `${crop.height * 100}%`,
              }}
            />
          )}
        </div>
      )}
      {editable && (
        <Collapse
          items={[
            {
              key: "content",
              label: <>裁剪题图／公式区域</>,
              children: (
                <div className="live-form">
                  <div className="live-inline">
                    {CROP_FIELDS.map(({ key, label, ariaLabel }) => {
                      const maxPercent =
                        key === "width"
                          ? Math.max(1, Math.floor((1 - crop.x) * 100))
                          : key === "height"
                            ? Math.max(1, Math.floor((1 - crop.y) * 100))
                            : 99;
                      const minPercent = key === "width" || key === "height" ? 1 : 0;
                      return (
                        <Field
                          className="ui-field"
                          key={key}
                          label={<>{label}</>}
                        >
                          <InputNumber
                            aria-label={ariaLabel}
                            min={minPercent}
                            max={maxPercent}
                            step={1}
                            precision={0}
                            value={Math.round(crop[key] * 100)}
                            onChange={(val) => {
                              if (typeof val !== "number" || !Number.isFinite(val)) {
                                return;
                              }
                              const nextRatio = val / 100;
                              setCrop((prev) =>
                                clampCrop({ ...prev, [key]: nextRatio }),
                              );
                            }}
                          />
                        </Field>
                      );
                    })}
                    <Field className="ui-field" label={<>内容类型</>}>
                      <Select
                        aria-label="内容类型"
                        value={kind}
                        onChange={setKind}
                        showSearch
                        optionFilterProp="label"
                        options={CROP_KIND_OPTIONS}
                      />
                    </Field>
                  </div>
                  {natural.w > 0 && natural.h > 0 && (
                    <p className="live-meta">
                      当前裁剪像素：{cropPxW} × {cropPxH} px（原图 {natural.w} ×{" "}
                      {natural.h} px；宽高须均不小于 10 px）
                    </p>
                  )}
                  <Space wrap>
                    <Button
                      htmlType="button"
                      disabled={action.busy}
                      onClick={() => setCrop(FULL_CROP)}
                    >
                      重置整图
                    </Button>
                    <Button
                      htmlType="button"
                      disabled={action.busy || !cropSizeValid}
                      onClick={async () => {
                        const msg = draft.dirty
                          ? "保存裁剪并切换到新图像？当前转写编辑将保留在浏览器草稿中。"
                          : "按当前区域裁剪并生成新的题图／公式片段？";
                        if (!(await confirm(msg))) return;
                        const safeCrop = clampCrop(crop);
                        const a = await action.run<Asset>(
                          `/assets/${asset.id}/crop`,
                          {
                            ...safeCrop,
                            kind,
                            parse_revision: sourceRevision,
                          },
                          "POST",
                          undefined,
                          {
                            invalidatePrefixes: [
                              "sources",
                              "resources",
                              "jobs",
                              "decisions",
                            ],
                          },
                        );
                        if (a) onCreated(a.id);
                      }}
                    >
                      保存裁剪
                    </Button>
                  </Space>
                </div>
              ),
            },
          ]}
        />
      )}
      <MetaTags>
        {latest ? (
          <>
            <StatusTag
              status={latest.state}
              label={latest.state === "confirmed" ? "已确认" : "待核对"}
            />
            <MetaTag>转写修订 {latest.revision}</MetaTag>
          </>
        ) : (
          <MetaTag>尚无转写</MetaTag>
        )}
      </MetaTags>
      {!canTranscribe && latest && (
        <div className="rag-hit">
          <RichContent text={latest.body} />
        </div>
      )}
      {canTranscribe && (
        <>
          <WorkflowJob
            kind="vision"
            target={{ asset_id: asset.id }}
            onAdopt={async (output) => {
              const raw = output.asset_revision;
              if (!raw || typeof raw !== "object") return;
              const r = raw as Partial<AssetRevision>;
              if (typeof r.body !== "string") return;
              if (
                !draft.dirty ||
                (await confirm("载入识别候选并覆盖当前编辑区内容？"))
              ) {
                draft.change({
                  body: r.body,
                  model_job_id: r.model_job_id || "",
                });
                await onRefresh();
              }
            }}
          />
          <DraftNotice
            {...draft}
            onDiscard={() =>
              draft.reset({
                body: latest?.body || "",
                model_job_id: latest?.model_job_id || "",
              })
            }
          />
          <Field className="ui-field" label={<>核对转写</>}>
            <Input.TextArea
              aria-label="图像核对转写"
              rows={7}
              value={draft.value.body}
              onChange={(e) =>
                draft.change({ ...draft.value, body: e.target.value })
              }
            />
          </Field>
          {bodyTooLong && (
            <Alert
              type="warning"
              showIcon
              message="转写内容不能超过 60000 字节，且不能包含非法空字符。"
            />
          )}
          <RichContent text={draft.value.body} />
          <Button
            htmlType="button"
            disabled={action.busy || !draft.value.body.trim() || bodyTooLong}
            onClick={async () => {
              const snapshot = draft.value;
              const r = await action.run(
                `/assets/${asset.id}/revisions`,
                {
                  ...snapshot,
                  structured: latest?.structured || {},
                  base_revision: latest?.revision || 0,
                },
                "POST",
                "已保存",
                {
                  invalidatePrefixes: [
                    "sources",
                    "resources",
                    "jobs",
                    "decisions",
                  ],
                },
              );
              if (r) {
                draft.saved(snapshot);
              }
            }}
            type="primary"
          >
            确认转写并更新原文
          </Button>
        </>
      )}
      <Feedback message={action.message} failed={action.failed} />
      {staleConflict && (
        <Alert
          type="warning"
          showIcon
          message="原图或转写修订已发生变化，请刷新后再提交。"
          action={
            <Button
              size="small"
              htmlType="button"
              onClick={() => void onRefresh()}
            >
              刷新原图与转写
            </Button>
          }
        />
      )}
      {!!revisions.length && (
        <Collapse
          items={[
            {
              key: "content",
              label: <>转写历史</>,
              children: (
                <>
                  {revisions.map((r) => (
                    <article className="rag-hit" key={r.id}>
                      <MetaTags>
                        <MetaTag>修订 {r.revision}</MetaTag>
                        <StatusTag
                          status={r.state}
                          label={r.state === "confirmed" ? "已确认" : "模型候选"}
                        />
                      </MetaTags>
                      <RichContent text={r.body} />
                    </article>
                  ))}
                </>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}
