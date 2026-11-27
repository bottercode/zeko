'use client'

import { deckMembers, frameSourceUrl } from '@/lib/ops'
import { newId } from '@/lib/client/useBoard'
import type { DriftReport, Frame } from '@/lib/types'
import { acpAgent, type AcpSelection } from '@/lib/acp'
import { driftRequest, openDrift } from '@/lib/drift'
import { withDesignTokens } from '@/lib/tokens'
import { copyToClipboard, frameCode, type CodeFormat } from '@/lib/client/copy-code'
import { useStudio } from './studio-context'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const fileName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'frame'

function download(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

/** What a person can do to frames, shared by the keyboard, the context menu and the panel. */
export function useFrameActions() {
  const { boardId, board, dispatch, select, toast, openLoupe, flyTo, setInteractId } = useStudio()

  const exportFrame = async (frame: Frame, format: 'png' | 'pdf', scale?: number) => {
    toast(`Rendering ${frame.name}…`)
    const query = new URLSearchParams({ board: boardId })
    if (scale) query.set('scale', String(scale))
    try {
      const res = await fetch(`/api/frames/${encodeURIComponent(frame.id)}/${format}?${query}`)
      if (!res.ok) {
        const msg = ((await res.json().catch(() => null)) as { error?: string } | null)?.error
        throw new Error(msg ?? 'Couldn’t render that frame.')
      }
      const name = `${fileName(frame.name)}${scale ? `@${scale}x` : ''}.${format}`
      download(await res.blob(), name)
      toast(`Exported ${name}`)
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Couldn’t render that frame.')
    }
  }

  /** Hands a request to the agent people used last, the way the request box does. */
  const askAgent = (text: string, frameIds: string[], chatId: string) => {
    const last = [...board.tasks].reverse().find((task) => task.acp)
    const acp: AcpSelection = last?.acp ?? { agent: 'codex', settings: {} }
    const agent = acpAgent(acp.agent)
    dispatch({ type: 'task.add', id: newId(), text, frameIds, chatId, assignee: agent?.name, acp })
    toast(`Sent to ${agent?.name ?? 'your agent'}. Follow along in Agents`)
  }

  return {
    variant(frame: Frame) {
      const id = newId()
      dispatch({ type: 'frame.variant', id: frame.id, newId: id })
      select([id])
      toast(frame.deckId ? 'Variant added to the deck' : 'Made a deck with a new variant')
    },
    duplicate(frame: Frame) {
      const id = newId()
      const { createdAt: _a, createdBy: _b, updatedAt: _c, deckId: _d, approved: _e, reference: _f, sheetRoute: _g, ...rest } = frame
      dispatch({ type: 'frame.create', frame: { ...rest, id, name: `${frame.name} copy`, x: frame.x + frame.w + 96 } })
      select([id])
      toast('Duplicated')
    },
    keep(frame: Frame) {
      if (!frame.deckId) return
      const others = deckMembers(board, frame.deckId).length - 1
      dispatch({ type: 'deck.keep', frameId: frame.id })
      toast(`Kept “${frame.name}”, removed ${plural(others, 'other variant')}`)
    },
    remove(ids: string[]) {
      if (!ids.length) return
      dispatch({ type: 'batch', ops: ids.map((id) => ({ type: 'frame.delete' as const, id })) })
      select([])
      toast(`Deleted ${plural(ids.length, 'frame')}. ⌘Z brings ${ids.length === 1 ? 'it' : 'them'} back`)
    },
    compare(frame: Frame) {
      openLoupe([frame.id])
    },
    zoomTo(frame: Frame) {
      flyTo(frame)
    },
    /** Work inside a frame: edit a sketch's elements, or use a live page. */
    use(frame: Frame) {
      select([frame.id])
      setInteractId(frame.id)
    },
    openInTab(frame: Frame) {
      const src = frameSourceUrl(frame, board.appUrl)
      if (src) window.open(src, '_blank', 'noopener')
    },
    exportPng(frame: Frame, scale = 2) {
      return exportFrame(frame, 'png', scale)
    },
    exportPdf(frame: Frame) {
      return exportFrame(frame, 'pdf')
    },
    exportHtml(frame: Frame) {
      if (frame.html === undefined) return
      download(new Blob([withDesignTokens(frame.html, board.design)], { type: 'text/html' }), `${fileName(frame.name)}.html`)
      toast(`Exported ${fileName(frame.name)}.html`)
    },
    async copyCode(frame: Frame, format: CodeFormat) {
      if (frame.html === undefined) return
      const code = frameCode(frame.html, frame.name, board.design, format)
      if (!code) return toast(format === 'tokens' ? 'This canvas has no tokens yet.' : 'Nothing to copy.')
      try {
        await copyToClipboard(code)
        toast(format === 'react' ? 'Copied as a React component' : format === 'tokens' ? 'Copied tokens as CSS variables' : 'Copied HTML')
      } catch {
        toast('Couldn’t reach the clipboard. Use Export HTML instead.')
      }
    },
    /** Turns a website frame into an editable sketch beside it: the page as rendered, with its styles written inline. */
    async snapshot(frame: Frame) {
      const url = frameSourceUrl(frame, board.appUrl)
      if (!url) return
      toast(`Capturing ${frame.name}…`)
      try {
        const res = await fetch(`/api/snapshot?board=${encodeURIComponent(boardId)}`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url, width: frame.w, height: frame.h }),
        })
        const data = (await res.json().catch(() => ({}))) as { html?: string; title?: string; height?: number; error?: string }
        if (!res.ok || !data.html) throw new Error(data.error ?? 'Couldn’t capture that page.')
        const id = newId()
        dispatch({ type: 'frame.create', frame: {
          id, pageId: frame.pageId, kind: 'sketch', name: `${data.title || frame.name} (snapshot)`, html: data.html,
          x: frame.x + frame.w + 96, y: frame.y, w: frame.w, h: Math.max(frame.h, Math.min(8000, data.height ?? frame.h)),
        } })
        select([id])
        toast('Snapshot ready: every layer is editable')
      } catch (error) {
        toast(error instanceof Error ? error.message : 'Couldn’t capture that page.')
      }
    },
    restoreVersion(frame: Frame, at: number) {
      dispatch({ type: 'frame.restoreVersion', id: frame.id, at })
      toast('Earlier version restored. ⌘Z undoes it')
    },
    /** Captures the page that implements a design and checks it for drift; with a build, captures that build again. */
    async checkBuild(input: { design?: Frame; build?: Frame; url?: string }) {
      const target = input.build ?? input.design
      if (!target) return null
      toast(input.build ? `Checking ${input.build.name}…` : 'Capturing the build…')
      try {
        const res = await fetch(`/api/drift?board=${encodeURIComponent(boardId)}`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ designId: input.design?.id, buildId: input.build?.id, url: input.url }),
        })
        const data = (await res.json().catch(() => ({}))) as { buildId?: string; drift?: DriftReport; error?: string }
        if (!res.ok || !data.buildId || !data.drift) throw new Error(data.error ?? 'Couldn’t check that build.')
        const accepted = board.frames.find((f) => f.id === data.buildId)?.driftAccepted
        const open = openDrift(data.drift.items, accepted).length
        if (!input.build) select([data.buildId])
        toast(open ? `${plural(open, 'difference')} from the design` : data.drift.matched < 3 ? 'Few elements matched: is this the right page?' : 'The build matches the design')
        return data.buildId
      } catch (error) {
        toast(error instanceof Error ? error.message : 'Couldn’t check that build.')
        return null
      }
    },
    /** Asks the agent to implement an approved design in the codebase and close the loop with a drift check. */
    buildIt(design: Frame) {
      const route = design.route ? ` (route ${design.route})` : ''
      askAgent([
        `Implement the design frame “${design.name}” (frame ${design.id}${route}) in this codebase.`,
        `1. Call get_frame_code with frame_id ${design.id} for its markup and the tokens, fonts, images and components it uses.`,
        `2. Build it with the project's own components, styles and theme; don't paste the raw markup.`,
        `3. Run the app and call capture_build with design_frame_id ${design.id} and the page's URL${design.route ? `, for example http://localhost:3000${design.route}` : ''}.`,
        '4. Fix the differences it lists and call check_drift until none are open, or explain the ones that are intentional.',
      ].join('\n'), [design.id], `build-${design.id}`)
    },
    /** Sends the open differences of a build to the agent as one request. */
    sendDriftFixes(build: Frame) {
      const design = board.frames.find((f) => f.id === build.buildOf)
      const open = openDrift(build.drift?.items, build.driftAccepted)
      if (!design || !open.length) return
      askAgent(driftRequest(design, build, open), [build.id, design.id], `build-${design.id}`)
    },
    compareWithDesign(build: Frame) {
      if (build.buildOf && board.frames.some((f) => f.id === build.buildOf)) openLoupe([build.buildOf, build.id])
    },
    acceptDrift(build: Frame, key: string, accepted: boolean) {
      const keys = new Set(build.driftAccepted ?? [])
      if (accepted) keys.add(key)
      else keys.delete(key)
      dispatch({ type: 'frame.update', id: build.id, patch: { driftAccepted: [...keys] } })
    },
    canOpenInTab(frame: Frame) {
      return !!frameSourceUrl(frame, board.appUrl)
    },
  }
}
