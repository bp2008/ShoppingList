import { describe, expect, it } from 'vitest'
import { listAsText, previewLine, relativeTime, spineColor } from './format'

const NOW = Date.UTC(2026, 7, 2, 12, 0, 0)
const ago = (ms: number) => NOW - ms
const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN
const DAY = 24 * HOUR

describe('relativeTime', () => {
  it('matches the handoff strings at every boundary', () => {
    expect(relativeTime(ago(0), NOW)).toBe('Just now')
    expect(relativeTime(ago(89 * SEC), NOW)).toBe('Just now')
    expect(relativeTime(ago(90 * SEC), NOW)).toBe('1m ago')
    expect(relativeTime(ago(59 * MIN), NOW)).toBe('59m ago')
    expect(relativeTime(ago(60 * MIN), NOW)).toBe('1h ago')
    expect(relativeTime(ago(23 * HOUR), NOW)).toBe('23h ago')
    expect(relativeTime(ago(24 * HOUR), NOW)).toBe('Yesterday')
    expect(relativeTime(ago(47 * HOUR), NOW)).toBe('Yesterday')
    expect(relativeTime(ago(2 * DAY), NOW)).toBe('2 days ago')
    expect(relativeTime(ago(29 * DAY), NOW)).toBe('29 days ago')
    expect(relativeTime(ago(30 * DAY), NOW)).toBe('1 months ago')
    expect(relativeTime(ago(364 * DAY), NOW)).toBe('12 months ago')
    expect(relativeTime(ago(365 * DAY), NOW)).toBe('Over a year ago')
  })

  it('does not produce negative ages for clock skew', () => {
    expect(relativeTime(NOW + 10 * DAY, NOW)).toBe('Just now')
  })
})

describe('spineColor', () => {
  it('starts at the accent colour', () => {
    expect(spineColor(NOW, false, NOW)).toBe('rgb(37, 99, 235)')
    expect(spineColor(NOW, true, NOW)).toBe('rgb(77, 141, 255)')
  })

  it('interpolates linearly between stops', () => {
    // Halfway from day 0 #2563eb (37,99,235) to day 7 #4f78cf (79,120,207).
    expect(spineColor(ago(3.5 * DAY), false, NOW)).toBe('rgb(58, 110, 221)')
  })

  it('lands exactly on a defined stop', () => {
    expect(spineColor(ago(30 * DAY), false, NOW)).toBe('rgb(124, 135, 148)')
    expect(spineColor(ago(120 * DAY), true, NOW)).toBe('rgb(33, 36, 41)')
  })

  it('is transparent from 180 days onward', () => {
    expect(spineColor(ago(180 * DAY), false, NOW)).toBe('transparent')
    expect(spineColor(ago(2000 * DAY), true, NOW)).toBe('transparent')
  })
})

describe('text output', () => {
  it('omits the multiplier at quantity 1', () => {
    expect(previewLine('Milk', 1)).toBe('Milk')
    expect(previewLine('Milk', 3)).toBe('Milk ×3')
  })

  it('formats a list for the clipboard', () => {
    expect(
      listAsText('Groceries', [
        { name: 'Milk', qty: 2 },
        { name: 'Eggs', qty: 1 },
      ]),
    ).toBe('Groceries\n- Milk ×2\n- Eggs')
  })
})
