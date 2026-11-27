'use client'

import { deckMembers, frameSourceUrl } from '@/lib/ops'
import { newId } from '@/lib/client/useBoard'
import type { Frame } from '@/lib/types'
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
    canOpenInTab(frame: Frame) {
      return !!frameSourceUrl(frame, board.appUrl)
    },
  }
}
