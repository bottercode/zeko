import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatHex, gamutOf, maxChroma, oklchToRgb, parseColor, toGamut } from '../lib/color'
import { componentBody, countInstances, replaceInstances, withRootAttribute } from '../lib/components'
import { documentToReact, htmlToJsx, styleObject } from '../lib/html-to-jsx'
import { SHADER_RUNTIME_ID, readShaderParams, shaderLayerHtml, withShaderRuntime } from '../lib/shaders'
import { applyOp, emptyBoard } from '../lib/ops'
import { frameCode, codeNotes } from '../lib/code'
import type { Actor } from '../lib/types'

const person: Actor = { kind: 'human', name: 'Designer' }

test('colors round-trip between hex, rgb and OKLCH', () => {
  const brand = parseColor('#3b82f6')!
  assert.equal(formatHex(brand), '#3b82f6')
  assert.equal(formatHex(parseColor('rgb(59, 130, 246)')!), '#3b82f6')
  assert.equal(formatHex(parseColor('oklch(62.3% 0.188 259.8)')!), formatHex(parseColor('oklch(0.623 0.188 259.8)')!))
  assert.equal(parseColor('rgba(0, 0, 0, 0)')!.a, 0)
  assert.equal(parseColor('transparent')!.a, 0)
  assert.equal(formatHex(parseColor('White')!), '#ffffff')
  assert.equal(parseColor('not a color'), null)
  assert.equal(parseColor('currentColor'), null)
})

test('wide-gamut colors are recognized and brought into sRGB by lowering chroma', () => {
  const vivid = parseColor('color(display-p3 1 0 0)')!
  assert.equal(gamutOf(vivid), 'p3')
  const mapped = toGamut(vivid, 'srgb')
  assert.equal(gamutOf(mapped), 'srgb')
  assert.ok(Math.abs(mapped.l - vivid.l) < 1e-9 && mapped.c < vivid.c)
  assert.ok(maxChroma(0.7, 30, 'p3') > maxChroma(0.7, 30, 'srgb'))
  assert.ok(oklchToRgb(mapped, 'srgb').every((v) => v >= -1e-4 && v <= 1 + 1e-4))
})

test('instances are found by attribute, nested markup and all, and replaced in place', () => {
  const html = '<body><div data-zeko-instance="card"><div><p>Old</p></div></div><p>between</p><div data-zeko-instance="card">x</div><div data-zeko-instance="other">y</div><script>"<div data-zeko-instance=\\"card\\">"</script></body>'
  assert.equal(countInstances(html, 'card'), 2)
  const next = replaceInstances(html, 'card', '<div data-zeko-instance="card">New</div>')
  assert.equal(countInstances(next, 'card'), 2)
  assert.ok(!next.includes('Old'))
  assert.ok(next.includes('<div data-zeko-instance="other">y</div>'))
  assert.ok(next.includes('<script>'))
})

test('a component body comes from the first element of its main document', () => {
  const doc = '<!doctype html><meta charset="utf-8"><style>body{margin:0}</style><body><button class="b" data-zeko-instance="old">Go</button></body>'
  assert.equal(componentBody(doc, 'btn'), '<button class="b" data-zeko-instance="btn">Go</button>')
  assert.equal(withRootAttribute('<img src="a.png">', 'data-zeko-instance', 'pic'), '<img src="a.png" data-zeko-instance="pic">')
})

test('editing a main component updates every instance across sketches', () => {
  let board = emptyBoard()
  const body = '<button data-zeko-instance="btn" style="color:red">Buy</button>'
  board = applyOp(board, { type: 'component.save', component: { id: 'btn', name: 'Button', tag: 'button', body, html: `<body>${body}</body>`, w: 160, h: 120 } }, person)
  const frame = (id: string, html: string, componentId?: string) => ({ type: 'frame.create' as const, frame: { id, kind: 'sketch' as const, name: id, html, x: 0, y: 0, w: 400, h: 300, componentId } })
  board = applyOp(board, frame('main', `<body>${body}</body>`, 'btn'), person)
  board = applyOp(board, frame('a', `<body><h1>Shop</h1>${body}</body>`), person)
  board = applyOp(board, frame('b', `<body>${body}<footer>${body}</footer></body>`), person)
  board = applyOp(board, { type: 'frame.update', id: 'main', patch: { html: '<body><button data-zeko-instance="btn" style="color:blue">Buy now</button></body>' } }, person)
  const html = (id: string) => board.frames.find((f) => f.id === id)!.html!
  assert.ok(html('a').includes('Buy now') && html('a').includes('<h1>Shop</h1>'))
  assert.equal(countInstances(html('b'), 'btn'), 2)
  assert.ok(!html('b').includes('color:red'))
  assert.ok(board.components![0]!.body!.includes('Buy now'))
  // Every instance change is a version, so it can be undone.
  assert.ok(board.frames.find((f) => f.id === 'a')!.versions!.length >= 1)

  board = applyOp(board, { type: 'component.update', id: 'btn', body: '<button>Checkout</button>', name: 'Primary button' }, person)
  assert.ok(html('a').includes('<button data-zeko-instance="btn">Checkout</button>'))
  assert.ok(html('main').includes('Checkout'))
  assert.equal(board.frames.find((f) => f.id === 'main')!.name, 'Primary button')
})

