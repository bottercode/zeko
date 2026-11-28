import { boardPages, designGuidelines, framePage, frameSourceUrl, visibleFrames } from './ops'
import { tokenValue } from './tokens'
import type { Board, Frame, Task } from './types'

export const DESIGN_BRIEF = [
  'Before designing, read get_guide with topic "design" (and "product-ui" for app screens); the canvas guidelines and the person’s words override it.',
  'For a new screen or look, unless the guidelines already settle palette and type, open your reply with the short brief the guide describes (subject, world, palette, type, layout) before the first create_sketch.',
  'Use realistic copy and the product’s known facts. Reuse canvas tokens and existing components where they fit, and keep repeated controls consistent.',
  'For a visual reference, inspect its rendered layout and identify the specific choices to carry over, such as hierarchy, density, color, or composition. Keep the reference intact. For website frames, use the source URL when you have browser access. If the reference is unavailable, say so.',
  'After the final visual change, check the rendered frame with screenshot_frame (use JPEG for ordinary review) against the guide’s review checklist, and use inspect_frame to diagnose clipping or overflow. Fix what fails with targeted edits before finishing.',
].join('\n')

export function designContext(board: Board, task: Task) {
  const pages = boardPages(board)
  const page = pages.find((item) => item.id === task.pageId) ?? pages[0]!
  const describe = (frame: Frame) => ({
    id: frame.id,
    name: frame.name.slice(0, 120),
    kind: frame.kind,
    size: [frame.w, frame.h],
    pageId: framePage(board, frame),
    ...(frame.kind !== 'sketch' ? { url: frameSourceUrl(frame, board.appUrl) } : {}),
  })
  const attachments = new Set(task.frameIds)
  if (task.element) attachments.add(task.element.frameId)
  const relevant = board.frames.filter((frame) => attachments.has(frame.id))
  const references = board.frames.filter((frame) => frame.reference && !attachments.has(frame.id))
  const nearby = visibleFrames(board, page.id).filter((frame) => !frame.shape && !frame.reference && !attachments.has(frame.id))
  const guidelines = designGuidelines(board)
  const design = board.design
  const tokens = design?.tokens.flatMap((token) => {
    const value = tokenValue(token, design.themeId)
    return value ? [[token.name, value]] : []
  }) ?? []
  const skills = board.skills ?? []
  return {
    canvas: board.name,
    page,
    attachments: relevant.slice(0, 8).map(describe),
    references: references.slice(0, 6).map(describe),
    otherFrames: nearby.slice(0, 8).map(describe),
    guidelines: guidelines.slice(0, 3200),
    tokens: Object.fromEntries(tokens.slice(0, 16)),
    skills: skills.slice(0, 12).map(({ id, title, description }) => ({ id, title, description: description.slice(0, 160) })),
    more: relevant.length > 8 || references.length > 6 || nearby.length > 8 || guidelines.length > 3200 || tokens.length > 16 || skills.length > 12,
  }
}
