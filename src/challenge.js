// challenge.js —— 限时咬月挑战
//
// 玩法：屏幕给出一个目标月相（只给形状和名字，不给数值），
//       玩家拖滑块把月饼咬成那个形状，点「咬下去」提交判定。
//       误差越小档位越高，连对累计倍数；限时 60 秒，时间到按总分进排行榜。
//
// 几个设计上的取舍：
//   · 判定用 ageGap（环上最短距离）—— 月龄 0 与 29.53 都是朔，
//     直接相减会在跨朔那几轮给出假的大误差。
//   · 目标是「有辨识度的八个档位」而不是随机月龄 —— 满月和 99% 的凸月
//     肉眼分不出来，随机月龄会让玩家觉得在瞎猜。
//   · 容差随轮次收紧（1.05 → 0.55 天），前几轮热身、后面才拉开差距。
//   · 形状走 shape.js，与 3D 版同一套几何，玩家看到的缺口就是判定的依据。

import { ageGap, ageToFraction, phaseName, PHASE_TARGETS, mooncakePath } from './shape.js';

const TOTAL_TIME = 60;      // 单局时长（秒）
const TIME_BONUS = 1.5;     // 命中奖励时间
const TIME_PENALTY = 2;     // 未命中罚时
const REVEAL_MS = 1000;     // 揭晓停顿
const TAIL_MS = 1600;       // 结束后停留展示
const HIT_FLOOR = 1.05;     // 起始容差（天，环上距离）
const HIT_MIN = 0.55;       // 最小容差

