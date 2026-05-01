import Plyr from "plyr";
import "plyr/dist/plyr.css";
import { memo, useEffect, useRef } from "react";
import "./sessionVideoPlayer.css";

type SessionVideoPlayerProps = {
  src: string;
  /** Session trace duration — playback cannot exceed this (may be shorter than file). */
  maxDurationSec: number;
  /**
   * Skip this many seconds from the file start so playback aligns with chart t=0
   * (preload before URL baseline / game surface).
   */
  timelineOffsetSec?: number;
  /** High-quality WebM can be large — use heavier preload & contain fit so preview decodes reliably. */
  highQuality?: boolean;
  /** Fires on timeupdate (throttled by the browser / Plyr). */
  onTimeSecChange?: (sec: number) => void;
  className?: string;
};

function SessionVideoPlayerInner({
  src,
  maxDurationSec,
  timelineOffsetSec = 0,
  highQuality = false,
  onTimeSecChange,
  className = "",
}: SessionVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const onTimeRef = useRef(onTimeSecChange);
  onTimeRef.current = onTimeSecChange;
  const offset = Math.max(0, timelineOffsetSec);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    const player = new Plyr(el, {
      iconUrl: "/plyr.svg",
      controls: [
        "play-large",
        "restart",
        "rewind",
        "play",
        "fast-forward",
        "progress",
        "current-time",
        "duration",
        "mute",
        "volume",
        "settings",
        "pip",
        "fullscreen",
      ],
      settings: ["speed"],
      speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] },
      keyboard: { focused: true, global: false },
      tooltips: { controls: true, seek: true },
      invertTime: false,
      hideControls: true,
      resetOnEnd: false,
      clickToPlay: true,
    });
    const effectiveCap = () => {
      const raw = player.duration;
      const fileDur = Number.isFinite(raw) && raw > 0 ? raw : maxDurationSec + offset;
      const graphEndOnFile = offset + maxDurationSec;
      return Math.min(fileDur, graphEndOnFile);
    };

    const clampAndNotify = () => {
      const cap = effectiveCap();
      let t = player.currentTime;
      if (t < offset) {
        t = offset;
        player.currentTime = offset;
      }
      if (t > cap) {
        t = cap;
        player.currentTime = cap;
      }
      if (t >= cap - 0.05) {
        player.pause();
      }
      onTimeRef.current?.(Math.max(0, t - offset));
    };

    const onSeeked = () => {
      const cap = effectiveCap();
      if (player.currentTime < offset) player.currentTime = offset;
      if (player.currentTime > cap) {
        player.currentTime = cap;
      }
    };

    const onLoadedMeta = () => {
      const cap = effectiveCap();
      if (player.currentTime < offset) player.currentTime = offset;
      if (player.currentTime > cap) player.currentTime = cap;
    };

    player.on("timeupdate", clampAndNotify);
    player.on("seeked", onSeeked);
    player.on("loadedmetadata", onLoadedMeta);

    return () => {
      player.off("timeupdate", clampAndNotify);
      player.off("seeked", onSeeked);
      player.off("loadedmetadata", onLoadedMeta);
      player.destroy();
    };
  }, [src, maxDurationSec, offset]);

  return (
    <div
      className={`session-video-shell ${highQuality ? "session-video-shell--hq" : ""} ${className}`.trim()}
    >
      <video
        ref={videoRef}
        src={src}
        playsInline
        preload={highQuality ? "auto" : "metadata"}
      />
    </div>
  );
}

export default memo(SessionVideoPlayerInner);
