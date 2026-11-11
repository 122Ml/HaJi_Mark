import { useState, type PointerEvent } from "react";
import { Select } from "antd";
import { Feedback, useAction, useLearning, useLiveQuery } from "./context";
import { WorkflowJob } from "./workflow-job";
import { RichContent, type Asset } from "./content-render";
import { DraftNotice, useEditorDraft } from "./editing";

type Revision = {
  id: string;
  asset_id: string;
  revision: number;
  body: string;
  state: string;
  model_job_id: string | null;
  structured: unknown;
};
export function MaterialAssets({
  sourceID,
  revision,
  editable,
}: {
  sourceID: string;
  revision: number;
  editable: boolean;
}) {
  const q = useLiveQuery<{ assets: Asset[]; revisions: Revision[] }>(
    `/sources/${sourceID}/assets`,
  );
  const [id, setID] = useState("");
  const asset = q.data?.assets.find((a) => a.id === id) || q.data?.assets[0];
  return (
    <details className="card-panel">
      <summary>公式与图像 · {q.data?.assets.length || 0}</summary>
      <Feedback error={q.error} />
      {!!q.data?.assets.length && (
        <>
          <Select
            aria-label="原图选择"
            value={asset?.id}
            style={{ width: "100%" }}
            onChange={setID}
            options={q.data.assets.map((a, i) => ({
              value: a.id,
              label: `${i + 1} · ${a.kind === "page" ? "原页预览" : a.kind} ${a.locator.page ? `第${a.locator.page}页` : a.locator.slide ? `幻灯片${a.locator.slide}` : ""}`,
            }))}
          />
          {asset && (
            <AssetEditor
              key={asset.id}
              asset={asset}
              revisions={q.data.revisions.filter(
                (r) => r.asset_id === asset.id,
              )}
              sourceRevision={revision}
              editable={editable}
              onCreated={setID}
              onRefresh={async () => {
                await q.refetch();
              }}
            />
          )}
        </>
      )}
    </details>
  );
}
function AssetEditor({
  asset,
  revisions,
  sourceRevision,
  editable,
  onCreated,
  onRefresh,
}: {
  asset: Asset;
  revisions: Revision[];
  sourceRevision: number;
  editable: boolean;
  onCreated: (id: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const { course } = useLearning(),
    action = useAction(),
    latest = revisions[0];
  const draft = useEditorDraft(
    `asset:${course!.id}:${asset.id}:${latest?.revision || 0}`,
    { body: latest?.body || "", model_job_id: latest?.model_job_id || "" },
  );
  const [crop, setCrop] = useState({ x: 0, y: 0, width: 1, height: 1 }),
    [start, setStart] = useState<{ x: number; y: number } | null>(null),
    [kind, setKind] = useState("image");
  function position(e: PointerEvent<HTMLDivElement>) {
    const b = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)),
      y: Math.max(0, Math.min(1, (e.clientY - b.top) / b.height)),
    };
  }
  return (
    <div className="live-form">
      <div
        className="asset-crop"
        onPointerDown={(e) => {
          if (!editable) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          setStart(position(e));
        }}
        onPointerMove={(e) => {
          if (!start) return;
          const p = position(e);
          setCrop({
            x: Math.min(p.x, start.x),
            y: Math.min(p.y, start.y),
            width: Math.abs(p.x - start.x),
            height: Math.abs(p.y - start.y),
          });
        }}
        onPointerUp={() => setStart(null)}
        onPointerCancel={() => setStart(null)}
      >
        <img
          draggable={false}
          src={`/api/v1/learning/courses/${course!.id}/assets/${asset.id}/file`}
          alt="原始图像，拖动选择裁剪区域"
        />
        {editable && (
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
      {editable && (
        <details>
          <summary>裁剪题图／公式区域</summary>
          <div className="live-inline">
            {(["x", "y", "width", "height"] as const).map((k) => (
              <label key={k}>
                {{ x: "左", y: "上", width: "宽", height: "高" }[k]} %
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={Math.round(crop[k] * 100)}
                  onChange={(e) =>
                    setCrop({ ...crop, [k]: Number(e.target.value) / 100 })
                  }
                />
              </label>
            ))}
            <label>
              内容类型
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="image">图片</option>
                <option value="formula">公式</option>
                <option value="chart">数据图表</option>
                <option value="diagram">结构／流程图</option>
              </select>
            </label>
            <button
              className="ghost-btn"
              disabled={action.busy || crop.width <= 0 || crop.height <= 0}
              onClick={async () => {
                if (
                  draft.dirty &&
                  !confirm("切换到裁剪图像？当前转写编辑将保留为草稿。")
                )
                  return;
                const a = await action.run<Asset>(`/assets/${asset.id}/crop`, {
                  ...crop,
                  kind,
                  parse_revision: sourceRevision,
                });
                if (a) onCreated(a.id);
              }}
            >
              保存裁剪
            </button>
          </div>
        </details>
      )}
      <p className="live-meta">
        {latest
          ? `转写修订 ${latest.revision} · ${latest.state === "confirmed" ? "已确认" : "待核对"}`
          : "尚无转写"}
      </p>
      {editable && (
        <>
          <WorkflowJob
            kind="vision"
            target={{ asset_id: asset.id }}
            onAdopt={async (output) => {
              const r = output.asset_revision as Revision;
              if (r && (!draft.dirty || confirm("载入识别候选？"))) {
                await onRefresh();
                draft.change({
                  body: r.body,
                  model_job_id: r.model_job_id || "",
                });
              }
            }}
          />
          <DraftNotice {...draft} />
          <label>
            核对转写
            <textarea
              aria-label="图像核对转写"
              rows={7}
              value={draft.value.body}
              onChange={(e) =>
                draft.change({ ...draft.value, body: e.target.value })
              }
            />
          </label>
          <RichContent text={draft.value.body} />
          <button
            className="primary-link"
            disabled={action.busy || !draft.value.body.trim()}
            onClick={async () => {
              const snapshot = draft.value;
              const r = await action.run(`/assets/${asset.id}/revisions`, {
                ...snapshot,
                structured: latest?.structured || {},
                base_revision: latest?.revision || 0,
              });
              if (r) draft.saved(snapshot);
            }}
          >
            确认转写并更新原文
          </button>
        </>
      )}
      <Feedback message={action.message} failed={action.failed} />
      {!!revisions.length && (
        <details>
          <summary>转写历史</summary>
          {revisions.map((r) => (
            <article className="rag-hit" key={r.id}>
              <strong>
                修订 {r.revision} ·{" "}
                {r.state === "confirmed" ? "已确认" : "模型候选"}
              </strong>
              <RichContent text={r.body} />
            </article>
          ))}
        </details>
      )}
    </div>
  );
}
