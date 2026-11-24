import { reviewPost } from '@/lib/github-app'
import { methodNotAllowed } from '@/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function POST(request: Request): Promise<Response> {
  return reviewPost(request)
}

export function GET(): Response {
  return methodNotAllowed('POST')
}
