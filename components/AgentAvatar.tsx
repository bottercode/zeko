import Image, { type StaticImageData } from 'next/image'
import { agentColor } from '@/lib/client/useBoard'
import claudeLogo from '@/public/agents/claude.png'
import codexLogo from '@/public/agents/codex.png'
import cursorLogo from '@/public/agents/cursor.svg'

const PROVIDER_LOGOS = new Map<string, StaticImageData>([
  ['claude', claudeLogo],
  ['claude code', claudeLogo],
  ['codex', codexLogo],
  ['openai codex', codexLogo],
  ['cursor', cursorLogo],
])

export function AgentAvatar({ name, size = 24 }: { name: string; size?: number }) {
  const logo = PROVIDER_LOGOS.get(name.trim().toLowerCase())

  if (logo) {
    return <Image src={logo} alt="" width={size} height={size} loading="eager" unoptimized className="shrink-0 object-contain" />
  }

  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full text-[10px] font-semibold text-white"
      style={{ width: size, height: size, background: agentColor(name) }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  )
}
