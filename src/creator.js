// creator.js —— 作者（UP 主）互动卡片
//
// 这是 Toy 生态里别处做不了的事：把玩 Toy 的人直接带到作者的视频上。
// 用到 getAuthorProfile / getAuthorRelation / getAuthorVideos /
// getVideoUserActions / navigate 五个能力，全部只读、不弹用户数据确认窗。
//
// 要展示哪些视频由 src/config.js 里的 FEATURED_VIDEOS 决定（填 bvid 或 aid）。

import * as toy from './toy.js';
import { FEATURED_VIDEOS, CREATOR_TAGLINE, SHOW_CREATOR_CARD } from './config.js';

const escapeHtml = (s) =>
  String(s == null ? '' : s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

function fmtCount(n) {
  const v = Number(n) || 0;
  if (v >= 10000) return (v / 10000).toFixed(1).replace(/\.0$/, '') + ' 万';
  if (v >= 1000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(v);
}

function fmtDuration(sec) {
  const s = Number(sec) || 0;
  if (!s) return '';
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** 取要推荐的视频及其互动状态 */
async function loadVideos() {
  if (!Array.isArray(FEATURED_VIDEOS) || !FEATURED_VIDEOS.length) return null;
  const res = await toy.authorVideos(FEATURED_VIDEOS);
  if (!res || res.status !== 'ok' || !Array.isArray(res.data)) return null;

  const aids = res.data.map((v) => Number(v.aid)).filter(Boolean);
  let acts = null;
  if (aids.length) {
    const r = await toy.videoActions(aids);
    if (r && Array.isArray(r.items)) acts = r.items;
  }
  return res.data.map((v) => {
    const act = acts ? acts.find((x) => Number(x.aid) === Number(v.aid)) : null;
    return { ...v, act: act && act.status === 'ok' ? act : null };
  });
}

function videoCard(v) {
  const act = v.act;
  const badges = [];
  if (act && act.liked) badges.push('<i class="vb on">赞</i>');
  if (act && Number(act.coinCount) > 0) badges.push('<i class="vb on">币</i>');
  if (act && act.favorited) badges.push('<i class="vb on">藏</i>');
  return `
    <button class="cv-item" data-bvid="${escapeHtml(v.bvid || '')}" data-aid="${escapeHtml(v.aid || '')}">
      <img class="cv-pic" src="${escapeHtml(v.pic || '')}" alt="" loading="lazy" referrerpolicy="no-referrer" />
      <span class="cv-dur">${fmtDuration(v.duration)}</span>
      <span class="cv-title">${escapeHtml(v.title || '视频')}</span>
      <span class="cv-stat">
        ${fmtCount(v.play ?? v.view ?? 0)} 播放${badges.length ? ' · ' + badges.join('') : ''}
      </span>
    </button>`;
}

/**
 * 渲染作者卡片。任何一步失败都只是把卡片藏起来，不报错、不影响其他功能。
 * @param {HTMLElement} root 容器
 */
export async function renderCreator(root) {
  if (!root) return;
  if (!SHOW_CREATOR_CARD) {
    root.hidden = true;
    return;
  }
  if (!(await toy.can('getAuthorProfile'))) {
    root.hidden = true;
    return;
  }

  const [ap, rel, videos] = await Promise.all([
    toy.authorProfile(),
    toy.authorRelation(),
    loadVideos(),
  ]);

  if (!ap || ap.status !== 'ok' || !ap.data) {
    root.hidden = true;
    return;
  }
  const a = ap.data;
  const following = rel && rel.status === 'ok' && rel.data && rel.data.isFollowing;
  const mid = a.mid ?? a.uid ?? null;

  root.innerHTML = `
    <div class="creator-head">
      <img class="creator-avatar" src="${escapeHtml(a.avatar || '')}" alt="" referrerpolicy="no-referrer" />
      <div class="creator-meta">
        <div class="creator-name">${escapeHtml(a.nickname || '作者')}</div>
        <div class="creator-stats">
          ${fmtCount(a.follower)} 粉丝 · ${fmtCount(a.videoCount ?? a.archive ?? 0)} 稿件
          ${rel && rel.status === 'ok' && rel.data && rel.data.hasFanMedal ? ' · 你有粉丝勋章' : ''}
        </div>
        ${CREATOR_TAGLINE ? `<div class="creator-tag">${escapeHtml(CREATOR_TAGLINE)}</div>` : ''}
      </div>
      ${mid ? `<button type="button" class="ghost creator-follow" data-mid="${escapeHtml(mid)}">${following ? '已关注' : '关注'}</button>` : ''}
    </div>
    ${videos && videos.length ? `<div class="creator-videos">${videos.map(videoCard).join('')}</div>` : ''}
  `;
  root.hidden = false;

  // 关注：SDK 没有"一键关注"，只能跳到作者空间让用户自己点
  const follow = root.querySelector('.creator-follow');
  if (follow) {
    follow.addEventListener('click', async () => {
      const ok = await toy.navigate('space', follow.dataset.mid);
      if (!ok) {
        follow.textContent = '请在 App 内关注';
        setTimeout(() => {
          follow.textContent = following ? '已关注' : '关注';
        }, 1800);
      }
    });
  }

  root.querySelectorAll('.cv-item').forEach((btn) => {
    btn.addEventListener('click', async () => {
      // bvid 优先；都没有就不跳
      const id = btn.dataset.bvid || btn.dataset.aid;
      if (!id) return;
      const ok = await toy.navigate('video', id);
      if (!ok) {
        // 本地/浏览器环境没有跳转能力，至少告诉用户去哪儿看
        window.open(`https://www.bilibili.com/video/${btn.dataset.bvid || ''}`, '_blank', 'noopener');
      }
    });
  });
}
