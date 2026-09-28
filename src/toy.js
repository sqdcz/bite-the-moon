// toy.js —— B站 Toy SDK 适配层
//
// 目标：业务代码只管调用，环境差异全部在这里吸收。
//
// 三级环境：
//   1. B站 App 内   —— 全部能力可用
//   2. B站 Web 端   —— 那批只在 App 内支持的能力会 reject / 返回 unsupported，
//                      这里统一用 isSupport 提前判断，再从降级分支走
//   3. 普通浏览器 / Electron —— window.toy 根本不存在，同样走降级
//
// 降级约定：
//   存档    → localStorage
//   存图    → <a download> 触发浏览器下载（Web 端官方建议的做法）
//   分享    → 降级为复制链接
//   二维码  → 返回 null，UI 隐藏该入口（不打包二维码库，省体积）
//   排行榜  → 返回 null，UI 展示「仅 App 内可用」
//
// 全程不抛异常：SDK 缺失、未登录、被限流都只是让对应能力返回空值，
// 由调用方决定怎么展示。

// 惰性读取而不是顶层捕获：SDK 用 defer 加载，与本模块的求值顺序不保证，
// 顶层捕获可能在 SDK 到位之前就锁成 null，之后再也拿不到。
function raw() {
  return typeof window !== 'undefined' && window.toy ? window.toy : null;
}

/** SDK 是否被注入（不能等同于「能力可用」——Web 端注入了 SDK 但缺部分能力） */
export function hasSdk() {
  return !!raw();
}

/** 等 SDK 就绪，给启动流程一个确定的同步点；超时也照常返回，不阻塞 */
export function ready(timeoutMs = 1500) {
  if (raw()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const t0 = Date.now();
    const timer = setInterval(() => {
      if (raw() || Date.now() - t0 > timeoutMs) {
        clearInterval(timer);
        resolve(!!raw());
      }
    }, 60);
  });
}

// ---------------------------------------------------------------- 能力探测
// isSupport 的结果在会话内不会变，缓存起来，避免反复 await
const supportCache = new Map();

export async function can(ability) {
  const R = raw();
  if (!R || typeof R.isSupport !== 'function') return false;
  if (supportCache.has(ability)) return supportCache.get(ability);
  let ok = false;
  try {
    ok = await R.isSupport(ability);
  } catch {
    ok = false;
  }
  supportCache.set(ability, !!ok);
  return !!ok;
}

// ---------------------------------------------------------------- 限流退避
// 云存储与排行榜共用一份按 Toy 计的额度，超限会返回 code 307044。
// 按官方建议做指数退避，不立即重试（立即重试会把偶发限流放大成持续限流）。
export function isRateLimited(err) {
  return !!err && err.type === 'http_error' && err.code === 307044;
}

async function withRetry(fn, tries = 3, baseDelay = 800) {
  let delay = baseDelay;
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRateLimited(err) || i >= tries - 1) throw err;
      await new Promise((r) => setTimeout(r, delay));
      delay *= 2;
    }
  }
}

// ---------------------------------------------------------------- 用户资料
export async function getUser() {
  if (!(await can('getUserProfile'))) return null;
  try {
    // 头像 / 昵称 / 当前 Toy 内的稳定假名标识（toyOpenId）
    return await withRetry(() => raw().getUserProfile());
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- 云存储存档
// 单 value 上限 1024 字节、单 Toy 最多 128 个 key，所以把整份存档序列化成
// 一个 JSON 再按片切开存；每片留足余量，key 只用字母数字（必须符合 SDK 的命名约束）。
const LS_KEY = 'bite-the-moon-save-v1';
const CHUNK = 900;
const MAX_PARTS = 8;

// 用 encodeURIComponent 把非 ASCII 转义掉，这样「字符数 ≈ 字节数」，
// 切片时不会切断多字节字符，也不用自己写 UTF-8 游标。
const toAscii = (s) => encodeURIComponent(s);
const fromAscii = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return '';
  }
};

async function cloudRead() {
  const all = await withRetry(() => raw().getCloudStorage());
  const n = Math.min(MAX_PARTS, parseInt(all.n || '0', 10) || 0);
  if (!n) return null;
  let acc = '';
  for (let i = 0; i < n; i++) acc += all['s' + i] || '';
  if (!acc) return null;
  return JSON.parse(fromAscii(acc));
}

async function cloudWrite(obj) {
  const ascii = toAscii(JSON.stringify(obj));
  const parts = [];
  for (let i = 0; i < ascii.length && parts.length < MAX_PARTS; i += CHUNK) {
    parts.push(ascii.slice(i, i + CHUNK));
  }
  const items = { n: String(parts.length) };
  parts.forEach((p, i) => {
    items['s' + i] = p;
  });
  await withRetry(() => raw().setCloudStorage(items));

  // 清掉上一份存档留下的多余分片，否则下次读取会把新旧数据接在一起
  const stale = [];
  for (let i = parts.length; i < MAX_PARTS; i++) stale.push('s' + i);
  if (stale.length) {
    try {
      await raw().removeCloudStorage(stale);
    } catch {
      /* 分片本来就不存在时会报错，忽略 */
    }
  }
}

