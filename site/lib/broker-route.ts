import { withRateLimit } from './http'
import { brokerEnv, handleBroker, type BrokerRoute } from './notion-broker'
import { brokerLimiter, type RateLimiter } from './rate-limit'

/** POST dos route handlers: limitador por IP e depois a lógica do intermediário. */
export function brokerPost(
  route: BrokerRoute,
  request: Request,
  limiter: RateLimiter = brokerLimiter
): Promise<Response> {
  return withRateLimit(limiter, request, () => handleBroker(route, request, brokerEnv()))
}
