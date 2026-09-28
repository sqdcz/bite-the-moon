#!/usr/bin/env python3
"""把「咬一口月亮」打包成可上传 B站 Toy 的 ZIP。

要点：
  · ZIP 内的路径分隔符必须是正斜杠 —— Windows 上有些工具（含 7z 的部分用法）
    会写成反斜杠，解压到 Linux/服务端时整个包会废掉，所以这里统一转换。
  · 只收网页运行真正需要的文件，开发脚本、Electron 外壳、node_modules 都不进包。
  · index.html 必须位于压缩包根目录（Toy 的入口约定）。

用法：python tools/build-toy-zip.py
"""

import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INCLUDE = ["index.html", "styles.css", "README.md", "src", "vendor", "assets"]
OUT = os.path.join(ROOT, "dist", "bite-the-moon-toy.zip")

SKIP_NAMES = {".DS_Store", "Thumbs.db", "desktop.ini"}
SKIP_DIRS = {"__pycache__", ".git", "node_modules"}


def iter_files():
    for item in INCLUDE:
        path = os.path.join(ROOT, item)
        if os.path.isfile(path):
            yield path, item
        elif os.path.isdir(path):
            for dirpath, dirnames, filenames in os.walk(path):
                dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
                for name in filenames:
                    if name in SKIP_NAMES:
                        continue
                    full = os.path.join(dirpath, name)
                    yield full, os.path.relpath(full, ROOT)


def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    count = 0
    total = 0
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for full, rel in iter_files():
            arc = rel.replace(os.sep, "/")  # ZIP 规范：一律正斜杠
            z.write(full, arc)
            count += 1
            total += os.path.getsize(full)

    size = os.path.getsize(OUT)
    print(f"打包完成：{os.path.relpath(OUT, ROOT)}")
    print(f"  文件数 {count}，原始 {total / 1048576:.2f} MB，压缩后 {size / 1048576:.2f} MB")

    with zipfile.ZipFile(OUT) as z:
        names = z.namelist()
        bad = [n for n in names if "\\" in n]
        if bad:
            print(f"  !! 有 {len(bad)} 个条目用了反斜杠，会影响跨平台解压")
        if "index.html" not in names:
            print("  !! 根目录缺少 index.html，Toy 无法识别入口")
        else:
            print("  根目录 index.html 就位")


if __name__ == "__main__":
    main()
