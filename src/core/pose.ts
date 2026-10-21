// Poses over time: keyframe clips (hand-authored) and per-frame tracks (extracted from video).
import { defaultPose, Pose, RigSpec } from "./spec";

export interface Clip {
  name: string;
  keys: { t: number; pose: Pose }[]; // t in seconds; channels left out fall back to the rig default
}

export interface Track {
  spec_version: 1;
  fps: number;
  channels: string[];
  frames: Pose[];
  contact?: { L: boolean[]; R: boolean[]; method: string; thresholds: Record<string, number> };
  calib?: Record<string, unknown>;
  generator?: string;
}

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// Pose at time t (seconds): eased interpolation between the two surrounding keys.
export const sampleClip = (clip: Clip, t: number, defaults: Pose): Pose => {
  const K = clip.keys;
  let i = 0;
  while (i < K.length - 2 && t > K[i + 1].t) i++;
  const t0 = K[i].t, a = K[i].pose, t1 = K[i + 1].t, b = K[i + 1].pose;
  const u = easeInOutCubic(Math.max(0, Math.min(1, (t - t0) / (t1 - t0))));
  const out: Pose = { ...defaults };
  for (const k of Object.keys(defaults)) {
    const x = a[k] ?? defaults[k], y = b[k] ?? defaults[k];
    out[k] = x + (y - x) * u;
  }
  return out;
};

// Pose for a video frame from a track; frames past the end hold the last pose.
export const trackPose = (track: Track, frame: number, defaults: Pose): Pose => ({ ...defaults, ...track.frames[Math.min(frame, track.frames.length - 1)] });

export const clipPose = (spec: RigSpec, clip: Clip, t: number) => sampleClip(clip, t, defaultPose(spec));
