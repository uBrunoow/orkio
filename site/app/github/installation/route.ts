import { installationPost } from '@/lib/github-app'
import { methodNotAllowed } from '@/lib/notion-broker'

// O orkio[bot] está instalado no repositório? Node, sempre dinâmico, nunca em cache.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function POST(request: Request): Promise<Response> {
  return installationPost(request)
}

export function GET(): Response {
  return methodNotAllowed('POST')
}
