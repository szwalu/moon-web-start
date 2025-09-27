// scripts/postbuild-copy.js
import fs from 'node:fs'
import path from 'node:path'

const pairs = [
  ['public/manifest.webmanifest', 'dist/manifest.webmanifest'],
  // 保险起见，把图标目录也一并确保存在（Vite 通常会复制，但这里稳一点）
  ['public/icons', 'dist/icons'],
]

for (const [srcRel, dstRel] of pairs) {
  const src = path.resolve(srcRel)
  const dst = path.resolve(dstRel)

  if (!fs.existsSync(src)) {
    console.warn(`⚠️  跳过：未找到 ${srcRel}`)
    continue
  }

  const stat = fs.statSync(src)
  if (stat.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true })
    // 简单递归拷贝
    for (const name of fs.readdirSync(src))
      fs.copyFileSync(path.join(src, name), path.join(dst, name))

    console.log(`✅  目录已复制：${srcRel} -> ${dstRel}`)
  }
  else {
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.copyFileSync(src, dst)
    console.log(`✅  文件已复制：${srcRel} -> ${dstRel}`)
  }
}
