export interface Camera {
  x: number
  y: number
  z: number
}

export const INITIAL_CAMERA: Camera = { x: 80, y: 80, z: 0.4 }

export function createCamera() {
  let current = INITIAL_CAMERA
  const listeners = new Set<() => void>()
  const zoomListeners = new Set<() => void>()

  return {
    get: () => current,
    getZoom: () => current.z,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    subscribeZoom(listener: () => void) {
      zoomListeners.add(listener)
      return () => { zoomListeners.delete(listener) }
    },
    set(update: Camera | ((camera: Camera) => Camera)) {
      const next = typeof update === 'function' ? update(current) : update
      if (current.x === next.x && current.y === next.y && current.z === next.z) return
      const zoomChanged = current.z !== next.z
      current = next
      listeners.forEach((listener) => listener())
      if (zoomChanged) zoomListeners.forEach((listener) => listener())
    },
  }
}