test('sketches with shader layers carry the shader runtime, and lose it when the last layer goes', () => {
  const layer = shaderLayerHtml({ ...readShaderParams({ 'data-zeko-shader': 'mesh' }) })
  const html = `<!doctype html><html><body>${layer}</body></html>`
  const withRuntime = withShaderRuntime(html)
  assert.ok(withRuntime.includes(`<script id="${SHADER_RUNTIME_ID}">`))
  assert.equal(withShaderRuntime(withRuntime), withRuntime)
  assert.ok(withRuntime.indexOf(SHADER_RUNTIME_ID) < withRuntime.indexOf('</body>'))
  assert.ok(!withShaderRuntime(withRuntime.replace(layer, '')).includes(SHADER_RUNTIME_ID))
  assert.match(layer, /style="[^"]*background:radial-gradient/)
  const params = readShaderParams({ 'data-zeko-shader': 'paper', 'data-colors': 'oklch(95% 0.02 80);var(--ink)', 'data-speed': '9' })
  assert.deepEqual(params.colors, ['oklch(95% 0.02 80)', 'var(--ink)'])
  assert.equal(params.speed, 3)
})

test('HTML becomes valid JSX', () => {
  assert.equal(
    htmlToJsx('<label for="e" class="f">Email {x}</label><input type="email" value="a" disabled><br><svg viewBox="0 0 2 2" stroke-width="2"><path fill-rule="evenodd" d="M0 0"/></svg><!-- note -->'),
    '<label htmlFor="e" className="f">Email {\'{\'}x{\'}\'}</label><input type="email" defaultValue="a" disabled /><br /><svg viewBox="0 0 2 2" strokeWidth="2"><path fillRule="evenodd" d="M0 0" /></svg>{/* note */}',
  )
  assert.equal(styleObject('color: red; --brand: #fff; -webkit-mask-image: url("a;b.png"); margin-top:4px'), '{{ color: "red", "--brand": "#fff", WebkitMaskImage: "url(\\"a;b.png\\")", marginTop: "4px" }}')
  assert.equal(htmlToJsx('<button onclick="go()" style="padding: 8px">Go</button>'), '<button style={{ padding: "8px" }}>Go</button>')
  const component = documentToReact('<!doctype html><html><head><style>.a{color:red}</style></head><body style="margin:0"><div class="a">Hi</div><script>alert(1)</script></body></html>', 'checkout page')
  assert.match(component, /^export default function CheckoutPage\(\) \{/)
  assert.ok(component.includes('<style>{".a{color:red}"}</style>'))
  assert.ok(component.includes('<div style={{ margin: "0" }}>'))
  assert.ok(!component.includes('alert'))
})

test('frame code defines the canvas tokens and lists what the design relies on', () => {
  const design = { themeId: 'default', themes: [{ id: 'default', name: 'Default' }], tokens: [{ name: 'brand', kind: 'color' as const, values: { default: '#f00' } }] }
  const html = '<html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"></head><body><p style="color:var(--brand)">Hi</p><img src="data:image/webp;base64,AAA"></body></html>'
  assert.ok(frameCode(html, 'Home', design, 'html').includes('<style>:root{--brand:#f00}</style>'))
  assert.equal(frameCode(html, 'Home', design, 'tokens'), ':root {\n  --brand:#f00;\n}\n')
  const notes = codeNotes(html)
  assert.deepEqual(notes.tokens, ['brand'])
  assert.equal(notes.embeddedImages, 1)
  assert.equal(notes.fonts.length, 1)
})

test('the bridge script injected into sketches parses, shader runtime and all', async () => {
  const { withBridge } = await import('../lib/client/bridge')
  const html = withBridge('<html><body><p>Hi</p></body></html>')
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]!)
  assert.ok(scripts.length >= 1)
  for (const source of scripts) assert.doesNotThrow(() => new Function(source))
})
