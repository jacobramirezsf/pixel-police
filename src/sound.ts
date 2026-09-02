// Tiny synthesized SFX — no assets, no loops, distance-attenuated by the caller.
let ctx: AudioContext | null = null;
let enabled = true;
try { enabled = (localStorage.getItem('pp.sound') ?? 'on') === 'on'; } catch { /* ignore */ }

export function soundEnabled() { return enabled; }
export function setSound(v: boolean) {
  enabled = v;
  try { localStorage.setItem('pp.sound', v ? 'on' : 'off'); } catch { /* ignore */ }
}

/** call from a user gesture once */
export function initAudio() {
  if (!ctx) {
    try { ctx = new (window.AudioContext || (window as any).webkitAudioContext)(); } catch { return; }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
}

let noiseBuf: AudioBuffer | null = null;
function noise(): AudioBuffer {
  if (!noiseBuf && ctx) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf!;
}

export function sfx(type: string, vol = 1) {
  if (!enabled || !ctx || ctx.state !== 'running' || vol <= 0.02) return;
  const t = ctx.currentTime;
  const out = ctx.createGain();
  out.connect(ctx.destination);
  switch (type) {
    case 'shot': {
      const src = ctx.createBufferSource(); src.buffer = noise();
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
      src.connect(f); f.connect(out);
      out.gain.setValueAtTime(0.5 * vol, t);
      out.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      src.start(t); src.stop(t + 0.15);
      break;
    }
    case 'blip': { // dispatch radio two-tone
      const o = ctx.createOscillator(); o.type = 'square';
      o.frequency.setValueAtTime(740, t);
      o.frequency.setValueAtTime(560, t + 0.09);
      o.connect(out);
      out.gain.setValueAtTime(0.06 * vol, t);
      out.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      o.start(t); o.stop(t + 0.2);
      break;
    }
    case 'chime': { // arrest booked
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(523, t);
      o.frequency.setValueAtTime(784, t + 0.1);
      o.connect(out);
      out.gain.setValueAtTime(0.12 * vol, t);
      out.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.start(t); o.stop(t + 0.3);
      break;
    }
    case 'thud': { // someone hit
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(140, t);
      o.frequency.exponentialRampToValueAtTime(50, t + 0.12);
      o.connect(out);
      out.gain.setValueAtTime(0.25 * vol, t);
      out.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      o.start(t); o.stop(t + 0.15);
      break;
    }
    case 'alarm': { // priority-3 alert
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(880, t);
      o.frequency.setValueAtTime(660, t + 0.12);
      o.frequency.setValueAtTime(880, t + 0.24);
      o.connect(out);
      out.gain.setValueAtTime(0.07 * vol, t);
      out.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      o.start(t); o.stop(t + 0.4);
      break;
    }
  }
}
