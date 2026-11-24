import { deckFront, emptyBoard } from './ops'
import type { Actor, Board, Frame } from './types'

/* The first board a new install opens on: a small pricing redesign for a
   made-up plant subscription, so every feature has something to act on. */

const you: Actor = { kind: 'human', name: 'You' }
export const SAMPLE_ID = 'fernway'

const base = `
  *{box-sizing:border-box;margin:0}
  body{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#1d2a22;background:#f6f4ee;-webkit-font-smoothing:antialiased}
  .nav{display:flex;align-items:center;justify-content:space-between;padding:22px 48px;border-bottom:1px solid #e4e0d4}
  .logo{font-weight:700;font-size:19px;letter-spacing:-.02em;color:#24533a}
  .links{display:flex;gap:28px;font-size:14px;color:#5b6b60}
  .btn{display:inline-block;padding:11px 18px;border-radius:10px;font-size:14px;font-weight:600;border:0}
  .btn-dark{background:#24533a;color:#fff}
  .btn-line{background:transparent;box-shadow:inset 0 0 0 1.5px #c9d3ca;color:#24533a}
`

const pricingCurrent = `<!doctype html><html><head><style>${base}
  main{padding:44px 48px}
  h1{font-size:30px;letter-spacing:-.02em}
  p.sub{color:#5b6b60;margin-top:6px;font-size:15px}
  .plans{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:26px}
  .plan{background:#fff;border:1px solid #e4e0d4;border-radius:8px;padding:16px}
  .plan h3{font-size:15px}.price{font-size:22px;font-weight:700;margin:8px 0}
  .plan ul{padding-left:16px;font-size:12px;color:#5b6b60;line-height:1.7}
  .plan .btn{margin-top:12px;width:100%;text-align:center;padding:8px}
  .note{margin-top:18px;font-size:11px;color:#8a978e}
</style></head><body>
<div class="nav"><div class="logo">fernway</div><div class="links"><span>Plants</span><span>Care guides</span><span>Pricing</span><span>Log in</span></div></div>
<main>
  <h1>Plans</h1><p class="sub">Pick a plan. Change or pause any time.</p>
  <div class="plans">
    <div class="plan"><h3>Sprout</h3><div class="price">$12/mo</div><ul><li>1 plant a month</li><li>Care card</li><li>Email support</li></ul><span class="btn btn-line">Choose</span></div>
    <div class="plan"><h3>Grove</h3><div class="price">$24/mo</div><ul><li>2 plants a month</li><li>Care cards</li><li>Pot included</li><li>Chat support</li></ul><span class="btn btn-dark">Choose</span></div>
    <div class="plan"><h3>Canopy</h3><div class="price">$39/mo</div><ul><li>3 plants a month</li><li>Rare picks</li><li>Pots included</li><li>Plant doctor</li></ul><span class="btn btn-line">Choose</span></div>
    <div class="plan"><h3>Studio</h3><div class="price">Custom</div><ul><li>Offices and cafés</li><li>Monthly visits</li></ul><span class="btn btn-line">Talk to us</span></div>
  </div>
  <p class="note">Annual billing saves 20%. Prices in USD. Shipping included in the contiguous US.</p>
</main></body></html>`

