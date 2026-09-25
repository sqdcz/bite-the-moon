// texture.js —— 程序化生成月面贴图
// 不依赖任何外部图片资源：用 Canvas 画出月海、环形山与辐射纹，再交给 Three.js 当贴图
// 好处是离线可用、加载秒开，也方便你自己改参数调风格

// 固定种子的伪随机，保证每次刷新月面一致
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 月面颜色贴图（等距柱状投影，2:1）
export function makeMoonTexture(size = 1024) {
  const w = size;
  const h = size / 2;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const rnd = mulberry32(20260925);

  // 底色：偏暖的月壤灰
  ctx.fillStyle = '#b3aa9a';
  ctx.fillRect(0, 0, w, h);

  // 月海：多块柔和暗斑叠加，边缘自然过渡（比单个硬椭圆真实得多）
  const maria = [
    [0.24, 0.32, 0.19, 0.15, 0],
    [0.30, 0.40, 0.15, 0.12, 0],
    [0.40, 0.27, 0.12, 0.10, 0],
    [0.20, 0.50, 0.11, 0.09, 0],
    [0.47, 0.44, 0.10, 0.09, 0],
    [0.62, 0.33, 0.10, 0.085, 0],
    [0.68, 0.44, 0.07, 0.06, 0],
    [0.34, 0.64, 0.085, 0.07, 0],
    [0.55, 0.60, 0.06, 0.05, 0],
    [0.78, 0.58, 0.05, 0.045, 0],
  ];
  maria.forEach(([x, y, rx, ry]) => {
    const cx = x * w;
    const cy = y * h;
    const R = Math.max(rx * w, ry * h);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    g.addColorStop(0, 'rgba(62,62,74,0.72)');
    g.addColorStop(0.55, 'rgba(78,78,90,0.46)');
    g.addColorStop(1, 'rgba(100,100,110,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * w, ry * h, rnd() * 0.8 - 0.4, 0, Math.PI * 2);
    ctx.fill();
  });

  // 环形山：真实月面坑极密，所以数量拉满、半径拉小
  const craters = [];
  for (let i = 0; i < 22; i++) craters.push({ r: 16 + rnd() * 30, a: 0.34 });
  for (let i = 0; i < 260; i++) craters.push({ r: 5 + rnd() * 12, a: 0.26 });
  for (let i = 0; i < 1500; i++) craters.push({ r: 2 + rnd() * 4.5, a: 0.2 });
  for (let i = 0; i < 3200; i++) craters.push({ r: 0.7 + rnd() * 1.8, a: 0.13 });

  craters.forEach((cr) => {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = cr.r;
    // 坑底（暗）
    ctx.fillStyle = `rgba(60,58,62,${cr.a * 0.9})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    // 坑缘（亮）
    ctx.strokeStyle = `rgba(236,234,226,${cr.a})`;
    ctx.lineWidth = Math.max(0.6, r * 0.16);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    // 一侧高光，模拟斜射光
    ctx.strokeStyle = `rgba(255,255,255,${cr.a * 0.5})`;
    ctx.beginPath();
    ctx.arc(x, y, r, Math.PI * 0.7, Math.PI * 1.3);
    ctx.stroke();
  });

  // 第谷坑风格的辐射纹
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = '#f2efe6';
  for (let k = 0; k < 3; k++) {
    const cx = (0.18 + rnd() * 0.64) * w;
    const cy = (0.3 + rnd() * 0.4) * h;
    const rays = 8 + Math.floor(rnd() * 8);
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2 + rnd() * 0.2;
      const len = (0.06 + rnd() * 0.16) * w;
      ctx.lineWidth = 1 + rnd() * 2.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len * 0.7);
      ctx.stroke();
    }
  }
  ctx.restore();

  // 细噪点，破坏塑料感
  const img = ctx.getImageData(0, 0, w, h);
  const px = img.data;
  for (let i = 0; i < px.length; i += 4) {
    const n = (rnd() - 0.5) * 26;
    px[i] = Math.max(0, Math.min(255, px[i] + n));
    px[i + 1] = Math.max(0, Math.min(255, px[i + 1] + n));
    px[i + 2] = Math.max(0, Math.min(255, px[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);

  return c;
}

// 月饼顶面压花贴图：外圈回纹 + 四瓣花 + “中秋”二字
// 直接画在圆盘上（底色就是饼皮色），UV 是平面映射，不会扭曲
export function makeMooncakeTopTexture(size = 1024) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const R = size / 2;

  // 饼皮底色（带一点烘深浅变化）
  const g = ctx.createRadialGradient(R * 0.75, R * 0.7, R * 0.1, R, R, R);
  g.addColorStop(0, '#f0c078');
  g.addColorStop(0.55, '#dfa355');
  g.addColorStop(1, '#c9853a');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(R, R, R, 0, Math.PI * 2);
  ctx.fill();

  // 烘焙斑驳
  const rnd = mulberry32(777);
  for (let i = 0; i < 1600; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = rnd() * 6 + 1;
    ctx.fillStyle = `rgba(${rnd() > 0.5 ? '255,222,170' : '150,96,40'},${rnd() * 0.09})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 压花走“凹”的路子：线条颜色淡、靠 bumpMap 出立体感，才像压出来的而不是贴上去的
  const ink = 'rgba(116,66,20,0.34)';

  // 外圈双线
  ctx.strokeStyle = ink;
  ctx.lineWidth = size * 0.016;
  ctx.beginPath();
  ctx.arc(R, R, R * 0.9, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = size * 0.009;
  ctx.beginPath();
  ctx.arc(R, R, R * 0.815, 0, Math.PI * 2);
  ctx.stroke();

  // 一圈整齐的回纹（简化的“回”字，沿切线方向）
  ctx.lineWidth = size * 0.0085;
  const n = 24;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const u = size * 0.0115;
    ctx.save();
    ctx.translate(R + Math.cos(a) * R * 0.858, R + Math.sin(a) * R * 0.858);
    ctx.rotate(a + Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(-u, -u);
    ctx.lineTo(u, -u);
    ctx.lineTo(u, u);
    ctx.lineTo(-u * 0.35, u);
    ctx.lineTo(-u * 0.35, -u * 0.35);
    ctx.lineWidth = size * 0.0085;
    ctx.stroke();
    ctx.restore();
  }

  // 中心四瓣花：只留花，不放字，留白干净
  ctx.lineWidth = size * 0.013;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const px = R + Math.cos(a) * R * 0.4;
    const py = R + Math.sin(a) * R * 0.4;
    ctx.beginPath();
    ctx.arc(px, py, R * 0.175, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.lineWidth = size * 0.011;
  ctx.beginPath();
  ctx.arc(R, R, R * 0.13, 0, Math.PI * 2);
  ctx.stroke();

  return c;
}

// 柔和光晕（加在月亮背后的 Sprite，比后期 bloom 便宜，效果也稳）
export function makeGlowTexture(size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const R = size / 2;
  const g = ctx.createRadialGradient(R, R, R * 0.18, R, R, R);
  g.addColorStop(0, 'rgba(255,244,214,0.55)');
  g.addColorStop(0.28, 'rgba(255,232,180,0.22)');
  g.addColorStop(0.6, 'rgba(255,220,150,0.07)');
  g.addColorStop(1, 'rgba(255,220,150,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

// 软阴影（月饼下方的接触阴影）
export function makeShadowTexture(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const R = size / 2;
  const g = ctx.createRadialGradient(R, R, 0, R, R, R);
  g.addColorStop(0, 'rgba(0,0,0,0.5)');
  g.addColorStop(0.5, 'rgba(0,0,0,0.24)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

// 月饼侧面的烘焙色贴图
// LatheGeometry 的 UV：u 沿旋转方向环绕一周、v 沿剖面从底到顶，所以这张图竖着做渐变即可
export function makeCrustSideTexture(w = 512, h = 256) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');

  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#c98f45'); // 顶部（靠近饼面，烤得深）
  g.addColorStop(0.14, '#dcab61');
  g.addColorStop(0.42, '#e8bd7b'); // 中部最亮
  g.addColorStop(0.78, '#d9a256');
  g.addColorStop(1, '#bd823c'); // 底部略深
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  const rnd = mulberry32(4242);
  // 一圈浅浅的模具棱（广式月饼侧面有一道收腰）
  ctx.globalAlpha = 0.16;
  for (let i = 0; i < 60; i++) {
    const x = rnd() * w;
    ctx.fillStyle = rnd() > 0.5 ? '#ffffff' : '#6b4517';
    ctx.fillRect(x, 0, 1 + rnd() * 2, h);
  }
  // 烘烤斑驳
  ctx.globalAlpha = 1;
  for (let i = 0; i < 900; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = rnd() * 9 + 1;
    ctx.fillStyle = `rgba(${rnd() > 0.5 ? '255,226,178' : '132,84,32'},${rnd() * 0.12})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

// 简易环境贴图（等距柱状）：给 PBR 材质一点环境反射，去掉塑料感
// 顶部暖光 + 一处主光高光 + 底部深暗，配合 PMREM 使用
export function makeEnvTexture(size = 512) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size / 2;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, size / 2);
  g.addColorStop(0, '#6d6350');
  g.addColorStop(0.42, '#2c2c40');
  g.addColorStop(1, '#0b0b16');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size / 2);

  const hi = ctx.createRadialGradient(size * 0.68, size * 0.2, 0, size * 0.68, size * 0.2, size * 0.34);
  hi.addColorStop(0, 'rgba(255,238,196,0.95)');
  hi.addColorStop(1, 'rgba(255,238,196,0)');
  ctx.fillStyle = hi;
  ctx.fillRect(0, 0, size, size / 2);

  const cool = ctx.createRadialGradient(size * 0.16, size * 0.36, 0, size * 0.16, size * 0.36, size * 0.3);
  cool.addColorStop(0, 'rgba(120,150,255,0.35)');
  cool.addColorStop(1, 'rgba(120,150,255,0)');
  ctx.fillStyle = cool;
  ctx.fillRect(0, 0, size, size / 2);
  return c;
}

// 凹凸贴图：黑底 + 白色坑缘，用来让光照产生真实的坑洼阴影
export function makeBumpTexture(size = 1024) {
  const w = size;
  const h = size / 2;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const rnd = mulberry32(20260925);

  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, w, h);

  for (let i = 0; i < 900; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = 1 + rnd() * (rnd() < 0.15 ? 34 : 10);
    // 坑底压暗
    ctx.fillStyle = 'rgba(40,40,40,0.5)';
    ctx.beginPath();
    ctx.arc(x, y, r * 0.8, 0, Math.PI * 2);
    ctx.fill();
    // 坑缘凸起
    ctx.strokeStyle = 'rgba(220,220,220,0.55)';
    ctx.lineWidth = Math.max(0.6, r * 0.18);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  return c;
}
