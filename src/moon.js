// moon.js —— 天文算法核心
// 太阳/月亮位置、月相（亮面比例与方位）、地平坐标、月出月落
// 公式参考 suncalc（MIT License）的核心实现，做了裁剪与中文注释
// 精度足够观赏与科普使用（月出月落误差约 1-3 分钟）

export const DAY_MS = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
const RAD = Math.PI / 180;
const OBLIQ = 23.4397 * RAD; // 黄赤交角
const AU_KM = 149598000;     // 日地距离（km）
const SYNODIC = 29.530588;   // 朔望月长度（天）

const toJulian = (date) => date.valueOf() / DAY_MS - 0.5 + J1970;
export const toDays = (date) => toJulian(date) - J2000;

function declination(L, b) {
  return Math.asin(Math.sin(b) * Math.cos(OBLIQ) + Math.cos(b) * Math.sin(OBLIQ) * Math.sin(L));
}

function rightAscension(L, b) {
  return Math.atan2(
    Math.sin(L) * Math.cos(OBLIQ) - Math.tan(b) * Math.sin(OBLIQ),
    Math.cos(L)
  );
}

export function sunCoords(d) {
  const M = RAD * (357.5291 + 0.98560028 * d); // 太阳平近点角
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI;  // 太阳黄经
  return { dec: declination(L, 0), ra: rightAscension(L, 0) };
}

export function moonCoords(d) {
  const L = RAD * (218.316 + 13.176396 * d); // 月球平黄经
  const M = RAD * (134.963 + 13.064993 * d); // 月球平近点角
  const F = RAD * (93.272 + 13.229350 * d);  // 升交点角距
  const l = L + RAD * 6.289 * Math.sin(M);   // 黄经（含中心差）
  const b = RAD * 5.128 * Math.sin(F);       // 黄纬
  const dist = 385001 - 20905 * Math.cos(M); // 地月距离（km）
  return { ra: rightAscension(l, b), dec: declination(l, b), dist };
}

// 天球坐标 → 三维单位向量
// 约定：相机位于 +Z 朝原点看，于是屏幕 x = 世界 x，屏幕 y = 世界 y（向上）
function sphereToVec(ra, dec) {
  return {
    x: Math.cos(dec) * Math.cos(ra),
    y: Math.sin(dec),
    z: -Math.cos(dec) * Math.sin(ra),
  };
}

const dot3 = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross3 = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const norm3 = (v) => {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};

// 把太阳方向投到「观察者站在地球看月亮」的屏幕坐标系
// 相机约定与 Three.js 一致：+Z 指向观察者，+Y 是天北极在屏面上的投影（北半球视角）
// 这样相机可以固定不动，而月相、亮面朝向都是真实几何
function toScreenFrame(sunDir, moonDir) {
  const zc = norm3({ x: -moonDir.x, y: -moonDir.y, z: -moonDir.z }); // 从月亮指向地球
  const up = { x: 0, y: 1, z: 0 }; // 天极
  let xc = cross3(up, zc);
  if (Math.hypot(xc.x, xc.y, xc.z) < 1e-9) xc = { x: 1, y: 0, z: 0 };
  xc = norm3(xc);
  const yc = cross3(zc, xc);
  return {
    x: dot3(sunDir, xc),
    y: dot3(sunDir, yc),
    z: dot3(sunDir, zc),
  };
}

// 单次月相计算（不含月龄）
export function illumination(date) {
  const d = toDays(date);
  const s = sunCoords(d);
  const m = moonCoords(d);
  // 太阳与月亮的地心夹角（相位角 phi）
  const cosPhi =
    Math.sin(s.dec) * Math.sin(m.dec) +
    Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra);
  const phi = Math.acos(Math.min(1, Math.max(-1, cosPhi)));
  // 相位角 inc：太阳-月亮-地球，决定亮面比例
  const inc = Math.atan2(AU_KM * Math.sin(phi), m.dist - AU_KM * Math.cos(phi));
  const fraction = (1 + Math.cos(inc)) / 2;
  // 亮面在天球上的方位角
  const angle = Math.atan2(
    Math.cos(s.dec) * Math.sin(s.ra - m.ra),
    Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra)
  );
  const phase = 0.5 + (0.5 * inc * Math.sign(angle)) / Math.PI;
  const sunDir = sphereToVec(s.ra, s.dec);
  const moonDir = sphereToVec(m.ra, m.dec);
  // 观察者在 +Z、月亮在原点：把「月亮指向地球」的方向旋到 +Z
  // 于是相机可以固定不动，而月相与亮面朝向仍然是真实几何
  const sunWorld = toScreenFrame(sunDir, moonDir);
  return {
    fraction,
    phase,
    angle,
    sunDir,   // 天球坐标系下的太阳方向（备用）
    sunWorld, // 屏幕坐标系下的太阳方向：直接当作 Three.js 平行光方向
    moonDir,  // 天球坐标系下的月亮方向
    // 屏幕平面内的亮面朝向角（Canvas 2D 的 y 轴向下，故取 -y）
    screenAngle: Math.atan2(-sunWorld.y, sunWorld.x),
    distanceKm: m.dist,
  };
}

