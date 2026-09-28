// main.js —— 状态管理与界面逻辑
//
// 数据流：本机时间 + 自动定位 → 月相（亮面比例 + 朝向）
//         → 同时驱动「天上的月亮」与「手里的月饼」
//         配方参数（克重/皮馅比/蛋黄/馅料）实时改变月饼的大小、皮厚、蛋黄、断面色

import {
  illumination,
  newMoonOf,
  moonAltAz,
  moonEvents,
  dateFromAge,
  lunarDayName,
  lunarInfo,
  fullMoonNear,
  DAY_MS,
} from './moon.js';
import { calcRecipe, shoppingList } from './recipe.js';
import { drawMooncake, drawMoon2D } from './mooncake.js';
import { buildCard } from './card.js';
import { detectByIP, requestPrecise, DEFAULT_LOC } from './geo.js';
import * as toy from './toy.js';
import { createChallenge } from './challenge.js';

const SYNODIC = 29.530588;

// 馅料 → 断面颜色
const FILL_COLORS = {
  莲蓉: 0x8a4d22,
  豆沙: 0x53291a,
  枣泥: 0x3d2118,
  五仁: 0x9a6b3a,
  芋泥: 0x8b7a9e,
  咸蛋黄: 0xd8912a,
};
const DEFAULT_FILL_COLOR = 0x8a4d22;

const $ = (id) => document.getElementById(id);
const el = (tag, cls) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
};
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (d) => (d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '—');
const toInput = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

const AZ_NAMES = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
const azName = (az) => AZ_NAMES[Math.round(az / 45) % 8];

// 时长文案：越近说得越细
function fmtDur(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 1) return '不到 1 分钟';
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d > 0) return `${d} 天 ${h} 小时`;
  if (h > 0) return `${h} 小时 ${m % 60} 分`;
  return `${m} 分钟`;
}

