import 'server-only'

export function eventStream<T>(
  signal: AbortSignal,
  read: () => T,
  subscribe: (listener: (snapshot: T) => void) => () => void,
) {
  const encoder = new TextEncoder()
  let cleanup = () => {}

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (signal.aborted) {
        controller.close()
        return
      }
      const push = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text))
        } catch {
          cleanup()
        }
      }
      const send = (snapshot: T) => push(`data: ${JSON.stringify(snapshot)}\n\n`)
      const first = read()
      const unsubscribe = subscribe(send)
      const heartbeat = setInterval(() => push(': ping\n\n'), 20_000)
      const abort = () => {
        cleanup()
        controller.close()
      }
      cleanup = () => {
        clearInterval(heartbeat)
        unsubscribe()
        signal.removeEventListener('abort', abort)
      }
      signal.addEventListener('abort', abort, { once: true })
      send(first)
    },
    cancel() {
      cleanup()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
