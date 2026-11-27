/** Typefaces the font picker offers: system stacks, then open-licensed web fonts loaded from Google Fonts. */

export type FontCategory = 'system' | 'sans' | 'serif' | 'mono' | 'display'

export interface FontOption {
  family: string
  category: FontCategory
  /** weights the family ships, as a Google Fonts axis range or list */
  weights?: string
  /** the CSS font-family value */
  stack: string
}

const fallback: Record<FontCategory, string> = {
  system: 'sans-serif',
  sans: 'ui-sans-serif, system-ui, sans-serif',
  serif: 'ui-serif, Georgia, serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  display: 'ui-sans-serif, system-ui, sans-serif',
}

const web = (family: string, category: Exclude<FontCategory, 'system'>, weights = '300..800'): FontOption => ({
  family, category, weights, stack: `"${family}", ${fallback[category]}`,
})

export const FONTS: FontOption[] = [
  { family: 'System sans', category: 'system', stack: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif' },
  { family: 'System serif', category: 'system', stack: 'ui-serif, Georgia, "Times New Roman", serif' },
  { family: 'System mono', category: 'system', stack: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
  web('Inter', 'sans', '100..900'),
  web('Geist', 'sans', '100..900'),
  web('DM Sans', 'sans', '100..1000'),
  web('Manrope', 'sans', '200..800'),
  web('Plus Jakarta Sans', 'sans', '200..800'),
  web('Outfit', 'sans', '100..900'),
  web('Work Sans', 'sans', '100..900'),
  web('IBM Plex Sans', 'sans', '100..700'),
  web('Space Grotesk', 'sans', '300..700'),
  web('Instrument Sans', 'sans', '400..700'),
  web('Fraunces', 'serif', '100..900'),
  web('Newsreader', 'serif', '200..800'),
  web('Instrument Serif', 'serif', '400'),
  web('Source Serif 4', 'serif', '200..900'),
  web('Playfair Display', 'serif', '400..900'),
  web('Lora', 'serif', '400..700'),
  web('JetBrains Mono', 'mono', '100..800'),
  web('Geist Mono', 'mono', '100..900'),
  web('IBM Plex Mono', 'mono', '100;200;300;400;500;600;700'),
  web('Space Mono', 'mono', '400;700'),
  web('DM Mono', 'mono', '300;400;500'),
  web('Fira Code', 'mono', '300..700'),
  web('Martian Mono', 'mono', '100..800'),
  web('Bricolage Grotesque', 'display', '200..800'),
  web('Syne', 'display', '400..800'),
  web('Unbounded', 'display', '200..900'),
]

export const FONT_CATEGORIES: { id: FontCategory; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'sans', label: 'Sans serif' },
  { id: 'serif', label: 'Serif' },
  { id: 'mono', label: 'Monospace' },
  { id: 'display', label: 'Display' },
]

/** The stylesheet that loads a web font, or undefined for system stacks. */
export function fontHref(font: FontOption): string | undefined {
  if (font.category === 'system' || !font.weights) return undefined
  const axis = font.weights.includes(';') || font.weights.includes('..') ? `:wght@${font.weights}` : font.weights === '400' ? '' : `:wght@${font.weights}`
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font.family).replace(/%20/g, '+')}${axis}&display=swap`
}

/** The picker entry that a computed font-family starts with. */
export function fontFromStack(stack: string): FontOption | undefined {
  const first = stack.split(',')[0]?.trim().replace(/^["']|["']$/g, '').toLowerCase()
  return FONTS.find((font) => font.family.toLowerCase() === first || font.stack.split(',')[0]!.trim().replace(/"/g, '').toLowerCase() === first)
}
