/*
 * Launcher icon generation.
 *
 * The design handoff bans image assets -- every in-app icon is composed from divs. PWA
 * launcher icons are the one unavoidable exception, because they are operating-system
 * assets rendered outside the page. Rather than commit opaque binaries, they are drawn
 * here from a handful of numbers and emitted at build time.
 *
 * Written against node:zlib only; a PNG is a signature plus three chunks, which is less
 * code than adding an image dependency would be.
 *
 * Run standalone to preview:  node scripts/icons.mjs <outDir>
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/* ------------------------------------------------------------------ PNG encoding */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typed))
  return Buffer.concat([length, typed, crc])
}

function encodePng(size, rgba) {
  const stride = size * 4 + 1
  const raw = Buffer.alloc(stride * size)
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0 // filter type: none
    rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  ihdr[10] = 0 // deflate
  ihdr[11] = 0 // adaptive filtering
  ihdr[12] = 0 // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* ---------------------------------------------------------------------- drawing */

const ACCENT = [0x25, 0x63, 0xeb] // --accent, light theme
const MARK = [0xff, 0xff, 0xff]

function inRoundedRect(px, py, x, y, w, h, r) {
  const cx = Math.min(Math.max(px, x + r), x + w - r)
  const cy = Math.min(Math.max(py, y + r), y + h - r)
  const dx = px - cx
  const dy = py - cy
  return dx * dx + dy * dy <= r * r
}

/**
 * Three stacked bars of decreasing width -- the same list motif the app's own div-drawn
 * icons use.
 *
 * `maskable` variants are full-bleed and draw the mark smaller, because Android crops an
 * adaptive icon to an arbitrary shape and only the centre ~80% is guaranteed visible.
 */
function render(size, { maskable }) {
  const SS = 3 // supersampling factor per axis
  const samples = SS * SS
  const rgba = Buffer.alloc(size * size * 4)

  const radius = size * 0.22
  const markW = size * (maskable ? 0.44 : 0.54)
  const barH = markW * 0.145
  const gap = markW * 0.12
  const markH = barH * 3 + gap * 2
  const markX = (size - markW) / 2
  const markY = (size - markH) / 2
  const widths = [markW, markW * 0.76, markW * 0.52]

  const insideBackground = (px, py) =>
    maskable ? true : inRoundedRect(px, py, 0, 0, size, size, radius)

  const insideMark = (px, py) => {
    for (let i = 0; i < 3; i++) {
      const y = markY + i * (barH + gap)
      if (inRoundedRect(px, py, markX, y, widths[i], barH, barH / 2)) return true
    }
    return false
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0
      let mark = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS
          const py = y + (sy + 0.5) / SS
          if (insideBackground(px, py)) bg++
          if (insideMark(px, py)) mark++
        }
      }
      const alpha = bg / samples
      const m = mark / samples
      const o = (y * size + x) * 4
      // The mark sits entirely within the background, so a straight lerp is correct for
      // non-premultiplied RGBA.
      rgba[o] = Math.round(ACCENT[0] * (1 - m) + MARK[0] * m)
      rgba[o + 1] = Math.round(ACCENT[1] * (1 - m) + MARK[1] * m)
      rgba[o + 2] = Math.round(ACCENT[2] * (1 - m) + MARK[2] * m)
      rgba[o + 3] = Math.round(alpha * 255)
    }
  }

  return encodePng(size, rgba)
}

/* ----------------------------------------------------------------------- output */

export function generateIcons(outDir) {
  mkdirSync(outDir, { recursive: true })
  const files = [
    ['icon-192.png', render(192, { maskable: false })],
    ['icon-512.png', render(512, { maskable: false })],
    ['maskable-512.png', render(512, { maskable: true })],
  ]
  for (const [name, buf] of files) writeFileSync(join(outDir, name), buf)
  return files.map(([name]) => name)
}

// pathToFileURL, not string concatenation: Windows paths produce file:///C:/... and a
// hand-rolled comparison silently never matches.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = process.argv[2] || 'icons'
  console.log(generateIcons(out).join('\n'))
}