// ---------------------------------------------------------------- 存档读写
let memCache = null; // 内存里的当前存档，避免每次改都去云端拉一遍
let pushTimer = null;

export async function loadSave() {
  if (memCache) return memCache;
  let cloud = null;
  if (await can('getCloudStorage')) {
    try {
      cloud = await cloudRead();
    } catch {
      cloud = null;
    }
  }
  if (cloud) {
    memCache = cloud;
  } else {
    try {
      memCache = JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {};
    } catch {
      memCache = {};
    }
  }
  return memCache;
}

// 合并写：本地立刻落地，云端延迟合并推送（符合官方「关键节点落盘、批量代替循环」的建议）
export async function patchSave(patch) {
  const cur = await loadSave();
  memCache = { ...cur, ...patch };
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(memCache));
  } catch {
    /* 隐私模式下可能写不了，不影响功能 */
  }
  schedulePush();
  return memCache;
}

function schedulePush() {
  if (!raw()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    if (!(await can('setCloudStorage'))) return;
    try {
      await cloudWrite(memCache || {});
    } catch {
      /* 未登录 / 限流 → 本地那份仍然有效，下次再推 */
    }
  }, 2500);
}

/** 页面隐藏或卸载时立刻把待推的存档送上去（不等回执） */
export function flushSave() {
  if (!raw() || !memCache) return;
  clearTimeout(pushTimer);
  can('setCloudStorage').then((ok) => {
    if (ok) cloudWrite(memCache).catch(() => {});
  });
}

// ---------------------------------------------------------------- 排行榜
export async function submitScore(board, score) {
  if (!(await can('submitScore'))) return null;
  try {
    return await withRetry(() => raw().submitScore({ board, score: Math.round(score) }));
  } catch {
    return null;
  }
}

export async function rankList(board = 1, period = 'all', limit = 50) {
  if (!(await can('getRankList'))) return null;
  try {
    return await withRetry(() => raw().getRankList({ board, period, limit }));
  } catch {
    return null;
  }
}

export async function myRank(board = 1, period = 'all') {
  if (!(await can('getMyRank'))) return null;
  try {
    return await withRetry(() => raw().getMyRank({ board, period }));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- 存图
/**
 * 保存团圆卡。App 内进系统相册，其余环境退化为浏览器下载。
 * @param {string} dataUrl 图片 data URL（png 或 jpeg）
 * @param {string} filename 降级下载时用的文件名
 * @param {string} hintMsg App 内申请相册权限时的提示文案
 */
export async function saveImage(dataUrl, filename, hintMsg) {
  if (await can('saveImageToAlbum')) {
    try {
      // 官方说明：可直接把 data URL 原样传入，不必先去掉前缀
      await withRetry(() => raw().saveImageToAlbum({ base64Data: dataUrl, hintMsg }));
      return { ok: true, where: 'album' };
    } catch (err) {
      return { ok: false, where: 'album', err };
    }
  }
  try {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return { ok: true, where: 'download' };
  } catch (err) {
    return { ok: false, where: 'download', err };
  }
}

// ---------------------------------------------------------------- 分享 / 二维码
export async function share(path) {
  if (await can('share')) {
    try {
      await raw().share({ path });
      return { ok: true, where: 'panel' };
    } catch {
      return { ok: false, where: 'panel' };
    }
  }
  // 降级：复制当前页地址（App 外没有分享面板）
  try {
    const text = location.href;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return { ok: true, where: 'copy' };
    }
  } catch {
    /* 剪贴板不可用 */
  }
  return { ok: false, where: 'none' };
}

export async function qrCode(opts = {}) {
  if (!(await can('getQrCode'))) return null;
  try {
    return await raw().getQrCode(opts);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- 容器
export function onContainer(listener) {
  const R = raw();
  if (!R || typeof R.onContainerChange !== 'function') return () => {};
  try {
    return R.onContainerChange(listener);
  } catch {
    return () => {};
  }
}

export async function containerState() {
  if (!(await can('getContainerState'))) return null;
  try {
    return await raw().getContainerState();
  } catch {
    return null;
  }
}

/**
 * 目标态切换。注意 SDK 的 Promise 只是「调用已返回」，不是成功回执，
 * 想确认是否生效必须配合 onContainerChange 监听，见 challenge 里的用法。
 */
export async function setContainerMode(mode) {
  if (!(await can('setContainerMode'))) return false;
  try {
    await raw().setContainerMode(mode);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- 跳转
export async function navigate(type, id, extra) {
  if (!(await can('navigate'))) return false;
  try {
    await raw().navigate({ type, id, extra });
    return true;
  } catch {
    return false;
  }
}
