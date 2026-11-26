'use client'

import { X } from 'lucide-react'
import { LIVE_FRAMES } from '@/lib/features'
import { Dialog, IconButton, Kbd } from './kit'

const GROUPS: { title: string; keys: [string, string[]][] }[] = [
  {
    title: 'Tools',
    keys: [
      ['Select', ['V']],
      ['Pan', ['H']],
      ['Comment', ['C']],
      ['Pan while held', ['Space']],
    ],
  },
  {
    title: 'Frames',
    keys: [
      ...(LIVE_FRAMES ? ([['Add a live frame', ['A']]] as [string, string[]][]) : []),
      ['Add a sketch', ['S']],
      ['Make a variant', ['⌘', 'D']],
      ['Drag without snapping', ['Alt', 'drag']],
      ...(LIVE_FRAMES ? ([['Use a live page', ['↵']]] as [string, string[]][]) : []),
      ['Edit a sketch’s contents', ['↵']],
      ['Delete', ['⌫']],
      ['Select all', ['⌘', 'A']],
    ],
  },
  {
    title: 'Decks',
    keys: [
      ['Previous or next variant', ['←', '→']],
      ['Keep this variant', ['K']],
      ['Compare in the loupe', ['L']],
    ],
  },
  {
    title: 'View',
    keys: [
      ['Search the board', ['⌘', 'K']],
      ['Fit everything', ['⇧', '1']],
      ['Zoom to selection', ['⇧', '2']],
      ['Zoom', ['⌘', 'scroll']],
      ['Undo', ['⌘', 'Z']],
      ['Redo', ['⇧', '⌘', 'Z']],
      ['Show shortcuts', ['?']],
    ],
  },
]

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose} width="max-w-2xl">
      <div className="flex items-center justify-between border-b border-hair-soft px-5 py-3.5">
        <h2 className="text-[15px] font-semibold">Keyboard shortcuts</h2>
        <IconButton label="Close" onClick={onClose} className="size-7">
          <X size={15} />
        </IconButton>
      </div>
      <div className="grid grid-cols-2 gap-x-8 gap-y-5 p-5">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h3 className="mb-1.5 text-xs font-medium text-mist">{g.title}</h3>
            <dl>
              {g.keys.map(([what, keys]) => (
                <div key={what} className="flex h-7 items-center justify-between">
                  <dt className="text-slate">{what}</dt>
                  <dd className="flex gap-0.5">
                    {keys.map((k) => (
                      <Kbd key={k}>{k}</Kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  )
}
