export interface FrameBox {
  x: number
  y: number
  w: number
  h: number
}

export interface AlignmentGuide {
  axis: 'x' | 'y'
  at: number
  from: number
  to: number
}

export function boxAround(boxes: FrameBox[]): FrameBox {
  const x = Math.min(...boxes.map((box) => box.x))
  const y = Math.min(...boxes.map((box) => box.y))
  return {
    x, y,
    w: Math.max(...boxes.map((box) => box.x + box.w)) - x,
    h: Math.max(...boxes.map((box) => box.y + box.h)) - y,
  }
}

function nearestEdge(axis: 'x' | 'y', moving: FrameBox, neighbors: FrameBox[], threshold: number) {
  const extent = axis === 'x' ? 'w' : 'h'
  const positions = [moving[axis], moving[axis] + moving[extent] / 2, moving[axis] + moving[extent]]
  let nearest: { delta: number; at: number; neighbor: FrameBox } | undefined
  for (const neighbor of neighbors) {
    const edges = [neighbor[axis], neighbor[axis] + neighbor[extent] / 2, neighbor[axis] + neighbor[extent]]
    for (const at of edges) {
      for (const position of positions) {
        const delta = at - position
        if (Math.abs(delta) <= threshold && (!nearest || Math.abs(delta) < Math.abs(nearest.delta))) {
          nearest = { delta, at, neighbor }
        }
      }
    }
  }
  return nearest
}

export function alignMovingBox(box: FrameBox, neighbors: FrameBox[], zoom: number) {
  const threshold = 6 / zoom
  const x = nearestEdge('x', box, neighbors, threshold)
  const y = nearestEdge('y', box, neighbors, threshold)
  const dx = x?.delta ?? 0
  const dy = y?.delta ?? 0
  const guides: AlignmentGuide[] = []
  if (x) guides.push({
    axis: 'x', at: x.at,
    from: Math.min(box.y + dy, x.neighbor.y),
    to: Math.max(box.y + dy + box.h, x.neighbor.y + x.neighbor.h),
  })
  if (y) guides.push({
    axis: 'y', at: y.at,
    from: Math.min(box.x + dx, y.neighbor.x),
    to: Math.max(box.x + dx + box.w, y.neighbor.x + y.neighbor.w),
  })
  return { dx, dy, guides }
}
