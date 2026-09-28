// audio.js —— 用 Web Audio 现场合成音效，不引入任何音频文件
//
// 为什么合成而不是塞素材：一个 mp3 少说几十 KB，一套音效下来几 MB，
// 而这里要的全是短促的冲击音和提示音，用振荡器 + 包络就够，体积成本为零。
//
// 一个必须注意的点：浏览器要求"首次发声必须在用户手势里"，
// 所以页面加载后要先调用一次 unlock()（挂在开始按钮的 click 上），
// 否则 AudioContext 会一直是 suspended，后面怎么调都不出声。

let ctx = null;
let muted = false;
let unlocked = false;

function ac() {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) {
    try {
      ctx = new AC();
    } catch {
      return null;
    }
  }
  return ctx;
}

/** 在用户手势里调一次，解锁音频（之后任何时刻都能出声） */
export function unlock() {
  const a = ac();
  if (!a) return false;
  if (a.state === 'suspended') {
    a.resume().catch(() => {});
  }
  unlocked = true;
  return true;
}

export function setMuted(v) {
  muted = !!v;
}

export function isMuted() {
  return muted;
}

export function isReady() {
  return unlocked && !muted;
}

function tone(o) {
  const a = ac();
  if (!a || muted || !unlocked) return;
  const t0 = a.currentTime + (o.delay || 0);
  const dur = o.dur ?? 0.12;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = o.type || 'sine';
  osc.frequency.setValueAtTime(o.freq, t0);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
  // 指数斜坡不能经过 0，所以起止都给一个极小的正数
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(o.gain ?? 0.14, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

/** 短噪声，用来做"咬"的闷响 */
function crunch(dur, gain, cutoff) {
  const a = ac();
  if (!a || muted || !unlocked) return;
  const len = Math.max(1, Math.floor(a.sampleRate * dur));
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  }
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = cutoff;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(a.destination);
  src.start();
}

export const sfx = {
  /** 拖动手感：很轻的一下 */
  hover() {
    tone({ freq: 620, dur: 0.05, gain: 0.045, type: 'triangle' });
  },
  /** 点「咬下去」 */
  bite() {
    crunch(0.11, 0.16, 1100);
    tone({ freq: 180, to: 90, dur: 0.1, type: 'sawtooth', gain: 0.1 });
  },
  /** 命中：档位越高音越亮 */
  hit(tier) {
    const base = tier === 'perfect' ? 880 : tier === 'great' ? 660 : 520;
    tone({ freq: base, dur: 0.1, type: 'triangle', gain: 0.13 });
    tone({ freq: base * 1.5, dur: 0.16, delay: 0.06, type: 'sine', gain: 0.09 });
  },
  /** 连击：每多一连，音阶往上走一格（封顶避免刺耳） */
  combo(n) {
    if (n < 2) return;
    const step = Math.min(n, 12);
    tone({ freq: 440 * Math.pow(2, (step - 2) / 12), dur: 0.09, type: 'square', gain: 0.06 });
  },
  miss() {
    tone({ freq: 220, to: 130, dur: 0.18, type: 'sawtooth', gain: 0.09 });
  },
  /** 最后几秒读秒 */
  tick(urgent) {
    tone({ freq: urgent ? 1200 : 900, dur: 0.045, gain: 0.07, type: 'square' });
  },
  /** 结算：一小段上行琶音 */
  finish() {
    [523, 659, 784, 1047].forEach((f, i) => {
      tone({ freq: f, dur: 0.24, delay: i * 0.09, type: 'triangle', gain: 0.12 });
    });
  },
  /** 解锁成就 */
  achievement() {
    [784, 988, 1319].forEach((f, i) => {
      tone({ freq: f, dur: 0.3, delay: i * 0.07, type: 'sine', gain: 0.1 });
    });
  },
  click() {
    tone({ freq: 740, dur: 0.04, gain: 0.05, type: 'triangle' });
  },
};
