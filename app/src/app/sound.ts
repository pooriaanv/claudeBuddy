// port of Sources/ClaudeBuddy/KnockSound.swift (Mac reference v0.0.9)
// Same synthesized samples (0.22 s mono, 44.1 kHz, LCG noise seed 12345); Web Audio instead of AVAudioPlayer.
// The AudioContext exists only while knocking, like the Mac's players (idle audio engines cost CPU).

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

export class KnockSound implements KnockSoundPlayer {
  private ctx: AudioContext | null = null;
  private buffers = new Map<KnockTone, AudioBuffer>();

  play(tone: KnockTone): void {
    if (this.ctx === null) this.ctx = new AudioContext();
    const ctx = this.ctx;
    let buffer = this.buffers.get(tone);
    if (buffer === undefined) {
      const samples = knockSamples(tone);
      buffer = ctx.createBuffer(1, samples.length, SAMPLE_RATE);
      const ch = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) ch[i] = samples[i] / 32768;
      this.buffers.set(tone, buffer);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = RECIPES[tone].volume;
    src.connect(gain).connect(ctx.destination);
    src.start();
  }

  release(): void {
    void this.ctx?.close();
    this.ctx = null;
    this.buffers.clear();
  }
}
