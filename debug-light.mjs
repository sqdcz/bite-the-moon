// 临时排查：屏幕坐标系下的太阳方向与亮面朝向
// 硬判据（北半球）：盈月一定“右亮”（屏幕角≈0°），亏月一定“左亮”（屏幕角≈±180°）
import { illumination } from './src/moon.js';

const cases = [
  ['2026-09-16T20:00:00+08:00', '盈娥眉（农历初六）', '盈', 0],
  ['2026-09-18T20:00:00+08:00', '上弦（初八）', '盈', 0],
  ['2026-09-21T20:00:00+08:00', '盈凸（十一）', '盈', 0],
  ['2026-09-25T19:10:00+08:00', '满月（十五）', '盈', 0],
  ['2026-10-03T20:00:00+08:00', '下弦（廿三）', '亏', 180],
  ['2026-10-07T05:00:00+08:00', '亏娥眉（廿七）', '亏', 180],
];

let allOk = true;
for (const [t, name, expect, targetDeg] of cases) {
  const d = new Date(t);
  const ill = illumination(d);
  const deg = (ill.screenAngle * 180) / Math.PI;
  // 角度归一到 [0,360)
  const norm = ((deg % 360) + 360) % 360;
  const ok =
    expect === '盈'
      ? norm < 60 || norm > 300
      : norm > 120 && norm < 240;
  if (!ok) allOk = false;
  console.log(
    `${ok ? '✓' : '✗'} ${name.padEnd(12)} 亮面${(ill.fraction * 100).toFixed(0).padStart(3)}%` +
      `  sunWorld.z=${ill.sunWorld.z.toFixed(3).padStart(6)}` +
      `  屏幕角=${norm.toFixed(0).padStart(3)}°（${expect}月应≈${targetDeg}°）`
  );
}
console.log(allOk ? '\n全部通过：盈月右亮、亏月左亮' : '\n有不符合，需检查坐标手性');
