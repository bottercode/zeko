import { handlers } from '@/auth'
import { googleAuthConfigured } from '@/lib/auth-access'
import type { NextRequest } from 'next/server'

export function GET(request: NextRequest) {
  return googleAuthConfigured() ? handlers.GET(request) : new Response(null, { status: 404 })
}

export function POST(request: NextRequest) {
  return googleAuthConfigured() ? handlers.POST(request) : new Response(null, { status: 404 })
}