const pricingAiry = `<!doctype html><html><head><style>${base}
  main{padding:64px 48px;text-align:center}
  h1{font-size:44px;letter-spacing:-.035em;line-height:1.05}
  p.sub{color:#5b6b60;margin-top:12px;font-size:17px}
  .toggle{display:inline-flex;margin-top:26px;background:#ebe7dc;border-radius:999px;padding:4px;font-size:13px;font-weight:600}
  .toggle span{padding:8px 16px;border-radius:999px;color:#5b6b60}.toggle .on{background:#fff;color:#1d2a22;box-shadow:0 1px 2px rgba(0,0,0,.08)}
  .save{color:#2f7d4f}
  .plans{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin:40px auto 0;max-width:960px;text-align:left}
  .plan{background:#fff;border-radius:18px;padding:28px;box-shadow:0 0 0 1px #e4e0d4}
  .plan.pick{box-shadow:0 0 0 2px #24533a}
  .tag{display:inline-block;font-size:12px;font-weight:600;color:#24533a;background:#e3eee5;border-radius:999px;padding:4px 10px;margin-bottom:14px}
  .plan h3{font-size:18px}.price{font-size:36px;font-weight:700;letter-spacing:-.03em;margin:12px 0 2px}
  .per{font-size:13px;color:#8a978e}
  .plan ul{list-style:none;padding:0;margin-top:18px;font-size:14px;line-height:2;color:#3d4b42}
  .plan .btn{margin-top:20px;width:100%;text-align:center}
</style></head><body>
<div class="nav"><div class="logo">fernway</div><div class="links"><span>Plants</span><span>Care guides</span><span>Pricing</span><span>Log in</span></div></div>
<main>
  <h1>A greener home,<br>delivered monthly.</h1><p class="sub">Every plan ships free and pauses whenever you travel.</p>
  <div class="toggle"><span>Monthly</span><span class="on">Yearly <span class="save">save 20%</span></span></div>
  <div class="plans">
    <div class="plan"><h3>Sprout</h3><div class="price">$9.60</div><div class="per">a month, billed yearly</div><ul><li>One plant a month</li><li>Care card with every plant</li><li>Email support</li></ul><span class="btn btn-line">Start with Sprout</span></div>
    <div class="plan pick"><span class="tag">Most homes pick this</span><h3>Grove</h3><div class="price">$19.20</div><div class="per">a month, billed yearly</div><ul><li>Two plants a month</li><li>Ceramic pot included</li><li>Chat with a plant expert</li></ul><span class="btn btn-dark">Start with Grove</span></div>
    <div class="plan"><h3>Canopy</h3><div class="price">$31.20</div><div class="per">a month, billed yearly</div><ul><li>Three plants, rare picks</li><li>Pots included</li><li>Plant doctor video calls</li></ul><span class="btn btn-line">Start with Canopy</span></div>
  </div>
</main></body></html>`

const pricingCompare = `<!doctype html><html><head><style>${base}
  main{padding:52px 64px}
  h1{font-size:36px;letter-spacing:-.03em}
  p.sub{color:#5b6b60;margin-top:8px;font-size:16px}
  table{width:100%;border-collapse:collapse;margin-top:34px;font-size:14px}
  th,td{padding:14px 16px;text-align:left;border-bottom:1px solid #e4e0d4}
  th{font-size:13px;color:#5b6b60;font-weight:600}
  thead th{font-size:17px;color:#1d2a22}
  thead th small{display:block;font-size:13px;color:#8a978e;font-weight:500;margin-top:4px}
  .col-pick{background:#eef4ef}
  .yes{color:#2f7d4f;font-weight:700}.no{color:#b8c0ba}
  tfoot td{border:0;padding-top:20px}
</style></head><body>
<div class="nav"><div class="logo">fernway</div><div class="links"><span>Plants</span><span>Care guides</span><span>Pricing</span><span>Log in</span></div></div>
<main>
  <h1>Compare plans</h1><p class="sub">Yearly prices shown. Switch to monthly at checkout.</p>
  <table>
    <thead><tr><th></th><th>Sprout<small>$9.60 a month</small></th><th class="col-pick">Grove<small>$19.20 a month</small></th><th>Canopy<small>$31.20 a month</small></th></tr></thead>
    <tbody>
      <tr><th>Plants a month</th><td>1</td><td class="col-pick">2</td><td>3</td></tr>
      <tr><th>Care card</th><td class="yes">Yes</td><td class="col-pick yes">Yes</td><td class="yes">Yes</td></tr>
      <tr><th>Pot included</th><td class="no">No</td><td class="col-pick yes">Yes</td><td class="yes">Yes</td></tr>
      <tr><th>Rare picks</th><td class="no">No</td><td class="col-pick no">No</td><td class="yes">Yes</td></tr>
      <tr><th>Expert help</th><td>Email</td><td class="col-pick">Chat</td><td>Video calls</td></tr>
    </tbody>
    <tfoot><tr><td></td><td><span class="btn btn-line">Choose Sprout</span></td><td class="col-pick"><span class="btn btn-dark">Choose Grove</span></td><td><span class="btn btn-line">Choose Canopy</span></td></tr></tfoot>
  </table>
</main></body></html>`

