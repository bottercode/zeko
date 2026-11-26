import 'server-only'

export function eventStream<T>(
  signal: AbortSignal,
  read: () => T,
  subscribe: (listener: (snapshot: T) => void) => () => void,
  delivery: 'snapshot' | 'ordered' = 'snapshot',
) {
  const encoder = new TextEncoder()
  let cleanup = () => {}
  let flush = () => {}

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (signal.aborted) {
        controller.close()
        return
      }
      let closed = false
      let scheduled = false
      let latest: { snapshot: T } | undefined = { snapshot: read() }
      const writable = () => !closed && (controller.desiredSize ?? 0) > 0
      const push = (text: string) => controller.enqueue(encoder.encode(text))
      const write = (snapshot: T) => push(`data: ${JSON.stringify(snapshot)}\n\n`)
      flush = () => {
        if (!latest || !writable()) return
        const { snapshot } = latest
        latest = undefined
        write(snapshot)
      }
      const send = (snapshot: T) => {
        if (closed) return
        if (delivery === 'ordered') {
          write(snapshot)
          return
        }
        // Consumers render the latest complete state. Keep one pending snapshot during bursts.
        latest = { snapshot }
        if (scheduled) return
        scheduled = true
        queueMicrotask(() => {
          scheduled = false
          flush()
        })
      }
      if (delivery === 'ordered') flush()
      const unsubscribe = subscribe(send)
      const heartbeat = setInterval(() => {
        if (latest) flush()
        else if (writable()) push(': ping\n\n')
      }, 20_000)
      const abort = () => {
        cleanup()
        controller.close()
      }
      cleanup = () => {
        if (closed) return
        closed = true
        latest = undefined
        clearInterval(heartbeat)
        unsubscribe()
        signal.removeEventListener('abort', abort)
      }
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
      else flush()
    },
    pull() {
      if (!signal.aborted) flush()
    },
    cancel() {
      cleanup()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    },
  })
}
