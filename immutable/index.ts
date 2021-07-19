import useSWR, { Middleware } from 'swr'
import { withMiddleware } from '../src/utils/with-middleware'

export const immutable: Middleware = useSWRNext => (key, fetcher, config) => {
  // Always override all revalidate options.
  config.revalidateOnFocus = false
  config.revalidateWhenStale = false
  config.revalidateOnReconnect = false
  return useSWRNext(key, fetcher, config)
}

export default withMiddleware(useSWR, immutable)
