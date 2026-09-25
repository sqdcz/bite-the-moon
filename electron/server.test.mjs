// electron/server.test.mjs —— 脱离 Electron 验证静态服务器
//
// 为什么要有它：Electron 的 GUI 在非交互式会话里起不来，但 exe 里真正
// 决定"能不能打开页面"的是这个服务器。所以把它拆出来单独测：
// 起服务 → 逐个请求打包后会依赖的文件 → 校验状态码与 MIME。
//
// 用法：node electron/server.test.mjs

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createStaticServer } = require('./server.cjs');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// 用 http.request 而不是 fetch。
// WHATWG URL 会在客户端就把 %2e%2e 规范化成 ..，再套用路径折叠，
// 真正的 ../ 请求根本发不出去 —— 那样测不到服务端的目录穿越防护。
function probe(port, rawPath) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: rawPath, method: 'GET' },
      (res) => {
        res.resume();
        resolve({ status: res.statusCode, ct: res.headers['content-type'] || '' });
      }
    );
    req.on('error', () => resolve({ status: -1, ct: '' }));
    req.end();
  });
}

const srv = await createStaticServer(ROOT);
console.log(`静态服务器已启动：${srv.url}\n`);

// [路径, 期望状态码, 期望 MIME 片段]
const checks = [
  ['/', 200, 'text/html'],
  ['/index.html', 200, 'text/html'],
  ['/styles.css', 200, 'text/css'],
  ['/src/main.js', 200, 'text/javascript'],
  ['/src/moon.js', 200, 'text/javascript'],
  ['/src/mooncake3d.js', 200, 'text/javascript'],
  ['/src/scene.js', 200, 'text/javascript'],
  ['/vendor/three/build/three.module.min.js', 200, 'text/javascript'],
  ['/vendor/three/addons/utils/BufferGeometryUtils.js', 200, 'text/javascript'],
  ['/vendor/three/addons/postprocessing/EffectComposer.js', 200, 'text/javascript'],
  ['/vendor/three/addons/postprocessing/UnrealBloomPass.js', 200, 'text/javascript'],
  ['/vendor/three/addons/postprocessing/OutputPass.js', 200, 'text/javascript'],
  ['/vendor/lunar.js', 200, 'text/javascript'],
  ['/vendor/fonts/cormorant-garamond-latin-400-normal.woff2', 200, 'font/woff2'],
  ['/assets/moon_1024.jpg', 200, 'image/jpeg'],
  ['/assets/mooncake_top.png', 200, 'image/png'],
  ['/build/icon.png', 200, 'image/png'],
  ['/missing-file.js', 404, null],
  // 中文路径必须走编码形式（浏览器也会自动编码），服务端 decodeURIComponent 后要能正确找到
  ['/%E4%B8%8D%E5%AD%98%E5%9C%A8%E7%9A%84%E6%96%87%E4%BB%B6.js', 404, null],
  // 目录穿越：编码过的 ../ 会被 decodeURIComponent 还原，必须被挡在 403
  ['/%2e%2e/%2e%2e/Windows/win.ini', 403, null],
  ['/src/%2e%2e/%2e%2e/package.json', 403, null],
];

let pass = 0;
const failures = [];
for (const [p, wantCode, wantType] of checks) {
  const { status, ct } = await probe(srv.port, p);
  const ok = status === wantCode && (!wantType || ct.includes(wantType));
  if (ok) pass++;
  else failures.push(`${p}  期望 ${wantCode}${wantType ? '/' + wantType : ''}，实际 ${status}/${ct}`);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${String(status).padEnd(4)} ${p}`);
}

await srv.close();

console.log('');
if (failures.length === 0) {
  console.log(`全部通过（${pass} 项）—— 页面所需资源都能被正确服务`);
  process.exit(0);
} else {
  console.log(`${failures.length} 项失败：`);
  failures.forEach((f) => console.log('  ' + f));
  process.exit(1);
}
