import type { CanvasSkill } from './types'

export const SKILL_TITLE_LIMIT = 120
export const SKILL_DESCRIPTION_LIMIT = 1024
export const SKILL_TEXT_LIMIT = 24_000

export function skillSourceUrl(value: string): URL | undefined {
  try {
    if (value.length > 2048) return undefined
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined
    url.hash = ''
    return url
  } catch {
    return undefined
  }
}

export function readCanvasSkill(value: unknown): CanvasSkill | undefined {
  if (!value || typeof value !== 'object') return undefined
  const { id, title, description, text, sourceUrl } = value as Partial<CanvasSkill>
  if (typeof id !== 'string' || !/^[\w-]{1,40}$/.test(id) ||
      typeof title !== 'string' || typeof description !== 'string' || typeof text !== 'string') return undefined
  const name = title.trim().replace(/\s+/g, ' ')
  const summary = description.trim().replace(/\s+/g, ' ')
  const instructions = text.trim()
  if (!name || name.length > SKILL_TITLE_LIMIT ||
      summary.length > SKILL_DESCRIPTION_LIMIT || !instructions || instructions.length > SKILL_TEXT_LIMIT) return undefined
  const source = typeof sourceUrl === 'string' ? skillSourceUrl(sourceUrl)?.href : undefined
  return { id, title: name, description: summary, text: instructions, ...(source ? { sourceUrl: source } : {}) }
}

export function readCanvasSkills(value: unknown): CanvasSkill[] | undefined {
  if (!Array.isArray(value)) return undefined
  const skills = new Map<string, CanvasSkill>()
  for (const item of value) {
    const skill = readCanvasSkill(item)
    if (skill) skills.set(skill.id, skill)
  }
  return [...skills.values()]
}
