import fs from 'node:fs'
import path from 'node:path'
import { PNG } from 'pngjs'

const projectRoot = process.cwd()
const rawDir = path.join(projectRoot, 'src/assets/generated/raw')
const outDir = path.join(projectRoot, 'src/assets/generated')

const manifest = [
  {
    input: 'wheel-main.raw.png',
    output: 'wheel-main.png',
    chroma: '#00ff00',
    keepCanvas: true,
  },
  {
    input: 'wheel-pointer.raw.png',
    output: 'wheel-pointer.png',
    chroma: '#00ff00',
  },
  {
    input: 'arcade-stage-bg.raw.png',
    output: 'arcade-stage-bg.png',
    chroma: null,
    keepCanvas: true,
  },
  {
    input: 'common-badge.raw.png',
    output: 'common-badge.png',
    chroma: '#00ff00',
  },
  {
    input: 'excellent-badge.raw.png',
    output: 'excellent-badge.png',
    chroma: '#00ff00',
  },
  {
    input: 'rare-badge.raw.png',
    output: 'rare-badge.png',
    chroma: '#ff00ff',
  },
  {
    input: 'epic-badge.raw.png',
    output: 'epic-badge.png',
    chroma: '#00ff00',
  },
  {
    input: 'mythic-badge.raw.png',
    output: 'mythic-badge.png',
    chroma: '#00ff00',
  },
  {
    input: 'limited-badge.raw.png',
    output: 'limited-badge.png',
    chroma: '#00ff00',
  },
  {
    input: 'eternal-badge.raw.png',
    output: 'eternal-badge.png',
    chroma: '#00ff00',
  },
  {
    input: 'supreme-badge.raw.png',
    output: 'supreme-badge.png',
    chroma: '#ff00ff',
  },
  {
    input: 'mystery-prize-icon.raw.png',
    output: 'mystery-prize-icon.png',
    chroma: '#00ff00',
  },
  {
    input: 'reroll-icon.raw.png',
    output: 'reroll-icon.png',
    chroma: '#00ff00',
  },
  {
    input: 'sticker-star.raw.png',
    output: 'sticker-star.png',
    chroma: '#00ff00',
  },
  {
    input: 'celebration-modal-bg.raw.png',
    output: 'celebration-modal-bg.png',
    chroma: null,
    keepCanvas: true,
  },
  {
    input: 'supreme-stage-bg.raw.png',
    output: 'supreme-stage-bg.png',
    chroma: null,
    keepCanvas: true,
  },
]

const hexToRgb = (hex) => {
  const normalized = hex.replace('#', '')
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  }
}

const distanceToColor = (pixel, color) => {
  const dr = pixel.r - color.r
  const dg = pixel.g - color.g
  const db = pixel.b - color.b
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

const trimTransparentBounds = (png) => {
  let minX = png.width
  let minY = png.height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const alpha = png.data[(png.width * y + x) * 4 + 3]
      if (alpha > 16) {
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
  }

  if (maxX === -1) {
    return null
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  }
}

const cropWithPadding = (png, bounds, keepCanvas = false) => {
  if (keepCanvas) {
    return png
  }

  const maxDimension = Math.max(bounds.width, bounds.height)
  const padding = Math.max(16, Math.round(maxDimension * 0.12))
  const outWidth = bounds.width + padding * 2
  const outHeight = bounds.height + padding * 2
  const nextPng = new PNG({ width: outWidth, height: outHeight })

  for (let y = 0; y < bounds.height; y += 1) {
    for (let x = 0; x < bounds.width; x += 1) {
      const srcIndex = ((bounds.minY + y) * png.width + (bounds.minX + x)) * 4
      const destIndex = ((padding + y) * outWidth + (padding + x)) * 4
      nextPng.data[destIndex] = png.data[srcIndex]
      nextPng.data[destIndex + 1] = png.data[srcIndex + 1]
      nextPng.data[destIndex + 2] = png.data[srcIndex + 2]
      nextPng.data[destIndex + 3] = png.data[srcIndex + 3]
    }
  }

  return nextPng
}

const removeChromaKey = (png, chromaHex) => {
  if (!chromaHex) {
    return png
  }

  const chroma = hexToRgb(chromaHex)
  const transparentThreshold = 42
  const opaqueThreshold = 150

  for (let index = 0; index < png.data.length; index += 4) {
    const pixel = {
      r: png.data[index],
      g: png.data[index + 1],
      b: png.data[index + 2],
    }
    const distance = distanceToColor(pixel, chroma)

    if (distance <= transparentThreshold) {
      png.data[index + 3] = 0
      continue
    }

    if (distance < opaqueThreshold) {
      const alphaScale =
        (distance - transparentThreshold) / (opaqueThreshold - transparentThreshold)
      png.data[index + 3] = Math.round(255 * Math.max(0, Math.min(1, alphaScale)))
    }

    const isChromaDominant =
      chromaHex === '#00ff00'
        ? pixel.g > 140 && pixel.g > pixel.r + 24 && pixel.g > pixel.b + 24
        : pixel.r > 140 && pixel.b > 140 && pixel.g < pixel.r - 20

    if (isChromaDominant && png.data[index + 3] < 220) {
      png.data[index + 3] = Math.round(png.data[index + 3] * 0.2)
    }
  }

  return png
}

fs.mkdirSync(outDir, { recursive: true })

for (const item of manifest) {
  const inputPath = path.join(rawDir, item.input)
  const outputPath = path.join(outDir, item.output)

  if (!fs.existsSync(inputPath)) {
    console.warn(`skip missing asset: ${item.input}`)
    continue
  }

  const png = PNG.sync.read(fs.readFileSync(inputPath))
  removeChromaKey(png, item.chroma)

  const trimmedBounds = trimTransparentBounds(png)
  const finalPng =
    trimmedBounds === null ? png : cropWithPadding(png, trimmedBounds, item.keepCanvas)

  fs.writeFileSync(outputPath, PNG.sync.write(finalPng))
  console.log(`processed ${item.output}`)
}
