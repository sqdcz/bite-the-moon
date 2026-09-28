// card.js —— 生成可分享的中秋团圆卡片（PNG 1080×1440）
// 版式走中式竖排 + 朱砂印：夜空 / 月亮 / 手里的月饼 / 农历大字 / 配方 / 祝福语

const W = 1080;
const H = 1440;

const SERIF = '"Songti SC","STSong","Noto Serif CJK SC","SimSun",serif';
const SANS = '"LXGW WenKai Screen","PingFang SC","Microsoft YaHei",sans-serif';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawSky(ctx) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#080b1e');
  g.addColorStop(0.4, '#131a3f');
  g.addColorStop(0.75, '#221c3c');
  g.addColorStop(1, '#2b1c2c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // 月亮周围的暖光晕
  const glow = ctx.createRadialGradient(W / 2, 470, 60, W / 2, 470, 620);
  glow.addColorStop(0, 'rgba(255,226,160,0.20)');
  glow.addColorStop(0.35, 'rgba(255,214,140,0.08)');
  glow.addColorStop(1, 'rgba(255,214,140,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // 星点
  let s = 20260925;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  for (let i = 0; i < 240; i++) {
    const x = rnd() * W;
    const y = rnd() * H * 0.8;
    const r = rnd() * 1.9 + 0.35;
    ctx.globalAlpha = 0.25 + rnd() * 0.65;
    ctx.fillStyle = rnd() > 0.85 ? '#ffe6c0' : '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// 朱砂印章
function drawSeal(ctx, x, y, size, text) {
  ctx.save();
  roundRect(ctx, x, y, size, size, size * 0.14);
  ctx.fillStyle = '#c2452d';
  ctx.fill();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = '#fdf3e3';
  ctx.font = `600 ${Math.round(size * 0.42)}px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text.slice(0, 1), x + size * 0.5, y + size * 0.31);
  ctx.fillText(text.slice(1, 2), x + size * 0.5, y + size * 0.71);
  ctx.restore();
}

/**
 * @param {object} o
 * @param {HTMLImageElement|null} o.moonImage 3D 月亮截图（透明底）
 * @param {HTMLImageElement|null} o.cakeImage 3D 月饼截图（透明底）
 * @param {object} o.info 文案与数据
 */
export function buildCard(o) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  const { info } = o;

  drawSky(ctx);

  // ── 月亮 ──
  const moonR = 240;
  const moonCx = W / 2;
  const moonCy = 470;
  if (o.moonImage && o.moonImage.width) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(moonCx, moonCy, moonR, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(o.moonImage, moonCx - moonR, moonCy - moonR, moonR * 2, moonR * 2);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,238,196,0.22)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(moonCx, moonCy, moonR, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.fillStyle = '#39405e';
    ctx.beginPath();
    ctx.arc(moonCx, moonCy, moonR, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── 手里的月饼 ──
  if (o.cakeImage && o.cakeImage.width) {
    const cr = 165;
    const cx = 790;
    const cy = 690;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, cr, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(12,14,34,0.55)';
    ctx.fill();
    ctx.clip();
    ctx.drawImage(o.cakeImage, cx - cr, cy - cr, cr * 2, cr * 2);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,220,170,0.3)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, cr, 0, Math.PI * 2);
    ctx.stroke();
  }

  // ── 标题区 ──
  ctx.textAlign = 'left';
  ctx.fillStyle = '#f7e6c4';
  ctx.font = `600 66px ${SERIF}`;
  ctx.fillText('咬一口月亮', 90, 132);

  // 竖排小字（右上角）
  ctx.save();
  ctx.translate(W - 74, 92);
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(247,230,196,0.5)';
  ctx.font = `26px ${SERIF}`;
  const vertical = '中秋 · 月饼配方与月相';
  for (let i = 0; i < vertical.length; i++) {
    ctx.fillText(vertical[i], 0, i * 32);
  }
  ctx.restore();

  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(247,230,196,0.62)';
  ctx.font = `28px ${SANS}`;
  ctx.fillText(`${info.subtitle || ''}${info.place ? ' · ' + info.place : ''}`, 92, 182);

  // 分隔细金线
  ctx.strokeStyle = 'rgba(232,180,90,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(90, 212);
  ctx.lineTo(W - 90, 212);
  ctx.stroke();

  // ── 农历大字 ──
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd98a';
  ctx.font = `600 92px ${SERIF}`;
  ctx.fillText(info.lunarBig || '', W / 2, 742);
  ctx.fillStyle = 'rgba(247,230,196,0.72)';
  ctx.font = `30px ${SANS}`;
  ctx.fillText(info.phaseLine || '', W / 2, 792);

  // ── 最圆时刻 ──
  ctx.fillStyle = 'rgba(255,217,138,0.88)';
  ctx.font = `27px ${SANS}`;
  ctx.fillText(info.fullMoonLine || '', W / 2, 836);

  // ── 配方面板 ──
  const px = 90;
  const py = 886;
  const pw = W - 180;
  const ph = 350;
  ctx.save();
  roundRect(ctx, px, py, pw, ph, 26);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,220,160,0.26)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(232,180,90,0.85)';
  ctx.font = `26px ${SERIF}`;
  ctx.fillText('饼皮', px + 48, py + 58);
  ctx.fillText('馅料', px + 400, py + 58);
  ctx.fillText('规格', px + 726, py + 58);

  ctx.fillStyle = '#f3ead8';
  ctx.font = `28px ${SANS}`;
  (info.dough || []).forEach((d, i) => ctx.fillText(d, px + 48, py + 112 + i * 46));
  (info.fillings || []).forEach((f, i) => ctx.fillText(f, px + 400, py + 112 + i * 46));
  (info.spec || []).forEach((s, i) => ctx.fillText(s, px + 726, py + 112 + i * 46));

  ctx.fillStyle = 'rgba(247,230,196,0.7)';
  ctx.font = `25px ${SANS}`;
  ctx.fillText(info.moonLine || '', px + 48, py + 292);

  // ── 祝福语与署名 ──
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffe9b8';
  ctx.font = `600 46px ${SERIF}`;
  ctx.fillText(info.blessing || '', W / 2, 1330);
  ctx.fillStyle = 'rgba(247,230,196,0.55)';
  ctx.font = `26px ${SANS}`;
  ctx.fillText(info.author ? `— ${info.author}` : '', W / 2, 1382);

  drawSeal(ctx, 862, 1300, 92, '中秋');

  // 用 JPEG 而不是 PNG：1080×1440 的 PNG 动辄 2-4MB，base64 之后会顶到
  // SDK 的 5MB 上限附近，保存慢、占内存；JPEG 只有它的零头，画质看不出差别。
  // 卡片是实心深色背景，没有透明区域需要保留。
  return c.toDataURL('image/jpeg', 0.92);
}
