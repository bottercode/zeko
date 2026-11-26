'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from 'cn'
import { samplePricingPreview } from '@/lib/seed'

export interface CanvasCover {
  html: string
  w: number
  h: number
}

export function CanvasPreview({ cover, className }: { cover: CanvasCover | null; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const hasPreview = !!cover
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [hasPreview])

  if (!cover) {
    return (
      <div className="grid h-[150px] place-items-center text-sm text-muted-foreground [background-image:radial-gradient(var(--color-hair)_1px,transparent_1px)] [background-size:16px_16px]">
        Empty canvas
      </div>
    )
  }

  return (
    <div ref={ref} className={cn('relative overflow-hidden bg-white', className ?? 'h-[150px]')}>
      {width > 0 && (
        <iframe
          title="Canvas preview"
          aria-hidden
          tabIndex={-1}
          sandbox=""
          loading="lazy"
          srcDoc={cover.html}
          className="pointer-events-none absolute top-0 left-0 origin-top-left border-0"
          style={{ width: cover.w, height: cover.h, transform: `scale(${width / cover.w})` }}
        />
      )}
    </div>
  )
}

export function SampleCanvasPreview() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-float sm:p-7 [background-image:radial-gradient(var(--color-hair)_1px,transparent_1px)] [background-size:16px_16px]">
      <div className="overflow-hidden rounded-lg border border-border shadow-float">
        <CanvasPreview cover={samplePricingPreview} className="aspect-[8/5]" />
      </div>
    </div>
  )
}
