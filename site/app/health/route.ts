import { json, methodNotAllowed } from '@/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET(): Response {
  return json(200, { ok: true })
}

export function POST(): Response {
  return methodNotAllowed('GET')
}
