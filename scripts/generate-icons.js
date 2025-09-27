// scripts/generate-icons.js
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const inputFile = path.resolve('public/logo.jpg') // 原始 logo 路径
const outputDir = path.resolve('public/icons')

if (!fs.existsSync(outputDir))
  fs.mkdirSync(outputDir, { recursive: true })

async function generateIcons() {
  const sizes = [
    { name: 'pwa-192.png', size: 192 },
    { name: 'pwa-512.png', size: 512 },
    { name: 'maskable-512.png', size: 512 },
    { name: 'apple-touch-icon-180.png', size: 180 },
  ]

  for (const { name, size } of sizes) {
    const outPath = path.join(outputDir, name)
    console.log(`生成 ${outPath} ...`)
    await sharp(inputFile)
      .resize(size, size, {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 0 }, // 背景透明
      })
      .toFile(outPath)
  }

  console.log('✅ 所有图标已生成到 public/icons/')
}

generateIcons().catch((err) => {
  console.error(err)
  process.exit(1)
})
