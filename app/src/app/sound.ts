// port of Sources/ClaudeBuddy/KnockSound.swift (Mac reference v0.0.9)
// Same synthesized samples (0.22 s mono, 44.1 kHz, LCG noise seed 12345); Web Audio instead of AVAudioPlayer.
// The AudioContext exists only while knocking, like the Mac's players (idle audio engines cost CPU).

import type { HitKind } from "../core/animation";
import type { KnockTone } from "../render/skins/skin";
import type { KnockSoundPlayer } from "./pet";

/// (frequency, decay, amplitude) partials plus click strength and overall volume.
const RECIPES: Record<KnockTone, { partials: [number, number, number][]; click: number; volume: number }> = {
  knuckle: { partials: [[190, 45, 0.5], [1320, 55, 0.22], [2710, 90, 0.1]], click: 0.45, volume: 0.9 },
  paw: { partials: [[150, 55, 0.6], [900, 80, 0.1]], click: 0.18, volume: 0.75 },
  metal: { partials: [[240, 60, 0.25], [1850, 22, 0.25], [2930, 26, 0.16], [4210, 35, 0.08]], click: 0.35, volume: 0.7 },
};

const SAMPLE_RATE = 44100;

/// Swift `KnockSound.wav` samples as Int16 values.
export function knockSamples(tone: KnockTone): Int16Array {
  const n = Math.floor(SAMPLE_RATE * 0.22);
  const r = RECIPES[tone];
  let seed = 12345;
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; // seed &* 1664525 &+ 1013904223 (UInt32)
    const noise = (seed | 0) / 2147483647; // Int32(bitPattern:) / Int32.max
    let v = noise * Math.exp(-t * 400) * r.click;
    for (const [f, d, a] of r.partials) v += Math.sin(2 * Math.PI * f * t) * Math.exp(-t * d) * a;
    out[i] = Math.trunc(Math.max(-1, Math.min(1, v)) * 30000);
  }
  return out;
}

/// Windows addition (Pooria, 2026-10-21): the impatient knock's sounds, synthesized like the knock (fixed seed).
/// stomp = a deep thump, clap = a short burst of noise (three tiny flams), crack = breaking glass.
export function effectSamples(kind: "stomp" | "clap" | "crack"): Int16Array {
  const seconds = kind === "crack" ? 0.7 : kind === "stomp" ? 0.32 : 0.22;
  const n = Math.floor(SAMPLE_RATE * seconds);
  const out = new Int16Array(n);
  let seed = 4242;
  const noise = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed | 0) / 2147483647;
  };
  // crack: a dozen sharp snaps in the first 0.3 s, then glass tinkling
  const snaps = Array.from({ length: 12 }, (_, i) => (i === 0 ? 0 : 0.01 + Math.pow(i / 12, 1.6) * 0.3));
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    let v = 0;
    if (kind === "stomp") {
      const f = 55 + 35 * Math.exp(-t * 30); // the pitch drops like a foot on a wooden floor
      v = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 14) * 0.95 + noise() * Math.exp(-t * 120) * 0.25;
    } else if (kind === "clap") {
      for (const at of [0, 0.011, 0.022]) if (t >= at) v += noise() * Math.exp(-(t - at) * (at === 0.022 ? 28 : 160)) * 0.45;
    } else {
      for (const at of snaps) if (t >= at) v += noise() * Math.exp(-(t - at) * 90) * 0.5;
      for (const [f, d, a] of [[3150, 9, 0.08], [4720, 11, 0.07], [6230, 14, 0.05], [7810, 18, 0.04]]) {
        v += Math.sin(2 * Math.PI * f * t) * Math.exp(-t * d) * a * (t > 0.05 ? 1 : t / 0.05);
      }
      v += Math.sin(2 * Math.PI * 70 * t) * Math.exp(-t * 20) * 0.6; // the thud of the last slam
    }
    out[i] = Math.trunc(Math.max(-1, Math.min(1, v)) * 30000);
  }
  return out;
}

export class KnockSound implements KnockSoundPlayer {
  private ctx: AudioContext | null = null;
  private buffers = new Map<string, AudioBuffer>();

  play(tone: KnockTone, kind: HitKind | "crack" = "knock"): void {
    if (this.ctx === null) this.ctx = new AudioContext();
    const ctx = this.ctx;
    // a slam is the character's own knock, louder; the rhythm and the crack have their own sounds
    const key = kind === "knock" || kind === "slam" ? tone : kind;
    let buffer = this.buffers.get(key);
    if (buffer === undefined) {
      const samples = key === tone ? knockSamples(tone) : effectSamples(key as "stomp" | "clap" | "crack");
      buffer = ctx.createBuffer(1, samples.length, SAMPLE_RATE);
      const ch = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) ch[i] = samples[i] / 32768;
      this.buffers.set(key, buffer);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = kind === "slam" ? Math.min(1, RECIPES[tone].volume * 1.35) : kind === "knock" ? RECIPES[tone].volume : 0.95;
    src.connect(gain).connect(ctx.destination);
    src.start();
  }

  release(): void {
    void this.ctx?.close();
    this.ctx = null;
    this.buffers.clear();
  }
}
