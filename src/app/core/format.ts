/**
 * Presentation helpers whose exact output the handoff specifies.
 *
 * The relative-time strings and the spine colour stops are copy and design tokens, not
 * implementation choices -- they are reproduced here verbatim and covered by tests so a
 * future refactor cannot quietly reword them.
 */

const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Exact strings from the handoff. Do not reword. */
export function relativeTime(modified: number, now: number = Date.now()): string {
  const seconds = Math.max(0, (now - modified) / 1000)

  if (seconds < 90) return 'Just now'
  if (seconds < HOUR) return `${Math.floor(seconds / MINUTE)}m ago`
  if (seconds < DAY) return `${Math.floor(seconds / HOUR)}h ago`

  const days = Math.floor(seconds / DAY)
  if (days < 2) return 'Yesterday'
  if (days < 30) return `${days} days ago`
  if (days < 365) return `${Math.floor(days / 30)} months ago`
  return 'Over a year ago'
}

/**
 * `2026-08-02 14:31`, in local time.
 *
 * The companion to `relativeTime`, not a replacement for it: "5m ago" is what you want to
 * know about a backup nine times out of ten, and the tenth is when you need to tell two
 * of them apart or match one against a file in Dropbox.
 *
 * Same fields, same order, same local clock as `cloud/backup.ts:backupFileName`, so a
 * status line and a file name can be compared at a glance. Hand-rolled rather than
 * `toLocaleString` for exactly that reason -- the format has to be pinned to the file
 * naming, not to whatever the device's locale would produce.
 */
export function absoluteTime(at: number): string {
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

type Stop = readonly [days: number, rgb: readonly [number, number, number]]

/**
 * Spine decay: a tile's accent bar fades with age, reaching transparent at 180 days.
 *
 * The handoff is explicit that there is no setting to disable this.
 */
const LIGHT_STOPS: readonly Stop[] = [
  [0, [0x25, 0x63, 0xeb]],
  [7, [0x4f, 0x78, 0xcf]],
  [30, [0x7c, 0x87, 0x94]],
  [60, [0xa8, 0xae, 0xb6]],
  [120, [0xd9, 0xdc, 0xe0]],
  [180, [0xf4, 0xf5, 0xf7]],
]

const OLED_STOPS: readonly Stop[] = [
  [0, [0x4d, 0x8d, 0xff]],
  [7, [0x3f, 0x6b, 0xb8]],
  [30, [0x5c, 0x63, 0x6c]],
  [60, [0x3c, 0x41, 0x49]],
  [120, [0x21, 0x24, 0x29]],
  [180, [0x00, 0x00, 0x00]],
]

/**
 * @param dark true for the OLED palette.
 * @returns a CSS colour, or `transparent` at 180 days and beyond.
 */
export function spineColor(modified: number, dark: boolean, now: number = Date.now()): string {
  const days = Math.max(0, (now - modified) / (DAY * 1000))
  if (days >= 180) return 'transparent'

  const stops = dark ? OLED_STOPS : LIGHT_STOPS

  for (let i = 0; i < stops.length - 1; i++) {
    const lower = stops[i]!
    const upper = stops[i + 1]!
    if (days > upper[0]) continue

    const span = upper[0] - lower[0]
    const t = span === 0 ? 0 : (days - lower[0]) / span
    const mix = (channel: 0 | 1 | 2) =>
      Math.round(lower[1][channel] + (upper[1][channel] - lower[1][channel]) * t)
    return `rgb(${mix(0)}, ${mix(1)}, ${mix(2)})`
  }

  return 'transparent'
}

/** `Name ×N` on tile previews; the multiplier is omitted at quantity 1. */
export function previewLine(name: string, qty: number): string {
  return qty > 1 ? `${name} ×${qty}` : name
}

/** Clipboard format for "Copy list as text". */
export function listAsText(name: string, entries: { name: string; qty: number }[]): string {
  return [name, ...entries.map((e) => `- ${previewLine(e.name, e.qty)}`)].join('\n')
}
