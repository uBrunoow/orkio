import { installationPost } from '@/lib/github-app'
import { methodNotAllowed } from '@/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function POST(request: Request): Promise<Response> {
  return installationPost(request)
}

export function GET(): Response {
  return methodNotAllowed('POST')
}
