'use client'

import { useRef } from 'react'
import { CircleHelp, RotateCcw, Settings } from 'lucide-react'
import { ZoomPill } from './Canvas'
import { useStudio } from './studio-context'
import { IconButton, Tip } from './kit'
import { Button } from './ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu'

/** Bottom right, beside the agents panel: zoom, settings, help and you. */
export function CornerControls({ onReset, right }: { onReset: () => Promise<void>; right: number }) {
  const { openShortcuts, confirm, toast } = useStudio()
  const gear = useRef<HTMLButtonElement>(null)
  const resetRequested = useRef(false)

  const afterSettingsClosed = (open: boolean) => {
    if (open || !resetRequested.current) return
    resetRequested.current = false
    confirm({
      title: 'Start over with the sample board?',
      body: 'This replaces every frame, comment and request on this board. It can’t be undone.',
      confirm: 'Start over',
      returnFocus: gear,
      onConfirm: async () => {
        await onReset()
        toast('Board reset to the sample')
      },
    })
  }

  return (
    <div className="absolute bottom-2 z-10 flex items-end gap-2" style={{ right }}>
      <ZoomPill />
      <div className="panel flex flex-col items-center gap-0.5 p-1">
        <DropdownMenu onOpenChangeComplete={afterSettingsClosed}>
          <Tip label="Settings" side="left">
            <DropdownMenuTrigger ref={gear} aria-label="Settings" render={<Button variant="ghost" size="icon" className="editor-control" />}>
              <Settings aria-hidden />
            </DropdownMenuTrigger>
          </Tip>
          <DropdownMenuContent side="top" align="end" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuItem variant="destructive" onClick={() => { resetRequested.current = true }}>
                <RotateCcw aria-hidden /> Start over with sample board
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <IconButton label="Help and shortcuts" keys={['?']} side="left" onClick={openShortcuts}>
          <CircleHelp aria-hidden />
        </IconButton>
        <Tip label="You" side="left">
          <span className="my-1 grid size-6 place-items-center rounded-full bg-[#5b6cff] text-[11px] font-semibold text-white">Y</span>
        </Tip>
      </div>
    </div>
  )
}
