'use client'

import { useRef, type ReactElement, type ReactNode } from 'react'
import { toast as sonner } from 'sonner'
import { cn } from '@/lib/utils'
import { Button as UIButton } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Kbd as UIKbd, KbdGroup } from '@/components/ui/kbd'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Dialog as UIDialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Toaster } from '@/components/ui/sonner'

/* Zeko's shared pieces, built on shadcn/ui. Screens use these so every button, key, tooltip and menu behaves the same. */

/** Conditional class names, merged so later Tailwind classes win. */
export const cx = (...parts: (string | false | null | undefined)[]) => cn(...parts)

export function Kbd({ children }: { children: ReactNode; dark?: boolean }) {
  return <UIKbd>{children}</UIKbd>
}

type Side = 'top' | 'bottom' | 'left' | 'right'

/** A label that appears on hover or keyboard focus, with the shortcut if there is one. The child must be one element. */
export function Tip({ label, keys, side = 'bottom', children }: { label: string; keys?: string[]; side?: Side; children: ReactNode; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children as ReactElement} />
      <TooltipContent side={side}>
        {label}
        {keys && (
          <KbdGroup>
            {keys.map((k) => (
              <UIKbd key={k}>{k}</UIKbd>
            ))}
          </KbdGroup>
        )}
      </TooltipContent>
    </Tooltip>
  )
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent'
const VARIANT = { primary: 'default', secondary: 'secondary', ghost: 'ghost', danger: 'destructive', accent: 'accent' } as const

export function Button({
  variant = 'secondary',
  size = 'md',
  ...rest
}: Omit<React.ComponentProps<typeof UIButton>, 'variant' | 'size'> & { variant?: Variant; size?: 'sm' | 'md' }) {
  return <UIButton variant={VARIANT[variant]} size={size === 'sm' ? 'sm' : 'default'} {...rest} />
}

/** An icon-only button. Its label shows as a tooltip and names it for screen readers. */
export function IconButton({
  label,
  keys,
  side,
  active,
  className,
  ...rest
}: Omit<React.ComponentProps<typeof UIButton>, 'variant' | 'size'> & { label: string; keys?: string[]; side?: Side; active?: boolean }) {
  return (
    <Tip label={label} keys={keys} side={side}>
      <UIButton
        variant="ghost"
        size="icon"
        aria-label={label}
        aria-pressed={active}
        className={cn('editor-control', className)}
        {...rest}
      />
    </Tip>
  )
}

/** A section heading inside a panel. */
export function Heading({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex h-5 items-center justify-between">
      <h3 className="text-xs font-medium text-muted-foreground">{children}</h3>
      {action}
    </div>
  )
}

/* ---------- Toasts ---------- */

const toastOnce = (text: string) => void sonner(text)
/** Shows a short confirmation at the bottom of the screen. */
export const useToast = () => toastOnce

export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <Toaster position="bottom-center" />
    </>
  )
}

/* ---------- Menus ---------- */

export interface MenuItem {
  label: string
  icon?: ReactNode
  keys?: string[]
  danger?: boolean
  disabled?: boolean
  onSelect: () => void
}

/** A menu that opens at a screen point, such as a right-click. Closes on Escape, outside clicks or a pick. */
export function Menu({ x, y, items, onClose }: { x: number; y: number; items: (MenuItem | 'divider')[]; onClose: () => void }) {
  // Groups between dividers, as shadcn expects items inside groups.
  const groups: MenuItem[][] = [[]]
  for (const item of items) {
    if (item === 'divider') groups.push([])
    else groups.at(-1)!.push(item)
  }
  return (
    <DropdownMenu open onOpenChange={(open) => !open && onClose()}>
      <DropdownMenuTrigger aria-hidden tabIndex={-1} className="pointer-events-none fixed size-0" style={{ left: x, top: y }} />
      <DropdownMenuContent align="start" sideOffset={0} className="w-56">
        {groups.map((group, gi) => (
          <div key={gi} className="contents">
            {gi > 0 && <DropdownMenuSeparator />}
            <DropdownMenuGroup>
              {group.map((item) => (
                <DropdownMenuItem
                  key={item.label}
                  disabled={item.disabled}
                  variant={item.danger ? 'destructive' : 'default'}
                  onClick={() => {
                    onClose()
                    item.onSelect()
                  }}
                >
                  {item.icon}
                  {item.label}
                  {item.keys && <DropdownMenuShortcut>{item.keys.join('')}</DropdownMenuShortcut>}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/* ---------- Dialogs ---------- */

const WIDTH: Record<string, string> = { 'max-w-sm': 'sm:max-w-sm', 'max-w-md': 'sm:max-w-md', 'max-w-lg': 'sm:max-w-lg', 'max-w-xl': 'sm:max-w-xl', 'max-w-2xl': 'sm:max-w-2xl' }

/** A modal. The children draw its body; the title names it for screen readers. */
export function Dialog({ title, children, onClose, width = 'max-w-md' }: { title: string; children: ReactNode; onClose: () => void; width?: string }) {
  return (
    <UIDialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className={cn('block gap-0 overflow-hidden p-0', WIDTH[width] ?? width)}>
        <DialogTitle className="sr-only">{title}</DialogTitle>
        {children}
      </DialogContent>
    </UIDialog>
  )
}

export function ConfirmDialog({
  title,
  body,
  confirm,
  onConfirm,
  onClose,
  returnFocus,
}: {
  title: string
  body: string
  confirm: string
  onConfirm: () => void
  onClose: () => void
  returnFocus?: React.RefObject<HTMLElement | null>
}) {
  const cancel = useRef<HTMLButtonElement>(null)
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent initialFocus={cancel} finalFocus={returnFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel ref={cancel} variant="ghost">Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              onClose()
              onConfirm()
            }}
          >
            {confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
