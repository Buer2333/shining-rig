// Secondary motion computed once over a whole track (pure: the same track always gives the same frames, so Remotion
// can render any frame alone). Squash & stretch from the body's vertical motion; lag = a child joint that follows its
// parent's rotation through a spring (the head trails the torso and overshoots a little).
import { Pose } from "./spec";
import { Track } from "./pose";

export interface SquashOpts {
  channel: string; // body_squash channel (1 = rest; >1 taller and thinner)
  lift: string; // body_translate channel, in body heights
  kv: number; // stretch per unit vertical speed (body heights / frame)
  ka: number; // squash per unit upward acceleration (impact on landing, push-off)
  range: [number, number];
  stiffness: number; // spring toward the target each frame (0..1)
  damping: number; // velocity kept each frame (0..1); < 1 - stiffness gives a small overshoot
}

export interface LagOpts {
  channel: string; // child rotate channel that gets the lag added (e.g. head)
  driver: string; // parent rotate channel it hangs on (e.g. torso)
  stiffness: number;
  damping: number;
}

export interface SecondaryOpts {
  squash?: SquashOpts;
  lag?: LagOpts[];
}

// Damped spring following target[], starting at rest on target[0].
export const spring = (target: number[], stiffness: number, damping: number): number[] => {
  let x = target[0], v = 0;
  return target.map((t) => {
    v = v * damping + (t - x) * stiffness;
    x += v;
    return x;
  });
};

const col = (frames: Pose[], ch: string, d: number) => frames.map((f) => f[ch] ?? d);

export const withSecondary = (track: Track, o: SecondaryOpts): Track => {
  const frames = track.frames.map((f) => ({ ...f }));
  const n = frames.length, channels = [...track.channels];
  if (o.squash && n > 2) {
    const s = o.squash, y = col(frames, s.lift, 0);
    const target = y.map((_, i) => {
      const a = i > 0 && i < n - 1 ? y[i + 1] - 2 * y[i] + y[i - 1] : 0; // >0: pushed upward (impact / push-off)
      const v = i > 0 && i < n - 1 ? (y[i + 1] - y[i - 1]) / 2 : 0;
      return 1 + s.kv * Math.abs(v) - s.ka * Math.max(0, a);
    });
    spring(target, s.stiffness, s.damping).forEach((v, i) => (frames[i][s.channel] = Math.max(s.range[0], Math.min(s.range[1], v))));
    if (!channels.includes(s.channel)) channels.push(s.channel);
  }
  for (const l of o.lag ?? []) {
    const d = col(frames, l.driver, 0), follow = spring(d, l.stiffness, l.damping);
    // the child's world angle follows the parent's through the spring: relative angle gains (follow - parent)
    frames.forEach((f, i) => (f[l.channel] = (f[l.channel] ?? 0) + follow[i] - d[i]));
    if (!channels.includes(l.channel)) channels.push(l.channel);
  }
  return { ...track, channels, frames };
};
