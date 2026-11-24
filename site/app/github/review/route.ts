import { reviewPost } from '@/lib/github-app'
import { methodNotAllowed } from '@/lib/notion-broker'

// Revisão publicada como orkio[bot]: Node, sempre dinâmico, nunca em cache.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function POST(request: Request): Promise<Response> {
  return reviewPost(request)
}

export function GET(): Response {
  return methodNotAllowed('POST')
}