export function createChallenge(canvas, hooks = {}) {
  const ctx = canvas.getContext('2d');

  const state = {
    phase: 'idle', // idle | playing | reveal | over
    timeLeft: TOTAL_TIME,
    score: 0,
    combo: 0,
    bestCombo: 0,
    round: 0,
    hits: 0,
    target: null,
    guess: 14.77,
    last: null, // { tier, label, gained, gap }
    revealUntil: 0,
    overAt: 0,
  };

  let raf = 0;
  let prev = 0;
  let tickAcc = 0;
  let disposed = false;

  // ---------------------------------------------------------------- 尺寸
  let dpr = 1;
  function fit() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    return { w, h };
  }

  // ---------------------------------------------------------------- 规则
  function tolerance() {
    return Math.max(HIT_MIN, HIT_FLOOR - state.round * 0.038);
  }

  function pickTarget() {
    let t = state.target;
    // 避免连着出同一个，但也别排得太死板（20% 概率允许重复）
    for (let i = 0; i < 8; i++) {
      const c = PHASE_TARGETS[Math.floor(Math.random() * PHASE_TARGETS.length)];
      if (!state.target || c.name !== state.target.name || Math.random() < 0.2) {
        t = c;
        break;
      }
    }
    return { age: t.age, name: t.name };
  }

  // ---------------------------------------------------------------- 流程
  function start() {
    state.phase = 'playing';
    state.timeLeft = TOTAL_TIME;
    state.score = 0;
    state.combo = 0;
    state.bestCombo = 0;
    state.round = 0;
    state.hits = 0;
    state.last = null;
    state.target = pickTarget();
    // 开局把玩家摆在离目标最远的地方，避免一上来就蒙对
    state.guess = (state.target.age + 14.77) % 29.53;
    fit();
    hooks.onChange && hooks.onChange(snapshot());
    if (!raf) {
      prev = 0;
      raf = requestAnimationFrame(loop);
    }
  }

  function nextRound() {
    state.round += 1;
    state.target = pickTarget();
    state.last = null;
    state.phase = 'playing';
    hooks.onChange && hooks.onChange(snapshot());
  }

  function confirm() {
    if (state.phase !== 'playing' || !state.target) return;
    const gap = ageGap(state.guess, state.target.age);
    const tol = tolerance();

    let base = 0;
    let tier = 'miss';
    let label = '差得远';
    if (gap <= tol * 0.25) {
      base = 100;
      tier = 'perfect';
      label = '分毫不差';
    } else if (gap <= tol * 0.55) {
      base = 60;
      tier = 'great';
      label = '很接近';
    } else if (gap <= tol) {
      base = 25;
      tier = 'ok';
      label = '踩线过关';
    }

    const mult = 1 + Math.min(state.combo, 10) * 0.1;
    const gained = Math.round(base * mult);

    if (tier === 'miss') {
      state.combo = 0;
      state.timeLeft = Math.max(0, state.timeLeft - TIME_PENALTY);
    } else {
      state.combo += 1;
      state.hits += 1;
      state.bestCombo = Math.max(state.bestCombo, state.combo);
      state.timeLeft = Math.min(TOTAL_TIME, state.timeLeft + TIME_BONUS);
    }
    state.score += gained;
    state.last = { tier, label, gained, gap, combo: state.combo, mult };
    state.phase = 'reveal';
    state.revealUntil = performance.now() + REVEAL_MS;
    hooks.onChange && hooks.onChange(snapshot());
    if (state.timeLeft <= 0) finish();

    return state.last;
  }

  function finish() {
    state.phase = 'over';
    state.overAt = performance.now() + TAIL_MS;
    const result = {
      score: state.score,
      rounds: state.round,
      hits: state.hits,
      bestCombo: state.bestCombo,
      accuracy: state.round ? state.hits / state.round : 0,
    };
    hooks.onChange && hooks.onChange(snapshot());
    hooks.onFinish && hooks.onFinish(result);
  }

  function stop() {
    state.phase = 'idle';
    cancelAnimationFrame(raf);
    raf = 0;
    hooks.onChange && hooks.onChange(snapshot());
  }

  function setGuess(age) {
    state.guess = age;
    hooks.onChange && hooks.onChange(snapshot());
  }

  function snapshot() {
    return {
      phase: state.phase,
      timeLeft: state.timeLeft,
      score: state.score,
      combo: state.combo,
      round: state.round,
      hits: state.hits,
      target: state.target ? state.target.name : '',
      last: state.last,
      tolerance: tolerance(),
    };
  }

  // ---------------------------------------------------------------- 主循环
  function loop(now) {
    if (disposed) return;
    raf = requestAnimationFrame(loop);
    const dt = prev ? Math.min(0.1, (now - prev) / 1000) : 0;
    prev = now;

    if (state.phase === 'playing') {
      state.timeLeft -= dt;
      if (state.timeLeft <= 0) {
        state.timeLeft = 0;
        finish();
      }
    } else if (state.phase === 'reveal' && now >= state.revealUntil) {
      if (state.timeLeft > 0) nextRound();
    } else if (state.phase === 'over' && now >= state.overAt) {
      state.phase = 'idle';
    }

    // UI 上的倒计时/分数每 120ms 同步一次就够，不必逐帧刷 DOM
    tickAcc += dt;
    if (tickAcc > 0.12) {
      tickAcc = 0;
      hooks.onTick && hooks.onTick(snapshot());
    }

    draw();
  }

  // ---------------------------------------------------------------- 绘制
  function draw() {
    const { w, h } = fit();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const base = Math.min(w, h);
    const tR = base * 0.115;
    const gR = base * 0.255;
    const tX = w * 0.5;
    const tY = h * 0.245;
    const gX = w * 0.5;
    const gY = h * 0.635;

    // ── 目标月相：白色剪影 + 名称 ──
    if (state.target) {
      ctx.save();
      ctx.globalAlpha = 0.94;
      const path = mooncakePath(tR, ageToFraction(state.target.age));
      if (path) {
        // 先画暗盘，再画亮面，看起来像一轮悬着的月
        ctx.beginPath();
        ctx.arc(tX, tY, tR, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.09)';
        ctx.fill();

        const g = ctx.createRadialGradient(tX - tR * 0.3, tY - tR * 0.3, tR * 0.05, tX, tY, tR * 1.02);
        g.addColorStop(0, '#fffaf0');
        g.addColorStop(0.7, '#f2e4c4');
        g.addColorStop(1, '#d9c69e');
        ctx.save();
        ctx.translate(tX, tY);
        ctx.fillStyle = g;
        ctx.fill(path);
        ctx.restore();
      }
      ctx.restore();

      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(232,180,90,0.92)';
      ctx.font = `600 ${Math.round(base * 0.058)}px "LXGW WenKai Screen","STKaiti","Microsoft YaHei",sans-serif`;
      ctx.fillText(state.target.name, tX, tY + tR + base * 0.035);
      ctx.restore();
    }

    // ── 玩家手里的月饼 ──
    const gp = mooncakePath(gR, ageToFraction(state.guess));
    if (gp) {
      // 被咬掉那块露出的底：深色，跟夜色一致
      ctx.save();
      ctx.beginPath();
      ctx.arc(gX, gY, gR, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(8,10,26,0.62)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(232,180,90,0.22)';
      ctx.lineWidth = Math.max(1, gR * 0.012);
      ctx.setLineDash([gR * 0.11, gR * 0.09]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      ctx.save();
      ctx.translate(gX, gY);
      const gd = ctx.createRadialGradient(-gR * 0.32, -gR * 0.36, gR * 0.08, 0, 0, gR);
      gd.addColorStop(0, '#f7d08e');
      gd.addColorStop(0.62, '#dda24c');
      gd.addColorStop(1, '#b07a34');
      ctx.fillStyle = gd;
      ctx.fill(gp);

      // 压花（裁进饼身，缺掉的部分自然被咬走）
      ctx.save();
      ctx.clip(gp);
      ctx.strokeStyle = 'rgba(120,76,30,0.45)';
      ctx.lineWidth = Math.max(1, gR * 0.026);
      ctx.beginPath();
      ctx.arc(0, 0, gR * 0.66, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        ctx.moveTo(Math.cos(a) * gR * 0.2, Math.sin(a) * gR * 0.2);
        ctx.arc(Math.cos(a) * gR * 0.34, Math.sin(a) * gR * 0.34, gR * 0.17, 0, Math.PI * 2);
      }
      ctx.stroke();
      ctx.restore();

      ctx.strokeStyle = 'rgba(255,236,190,0.42)';
      ctx.lineWidth = Math.max(1, gR * 0.014);
      ctx.stroke(gp);
      ctx.restore();

      // 当前咬口对应的月相名（跟着滑块走，是玩家唯一的读数）
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(247,236,216,0.7)';
      ctx.font = `${Math.round(base * 0.05)}px "LXGW WenKai Screen","STKaiti","Microsoft YaHei",sans-serif`;
      ctx.fillText(phaseName(state.guess), gX, gY + gR + base * 0.028);
      ctx.restore();
    }

    // ── 揭晓反馈 ──
    if (state.phase === 'reveal' && state.last) {
      const r = state.last;
      const color =
        r.tier === 'perfect' ? '#ffd98a' : r.tier === 'great' ? '#9ee493' : r.tier === 'ok' ? '#f0c674' : '#e07a6a';
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = color;
      ctx.font = `600 ${Math.round(base * 0.075)}px "LXGW WenKai Screen","STKaiti","Microsoft YaHei",sans-serif`;
      const text = r.tier === 'miss' ? r.label : `${r.label}  +${r.gained}`;
      ctx.fillText(text, w * 0.5, h * 0.435);
      if (r.tier !== 'miss' && r.combo > 1) {
        ctx.fillStyle = 'rgba(232,180,90,0.85)';
        ctx.font = `${Math.round(base * 0.042)}px "LXGW WenKai Screen","STKaiti","Microsoft YaHei",sans-serif`;
        ctx.fillText(`${r.combo} 连击 · ${r.mult.toFixed(1)}×`, w * 0.5, h * 0.5);
      }
      ctx.restore();
    }
  }

  function dispose() {
    disposed = true;
    cancelAnimationFrame(raf);
    raf = 0;
  }

  return {
    start,
    stop,
    confirm,
    setGuess,
    snapshot,
    resize: fit,
    dispose,
    get running() {
      return state.phase === 'playing' || state.phase === 'reveal';
    },
  };
}