const pricingEmpty = `<!doctype html><html><head><style>${base}
  main{display:grid;place-items:center;height:calc(100vh - 70px);text-align:center;padding:40px}
  .pot{width:72px;height:72px;border-radius:50%;background:#e3eee5;margin:0 auto 20px;display:grid;place-items:center;font-size:30px}
  h1{font-size:24px;letter-spacing:-.02em}
  p{color:#5b6b60;margin:10px auto 22px;max-width:380px;line-height:1.5}
</style></head><body>
<div class="nav"><div class="logo">fernway</div><div class="links"><span>Plants</span><span>Care guides</span><span>Pricing</span><span>Log in</span></div></div>
<main><div><div class="pot">🪴</div><h1>We don't ship to your area yet</h1><p>Plans aren't available for this ZIP code. Leave your email and we'll tell you the week we arrive.</p><span class="btn btn-dark">Notify me</span></div></main>
</body></html>`

const checkoutError = `<!doctype html><html><head><style>${base}
  main{display:grid;grid-template-columns:1.2fr .8fr;gap:40px;padding:44px 48px}
  h1{font-size:24px;letter-spacing:-.02em;margin-bottom:20px}
  label{display:block;font-size:13px;font-weight:600;margin:16px 0 6px}
  .field{height:44px;border-radius:10px;background:#fff;box-shadow:inset 0 0 0 1px #d6d2c6;padding:12px 14px;font-size:14px;color:#3d4b42}
  .field.bad{box-shadow:inset 0 0 0 1.5px #c2412d}
  .err{color:#c2412d;font-size:13px;margin-top:6px}
  .banner{background:#fbeae6;color:#8d2c1c;border-radius:10px;padding:12px 14px;font-size:14px;margin-bottom:8px}
  aside{background:#fff;border-radius:16px;padding:24px;box-shadow:0 0 0 1px #e4e0d4;align-self:start}
  .row{display:flex;justify-content:space-between;font-size:14px;padding:8px 0;color:#3d4b42}
  .total{border-top:1px solid #e4e0d4;margin-top:8px;padding-top:14px;font-weight:700;color:#1d2a22}
  .btn{margin-top:24px;width:100%;text-align:center}
</style></head><body>
<div class="nav"><div class="logo">fernway</div><div class="links"><span>Checkout</span></div></div>
<main>
  <section><h1>Payment</h1>
    <div class="banner">Your card was declined. Nothing was charged.</div>
    <label>Name on card</label><div class="field">Rae Okafor</div>
    <label>Card number</label><div class="field bad">•••• •••• •••• 4410</div><div class="err">Try another card, or ask your bank to allow this payment.</div>
    <span class="btn btn-dark">Try again</span>
  </section>
  <aside><div class="row"><span>Grove, yearly</span><span>$230.40</span></div><div class="row"><span>Shipping</span><span>Free</span></div><div class="row total"><span>Due today</span><span>$230.40</span></div></aside>
</main></body></html>`

const startHere = `<!doctype html><html><head><style>
  *{box-sizing:border-box;margin:0}
  body{font-family:ui-sans-serif,system-ui,sans-serif;background:#fffdf5;color:#26231c;padding:36px 38px;line-height:1.5}
  h1{font-size:24px;letter-spacing:-.02em;margin-bottom:6px}
  p{color:#5f5949;font-size:14px}
  ol{margin-top:18px;padding-left:20px;font-size:14px}
  li{margin-bottom:10px}
  b{font-weight:650}
  kbd{font-family:ui-monospace,monospace;font-size:12px;background:#f1ecdc;border-radius:5px;padding:1px 6px}
</style></head><body>
  <h1>Start here</h1>
  <p>This board is a pricing redesign for a made-up plant shop. Try each of these:</p>
  <ol>
    <li><b>Flip the deck.</b> The pricing frame on the right holds three variants. Select it and press <kbd>←</kbd> <kbd>→</kbd>, then <b>Keep</b> the one you like.</li>
    <li><b>Compare.</b> Shift-click two frames, then press <kbd>L</kbd> to open the loupe and drag the divider.</li>
    <li><b>Arrange as sheet.</b> Lines frames up by screen and state.</li>
    <li><b>Point it at your app.</b> Put your dev server's address in the top bar and add a live frame with <kbd>A</kbd>.</li>
    <li><b>Connect an agent.</b> Claude Code, Codex or Cursor can then read the board, sketch variants and take the requests you type in the Agents panel.</li>
  </ol>
</body></html>`

function frame(partial: Omit<Frame, 'createdBy' | 'createdAt' | 'updatedAt'>, at: number): Frame {
  return { ...partial, createdBy: you, createdAt: at, updatedAt: at }
}

function linkToCheckout(html: string) {
  return html.replace(
    /<span class="btn btn-dark">([^<]+)<\/span>/,
    '<button type="button" class="btn btn-dark" data-zeko-goto="checkout-error">$1</button>',
  )
}

