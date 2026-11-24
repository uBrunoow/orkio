import { brokerPost } from '@/lib/broker-route'
import { methodNotAllowed } from '@/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function POST(request: Request): Promise<Response> {
  return brokerPost('token', request)
}

export function GET(): Response {
  return methodNotAllowed('POST')
}
