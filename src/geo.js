// geo.js —— 自动获取所在地
// 启动先静默走 IP 定位（不需要授权，不会弹窗），失败就用默认坐标
// 想要更精确，点界面上的「用我的位置」再走浏览器定位

export const DEFAULT_LOC = { lat: 39.687, lon: 122.968, city: '辽宁庄河' };

const SOURCES = [
  {
    url: 'https://ipapi.co/json/',
    parse: (d) =>
      d && d.latitude
        ? { lat: +d.latitude, lon: +d.longitude, city: d.city || d.region || '' }
        : null,
  },
  {
    url: 'https://get.geojs.io/v1/ip/geo.json',
    parse: (d) =>
      d && d.latitude
        ? { lat: +d.latitude, lon: +d.longitude, city: d.city || d.region || '' }
        : null,
  },
];

async function fetchJSON(url, timeout = 4500) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 依次尝试几个免费 IP 定位源
export async function detectByIP() {
  for (const s of SOURCES) {
    const data = await fetchJSON(s.url);
    const loc = data ? s.parse(data) : null;
    if (loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lon)) {
      return { ...loc, source: 'IP 自动定位' };
    }
  }
  return null;
}

// 浏览器精确定位（会弹授权，且只在 https / localhost 下可用）
export function requestPrecise() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          lat: p.coords.latitude,
          lon: p.coords.longitude,
          city: '',
          source: '浏览器定位',
        }),
      () => resolve(null),
      { timeout: 8000, maximumAge: 600000 }
    );
  });
}