const sampleUpdates = new Map(Object.entries({
  'pricing-v1': { original: pricingCurrent, next: linkToCheckout(pricingCurrent) },
  'pricing-v2': { original: pricingAiry, next: linkToCheckout(pricingAiry) },
  'pricing-v3': { original: pricingCompare, next: linkToCheckout(pricingCompare) },
  'checkout-error': {
    original: checkoutError,
    next: checkoutError.replace('<span>Checkout</span>', '<a href="#pricing" style="color:inherit" data-zeko-goto="back">Back to plans</a>'),
  },
  start: {
    original: startHere,
    next: startHere.replace(
      '    <li><b>Point it at your app.</b> Put your dev server\'s address in the top bar and add a live frame with <kbd>A</kbd>.</li>',
      '    <li><b>Try the prototype.</b> Click Play, choose Grove, then use Back to plans on the checkout screen.</li>',
    ),
  },
}))

/** Add the demo links to the original sample HTML while keeping user-edited screens and start choices. */
export function addSamplePrototype(board: Board): Board {
  if (!board.frames.some((f) => f.id === 'checkout-error' && f.kind === 'sketch')) return board
  let changed = false
  const frames = board.frames.map((f) => {
    const update = sampleUpdates.get(f.id)
    if (!update || f.kind !== 'sketch' || f.html !== update.original) return f
    changed = true
    return { ...f, html: update.next }
  })
  if (!changed) return board
  const updated = { ...board, frames }
  const pricing = deckFront(updated, 'pricing') ?? frames.find((f) => /^pricing-v[123]$/.test(f.id))
  if (!updated.flowStart && pricing?.html?.includes('data-zeko-goto="checkout-error"')) updated.flowStart = pricing.id
  return updated
}

export function seedBoard(): Board {
  const t = Date.now() - 60_000
  const board = emptyBoard()
  board.name = 'Fernway pricing'
  board.guidelines = `Fernway sells houseplants by monthly subscription. Calm, warm, unhurried.

Color
- Paper #f6f4ee (page), Ink #1f2a1f (text), Fern #2f5d3a (primary actions), Moss #e5ecdf (highlights)
- One primary button per screen. Never use red except for errors.

Type
- Headings: a soft serif, tight leading. Body: system sans, 15–16px, generous line height.

Voice
- Plain and friendly. Say what happens next ("Your first plant ships Monday"), no exclamation marks.

Decisions
- Prices are monthly and include delivery. Show the yearly saving as a percentage, not a total.`
  board.frames = [
    frame({ id: 'start', name: 'Start here', kind: 'sketch', x: -720, y: 0, w: 560, h: 520, html: startHere }, t),
    frame({ id: 'pricing-v1', name: 'Pricing', kind: 'sketch', x: 0, y: 0, w: 1280, h: 800, html: pricingCurrent, route: '/pricing', state: 'default', deckId: 'pricing' }, t + 1),
    frame({ id: 'pricing-v2', name: 'Pricing · v2', kind: 'sketch', x: 0, y: 0, w: 1280, h: 800, html: pricingAiry, route: '/pricing', state: 'default', deckId: 'pricing' }, t + 2),
    frame({ id: 'pricing-v3', name: 'Pricing · v3', kind: 'sketch', x: 0, y: 0, w: 1280, h: 800, html: pricingCompare, route: '/pricing', state: 'default', deckId: 'pricing' }, t + 3),
    frame({ id: 'pricing-empty', name: 'Pricing, no coverage', kind: 'sketch', x: 1440, y: 0, w: 1280, h: 800, html: pricingEmpty, route: '/pricing', state: 'empty' }, t + 4),
    frame({ id: 'checkout-error', name: 'Checkout, card declined', kind: 'sketch', x: 0, y: 1120, w: 1280, h: 800, html: checkoutError, route: '/checkout', state: 'error' }, t + 5),
  ]
  board.decks = { pricing: { front: 'pricing-v2' } }
  board.comments = [
    {
      id: 'c1',
      frameId: 'pricing-v1',
      x: 0.5,
      y: 0.62,
      author: you,
      text: 'Four plans in a row feels cramped, and the 20% annual saving is hidden in the footnote.',
      forAgents: true,
      resolved: false,
      replies: [],
      at: t + 6,
    },
  ]
  return addSamplePrototype(board)
}
