import { connection } from 'next/server'
import { prepareStore } from '@/lib/server/store'

export async function GET() {
  await connection()
  try {
    await prepareStore()
    return new Response('OK', { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return new Response('Unavailable', { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
