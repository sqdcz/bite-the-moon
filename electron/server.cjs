// electron/server.cjs —— 本地静态文件服务器（只监听 127.0.0.1）
//
// 为什么要它：页面是 ES Module + importmap，file:// 协议下模块请求会被当成
// 跨源而拒绝，直接白屏。主进程起一个本机服务器就能绕开这个限制。
//
// 为什么单独成模块：Electron 的 GUI 在部分非交互式会话里起不来（没有桌面），
// 但"把页面正确服务出去"是打包后必须可靠的部分 —— 拆出来就能脱离 Electron
// 用 node 直接跑测试（见 server.test.mjs）。

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

/**
 * 起一个只监听 127.0.0.1 的静态服务器，端口由系统分配（避免撞车）。
 * @param {string} rootDir 站点根目录
 * @returns {Promise<{port:number,url:string,close:()=>Promise<void>}>}
 */
function createStaticServer(rootDir) {
  const root = path.resolve(rootDir);
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
      const abs = path.resolve(root, rel);
      // 目录穿越防护：只允许读站点根目录以内的文件
      if (abs !== root && !abs.startsWith(root + path.sep)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('forbidden');
        return;
      }
      fs.readFile(abs, (err, buf) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
          return;
        }
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'no-store',
        });
        res.end(buf);
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        port,
        url: `http://127.0.0.1:${port}/`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

module.exports = { createStaticServer, MIME };
