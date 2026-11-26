'use client'

import { code } from '@streamdown/code'
import { defaultRehypePlugins, Streamdown } from 'streamdown'

const markdownPlugins = { code }
const safeMarkdown = [defaultRehypePlugins.sanitize]
const markdownControls = { code: { copy: true, download: false }, table: false }

function chatLink(url: string) {
  if (!/^https?:\/\//i.test(url)) return undefined
  try { return new URL(url).href } catch { return undefined }
}

export function AgentMarkdown({ reply, streaming }: { reply: string; streaming: boolean }) {
  return (
    <Streamdown
      className="min-w-0 flex flex-col gap-2 [&_h1]:text-base [&_h2]:text-base [&_h3]:text-sm [&_p]:whitespace-pre-wrap"
      plugins={markdownPlugins}
      rehypePlugins={safeMarkdown}
      disallowedElements={['img']}
      skipHtml
      urlTransform={chatLink}
      controls={markdownControls}
      lineNumbers={false}
      codeBlockMaxHeight={320}
      mode={streaming ? 'streaming' : 'static'}
      isAnimating={streaming}
    >{reply}</Streamdown>
  )
}
