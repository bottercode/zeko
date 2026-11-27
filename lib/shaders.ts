/*
 * Shader layers: a <canvas data-zeko-shader="…"> element in a sketch, drawn by a small WebGL runtime that
 * travels inside the sketch (a <script id="zeko-shaders">), so the HTML stays self-contained wherever it goes.
 * The canvas is an ordinary element: it can be clipped, masked, rounded and blended with CSS like any layer.
 * Every shader layer also carries a CSS background that approximates it, shown where scripts do not run.
 */

export const SHADER_RUNTIME_ID = 'zeko-shaders'
export const SHADER_ATTR = 'data-zeko-shader'

export type ShaderPreset = 'mesh' | 'waves' | 'grain' | 'paper' | 'dots'

export interface ShaderParams {
  preset: ShaderPreset
  /** up to four CSS colors, including var(--token) */
  colors: string[]
  /** 0 keeps a still frame */
  speed: number
  /** pattern size, 0.25..4 */
  scale: number
  /** distortion or contrast, 0..1 */
  amount: number
  /** film grain, 0..1 */
  grain: number
  seed: number
}

export const SHADER_PRESETS: Record<ShaderPreset, { label: string; description: string; defaults: Omit<ShaderParams, 'preset'> }> = {
  mesh: {
    label: 'Mesh gradient',
    description: 'Four colors flowing into each other, with optional swirl and grain.',
    defaults: { colors: ['#ff8a5b', '#ffd36e', '#6f8cff', '#c56bff'], speed: 0.35, scale: 1, amount: 0.55, grain: 0.15, seed: 7 },
  },
  waves: {
    label: 'Liquid',
    description: 'Domain-warped noise that moves like ink in water.',
    defaults: { colors: ['#0f172a', '#2563eb', '#22d3ee', '#f0abfc'], speed: 0.25, scale: 1, amount: 0.6, grain: 0.08, seed: 3 },
  },
  grain: {
    label: 'Grain gradient',
    description: 'A soft two-tone gradient with film grain.',
    defaults: { colors: ['#f97316', '#7c3aed', '#fde68a', '#0ea5e9'], speed: 0.15, scale: 1, amount: 0.5, grain: 0.45, seed: 11 },
  },
  paper: {
    label: 'Paper texture',
    description: 'Paper with fibers and tooth, for warm, printed surfaces.',
    defaults: { colors: ['#f4efe4', '#d9cdb6', '#bfae8e', '#f4efe4'], speed: 0, scale: 1, amount: 0.5, grain: 0.5, seed: 5 },
  },
  dots: {
    label: 'Halftone dots',
    description: 'A dot grid whose dots grow and shrink across a gradient.',
    defaults: { colors: ['#0b0b0f', '#f5f5f5', '#a3e635', '#0b0b0f'], speed: 0.2, scale: 1, amount: 0.6, grain: 0, seed: 2 },
  },
}

export const isShaderPreset = (value: string): value is ShaderPreset => Object.hasOwn(SHADER_PRESETS, value)

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
const num = (value: string | null | undefined, fallback: number, min: number, max: number) => {
  const n = Number(value)
  return value != null && value !== '' && Number.isFinite(n) ? clamp(n, min, max) : fallback
}

export function readShaderParams(attrs: Record<string, string | null | undefined>): ShaderParams {
  const preset = isShaderPreset(attrs[SHADER_ATTR] ?? '') ? (attrs[SHADER_ATTR] as ShaderPreset) : 'mesh'
  const d = SHADER_PRESETS[preset].defaults
  const colors = (attrs['data-colors'] ?? '').split(';').map((c) => c.trim()).filter(Boolean).slice(0, 4)
  return {
    preset,
    colors: colors.length ? colors : d.colors,
    speed: num(attrs['data-speed'], d.speed, 0, 3),
    scale: num(attrs['data-scale'], d.scale, 0.25, 4),
    amount: num(attrs['data-amount'], d.amount, 0, 1),
    grain: num(attrs['data-grain'], d.grain, 0, 1),
    seed: num(attrs['data-seed'], d.seed, 0, 1000),
  }
}

/** Attribute values for a shader layer. Colors are joined with ";" because CSS colors contain spaces. */
export function shaderAttributes(params: ShaderParams): Record<string, string> {
  return {
    [SHADER_ATTR]: params.preset,
    'data-colors': params.colors.slice(0, 4).join(';'),
    'data-speed': String(params.speed),
    'data-scale': String(params.scale),
    'data-amount': String(params.amount),
    'data-grain': String(params.grain),
    'data-seed': String(params.seed),
  }
}

