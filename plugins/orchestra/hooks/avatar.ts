// Drawings of the pane: each agent's pixel avatar, the context gauge and the
// band's progress bar, as SVG for the remote surfaces and as cells for the
// terminal's Raster.

// A little Claude, 8 by 6 pixels: '#' its body, 'o' an eye, '.' nothing.
// Running, it steps between the two frames; ended, it stands on the first.
const SPRITES = [
  ['........', '.######.', '.#o##o#.', '########', '.######.', '.#.##.#.'],
  ['.######.', '.#o##o#.', '########', '.######.', '.#.##.#.', '#.#..#.#'],
]
export const AVATAR_COLUMNS = 8
export const AVATAR_ROWS = SPRITES[0]!.length / 2
export const FRAME_COUNT = SPRITES.length

// Eight body colours, Claude's own first, that read on light and dark themes.
export const HUES = ['#d97757', '#3b82f6', '#16a34a', '#a855f7', '#eab308', '#ec4899', '#14b8a6', '#6366f1']
const EYE = '#1c1917'
// A failed agent's avatar is grey.
const FAILED_BODY = '#78716c'

export const hueColor = (hue: number): string => HUES[((hue % HUES.length) + HUES.length) % HUES.length]!
export const bodyColor = (hue: number, isFailed: boolean): string => (isFailed ? FAILED_BODY : hueColor(hue))

const pixelColor = (ch: string | undefined, body: string): string | undefined =>
  ch === '#' ? body : ch === 'o' ? EYE : undefined

// Every pixel row as runs of one colour, so the SVG holds a rect per run.
function runs(sprite: string[], body: string): { x: number; y: number; w: number; color: string }[] {
  const found: { x: number; y: number; w: number; color: string }[] = []
  sprite.forEach((line, y) => {
    let x = 0
    while (x < line.length) {
      const color = pixelColor(line[x], body)
      let w = 1
      while (x + w < line.length && pixelColor(line[x + w], body) === color) w += 1
      if (color !== undefined) found.push({ x, y, w, color })
      x += w
    }
  })
  return found
}

export function avatarSvg(frame: number, body: string): string {
  const sprite = SPRITES[frame % FRAME_COUNT]!
  const rects = runs(sprite, body)
    .map(run => `<rect x="${run.x}" y="${run.y}" width="${run.w}" height="1" fill="${run.color}"/>`)
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${AVATAR_COLUMNS} ${sprite.length}" shape-rendering="crispEdges">${rects}</svg>`
}

// The terminal draws two pixel rows per cell: '▀' in the top pixel's colour
// over the bottom one's, '▄' when only the bottom one is drawn.
const DEFAULT_COLOR = 0x01000000
const UPPER_HALF = 0x2580
const LOWER_HALF = 0x2584
const rgb = (hex: string): number => Number.parseInt(hex.slice(1), 16)

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function base64(bytes: Uint8Array): string {
  let text = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    text += BASE64[a >> 2]
    text += BASE64[((a & 3) << 4) | ((b ?? 0) >> 4)]
    text += b === undefined ? '=' : BASE64[((b & 15) << 2) | ((c ?? 0) >> 6)]
    text += c === undefined ? '=' : BASE64[c & 63]
  }
  return text
}

// The Raster's cells: [code point, foreground, background] per cell, each a
// little-endian u32.
export function avatarCells(frame: number, body: string): string {
  const sprite = SPRITES[frame % FRAME_COUNT]!
  const words: number[] = []
  for (let y = 0; y < sprite.length; y += 2) {
    for (let x = 0; x < AVATAR_COLUMNS; x += 1) {
      const top = pixelColor(sprite[y]?.[x], body)
      const bottom = pixelColor(sprite[y + 1]?.[x], body)
      if (top === undefined && bottom === undefined) words.push(0x20, DEFAULT_COLOR, DEFAULT_COLOR)
      else if (top === undefined) words.push(LOWER_HALF, rgb(bottom ?? EYE), DEFAULT_COLOR)
      else words.push(UPPER_HALF, rgb(top), bottom === undefined ? DEFAULT_COLOR : rgb(bottom))
    }
  }
  const bytes = new Uint8Array(words.length * 4)
  words.forEach((word, i) => {
    bytes[i * 4] = word & 0xff
    bytes[i * 4 + 1] = (word >>> 8) & 0xff
    bytes[i * 4 + 2] = (word >>> 16) & 0xff
    bytes[i * 4 + 3] = (word >>> 24) & 0xff
  })
  return base64(bytes)
}

// A rounded bar, its fill in `color` over a grey track.
export function barSvg(fraction: number, color: string, width: number, height: number): string {
  const filled = Math.max(0, Math.min(1, fraction)) * width
  const r = height / 2
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" rx="${r}" fill="#8883"/>` +
    (filled > 0 ? `<rect width="${Math.max(height, filled).toFixed(1)}" height="${height}" rx="${r}" fill="${color}"/>` : '') +
    '</svg>'
  )
}

// The band's progress bar: Claude's orange, light at the start, deep at the head.
const PROGRESS_START = '#f5b89f'
const PROGRESS_HEAD = '#c2410c'

// The terminal's bar: one colour per filled cell along the same gradient.
export function progressColors(filled: number): string[] {
  const from = rgb(PROGRESS_START)
  const to = rgb(PROGRESS_HEAD)
  const channel = (value: number, shift: number): number => (value >> shift) & 0xff
  return Array.from({ length: filled }, (_, i) => {
    const t = filled <= 1 ? 1 : i / (filled - 1)
    const mixed = [16, 8, 0].map(shift => Math.round(channel(from, shift) + (channel(to, shift) - channel(from, shift)) * t))
    return `#${mixed.map(value => value.toString(16).padStart(2, '0')).join('')}`
  })
}

export function progressSvg(fraction: number, width: number, height: number): string {
  const filled = Math.max(0, Math.min(1, fraction)) * width
  const r = height / 2
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">` +
    `<defs><linearGradient id="p" x1="0" x2="1"><stop offset="0" stop-color="${PROGRESS_START}"/><stop offset="1" stop-color="${PROGRESS_HEAD}"/></linearGradient></defs>` +
    `<rect width="${width}" height="${height}" rx="${r}" fill="#8883"/>` +
    (filled > 0 ? `<rect width="${Math.max(height, filled).toFixed(1)}" height="${height}" rx="${r}" fill="url(#p)"/>` : '') +
    '</svg>'
  )
}
