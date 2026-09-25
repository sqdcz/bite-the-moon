// recipe.js —— 广式月饼配方与分馅计算
// 思路：先按“总重 × 皮馅比”拆出皮与馅，再从皮反推面团材料，从馅里扣掉蛋黄后按比分配

// 广式糖浆皮的经典配比（以面粉为 100%）
export const DOUGH = {
  flour: 1.0,   // 中筋面粉
  syrup: 0.75,  // 转化糖浆
  oil: 0.25,    // 花生油
  lye: 0.02,    // 枧水
};

export const PRESET_FILLINGS = [
  { name: '莲蓉', pct: 70 },
  { name: '豆沙', pct: 70 },
  { name: '枣泥', pct: 70 },
  { name: '五仁', pct: 70 },
  { name: '芋泥', pct: 70 },
];

const r1 = (n) => Math.round(n * 10) / 10;

/**
 * @param {object} o
 * @param {number} o.weight 单个月饼重量（g，由模具决定）
 * @param {number} o.count  月饼个数
 * @param {number} o.crustRatio 饼皮占比（0.2 = 2:8）
 * @param {Array<{name:string,pct:number}>} o.fillings 馅料与配比（会自动归一化）
 * @param {boolean} o.useYolk 是否包咸蛋黄
 * @param {number} o.yolkWeight 单个蛋黄重量（g）
 * @param {number} o.yolkPer 每个月饼放几个蛋黄
 */
export function calcRecipe(o) {
  const total = o.weight * o.count;
  const crustTotal = total * o.crustRatio;
  const fillTotal = total * (1 - o.crustRatio);

  // 面团材料：皮重 = 面粉 × (1 + 0.75 + 0.25 + 0.02)
  const sumRatio = DOUGH.flour + DOUGH.syrup + DOUGH.oil + DOUGH.lye;
  const flour = crustTotal / sumRatio;
  const dough = [
    { name: '中筋面粉', grams: r1(flour * DOUGH.flour) },
    { name: '转化糖浆', grams: r1(flour * DOUGH.syrup) },
    { name: '花生油', grams: r1(flour * DOUGH.oil) },
    { name: '枧水', grams: r1(flour * DOUGH.lye) },
  ];

  // 蛋黄：从馅料额度里扣除
  const yolkCount = o.useYolk ? o.yolkPer * o.count : 0;
  const yolkTotal = yolkCount * o.yolkWeight;
  const restFill = Math.max(0, fillTotal - yolkTotal);

  // 其余馅料按配比分配
  const pctSum = o.fillings.reduce((s, f) => s + Math.max(0, f.pct), 0);
  const fillings = o.fillings.map((f) => ({
    name: f.name,
    grams: pctSum > 0 ? r1((restFill * Math.max(0, f.pct)) / pctSum) : 0,
    perPiece:
      pctSum > 0 ? r1((restFill * Math.max(0, f.pct)) / pctSum / o.count) : 0,
  }));

  return {
    total: r1(total),
    crustTotal: r1(crustTotal),
    fillTotal: r1(fillTotal),
    crustPer: r1(crustTotal / o.count),
    fillPer: r1(fillTotal / o.count),
    dough,
    fillings,
    yolkCount,
    yolkTotal: r1(yolkTotal),
    yolkPer: o.useYolk ? o.yolkPer : 0,
    // 重要提醒：皮 + 馅 的每份克数
    perPiece: { crust: r1(crustTotal / o.count), fill: r1(fillTotal / o.count) },
  };
}

// 生成购物清单文本
export function shoppingList(r) {
  const lines = [];
  lines.push('【饼皮材料】');
  r.dough.forEach((d) => lines.push(`${d.name} ${d.grams} g`));
  lines.push('');
  lines.push('【馅料】');
  r.fillings.forEach((f) => lines.push(`${f.name} ${f.grams} g`));
  if (r.yolkCount > 0) {
    lines.push(`咸蛋黄 ${r.yolkCount} 个（约 ${r.yolkTotal} g）`);
  }
  lines.push('');
  lines.push(`【规格】每份 ${r.perPiece.crust} g 皮 + ${r.perPiece.fill} g 馅`);
  return lines.join('\n');
}