const fmtFullTime = (d) =>
  `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;

const BLESSINGS = [
  '但愿人长久，千里共婵娟',
  '海上生明月，天涯共此时',
  '咬一口月亮，愿你岁岁团圆',
  '月饼要趁热吃，人要常联系',
  '今夜月明人尽望，不知秋思落谁家',
  '月满中秋，人长久，事顺遂',
  '今夜的月亮，我分你一半',
];

// ---------------------------------------------------------------- 状态
const state = {
  date: new Date(),
  newMoon: null,
  lat: DEFAULT_LOC.lat,
  lon: DEFAULT_LOC.lon,
  city: DEFAULT_LOC.city,
  weight: 75,
  count: 12,
  crustRatio: 0.3,
  useYolk: true,
  yolkWeight: 12,
  yolkPer: 1,
  fillings: [{ name: '莲蓉', pct: 100 }],
  cut: false,
  blessing: 0,
  author: '',
  best: 0, // 挑战最高分（来自存档）
};

let scene = null;
let cakeScene = null;
let moon2dCtx = null;
let cake2dOn = true;
let fullState = null; // 上一次/下一次最圆时刻，供跳转按钮用

const fillColorOf = (fillings) => {
  for (const f of fillings) {
    const c = FILL_COLORS[f.name.trim()];
    if (c != null) return c;
  }
  return DEFAULT_FILL_COLOR;
};

// ---------------------------------------------------------------- 3D 初始化（失败自动降级）
async function init3D() {
  try {
    const mod = await import('./scene.js');
    scene = await mod.createMoonScene($('moon3d'));
    scene.resize();
    $('moonNote').textContent = scene.usingRealTexture
      ? '月面为 NASA 实拍贴图 · 由太阳方向真实照亮'
      : '月面为程序化生成 · 由太阳方向真实照亮';
  } catch (err) {
    console.warn('3D 月亮加载失败，改为 2D 月相：', err);
    scene = null;
    moon2dCtx = $('moon3d').getContext('2d');
    $('hint3d').hidden = false;
  }

  try {
    const mod = await import('./mooncake3d.js');
    cakeScene = await mod.createMooncakeScene($('cake3d'));
    cakeScene.resize();
    cake2dOn = false;
    $('cake2d').hidden = true;
    $('cake2d').style.display = 'none';
  } catch (err) {
    console.warn('3D 月饼加载失败，保留 2D 月饼：', err);
    cake2dOn = true;
    $('cake3d').style.display = 'none';
  }

  update({ keepNewMoon: true });
  loop();
}

function loop() {
  if (scene) scene.render();
  if (cakeScene) cakeScene.render();
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------- Canvas 绘制（降级用）
function fitCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || 1;
  const h = canvas.clientHeight || 1;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

const cssHex = (n) => '#' + n.toString(16).padStart(6, '0');

function drawCake(ms) {
  const { ctx, w, h } = fitCanvas($('cake2d'));
  ctx.clearRect(0, 0, w, h);
  const R = Math.min(w, h) * 0.3;
  const cut = state.cut;
  drawMooncake(
    ctx,
    w / 2,
    h / 2,
    R,
    cut ? 0.5 : ms.fraction,
    cut ? 0 : ms.screenAngle,
    { biteColor: cssHex(fillColorOf(state.fillings)) }
  );
}

function drawFallbackMoon(ms) {
  if (!moon2dCtx) return;
  const { ctx, w, h } = fitCanvas($('moon3d'));
  ctx.clearRect(0, 0, w, h);
  const R = Math.min(w, h) * 0.34;
  drawMoon2D(ctx, w / 2, h / 2, R, ms.fraction, ms.screenAngle);
}

// ---------------------------------------------------------------- 主更新
function update(opts = {}) {
  const ill = illumination(state.date);
  const nm = opts.keepNewMoon && state.newMoon ? state.newMoon : newMoonOf(state.date);
  state.newMoon = nm;

  const age = Math.max(0, (state.date - nm) / DAY_MS);
  const lunarDay = Math.min(30, Math.floor(age) + 1);
  const ms = { ...ill, age, lunarDay };
  const fillHex = fillColorOf(state.fillings);

  if (scene) scene.setSunDirection(ill.sunWorld, ill.fraction);
  else drawFallbackMoon(ms);

  if (cakeScene) {
    cakeScene.setParams({
      fraction: ill.fraction,
      angle: ill.screenAngle,
      cut: state.cut,
      weight: state.weight,
      crustRatio: state.crustRatio,
      yolkOn: state.useYolk,
      yolkPer: state.yolkPer,
      yolkWeight: state.yolkWeight,
      fillColor: fillHex,
    });
  } else if (cake2dOn) {
    drawCake(ms);
  }

  // 月相读数。农历优先用权威库（含闰月），拿不到才回落到月龄近似。
  const li = lunarInfo(state.date);
  const lunarText = li ? li.full : `八月${lunarDayName(lunarDay)}`;
  const extra = li && li.jieQi ? ` · ${li.jieQi}` : '';
  $('outPhase').innerHTML = `
    <div class="phase-day">${lunarText}</div>
    <div class="phase-meta">亮面 <b>${(ill.fraction * 100).toFixed(1)}%</b> · 月龄 ${age.toFixed(1)} 天 · ${ill.phase < 0.5 ? '盈' : '亏'}月${extra}</div>`;

  // 月饼说明：把配方参数换算成看得见的比例
  const crustRadial = 1 - Math.cbrt(1 - state.crustRatio);
  const yolkPart = state.useYolk
    ? `咸蛋黄 ${state.yolkPer} 个（单个 ${state.yolkWeight} g）`
    : '不放蛋黄';
  const fillNames = state.fillings.map((f) => f.name).join(' + ') || '未填馅料';
  $('cakeNote').textContent =
    `${state.weight} g × ${state.count} 个 · 皮馅比 ${Math.round(state.crustRatio * 100)} : ${Math.round(
      (1 - state.crustRatio) * 100
    )} · ${fillNames} · ${yolkPart}　→　断面皮层约占半径 ${(crustRadial * 100).toFixed(0)}%${
      state.cut ? '，已切开' : '，咬口跟着月亮走'
    }`;

  // 赏月信息
  const ev = moonEvents(state.date, state.lat, state.lon);
  const aa = moonAltAz(state.date, state.lat, state.lon);
  let tip = '';
  if (aa.alt < 0) {
    tip = ev.rise
      ? `此刻月亮还在地平线下，${hhmm(ev.rise)} 才升起 —— 先把月饼晾着，等月亮上来再吃。`
      : '这一天月亮整夜都在地平线下，换个日期看看。';
  } else if (aa.alt < 12) {
    tip = `月亮刚爬上来 ${aa.alt.toFixed(1)}°，在${azName(aa.az)}边，抬头就能看见。`;
  } else {
    tip = `月亮已升到 ${aa.alt.toFixed(1)}°，挂在${azName(aa.az)}边，端着月饼出门刚刚好。`;
  }
  $('outMoon').innerHTML = `
    <div class="row"><span>月出</span><b>${hhmm(ev.rise)}</b></div>
    <div class="row"><span>月上中天</span><b>${hhmm(ev.culmination)} · ${ev.culminationAlt.toFixed(0)}°</b></div>
    <div class="row"><span>月落</span><b>${hhmm(ev.set)}</b></div>
    <div class="row"><span>此刻</span><b>${hhmm(state.date)} · 高度 ${aa.alt.toFixed(1)}°</b></div>
    <p class="tip">${tip}</p>`;

  const r = calcRecipe(state);
  renderRecipe(r);
  state._recipe = r;
  renderFullMoon();
  syncInputs();
}

// 最圆时刻：倒计时 + 一键跳过去
function renderFullMoon() {
  const { prev, next } = fullMoonNear(state.date);
  const now = state.date.valueOf();
  const toNext = next.date.valueOf() - now;
  const sincePrev = now - prev.date.valueOf();
  fullState = { prev: prev.date, next: next.date };

  // 离哪一次更近就主打哪一次：还没到说"还有多久"，刚过说"已过多久"
  const nearestIsNext = toNext <= sincePrev;
  const node = $('fmCount');
  node.textContent = nearestIsNext
    ? `距最圆还有 ${fmtDur(toNext)}`
    : `最圆已过 ${fmtDur(sincePrev)}`;
  // 就在最圆前后半小时内，点亮它
  node.classList.toggle('is-full', Math.min(toNext, sincePrev) < 30 * 60 * 1000);

  $('fmPrev').textContent = `← 上一次 ${fmtFullTime(prev.date)}`;
  $('fmNext').textContent = `下一次 ${fmtFullTime(next.date)} →`;
}

function jumpToFull(which) {
  const target = fullState && fullState[which];
  if (!target) return;
  state.date = new Date(target);
  state.newMoon = null;
  update();
  // 把月亮区滚进视野，跳过去的变化立刻看得见
  $('moon3d')?.closest('.block')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function renderRecipe(r) {
  const dough = r.dough.map((d) => `<div class="row"><span>${d.name}</span><b>${d.grams} g</b></div>`).join('');
  const fill = r.fillings
    .map((f) => `<div class="row"><span>${f.name}</span><b>${f.grams} g</b></div>`)
    .join('');
  const yolk = r.yolkCount
    ? `<div class="row"><span>咸蛋黄</span><b>${r.yolkCount} 个 · ${r.yolkTotal} g</b></div>`
    : '';
  $('outRecipe').innerHTML = `
    <div class="cols">
      <div class="col"><h4>饼皮</h4>${dough}</div>
      <div class="col"><h4>馅料</h4>${fill}${yolk}</div>
    </div>
    <div class="spec">每个 ${state.weight} g ＝ 皮 ${r.perPiece.crust} g ＋ 馅 ${r.perPiece.fill} g</div>`;
}

function syncInputs() {
  const age = state.newMoon ? (state.date - state.newMoon) / DAY_MS : 0;
  $('age').value = Math.min(SYNODIC, Math.max(0, age)).toFixed(2);
  $('when').value = toInput(state.date);
  $('crust').value = String(state.crustRatio);
  $('crustTag').textContent = `${Math.round(state.crustRatio * 100)} : ${Math.round((1 - state.crustRatio) * 100)}`;
}

// ---------------------------------------------------------------- 定位
function applyLoc(loc) {
  state.lat = loc.lat;
  state.lon = loc.lon;
  state.city = loc.city || '';
  $('lat').value = loc.lat.toFixed(3);
  $('lon').value = loc.lon.toFixed(3);
  $('locStatus').textContent = `${loc.source}${loc.city ? ' · ' + loc.city : ''}`;
  $('locStatus').classList.add('on');
  update({ keepNewMoon: true });
}

async function autoLocate() {
  $('locStatus').textContent = '正在定位…';
  const loc = await detectByIP();
  if (loc) applyLoc(loc);
  else $('locStatus').textContent = `定位失败 · 已用默认（${DEFAULT_LOC.city}）`;
}

// ---------------------------------------------------------------- 馅料列表
function renderFillings() {
  const box = $('fillings');
  box.textContent = '';
  state.fillings.forEach((f, i) => {
    const row = el('div', 'frow');
    const name = el('input', 'fname');
    name.value = f.name;
    name.placeholder = '馅料名';
    name.oninput = () => {
      f.name = name.value;
      update({ keepNewMoon: true });
    };
    const dot = el('span', 'dot');
    dot.style.background = cssHex(FILL_COLORS[f.name.trim()] ?? DEFAULT_FILL_COLOR);
    name.style.paddingLeft = '4px';
    const nameWrap = el('div');
    nameWrap.style.display = 'flex';
    nameWrap.style.alignItems = 'center';
    nameWrap.append(dot, name);
    nameWrap.style.gridColumn = 'span 1';

    const pct = el('input', 'fpct');
    pct.type = 'number';
    pct.min = '0';
    pct.value = f.pct;
    pct.oninput = () => {
      f.pct = Number(pct.value) || 0;
      update({ keepNewMoon: true });
    };
    const unit = el('span', 'unit');
    unit.textContent = '%';
    const del = el('button', 'fdel');
    del.type = 'button';
    del.textContent = '×';
    del.onclick = () => {
      state.fillings.splice(i, 1);
      renderFillings();
      update({ keepNewMoon: true });
    };
    row.append(nameWrap, pct, unit, del);
    box.append(row);
  });
}

// ---------------------------------------------------------------- 事件绑定
function bind() {
  $('age').addEventListener('input', () => {
    if (!state.newMoon) return;
    state.date = dateFromAge(state.newMoon, parseFloat($('age').value));
    update({ keepNewMoon: true });
  });

  $('when').addEventListener('change', () => {
    const v = $('when').value;
    if (!v) return;
    state.date = new Date(v);
    state.newMoon = null;
    update();
  });

  $('btnNow').addEventListener('click', () => {
    state.date = new Date();
    state.newMoon = null;
    update();
  });

  $('fmPrev').addEventListener('click', () => jumpToFull('prev'));
  $('fmNext').addEventListener('click', () => jumpToFull('next'));

  $('cutOpen').addEventListener('change', () => {
    state.cut = $('cutOpen').checked;
    update({ keepNewMoon: true });
  });

  $('weight').addEventListener('input', () => {
    state.weight = Number($('weight').value) || 75;
    update({ keepNewMoon: true });
  });
  $('count').addEventListener('input', () => {
    state.count = Math.max(1, Number($('count').value) || 1);
    update({ keepNewMoon: true });
  });
  $('crust').addEventListener('input', () => {
    state.crustRatio = Number($('crust').value);
    update({ keepNewMoon: true });
  });
  $('yolkOn').addEventListener('change', () => {
    state.useYolk = $('yolkOn').checked;
    update({ keepNewMoon: true });
  });
  $('yolkW').addEventListener('input', () => {
    state.yolkWeight = Number($('yolkW').value) || 12;
    update({ keepNewMoon: true });
  });
  $('yolkPer').addEventListener('input', () => {
    state.yolkPer = Number($('yolkPer').value) || 1;
    update({ keepNewMoon: true });
  });
  $('addFilling').addEventListener('click', () => {
    state.fillings.push({ name: '豆沙', pct: 30 });
    renderFillings();
    update({ keepNewMoon: true });
  });
  document.querySelectorAll('.chip[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.preset;
      if (state.fillings.length === 1) state.fillings[0] = { name, pct: 100 };
      else state.fillings.push({ name, pct: 50 });
      renderFillings();
      update({ keepNewMoon: true });
    });
  });

  $('lat').addEventListener('change', () => {
    state.lat = Number($('lat').value);
    state.city = '';
    $('locStatus').textContent = '手动输入坐标';
    update({ keepNewMoon: true });
  });
  $('lon').addEventListener('change', () => {
    state.lon = Number($('lon').value);
    state.city = '';
    $('locStatus').textContent = '手动输入坐标';
    update({ keepNewMoon: true });
  });
  $('btnGeo').addEventListener('click', async () => {
    $('locStatus').textContent = '正在定位…';
    const loc = await requestPrecise();
    if (loc) applyLoc(loc);
    else $('locStatus').textContent = '定位被拒绝 · 点这里再试一次';
  });

  $('blessing').addEventListener('change', () => {
    state.blessing = Number($('blessing').value);
  });
  $('author').addEventListener('input', () => {
    state.author = $('author').value;
  });

  $('btnExport').addEventListener('click', exportCard);
  $('btnList').addEventListener('click', () => {
    const r = state._recipe || calcRecipe(state);
    navigator.clipboard?.writeText(shoppingList(r));
    const b = $('btnList');
    b.textContent = '已复制清单';
    setTimeout(() => (b.textContent = '复制购物清单'), 1600);
  });

  window.addEventListener('resize', () => {
    if (scene) scene.resize();
    if (cakeScene) cakeScene.resize();
    update({ keepNewMoon: true });
  });
}

// ---------------------------------------------------------------- 导出卡片
async function loadImage(src) {
  if (!src) return null;
  const img = new Image();
  img.src = src;
  try {
    await img.decode();
    return img;
  } catch (e) {
    return null;
  }
}

async function exportCard() {
  const btn = $('btnExport');
  btn.disabled = true;
  btn.textContent = '生成中…';
  try {
    const [moonImg, cakeImg] = await Promise.all([
      scene ? loadImage(scene.snapshot()) : null,
      cakeScene ? loadImage(cakeScene.snapshot()) : null,
    ]);
    const r = state._recipe || calcRecipe(state);
    const ill = illumination(state.date);
    const ev = moonEvents(state.date, state.lat, state.lon);
    const lunarDay = Math.min(30, Math.floor((state.date - state.newMoon) / DAY_MS) + 1);
    const d = state.date;
    // 卡片上也印一行最圆时刻
    const fm = fullMoonNear(d);
    const toNextFull = fm.next.date.valueOf() - d.valueOf();
    const sincePrevFull = d.valueOf() - fm.prev.date.valueOf();
    const fullMoonLine =
      toNextFull <= sincePrevFull
        ? `最圆：${fmtFullTime(fm.next.date)} · 还有 ${fmtDur(toNextFull)}`
        : `最圆：${fmtFullTime(fm.prev.date)} · 已过 ${fmtDur(sincePrevFull)}`;

    const dataUrl = buildCard({
      moonImage: moonImg,
      cakeImage: cakeImg,
      info: {
        subtitle: `${d.getFullYear()} · ${d.getMonth() + 1} 月 ${d.getDate()} 日 · ${hhmm(d)}`,
        place: state.city || `${state.lat.toFixed(2)}, ${state.lon.toFixed(2)}`,
        lunarBig: (lunarInfo(d) || {}).full || `八月${lunarDayName(lunarDay)}`,
        phaseLine: `亮面 ${(ill.fraction * 100).toFixed(0)}% · 月出 ${hhmm(ev.rise)} · 中天 ${hhmm(ev.culmination)}`,
        dough: r.dough.map((x) => `${x.name} ${x.grams} g`),
        fillings: r.fillings
          .map((x) => `${x.name} ${x.grams} g`)
          .concat(r.yolkCount ? [`咸蛋黄 ${r.yolkCount} 个`] : []),
        spec: [
          `${state.count} 个`,
          `每个 ${state.weight} g`,
          `皮 ${r.perPiece.crust} g`,
          `馅 ${r.perPiece.fill} g`,
        ],
        moonLine: `赏月时刻：月出 ${hhmm(ev.rise)}，月上中天 ${hhmm(ev.culmination)}（${ev.culminationAlt.toFixed(0)}°），月落 ${hhmm(ev.set)}`,
        fullMoonLine,
        blessing: BLESSINGS[state.blessing],
        author: state.author,
      },
    });
    // 交给适配层决定保存方式：App 内存进相册，其余环境走浏览器下载
    const name = `咬一口月亮-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.jpg`;
    const res = await toy.saveImage(dataUrl, name, '需要相册权限，把这张团圆卡保存下来');
    if (!res.ok) {
      btn.textContent = '保存失败，长按图片试试';
      setTimeout(() => {
        btn.textContent = '生成团圆卡';
      }, 2400);
      return;
    }
    btn.textContent = res.where === 'album' ? '已存入相册' : '已下载到本地';
    setTimeout(() => {
      btn.textContent = '生成团圆卡';
    }, 2000);
  } finally {
    btn.disabled = false;
  }
}

// ================================================================
// Toy 版新增：视图切换 / 限时挑战 / 排行榜 / 分享 / 容器适配
// ================================================================

const VIEWS = ['moon', 'challenge', 'rank'];
let activeView = 'moon';
let ch = null; // 挑战实例
let rankPeriod = 'all';

const escapeHtml = (s) =>
  String(s == null ? '' : s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

/**
 * 切换视图。注意：隐藏中的 canvas 量出来是 0 宽高，
 * 切回来必须重新 resize，否则 3D 场景会按 0 尺寸重建、看着像坏了。
 */
function switchView(name) {
  if (!VIEWS.includes(name)) return;
  activeView = name;
  VIEWS.forEach((v) => {
    $('view-' + v).hidden = v !== name;
  });
  document.querySelectorAll('.tab').forEach((b) => {
    b.classList.toggle('on', b.dataset.view === name);
  });
  requestAnimationFrame(() => {
    if (name === 'moon') {
      if (scene) scene.resize();
      if (cakeScene) cakeScene.resize();
      update({ keepNewMoon: true });
    } else if (name === 'challenge') {
      if (ch) ch.resize();
    } else if (name === 'rank') {
      loadRank();
    }
  });
}

function initTabs() {
  document.querySelectorAll('.tab').forEach((b) => {
    b.addEventListener('click', () => switchView(b.dataset.view));
  });
}

// ---------------------------------------------------------------- 限时挑战
function initChallenge() {
  ch = createChallenge($('chCanvas'), {
    onTick: (s) => {
      $('chTime').textContent = Math.max(0, s.timeLeft).toFixed(1);
      $('chScore').textContent = String(s.score);
      $('chCombo').textContent = String(s.combo);
      $('chRound').textContent = String(s.round);
      $('chBar').style.width = Math.max(0, Math.min(100, (s.timeLeft / 60) * 100)) + '%';
      $('chTol').textContent = `容差 ±${s.tolerance.toFixed(2)} 天`;
    },
    onChange: (s) => {
      $('chGo').disabled = s.phase !== 'playing';
    },
    onFinish: (result) => finishChallenge(result),
  });

  $('chSlider').addEventListener('input', () => {
    ch.setGuess(Number($('chSlider').value));
  });
  $('chGo').addEventListener('click', () => ch.confirm());

  $('chStart').addEventListener('click', () => {
    $('chOverlay').hidden = true;
    $('chOvFacts').hidden = true;
    $('chOvHint').textContent = '';
    $('chShareScore').hidden = true;
    $('chSlider').value = '14.77';
    ch.start();
  });

  $('chShareScore').addEventListener('click', async () => {
    const btn = $('chShareScore');
    const r = await toy.share('index.html');
    btn.textContent = r.ok ? '已分享' : '当前环境不支持分享';
    setTimeout(() => {
      btn.textContent = '分享成绩';
    }, 1800);
  });
}

async function finishChallenge(result) {
  $('chOvTitle').textContent =
    result.score >= 900
      ? '月亮就这么圆'
      : result.score >= 450
        ? '咬得不错'
        : result.score >= 180
          ? '有点手感了'
          : '再来一局？';
  $('chOvText').textContent = `答对 ${result.hits} / ${result.round} 轮，最高 ${result.bestCombo} 连击。`;

  const facts = $('chOvFacts');
  facts.innerHTML = `
    <div class="ch-fact"><span>本局得分</span><b>${result.score}</b></div>
    <div class="ch-fact"><span>准确率</span><b>${Math.round(result.accuracy * 100)}%</b></div>`;
  facts.hidden = false;

  // 存档：本地立刻落，云端延迟合并推送（官方建议按关键节点落盘、批量代替循环）
  const save = await toy.loadSave();
  const best = Math.max(save.challengeBest || 0, result.score);
  state.best = best;
  await toy.patchSave({
    challengeBest: best,
    challengePlays: (save.challengePlays || 0) + 1,
  });
  updateBestNote();

  // 提交排行榜（只增不减且幂等，一局提交一次就够）
  const hint = $('chOvHint');
  const submitted = await toy.submitScore(1, result.score);
  if (submitted) {
    hint.textContent = `已提交 · 你的历史最高 ${submitted.score} 分`;
  } else if (await toy.can('submitScore')) {
    hint.textContent = '提交失败：可能需要登录，或正好撞上限流，过一会儿再试。';
  } else {
    hint.textContent = '当前环境没有排行榜能力，成绩已存在本机。';
  }

  $('chOverlay').hidden = false;
  $('chStart').textContent = '再来一局';
  $('chShareScore').hidden = !(await toy.can('share'));
}

function updateBestNote() {
  $('chBestNote').textContent = state.best ? `本机最高分 ${state.best}` : '看看你能连对几轮';
}

// ---------------------------------------------------------------- 排行榜
async function loadRank() {
  const listEl = $('rankList');
  const myEl = $('myRank');

  if (!(await toy.can('getRankList'))) {
    listEl.innerHTML = '<p class="muted">排行榜只在 B站 App 内可用；Web 端与本地环境读不到榜单。</p>';
    myEl.textContent = '当前环境不支持排行榜';
    return;
  }

  listEl.innerHTML = '<p class="muted">正在读取榜单…</p>';
  const [list, mine] = await Promise.all([toy.rankList(1, rankPeriod, 50), toy.myRank(1, rankPeriod)]);

  // 是否上榜必须看 ranked —— 分数允许是 0 或负数，拿分数判断会出错
  if (mine && mine.ranked) {
    myEl.innerHTML = `我：第 <b>${mine.rank}</b> 名 · ${mine.score} 分`;
  } else if (mine) {
    myEl.textContent = '我还没上榜 —— 去挑战里刷一局';
  } else {
    myEl.textContent = '读不到我的排名（可能未登录）';
  }

  if (!list || !list.length) {
    listEl.innerHTML = '<p class="muted">这个周期还没有人上榜，你可以做第一个。</p>';
    return;
  }
  const myRankNo = mine && mine.ranked ? mine.rank : -1;
  listEl.innerHTML = list
    .map(
      (it) => `
    <div class="rank-row${Number(it.rank) === myRankNo ? ' me' : ''}">
      <div class="rank-no">${Number(it.rank) || 0}</div>
      <img class="rank-avatar" src="${escapeHtml(it.avatar || '')}" alt="" loading="lazy" referrerpolicy="no-referrer" />
      <div class="rank-name">${escapeHtml(it.nickname || '匿名')}</div>
      <div class="rank-score">${Number(it.score) || 0}</div>
    </div>`
    )
    .join('');
}

function initRank() {
  document.querySelectorAll('#rankPeriod .seg-item').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#rankPeriod .seg-item').forEach((x) => x.classList.toggle('on', x === b));
      rankPeriod = b.dataset.p;
      loadRank();
    });
  });
  $('rankRefresh').addEventListener('click', loadRank);
}

// ---------------------------------------------------------------- 分享动作
function initShare() {
  $('btnShare').addEventListener('click', async () => {
    const btn = $('btnShare');
    const r = await toy.share('index.html');
    btn.textContent = r.ok && r.where === 'panel' ? '已唤起分享' : r.ok ? '链接已复制' : '当前环境不支持';
    setTimeout(() => {
      btn.textContent = '分享';
    }, 1800);
  });

  $('btnQr').addEventListener('click', async () => {
    const box = $('qrBox');
    if (!box.hidden) {
      box.hidden = true;
      return;
    }
    const qr = await toy.qrCode({ size: 320 });
    if (!qr) {
      const btn = $('btnQr');
      btn.textContent = '仅 App 内可用';
      setTimeout(() => {
        btn.textContent = '二维码';
      }, 1800);
      return;
    }
    $('qrImg').src = qr.base64 || qr.url;
    box.hidden = false;
  });
}

// ---------------------------------------------------------------- 容器与沉浸
async function initImmersive() {
  const btn = $('btnImmersive');
  if (!(await toy.can('setContainerMode'))) return;
  btn.hidden = false;

  let immersive = false;
  let pending = null;

  // setContainerMode 的 Promise 只是「调用返回」，不是成功回执；
  // 是否真的生效只能靠 onContainer 的状态变化来确认（官方明确要求这样用）。
  toy.onContainer((cs) => {
    if (!cs) return;
    if (cs.changedFields && cs.changedFields.includes('immersive')) {
      immersive = !!cs.immersive;
      pending = null;
      btn.textContent = immersive ? '退出沉浸' : '沉浸看月';
    }
    // 刘海屏与手势条：交给 body 的 padding，别让内容压在系统栏下面
    if (cs.safeArea) {
      document.body.style.paddingTop = cs.safeArea.top ? cs.safeArea.top + 'px' : '';
      document.body.style.paddingBottom = cs.safeArea.bottom ? cs.safeArea.bottom + 'px' : '';
    }
  });

  btn.addEventListener('click', async () => {
    pending = !immersive;
    btn.disabled = true;
    const ok = await toy.setContainerMode({ immersive: pending });
    btn.disabled = false;
    if (!ok) {
      pending = null;
      btn.textContent = '此环境不支持沉浸';
      setTimeout(() => {
        btn.textContent = '沉浸看月';
      }, 1800);
    }
  });
}

async function initEnvNote() {
  const note = $('envNote');
  if (toy.hasSdk()) {
    const caps = [];
    if (await toy.can('submitScore')) caps.push('排行榜');
    if (await toy.can('saveImageToAlbum')) caps.push('保存到相册');
    if (await toy.can('share')) caps.push('分享面板');
    if (await toy.can('getQrCode')) caps.push('二维码');
    if (await toy.can('setContainerMode')) caps.push('沉浸模式');
    note.textContent = caps.length
      ? `已接入 B站 Toy 能力：${caps.join(' / ')}`
      : '检测到 Toy 环境，但当前容器没有开放这些能力（可能是旧版客户端）。';
  } else {
    note.textContent =
      '当前不在 B站 Toy 环境：排行榜、保存到相册、分享面板、二维码、沉浸模式不可用；成绩与配方会存在本机，其余功能完全正常。';
  }
  note.hidden = false;
}

async function initToy() {
  const ok = await toy.ready();
  if (ok) {
    const save = await toy.loadSave();
    state.best = save.challengeBest || 0;
  }
  updateBestNote();
  await initImmersive();
  await initEnvNote();
  // 页面被切走时把还没推的存档送上去
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) toy.flushSave();
  });
}

// ---------------------------------------------------------------- 启动
function boot() {
  const t = new URLSearchParams(location.search).get('t');
  if (t) {
    const d = new Date(t);
    if (!Number.isNaN(d.valueOf())) state.date = d;
  }
  if (new URLSearchParams(location.search).get('cut') === '1') {
    state.cut = true;
    $('cutOpen').checked = true;
  }

  const sel = $('blessing');
  BLESSINGS.forEach((b, i) => {
    const o = el('option');
    o.value = String(i);
    o.textContent = b;
    sel.append(o);
  });
  $('lat').value = state.lat;
  $('lon').value = state.lon;
  renderFillings();
  bind();
  update();
  init3D();
  autoLocate();

  // Toy 版新增
  initTabs();
  initChallenge();
  initRank();
  initShare();
  initToy();

  // ?view=challenge 直达某个视图 —— 分享挑战页时有用，也方便调试
  // 再加 &auto=1 会直接开局（无需先点开始按钮）
  const q = new URLSearchParams(location.search);
  const v = q.get('view');
  if (v && VIEWS.includes(v)) {
    switchView(v);
    if (v === 'challenge' && q.get('auto') === '1') {
      // 等一帧，让视图从 hidden 变可见、canvas 量到真实尺寸后再开局
      setTimeout(() => $('chStart').click(), 150);
    }
  }
}

boot();
