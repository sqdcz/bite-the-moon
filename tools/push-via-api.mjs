// tools/push-via-api.mjs —— 走 GitHub HTTP API 推送当前 HEAD
//
// 什么时候需要它：有些网络环境下 `github.com:443` 连不上（git push 直接报
// "Connection was reset" 或 "Could not connect"），但 `api.github.com` 仍然通畅
// （gh 命令能正常用就是这个原因）。这时用 Git Data API 把本地提交推上去：
//
//   blobs（每个文件） → tree → commit → PATCH refs/heads/main
//
// 代价：这样生成的 commit SHA 与本地不同（Git 按内容重新计算，作者/时间一致），
// 所以推完要把本地对齐一下：
//
//   git fetch origin && git reset --hard origin/main
//
// 用法：GH_TOKEN=xxx node tools/push-via-api.mjs [分支名]

import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const TOKEN = process.env.GH_TOKEN;
if (!TOKEN) {
  console.error('缺少 GH_TOKEN 环境变量');
  process.exit(1);
}

const BRANCH = process.argv[2] || 'main';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const git = (args) => execSync(`git ${args}`, { cwd: ROOT, encoding: 'utf8' }).trim();

const remoteUrl = git('remote get-url origin');
const m = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
if (!m) {
  console.error('无法从 origin 解析出 owner/repo：', remoteUrl);
  process.exit(1);
}
const [, owner, repo] = m;
const API = 'https://api.github.com';

async function gh(endpoint, init = {}) {
  const res = await fetch(API + endpoint, {
    ...init,
    headers: {
      Authorization: `token ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'bite-the-moon-push',
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    throw new Error(`${init.method || 'GET'} ${endpoint} → ${res.status} ${await res.text()}`);
  }
  return res.json();
}

console.log(`仓库 ${owner}/${repo}，分支 ${BRANCH}`);

// ── 1. 远端的当前状态 ──
const ref = await gh(`/repos/${owner}/${repo}/git/refs/heads/${BRANCH}`);
const parentSha = ref.object.sha;
const parent = await gh(`/repos/${owner}/${repo}/git/commits/${parentSha}`);
console.log(`远端 HEAD ${parentSha.slice(0, 7)}`);

// ── 2. 本地 HEAD 改了哪些文件 ──
const files = git('show --name-only --pretty=format: HEAD')
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean);
const message = git('log -1 --pretty=%B');
const authorName = git('log -1 --pretty=%an');
const authorEmail = git('log -1 --pretty=%ae');
const authorDate = git('log -1 --pretty=%aI');

console.log(`本次要推送 ${files.length} 个文件：`);

// ── 3. 逐个建 blob ──
const tree = [];
for (const rel of files) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    // 提交里删掉的文件：tree 里给 null sha 即可
    tree.push({ path: rel.replace(/\\/g, '/'), mode: '100644', type: 'blob', sha: null });
    console.log(`  删除 ${rel}`);
    continue;
  }
  const content = fs.readFileSync(abs);
  const blob = await gh(`/repos/${owner}/${repo}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify({ content: content.toString('base64'), encoding: 'base64' }),
  });
  tree.push({ path: rel.replace(/\\/g, '/'), mode: '100644', type: 'blob', sha: blob.sha });
  console.log(`  ${rel}  ${blob.sha.slice(0, 7)}  ${(content.length / 1024).toFixed(1)}KB`);
}

// ── 4. 建 tree（基于远端的 tree，只覆盖改动的路径）──
const newTree = await gh(`/repos/${owner}/${repo}/git/trees`, {
  method: 'POST',
  body: JSON.stringify({ base_tree: parent.tree.sha, tree }),
});
console.log(`新 tree ${newTree.sha.slice(0, 7)}`);

// ── 5. 建 commit ──
const commit = await gh(`/repos/${owner}/${repo}/git/commits`, {
  method: 'POST',
  body: JSON.stringify({
    message,
    tree: newTree.sha,
    parents: [parentSha],
    author: { name: authorName, email: authorEmail, date: authorDate },
  }),
});
console.log(`新 commit ${commit.sha.slice(0, 7)}`);

// ── 6. 更新分支指针 ──
await gh(`/repos/${owner}/${repo}/git/refs/heads/${BRANCH}`, {
  method: 'PATCH',
  body: JSON.stringify({ sha: commit.sha, force: false }),
});

console.log(`\n推送完成：https://github.com/${owner}/${repo}/commit/${commit.sha}`);
console.log('本地 SHA 与远端不同是正常的（Git 按内容重算），执行下面这条对齐：');
console.log('  git fetch origin && git reset --hard origin/' + BRANCH);
