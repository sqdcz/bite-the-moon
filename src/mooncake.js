// mooncake.js —— Canvas 2D 绘制「被咬了一口的月饼」
// 核心：月饼缺口与月相共用同一组参数（亮面比例 fraction + 咬口朝向 angle）
//
// 轮廓几何统一由 shape.js 提供（**双圆月牙**模型），与 3D 版同源。
// 早先这里用的是椭圆终止线模型（rx = R·|2f−1|），和 3D 形状对不上 —— 
// 2D 只在 three 加载失败时兜底，平时看不出来，但挑战玩法要靠 2D 绘制，
// 形状对不上就会让玩家看到的东西不可信。

import { mooncakePath } from './shape.js';

export { mooncakePath };

// 画一整块月饼：底盘阴影 + 缺口底 + 饼身 + 压花
export function drawMooncake(ctx, cx, cy, R, fraction, angle, opts = {}) {
  const f = Math.min(1, Math.max(0, fraction));
  ctx.save();
  ctx.translate(cx, cy);

  // 托盘阴影
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(0, R * 0.92, R * 0.95, R * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 被咬掉的部分：露出浅灰的“断面盘底”
  ctx.save();
  ctx.rotate(angle);
  const full = new Path2D();
  full.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fillStyle = opts.biteColor || '#efe6d4';
  ctx.fill(full);
  ctx.strokeStyle = 'rgba(120,96,60,0.28)';
  ctx.lineWidth = Math.max(1, R * 0.012);
  ctx.setLineDash([R * 0.09, R * 0.07]);
  ctx.stroke(full);
  ctx.setLineDash([]);
  ctx.restore();

  // 饼身
  ctx.save();
  ctx.rotate(angle);
  const body = mooncakePath(R, f);

  const grad = ctx.createRadialGradient(-R * 0.3, -R * 0.35, R * 0.1, 0, 0, R);
  grad.addColorStop(0, opts.hiColor || '#f6c977');
  grad.addColorStop(0.65, opts.baseColor || '#dda24c');
  grad.addColorStop(1, opts.edgeColor || '#b97a34');
  ctx.fillStyle = grad;
  ctx.fill(body);

  // 压花：先裁剪到饼身，缺失的部分自然被咬掉
  ctx.save();
  ctx.clip(body);
  ctx.strokeStyle = 'rgba(120,76,30,0.55)';
  ctx.lineWidth = Math.max(1, R * 0.03);
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.66, 0, Math.PI * 2);
  ctx.stroke();

  // 四瓣花
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    ctx.moveTo(Math.cos(a) * R * 0.2, Math.sin(a) * R * 0.2);
    ctx.arc(Math.cos(a) * R * 0.34, Math.sin(a) * R * 0.34, R * 0.17, 0, Math.PI * 2);
  }
  ctx.stroke();

  // 中心字样
  if (opts.label && f > 0.45) {
    ctx.fillStyle = 'rgba(112,68,24,0.85)';
    ctx.font = `${Math.round(R * 0.34)}px "PingFang SC","Microsoft YaHei",serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(opts.label, 0, R * 0.02);
  }
  ctx.restore();

  // 咬痕断面：沿终止线描一道深边，看起来更像真咬过
  ctx.strokeStyle = 'rgba(150,96,40,0.5)';
  ctx.lineWidth = Math.max(1, R * 0.02);
  ctx.stroke(body);

  // 饼边高光
  ctx.strokeStyle = 'rgba(255,236,190,0.4)';
  ctx.lineWidth = Math.max(1, R * 0.015);
  ctx.stroke(body);
  ctx.restore();

  ctx.restore();
}

// 3D 不可用时的降级：用同一套几何画一个 2D 月亮
export function drawMoon2D(ctx, cx, cy, R, fraction, angle) {
  const f = Math.min(1, Math.max(0, fraction));
  ctx.save();
  ctx.translate(cx, cy);

  // 暗面（地照）
  const dark = new Path2D();
  dark.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fillStyle = '#3d4358';
  ctx.fill(dark);

  ctx.rotate(angle);
  const lit = mooncakePath(R, f);
  const g = ctx.createRadialGradient(-R * 0.25, -R * 0.25, R * 0.05, 0, 0, R * 1.05);
  g.addColorStop(0, '#fffaf0');
  g.addColorStop(0.7, '#f2e4c4');
  g.addColorStop(1, '#d8c69f');
  ctx.fillStyle = g;
  ctx.fill(lit);
  ctx.restore();
}
