// 临时验证脚本：检查天文算法是否靠谱（中秋当天应接近满月）
import { createRequire } from 'module';
import {
  illumination,
  moonState,
  moonAltAz,
  moonEvents,
  lunarDayName,
  lunarInfo,
} from './src/moon.js';

// vendor/lunar.js 是 UMD，在 Node 里用 createRequire 加载后挂到 globalThis，
// 浏览器里则由 index.html 的 <script> 标签完成同样的事。
const require = createRequire(import.meta.url);
try {
  const lunarLib = require('./vendor/lunar.js');
  globalThis.Solar = lunarLib.Solar;
  globalThis.Lunar = lunarLib.Lunar;
} catch (err) {
  console.log('（未能加载 lunar.js，农历对照将跳过）');
}

const t = (s) => new Date(s);
const pct = (f) => (f * 100).toFixed(1) + '%';

const cases = [
  ['2026-09-25T20:00', '中秋夜 · 应为满月'],
  ['2026-10-02T20:00', '中秋后 7 天 · 应约下弦'],
  ['2026-10-09T20:00', '中秋后 14 天 · 应约新月'],
  ['2026-09-18T20:00', '中秋前 7 天 · 应约上弦'],
];

for (const [s, note] of cases) {
  const d = t(s);
  const ms = moonState(d);
  console.log(
    `${s}  ${note}\n  亮面 ${pct(ms.fraction)}  月龄 ${ms.age.toFixed(2)} 天  农历八月${lunarDayName(ms.lunarDay)}  ${ms.waxing ? '盈' : '亏'}`
  );
}

// 咬口几何自检：直接引用 src/shape.js 的实现（2D 与 3D 共用同一份），
// 这里只负责用蒙特卡洛独立复算，确认解析解与"实际被咬掉的区域"一致。
// 公式在这儿再抄一份的话，两边跑偏了都不会有人发现。
import { biteD, ageGap, phaseName } from './src/shape.js';

console.log('\n咬口几何自检（双圆月牙，保留面积应≈亮面比例）：');
const N = 400000;
let s2 = 12345;
const rnd2 = () => {
  s2 = (s2 + 0x6d2b79f5) | 0;
  let t = Math.imul(s2 ^ (s2 >>> 15), 1 | s2);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
let worst = 0;
for (const f of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
  const D = biteD(f);
  // 分母必须用"落在月饼圆内"的点数：圆只占采样方块的 π/4，
  // 拿总采样数当分母会把比例整体低估成 0.785 倍，看着像公式错了。
  let inCircle = 0;
  let inside = 0;
  for (let i = 0; i < N; i++) {
    const u = rnd2() * 2 - 1;
    const v = rnd2() * 2 - 1;
    if (u * u + v * v > 1) continue; // 月饼圆外
    inCircle++;
    const du = u + D; // 咬痕圆圆心在 u = −D
    if (du * du + v * v < 1) continue; // 落在咬痕圆内 → 被咬掉
    inside++;
  }
  const got = inside / inCircle;
  const err = Math.abs(got - f);
  if (err > worst) worst = err;
  console.log(`  f=${f.toFixed(2)}  D=${D.toFixed(4)}  实测保留比例 ${got.toFixed(4)}  偏差 ${err.toFixed(4)}`);
}
console.log(`  最大偏差 ${worst.toFixed(4)}（蒙特卡洛采样噪声量级，应 < 0.005）`);

// 大连庄河当晚的月出与中天
const d = t('2026-09-25T20:00');
const ev = moonEvents(d, 39.687, 122.968);
const aa = moonAltAz(d, 39.687, 122.968);
const hhmm = (x) => (x ? `${x.getHours()}:${String(x.getMinutes()).padStart(2, '0')}` : '—');
// 农历对照：权威库（含闰月规则）vs 朔望月近似
console.log('\n农历对照（权威库 lunar-javascript vs 朔望月近似）：');
for (const s of [
  '2026-09-25T20:00', // 本次中秋
  '2025-10-06T20:00', // 2025 中秋
  '2024-09-17T20:00', // 2024 中秋
  '2025-08-01T12:00', // 2025 闰六月期间
  '2028-06-20T12:00', // 2028 闰五月期间
  '2026-10-01T12:00',
]) {
  const d = new Date(s);
  const ms = moonState(d);
  const auth = lunarInfo(d);
  const approx = `八月${lunarDayName(ms.lunarDay)}`;
  const authText = auth ? auth.full : '(库未加载)';
  const same = auth && authText === approx;
  console.log(
    `  ${s.slice(0, 10)}  权威 ${authText.padEnd(6)} | 近似 ${approx.padEnd(6)} ${
      same ? '一致' : '← 不同（近似算法不处理闰月，属预期）'
    }`
  );
}

// 挑战玩法的判定自检：核心是「月龄是循环量」，以及月相档位能否被稳定识别
console.log('\n挑战判定自检：');
const gapCases = [
  [0.2, 29.3, '跨朔两侧 —— 应约 0.43 天，而不是 29.1 天'],
  [0, 29.5306, '朔与朔 —— 应约 0'],
  [14.77, 14.77, '同一个点 —— 应为 0'],
  [7.38, 22.15, '上弦对下弦 —— 应是半周期'],
];
let gapOk = true;
for (const [a, b, note] of gapCases) {
  const g = ageGap(a, b);
  if (g > 14.78) gapOk = false;
  console.log(`  ageGap(${a}, ${b}) = ${g.toFixed(3)} 天 · ${note}`);
}
console.log(`  环上距离上界：${gapOk ? '全部 ≤ 半个朔望周期 ✓' : '✗ 出现超过半周期的值'}`);

console.log('\n月相档位识别：');
for (const age of [0, 3.7, 7.38, 11.1, 14.77, 18.4, 22.15, 25.8, 29.4]) {
  console.log(`  月龄 ${String(age).padStart(5)} 天 → ${phaseName(age)}`);
}

console.log('\n庄河（39.687, 122.968）2026-09-25：');
console.log('  月出', hhmm(ev.rise), '| 中天', hhmm(ev.culmination), ev.culminationAlt.toFixed(1) + '°', '| 月落', hhmm(ev.set));
console.log('  20:00 高度角', aa.alt.toFixed(1) + '°', '方位', aa.az.toFixed(0) + '°');