// 回溯最近一次“朔”（月亮最暗的时刻），即本月农历初一的天文近似
// 先以 6 小时步长粗扫，再以 1 分钟步长在 ±6 小时内精扫
export function findNewMoon(date) {
  let best = null;
  for (let t = -32 * DAY_MS; t <= 0; t += 6 * 3600 * 1000) {
    const d = new Date(date.valueOf() + t);
    const f = illumination(d).fraction;
    if (!best || f < best.f) best = { f, date: d };
  }
  for (let t = -6 * 3600 * 1000; t <= 6 * 3600 * 1000; t += 60 * 1000) {
    const d = new Date(best.date.valueOf() + t);
    const f = illumination(d).fraction;
    if (f < best.f) best = { f, date: d };
  }
  return best.date;
}

// 找「最圆」时刻：一个朔望周期内照度极大值的那个瞬间。
// 先按 6 小时步长粗扫一个朔望月锁定峰，再三级细化（窗口 7h → 20min → 1min，各取 41 点），
// 最终精度到秒级。dir = +1 往后找下一次，-1 往前找上一次。
function scanFullMoon(fromDate, dir) {
  const TOTAL = 30 * DAY_MS;
  let best = null;
  for (let t = 0; t <= TOTAL; t += 6 * 3600 * 1000) {
    const d = new Date(fromDate.valueOf() + dir * t);
    const f = illumination(d).fraction;
    if (!best || f > best.f) best = { f, date: d };
  }
  for (const win of [7 * 3600 * 1000, 20 * 60 * 1000, 60 * 1000]) {
    const center = best.date.valueOf();
    const step = win / 20;
    for (let t = -win; t <= win; t += step) {
      const d = new Date(center + t);
      const f = illumination(d).fraction;
      if (f > best.f) best = { f, date: d };
    }
  }
  return best;
}

// 满月时刻在几小时内不会变，缓存住，免得拖动月龄滑块时反复重算
let fullMoonCache = { key: null, value: null };
export function fullMoonNear(date) {
  const key = Math.floor(date.valueOf() / (6 * 3600 * 1000));
  if (fullMoonCache.key === key && fullMoonCache.value) return fullMoonCache.value;
  const next = scanFullMoon(date, 1);
  const prev = scanFullMoon(date, -1);
  const value = { next, prev };
  fullMoonCache = { key, value };
  return value;
}

// 朔日缓存：同一个朔望周期内不重复计算
let newMoonCache = { key: null, date: null };
export function newMoonOf(date) {
  const key = Math.floor(date.valueOf() / DAY_MS / 10); // 粗略分桶
  if (newMoonCache.key === key && newMoonCache.date) {
    const age = (date - newMoonCache.date) / DAY_MS;
    if (age >= 0 && age < SYNODIC) return newMoonCache.date;
  }
  const nm = findNewMoon(date);
  newMoonCache = { key, date: nm };
  return nm;
}

// 完整月相状态：亮面比例、方位、月龄、农历日
export function moonState(date) {
  const ill = illumination(date);
  const nm = newMoonOf(date);
  const age = (date - nm) / DAY_MS;             // 月龄（天）
  const lunarDay = Math.min(30, Math.floor(age) + 1);
  return {
    ...ill,
    newMoon: nm,
    age,
    lunarDay,
    waxing: ill.phase < 0.5, // 盈（上半月）
  };
}

