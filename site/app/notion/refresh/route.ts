import { brokerPost } from '@/lib/broker-route'
import { methodNotAllowed } from '@/lib/http'

// Intermediário OAuth do Notion: Node, sempre dinâmico, nunca em cache.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function POST(request: Request): Promise<Response> {
  return brokerPost('refresh', request)
}

export function GET(): Response {
  return methodNotAllowed('POST')
}