const safeColor = (color: string) => (/^[#\w\s(),.%/-]+$/.test(color) && !/url|expression/i.test(color) ? color : 'transparent')

/** A CSS-only stand-in, painted under the canvas and shown wherever WebGL or scripts are unavailable. */
export function shaderFallback(params: Pick<ShaderParams, 'preset' | 'colors'>): string {
  const c = [0, 1, 2, 3].map((i) => safeColor(params.colors[i % params.colors.length] ?? '#888'))
  switch (params.preset) {
    case 'mesh':
      return `radial-gradient(at 18% 22%, ${c[0]} 0, transparent 58%), radial-gradient(at 82% 18%, ${c[1]} 0, transparent 56%), radial-gradient(at 78% 84%, ${c[2]} 0, transparent 58%), radial-gradient(at 16% 82%, ${c[3]} 0, transparent 56%), ${c[0]}`
    case 'waves':
      return `radial-gradient(at 70% 30%, ${c[2]} 0, transparent 50%), linear-gradient(135deg, ${c[0]}, ${c[1]} 55%, ${c[3]})`
    case 'grain':
      return `linear-gradient(140deg, ${c[0]}, ${c[1]})`
    case 'paper':
      return c[0]
    case 'dots':
      return `radial-gradient(${c[1]} 28%, transparent 31%) 0 0 / 14px 14px, ${c[0]}`
  }
}

const escapeAttr = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/** The HTML for a new shader layer. */
export function shaderLayerHtml(params: ShaderParams, style = 'display:block;width:100%;height:320px'): string {
  const attrs = Object.entries(shaderAttributes(params)).map(([k, v]) => `${k}="${escapeAttr(v)}"`).join(' ')
  const css = `${style};background:${shaderFallback(params)}`
  return `<canvas ${attrs} aria-hidden="true" style="${escapeAttr(css)}"></canvas>`
}

const VERTEX = 'attribute vec2 p;varying vec2 v_uv;void main(){v_uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}'

const COMMON = `precision highp float;
uniform vec2 u_res;uniform float u_time,u_seed,u_scale,u_amount,u_grain;uniform vec3 u_c0,u_c1,u_c2,u_c3;varying vec2 v_uv;
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32+u_seed);return fract(p.x*p.y);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),u.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),u.x),u.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*noise(p);p=p*2.03+17.1;a*=.5;}return v;}
vec3 lin(vec3 c){return pow(c,vec3(2.2));}
vec3 gam(vec3 c){return pow(max(c,0.),vec3(1./2.2));}
vec3 grainy(vec3 c){return c+(hash(gl_FragCoord.xy+fract(u_time)*91.)-.5)*u_grain*.16;}
vec2 aspect(vec2 uv){return vec2(uv.x*u_res.x/max(u_res.y,1.),uv.y);}`

const FRAGMENTS: Record<ShaderPreset, string> = {
  mesh: `void main(){
  float t=u_time*.4;vec2 uv=aspect(v_uv)/u_scale;
  uv+=u_amount*.22*(vec2(fbm(uv*1.7+t*.6),fbm(uv*1.7-t*.5+4.1))-.5);
  float r=u_res.x/max(u_res.y,1.)/u_scale;
  vec2 p0=vec2(r*(.2+.12*sin(t*1.1+u_seed)),.22+.12*cos(t*.9+u_seed));
  vec2 p1=vec2(r*(.82+.1*cos(t*.8)),.2+.14*sin(t*1.2+1.));
  vec2 p2=vec2(r*(.78+.12*sin(t*.7+2.)),.82+.1*cos(t*1.05));
  vec2 p3=vec2(r*(.18+.1*cos(t*1.3+3.)),.8+.12*sin(t*.75+2.));
  float w0=1./(pow(distance(uv,p0),2.)+.02),w1=1./(pow(distance(uv,p1),2.)+.02),w2=1./(pow(distance(uv,p2),2.)+.02),w3=1./(pow(distance(uv,p3),2.)+.02);
  vec3 c=(lin(u_c0)*w0+lin(u_c1)*w1+lin(u_c2)*w2+lin(u_c3)*w3)/(w0+w1+w2+w3);
  gl_FragColor=vec4(grainy(gam(c)),1.);}`,
  waves: `void main(){
  float t=u_time*.3;vec2 p=aspect(v_uv)*2.2/u_scale;
  vec2 q=vec2(fbm(p+t),fbm(p+vec2(5.2,1.3)-t));
  vec2 s=vec2(fbm(p+(2.+u_amount*4.)*q+vec2(1.7,9.2)+t*.6),fbm(p+(2.+u_amount*4.)*q+vec2(8.3,2.8)-t*.4));
  float f=fbm(p+4.*s);
  vec3 c=mix(lin(u_c0),lin(u_c1),clamp(f*f*3.,0.,1.));
  c=mix(c,lin(u_c2),clamp(length(q)*.9,0.,1.));
  c=mix(c,lin(u_c3),clamp(s.x*s.x*1.4,0.,1.));
  gl_FragColor=vec4(grainy(gam(c)),1.);}`,
  grain: `void main(){
  float t=u_time*.25;vec2 uv=aspect(v_uv)/u_scale;
  float n=fbm(uv*1.6+vec2(t,-t*.7));
  float g=clamp(v_uv.x*.65+v_uv.y*.35+(n-.5)*(.4+u_amount*.8),0.,1.);
  vec3 c=mix(lin(u_c0),lin(u_c1),smoothstep(0.,1.,g));
  c=mix(c,lin(u_c2),smoothstep(.55,1.,n)*u_amount*.6);
  gl_FragColor=vec4(grainy(gam(c)),1.);}`,
  paper: `void main(){
  vec2 px=gl_FragCoord.xy/u_scale;
  float tooth=fbm(px*.08)*.6+fbm(px*.35)*.4;
  float fibers=fbm(vec2(px.x*.012,px.y*.18)+fbm(px*.02)*2.);
  float flecks=step(.985,hash(floor(px*.5)));
  vec3 c=lin(u_c0);
  c=mix(c,lin(u_c1),clamp((tooth-.45)*u_amount*1.6,0.,1.));
  c=mix(c,lin(u_c2),clamp((fibers-.55)*u_amount*2.2,0.,1.)*.6+flecks*.25);
  gl_FragColor=vec4(grainy(gam(c)),1.);}`,
  dots: `void main(){
  float t=u_time*.3;float cell=14.*u_scale;vec2 px=gl_FragCoord.xy;
  vec2 id=floor(px/cell);vec2 f=fract(px/cell)-.5;
  vec2 uv=id*cell/u_res;
  float v=clamp(fbm(aspect(uv)*2.+t)*1.2*(.6+u_amount*.8)-(1.-uv.y)*.25,0.,1.);
  float d=length(f);float radius=.08+v*.42;
  float m=1.-smoothstep(radius-.04,radius+.04,d);
  vec3 dot=mix(lin(u_c1),lin(u_c2),uv.x);
  vec3 c=mix(lin(u_c0),dot,m);
  gl_FragColor=vec4(grainy(gam(c)),1.);}`,
}

/** The runtime that draws every shader layer in a document. Plain browser JavaScript, no dependencies. */
export const SHADER_RUNTIME = String.raw`(() => {
  if (window.__zekoShaders) return
  window.__zekoShaders = 1
  const ATTR = '${SHADER_ATTR}'
  const VERT = ${JSON.stringify(VERTEX)}
  const COMMON = ${JSON.stringify(COMMON)}
  const FRAG = ${JSON.stringify(FRAGMENTS)}
  const DEFAULTS = ${JSON.stringify(Object.fromEntries(Object.entries(SHADER_PRESETS).map(([k, v]) => [k, v.defaults])))}
  const still = matchMedia('(prefers-reduced-motion: reduce)')
  const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  const items = new Map()
  const start = performance.now()
  let raf = 0

  const rgb = (el, value) => {
    let css = value
    if (/var\(/.test(css)) {
      const span = document.createElement('span')
      span.style.color = css
      span.style.display = 'none'
      ;(el.parentElement || document.body).appendChild(span)
      css = getComputedStyle(span).color
      span.remove()
    }
    probe.clearRect(0, 0, 1, 1)
    probe.fillStyle = '#000'
    probe.fillStyle = css
    probe.fillRect(0, 0, 1, 1)
    const d = probe.getImageData(0, 0, 1, 1).data
    return [d[0] / 255, d[1] / 255, d[2] / 255]
  }
  const num = (el, name, fallback, min, max) => {
    const v = el.getAttribute('data-' + name)
    const n = Number(v)
    return v !== null && v !== '' && isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
  }
  const params = (el) => {
    const preset = FRAG[el.getAttribute(ATTR)] ? el.getAttribute(ATTR) : 'mesh'
    const d = DEFAULTS[preset]
    let colors = (el.getAttribute('data-colors') || '').split(';').map((c) => c.trim()).filter(Boolean)
    if (!colors.length) colors = d.colors
    return {
      preset,
      colors: [0, 1, 2, 3].map((i) => rgb(el, colors[i % colors.length])),
      speed: num(el, 'speed', d.speed, 0, 3), scale: num(el, 'scale', d.scale, 0.25, 4),
      amount: num(el, 'amount', d.amount, 0, 1), grain: num(el, 'grain', d.grain, 0, 1), seed: num(el, 'seed', d.seed, 0, 1000),
    }
  }
  const compile = (gl, type, source) => {
    const s = gl.createShader(type)
    gl.shaderSource(s, source)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader')
    return s
  }
  const setup = (el) => {
    const old = items.get(el)
    const p = params(el)
    if (old && old.preset === p.preset) { old.p = p; return old }
    const gl = old ? old.gl : el.getContext('webgl', { preserveDrawingBuffer: true, antialias: false, premultipliedAlpha: false })
    if (!gl) return null
    try {
      const program = gl.createProgram()
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT))
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, COMMON + '\n' + FRAG[p.preset]))
      gl.linkProgram(program)
      gl.useProgram(program)
      const buf = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
      const loc = gl.getAttribLocation(program, 'p')
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
      const u = (name) => gl.getUniformLocation(program, name)
      const item = { gl, preset: p.preset, p, visible: true, u: {
        res: u('u_res'), time: u('u_time'), seed: u('u_seed'), scale: u('u_scale'), amount: u('u_amount'), grain: u('u_grain'),
        c: [u('u_c0'), u('u_c1'), u('u_c2'), u('u_c3')],
      } }
      items.set(el, item)
      visibility.observe(el)
      resize.observe(el)
      return item
    } catch (e) {
      return null
    }
  }
  const draw = (el, item, now) => {
    const { gl, p, u } = item
    const dpr = Math.min(2, devicePixelRatio || 1)
    const w = Math.max(1, Math.round(el.clientWidth * dpr)), h = Math.max(1, Math.round(el.clientHeight * dpr))
    if (el.width !== w || el.height !== h) { el.width = w; el.height = h }
    gl.viewport(0, 0, w, h)
    const animated = p.speed > 0 && !still.matches
    gl.uniform2f(u.res, w, h)
    gl.uniform1f(u.time, animated ? ((now - start) / 1000) * p.speed : p.seed * 0.37)
    gl.uniform1f(u.seed, p.seed)
    gl.uniform1f(u.scale, p.scale)
    gl.uniform1f(u.amount, p.amount)
    gl.uniform1f(u.grain, p.grain)
    p.colors.forEach((c, i) => gl.uniform3f(u.c[i], c[0], c[1], c[2]))
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    return animated
  }
  const tick = (now) => {
    raf = 0
    let again = false
    for (const [el, item] of items) {
      if (!el.isConnected) { items.delete(el); continue }
      if (!item.visible && item.drawn) continue
      again = draw(el, item, now) || again
      item.drawn = true
    }
    if (again) raf = requestAnimationFrame(tick)
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(tick) }
  const visibility = new IntersectionObserver((entries) => {
    for (const e of entries) { const item = items.get(e.target); if (item) item.visible = e.isIntersecting }
    schedule()
  })
  const resize = new ResizeObserver(schedule)
  const scan = () => {
    document.querySelectorAll('canvas[' + ATTR + ']').forEach((el) => setup(el))
    schedule()
  }
  new MutationObserver((records) => {
    let dirty = false
    for (const r of records) {
      if (r.type === 'attributes' && r.target.matches && r.target.matches('canvas[' + ATTR + ']')) { setup(r.target); dirty = true }
      if (r.type === 'childList' && [...r.addedNodes].some((n) => n.nodeType === 1 && (n.matches('canvas[' + ATTR + ']') || n.querySelector('canvas[' + ATTR + ']')))) dirty = true
    }
    if (dirty) scan()
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: [ATTR, 'data-colors', 'data-speed', 'data-scale', 'data-amount', 'data-grain', 'data-seed', 'style', 'class'] })
  still.addEventListener('change', schedule)
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', scan); else scan()
})()`

export const shaderRuntimeTag = () => `<script id="${SHADER_RUNTIME_ID}">${SHADER_RUNTIME}</script>`

/** Adds the shader runtime to a document that has shader layers and lacks it, or refreshes an older copy. */
export function withShaderRuntime(html: string): string {
  const existing = new RegExp(`<script id="${SHADER_RUNTIME_ID}">[\\s\\S]*?</script>`, 'i')
  // The runtime names the attribute itself, so look for layers in the rest of the document.
  const hasLayers = new RegExp(`<canvas\\b[^>]*\\s${SHADER_ATTR}\\s*=`, 'i').test(html.replace(existing, ''))
  if (!hasLayers) return html.replace(existing, '')
  const tag = shaderRuntimeTag()
  if (existing.test(html)) return html.replace(existing, () => tag)
  const end = html.toLowerCase().lastIndexOf('</body>')
  return end === -1 ? html + tag : html.slice(0, end) + tag + html.slice(end)
}
