import type { AlignmentGuide, FrameBox } from './frame-snap'

const noGuides: readonly AlignmentGuide[] = []

export function createFrameGesture() {
  let overrides: Record<string, Partial<FrameBox>> = {}
  let guides = noGuides
  const listeners = new Set<() => void>()

  return {
    getOverride: (id: string) => overrides[id],
    getGuides: () => guides,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set(next: Record<string, Partial<FrameBox>>, alignment: readonly AlignmentGuide[] = noGuides) {
      overrides = next
      guides = alignment.length ? alignment : noGuides
      listeners.forEach((listener) => listener())
    },
  }
}
