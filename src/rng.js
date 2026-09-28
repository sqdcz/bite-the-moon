// rng.js —— 可复现的伪随机
//
// 每日挑战要"同一天同一套题"，就必须有确定性随机。Math.random() 做不到，
// 需要 种子 → 随机序列 的固定映射。

/** FNV-1a 变体：字符串 → 32 位无符号整数种子 */
export function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * mulberry32：小而快的 PRNG。同一个种子永远产出同一串数，
 * 所以"按日期定种子"就能让所有人拿到同一套题。
 */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
