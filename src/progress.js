// progress.js —— 每日挑战的定种子机制 + 成就系统
//
// 每日挑战存在的理由：没有它，玩家可以反复重开刷分，排行榜就没有意义。
// 用日期当种子，同一天全世界拿到的是同一套目标序列，成绩才可比，
// 也顺便给了"明天再来"的理由。

import { seededRandom, hashSeed } from './rng.js';

/** 日期键，纯数字（如 20260928）。不要用 Date 对象当键，跨时区会错。 */
export function dayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return Number(`${y}${m}${d}`);
}

/** 当天的每日挑战种子 */
export function dailySeed(date = new Date()) {
  return hashSeed('bite-the-moon-' + dayKey(date));
}

/**
 * 更新连续打卡天数。
 * 注意日期是纯数字（20260930 → 20261001 差 71），不能用"相差 1"判断连续，
 * 得把昨天也算成一个 dayKey 再比。
 */
export function nextStreak(save, today = new Date()) {
  const t = dayKey(today);
  const y = new Date(today);
  y.setDate(y.getDate() - 1);
  const last = Number(save.lastDailyDay || 0);
  const prevBest = Number(save.dailyStreak || 0);
  if (last === t) return { streak: prevBest || 1, firstToday: false };
  if (last === dayKey(y)) return { streak: prevBest + 1, firstToday: true };
  return { streak: 1, firstToday: true };
}

// ---------------------------------------------------------------- 成就
export const ACHIEVEMENTS = [
  { id: 'first_bite', name: '开咬', desc: '第一次命中目标月相' },
  { id: 'combo5', name: '手感来了', desc: '连对 5 轮' },
  { id: 'combo10', name: '月相通', desc: '连对 10 轮' },
  { id: 'exact', name: '分毫不差', desc: '拿到一次「分毫不差」' },
  { id: 'score300', name: '咬月新秀', desc: '单局拿到 300 分' },
  { id: 'score600', name: '咬月好手', desc: '单局拿到 600 分' },
  { id: 'flawless', name: '满月无缺', desc: '一局里至少 8 轮且全中' },
  { id: 'daily3', name: '三日赏月', desc: '连续 3 天完成每日挑战' },
  { id: 'daily7', name: '整周守月', desc: '连续 7 天完成每日挑战' },
];

const BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

export function achInfo(id) {
  return BY_ID.get(id) || null;
}

/**
 * 结算后判定成就。纯函数：不写存档，只告诉你"这一局新解锁了哪些"。
 * @param {object} save 已有存档（含 achievements 数组、连续打卡信息）
 * @param {object} r 一局结果：score / rounds / hits / bestCombo / accuracy / perfects
 * @param {object} extra { daily: boolean, streak: number }
 */
export function evaluateAchievements(save, r, extra = {}) {
  const owned = new Set(save.achievements || []);
  const gained = [];
  const add = (id) => {
    if (!owned.has(id)) {
      owned.add(id);
      gained.push(id);
    }
  };

  if ((r.hits || 0) >= 1) add('first_bite');
  if ((r.bestCombo || 0) >= 5) add('combo5');
  if ((r.bestCombo || 0) >= 10) add('combo10');
  if ((r.perfects || 0) >= 1) add('exact');
  if ((r.score || 0) >= 300) add('score300');
  if ((r.score || 0) >= 600) add('score600');
  // "全中"要限定轮数，否则只答一轮就 100% 太容易
  if ((r.rounds || 0) >= 8 && (r.accuracy || 0) >= 1) add('flawless');
  if (extra.daily) {
    if ((extra.streak || 0) >= 3) add('daily3');
    if ((extra.streak || 0) >= 7) add('daily7');
  }

  return { list: [...owned], gained };
}

export { seededRandom, hashSeed };