// 由月龄反推日期：保持朔日基准不变
export function dateFromAge(newMoon, ageDays) {
  return new Date(newMoon.valueOf() + ageDays * DAY_MS);
}

// 月亮的地平坐标（高度角 / 方位角，单位：度）
export function moonAltAz(date, latDeg, lonDeg) {
  const d = toDays(date);
  const m = moonCoords(d);
  const phi = latDeg * RAD;
  const lw = -lonDeg * RAD;
  // 格林尼治平恒星时 → 本地时角
  const sidereal = RAD * (280.16 + 360.9856235 * d) - lw;
  const H = sidereal - m.ra;
  const alt = Math.asin(
    Math.sin(phi) * Math.sin(m.dec) + Math.cos(phi) * Math.cos(m.dec) * Math.cos(H)
  );
  let az = Math.atan2(
    Math.sin(H),
    Math.cos(H) * Math.sin(phi) - Math.tan(m.dec) * Math.cos(phi)
  );
  az = ((az / RAD + 180) % 360 + 360) % 360; // 以正北为 0，顺时针
  return { alt: alt / RAD, az };
}

// 一天之内的月出 / 月上中天 / 月落
// 用 2 分钟步长扫描 24 小时，再线性插值细化
export function moonEvents(date, latDeg, lonDeg) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const step = 2 * 60 * 1000;
  const samples = [];
  for (let t = 0; t <= DAY_MS; t += step) {
    const d = new Date(start.valueOf() + t);
    samples.push({ t, alt: moonAltAz(d, latDeg, lonDeg).alt });
  }
  const cross = (a, b) => {
    // 在 samples[a] 与 samples[b] 之间线性插值出高度角为 0 的时刻
    const r = Math.abs(samples[a].alt) / (Math.abs(samples[a].alt) + Math.abs(samples[b].alt));
    return new Date(start.valueOf() + samples[a].t + (samples[b].t - samples[a].t) * r);
  };
  let rise = null, set = null, peakIdx = 0;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i - 1].alt < 0 && samples[i].alt >= 0 && !rise) rise = cross(i - 1, i);
    if (samples[i - 1].alt >= 0 && samples[i].alt < 0) set = cross(i - 1, i);
    if (samples[i].alt > samples[peakIdx].alt) peakIdx = i;
  }
  const culmination = new Date(start.valueOf() + samples[peakIdx].t);
  return {
    rise,
    set,
    culmination,
    culminationAlt: samples[peakIdx].alt,
  };
}

export const LUNAR_DAY_NAMES = [
  '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十',
];

export function lunarDayName(day) {
  return LUNAR_DAY_NAMES[Math.min(29, Math.max(0, day - 1))] || '三十';
}

export const LUNAR_MONTH_NAMES = [
  '正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊',
];

// ---------------------------------------------------------------- 权威农历
// 本文件上面的农历是按朔望月近似推的（回溯最近一次朔再数天数），不处理闰月，
// 遇上闰月会比官方农历差一天。这里改用 lunar-javascript（基于《寿星天文历》，
// 内置闰月与大小月规则、节气、干支），它由 vendor/lunar.js 以 UMD 挂到 window。
//
// 拿不到库时返回 null，调用方回落到上面的近似算法 —— 功能不受影响，
// 只是闰月月份的日期可能差一天。
export function lunarInfo(date) {
  const Solar = typeof globalThis !== 'undefined' ? globalThis.Solar : undefined;
  if (!Solar || typeof Solar.fromDate !== 'function') return null;
  try {
    const lunar = Solar.fromDate(date).getLunar();
    const m = lunar.getMonth(); // 负数表示闰月
    const abs = Math.abs(m);
    const leap = m < 0;
    const monthName = (LUNAR_MONTH_NAMES[abs - 1] || '') + '月';
    const dayName = lunar.getDayInChinese();
    return {
      month: abs,
      day: lunar.getDay(),
      leap,
      monthName: (leap ? '闰' : '') + monthName,
      dayName,
      full: (leap ? '闰' : '') + monthName + dayName,
      ganZhiYear: lunar.getYearInGanZhi(),
      jieQi: lunar.getJieQi() || '',
      zodiac: lunar.getYearShengXiao(),
    };
  } catch (err) {
    return null;
  }
}
