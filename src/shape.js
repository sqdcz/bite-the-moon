// shape.js —— 月牙形状的纯数学，2D 与 3D 共用，无任何依赖
//
// 为什么要有这个文件：3D 月饼用的是**双圆月牙**模型，而旧的 2D 绘制用的是
// 椭圆终止线模型，两者形状并不一致。挑战玩法要在 Canvas 2D 上画月饼和目标轮廓，
// 如果形状和 3D 版对不上，玩家看到的东西就不可信了。
// 把几何抽到这里，2D 与 3D 引用同一份实现，判据和画面才对得上。
//
// 双圆月牙：拿一个与月饼等半径的「咬痕圆」咬进去，保留区域 = 月饼圆 − 咬痕圆。
// 两圆等半径时的差集正好是一枚月牙，且随圆心距连续变化。

export const SYNODIC = 29.530588; // 朔望月长度（天）

// 亮面比例 → 咬痕圆圆心距 D
// 交集面积 A(D) = 2·acos(D/2) − (D/2)·√(4 − D²)，令 A = (1−fraction)·π 二分反解。
//   D = 2 → 两圆外切，交集 0 → 满月，月饼完整
//   D = 0 → 两圆重合，交集 π → 新月，月饼全没
export function biteD(fraction) {
  const f = Math.min(1, Math.max(0, Number(fraction) || 0));
  const target = Math.PI * (1 - f);
  let lo = 0;
  let hi = 2;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const a = 2 * Math.acos(mid / 2) - (mid / 2) * Math.sqrt(Math.max(0, 4 - mid * mid));
    if (a > target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// 月龄 → 亮面比例（标准近似，视觉足够）
//   月龄 0    → 0（朔）
//   月龄 14.77→ 1（望）
export function ageToFraction(age) {
  const p = ((Number(age) || 0) / SYNODIC) % 1;
  const q = p < 0 ? p + 1 : p;
  return (1 - Math.cos(2 * Math.PI * q)) / 2;
}

// 亮面比例 → 月龄（只落在盈的半周期 0 ~ 14.77 天上；亏的由环形判定处理）
export function fractionToAge(fraction) {
  const f = Math.min(1, Math.max(0, Number(fraction) || 0));
  return (Math.acos(1 - 2 * f) / (2 * Math.PI)) * SYNODIC;
}

// 月龄是循环量：0 与 29.53 都是朔。直接相减会在跨朔时得到假的大误差，
// 所以一律用它取环上最短距离。
export function ageGap(a, b) {
  const d = Math.abs((Number(a) || 0) - (Number(b) || 0)) % SYNODIC;
  return Math.min(d, SYNODIC - d);
}

// 八个辨识度足够的月相档位，均匀铺在朔望周期上（相邻两档差得开，肉眼能分）
export const PHASE_TARGETS = [
  { age: 0, name: '新月' },
  { age: 3.7, name: '娥眉月' },
  { age: 7.38, name: '上弦月' },
  { age: 11.1, name: '盈凸月' },
  { age: 14.77, name: '满月' },
  { age: 18.4, name: '亏凸月' },
  { age: 22.15, name: '下弦月' },
  { age: 25.8, name: '残月' },
];

export function phaseName(age) {
  let best = PHASE_TARGETS[0];
  let bestD = Infinity;
  for (const t of PHASE_TARGETS) {
    const d = ageGap(age, t.age);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best.name;
}

/**
 * 生成「被咬过的月饼」轮廓路径。
 * 保留区域 = 月饼圆(半径 R) − 咬痕圆(半径 R, 圆心在 (-D·R, 0))。
 * 调用方自行 translate/rotate 来决定咬口方向。
 *
 * @param {number} R 半径
 * @param {number} fraction 亮面比例 0~1
 * @returns {Path2D|null} Node 环境（无 Path2D）返回 null
 */
export function mooncakePath(R, fraction) {
  if (typeof Path2D === 'undefined') return null;
  const p = new Path2D();
  const D = biteD(fraction);

  // 满月：整圆
  if (D >= 1.998) {
    p.arc(0, 0, R, 0, Math.PI * 2);
    return p;
  }
  // 新月：面积趋近于 0，直接给空路径，免得画出细边
  if (D <= 0.004) return p;

  const cl = Math.min(1, Math.max(-1, D / 2));
  const phi = Math.acos(-cl); // 月饼圆上的交点角
  const beta = Math.acos(cl); // 咬痕圆上的交点角

  // 月饼圆：右弧（从 (x0,-y0) 逆时针经 (R,0) 到 (x0,+y0)）
  p.arc(0, 0, R, -phi, phi, false);
  // 咬痕圆：凹进去的弧（顺时针回到起点，经过咬痕圆最右点）
  p.arc(-D * R, 0, R, beta, -beta, true);
  p.closePath();
  return p;
}

/** 只要求轮廓时的简便画法：填一个纯色剪影 */
export function fillMooncakeShape(ctx, cx, cy, R, fraction, angle, style) {
  const path = mooncakePath(R, fraction);
  if (!path) return;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.fillStyle = style;
  ctx.fill(path);
  ctx.restore();
}
