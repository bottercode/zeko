import { importSkill, SkillImportError } from '@/lib/server/skill-import'

export async function POST(request: Request) {
  if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    return Response.json({ error: 'Send the skill file URL as JSON.' }, { status: 415 })
  }
  const body = await request.json().catch(() => null) as { url?: unknown } | null
  if (typeof body?.url !== 'string') return Response.json({ error: 'Enter a skill file URL.' }, { status: 400 })
  try {
    return Response.json(await importSkill(body.url))
  } catch (error) {
    const message = error instanceof SkillImportError ? error.message : 'Zeko could not load that skill file. Check the link and try again.'
    return Response.json({ error: message }, { status: 422 })
  }
}
