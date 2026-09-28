// config.js —— 作者（UP 主）自定义配置，填你自己的东西
//
// 改这个文件不会影响运行时逻辑，只是决定作者卡片上展示什么。
// 改完记得重新打一次 ZIP：python tools/build-toy-zip.py

/**
 * 作者卡片上推荐的视频。填 bvid 或 aid 都行（每项只填一个字段）。
 * 留空的话，卡片只显示作者资料，不列视频。
 *
 * 例：
 *   export const FEATURED_VIDEOS = [
 *     { bvid: 'BV1xx411c7mD' },
 *     { bvid: 'BV1Hh411S7Ys' },
 *   ];
 */
export const FEATURED_VIDEOS = [];

/** 作者卡片上的一句话简介（留空则只显示昵称与粉丝数） */
export const CREATOR_TAGLINE = '';

/** 是否显示作者卡片（关掉就完全不请求作者的公开资料） */
export const SHOW_CREATOR_CARD = true;
