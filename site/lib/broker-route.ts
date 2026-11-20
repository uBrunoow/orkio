import { brokerEnv, handleBroker, json, type BrokerRoute } from './notion-broker'
import { brokerLimiter, clientIp, type RateLimiter } from './rate-limit'

/** POST dos route handlers: limitador por IP e depois a lógica do intermediário. */
export async function brokerPost(
  route: BrokerRoute,
  request: Request,
  limiter: RateLimiter = brokerLimiter
): Promise<Response> {
  const wait = limiter.check(clientIp(request))
  if (wait !== null) {
    return json(429, { error: 'rate_limited' }, { 'Retry-After': String(wait) })
  }
  return handleBroker(route, request, brokerEnv())
}
