import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Space, Tag, Typography } from "antd";
import { formatTimeRangeMs } from "./domain-meta";

export function MediaPlayer({
  src,
  title,
  seekMs,
  seekNonce = 0,
  clipRange,
}: {
  src: string;
  title?: string;
  seekMs?: number | null;
  seekNonce?: number;
  clipRange?: { startMs: number; endMs: number } | null;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pendingSeekMsRef = useRef<number | null>(null);
  const [error, setError] = useState(false);
  const [reloadCount, setReloadCount] = useState(0);

  const applySeek = useCallback((ms: number) => {
    if (!Number.isFinite(ms) || ms < 0) return;
    const el = videoRef.current;
    if (!el || el.readyState < 1) {
      pendingSeekMsRef.current = ms;
      return;
    }
    let targetSec = ms / 1000;
    if (Number.isFinite(el.duration) && el.duration > 0) {
      targetSec = Math.min(Math.max(0, targetSec), el.duration);
    }
    el.currentTime = targetSec;
    pendingSeekMsRef.current = null;
  }, []);

  useEffect(() => {
    setError(false);
    pendingSeekMsRef.current = null;
  }, [src]);

  useEffect(() => {
    if (typeof seekMs === "number" && Number.isFinite(seekMs) && seekMs >= 0) {
      applySeek(seekMs);
    }
  }, [seekMs, seekNonce, src, applySeek]);

  const clipLabel = clipRange
    ? formatTimeRangeMs(clipRange.startMs, clipRange.endMs)
    : "";

  return (
    <div className="media-player-card">
      {!error && (
        <video
          key={`${src}:${reloadCount}`}
          ref={videoRef}
          className="media-player-video"
          controls
          preload="metadata"
          playsInline
          src={src}
          aria-label={title ? `视频播放：${title}` : "视频播放"}
          onLoadedMetadata={() => {
            setError(false);
            const pending = pendingSeekMsRef.current;
            if (pending !== null) {
              applySeek(pending);
            }
          }}
          onError={() => {
            setError(true);
          }}
        />
      )}
      {error && (
        <Alert
          type="warning"
          showIcon
          message="音视频暂不可播放，请确认已发布或重试"
          action={
            <Button
              size="small"
              htmlType="button"
              onClick={() => {
                setError(false);
                if (
                  typeof seekMs === "number" &&
                  Number.isFinite(seekMs) &&
                  seekMs >= 0
                ) {
                  pendingSeekMsRef.current = seekMs;
                }
                setReloadCount((c) => c + 1);
              }}
            >
              重新加载
            </Button>
          }
        />
      )}
      {(title || (clipLabel && clipRange)) && (
        <Space wrap size="small">
          {title && (
            <Typography.Text
              type="secondary"
              style={{ overflowWrap: "anywhere" }}
            >
              {title}
            </Typography.Text>
          )}
          {clipLabel && clipRange && (
            <>
              <Tag color="purple">{clipLabel}</Tag>
              <Button
                size="small"
                htmlType="button"
                onClick={() => applySeek(clipRange.startMs)}
              >
                {`跳转片段起点 (${clipLabel})`}
              </Button>
            </>
          )}
        </Space>
      )}
    </div>
  );
}
