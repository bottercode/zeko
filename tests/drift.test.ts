import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compareLayouts, driftRequest, openDrift, type DriftElement, type DriftPage } from '../lib/drift'

const el = (path: string, props: Partial<DriftElement>): DriftElement => ({
  path, tag: 'p', text: '', x: 0, y: 0, w: 100, h: 20, color: 'rgb(17, 17, 17)', background: 'rgba(0, 0, 0, 0)',
  borderColor: 'rgb(17, 17, 17)', borderWidth: 0, radius: 0, fontFamily: 'system-ui, sans-serif', fontSize: 16, fontWeight: 400, surface: false, ...props,
})
const page = (elements: DriftElement[]): DriftPage => ({ width: 1000, height: 800, elements })

/** Three plan cards; options change one thing at a time. */
function pricing(o: { gap?: number; priceSize?: number; border?: string; note?: boolean; lead?: string; banner?: number } = {}) {
  const gap = o.gap ?? 24
  const elements = [el('0', { tag: 'h1', text: 'Simple pricing', y: 40, h: 50, fontSize: 44, fontWeight: 700 }), el('1', { text: o.lead ?? 'Start free, upgrade when your team grows.', y: 100 })]
  ;['Starter', 'Pro', 'Team'].forEach((plan, i) => {
    const x = i * (300 + gap)
    elements.push(el(`2.${i}`, { tag: 'div', surface: true, x, y: 160, w: 300, h: 240, background: 'rgb(255, 255, 255)', borderWidth: i === 1 ? 2 : 1, borderColor: i === 1 ? (o.border ?? 'rgb(79, 70, 229)') : 'rgb(229, 229, 229)', radius: 16 }))
    elements.push(el(`2.${i}.0`, { tag: 'h2', text: plan, x: x + 28, y: 188, fontSize: 20, fontWeight: 600 }))
    elements.push(el(`2.${i}.1`, { text: ['$0', '$29', '$99'][i]!, x: x + 28, y: 220, h: 48, fontSize: o.priceSize ?? 40, fontWeight: o.priceSize ? 700 : 600 }))
    elements.push(el(`2.${i}.2`, { tag: 'button', text: 'Choose', x: x + 28, y: 288, w: 244, h: 44 }))
    if (i === 1 && o.note !== false) elements.push(el('2.1.3', { text: 'Cancel anytime', x: x + 100, y: 344, fontSize: 13 }))
  })
  if (o.banner !== undefined) elements.push(el('3', { text: 'We use cookies', y: o.banner, pinned: true }))
  return page(elements)
}
const tokens = { brand: 'rgb(79, 70, 229)' }

test('an identical build has no drift, even with a window-pinned banner placed differently', () => {
  const { items, matched } = compareLayouts(pricing({ banner: 700 }), pricing({ banner: 3000 }), { tokens })
  assert.deepEqual(items, [])
  assert.ok(matched >= 14)
})

test('each planted difference is reported once, with the change to make', () => {
  const build = pricing({ gap: 16, priceSize: 36, border: 'rgb(59, 130, 246)', note: false, lead: 'Start for free and upgrade as your team grows.' })
  const { items } = compareLayouts(pricing(), build, { tokens })
  const kinds = items.map((item) => item.kind)
  assert.deepEqual(kinds, ['missing', 'text', 'spacing', 'type', 'token'])
  const [missing, copy, spacing, type, token] = items
  assert.match(missing!.fix, /Add “Cancel anytime”/)
  assert.equal(copy!.design, 'Start free, upgrade when your team grows.')
  assert.equal(spacing!.design, '24px')
  assert.equal(spacing!.build, '16px')
  assert.match(spacing!.fix, /in 2 places/)
  assert.match(type!.label, /“\$0”, “\$29” and 1 more|“\$0”, “\$99” and 1 more/)
  assert.equal(type!.design, 'system-ui 600 40px')
  assert.equal(token!.design, 'var(--brand)')
  assert.match(token!.fix, /--brand design token/)
  for (const item of items) assert.ok(item.x >= 0 && item.x <= 1 && item.y >= 0 && item.y <= 1)
})

test('accepted differences stay accepted when the same build is checked again', () => {
  const build = pricing({ priceSize: 36 })
  const first = compareLayouts(pricing(), build).items
  const again = compareLayouts(pricing(), build).items
  assert.deepEqual(first.map((i) => i.key), again.map((i) => i.key))
  assert.deepEqual(openDrift(again, [first[0]!.key]), again.slice(1))
})

test('a drift request lists every open difference and asks for a re-check', () => {
  const { items } = compareLayouts(pricing(), pricing({ note: false, gap: 16 }))
  const request = driftRequest({ id: 'd1', name: 'Pricing' }, { id: 'b1', name: 'Pricing (build)', buildUrl: 'http://localhost:3000/pricing' }, items)
  assert.match(request, /differs from the approved design in 2 places/)
  assert.match(request, /1\. Missing “Cancel anytime”/)
  assert.match(request, /check_drift with build_frame_id b1/)
})
