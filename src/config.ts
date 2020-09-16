import deepEqual from 'fast-deep-equal'
import isDocumentVisible from './libs/is-document-visible'
import {
  ConfigInterface,
  RevalidateOptionInterface,
  revalidateType
} from './types'
import Cache from './cache'

// cache
const cache = new Cache()

// error retry
function onErrorRetry(
  _,
  __,
  config: ConfigInterface,
  revalidate: revalidateType,
  opts: RevalidateOptionInterface
): void {
  if (!isDocumentVisible()) {
    // if it's hidden, stop
    // it will auto revalidate when focus
    return
  }

  if (
    typeof config.errorRetryCount === 'number' &&
    opts.retryCount > config.errorRetryCount
  ) {
    return
  }

  // exponential backoff
  const count = Math.min(opts.retryCount || 0, 8)
  const timeout =
    ~~((Math.random() + 0.5) * (1 << count)) * config.errorRetryInterval
  setTimeout(revalidate, timeout, opts)
}

// client side: need to adjust the config
// based on the browser status
// slow connection (<= 70Kbps)
const slowConnection =
  typeof window !== 'undefined' &&
  navigator['connection'] &&
  ['slow-2g', '2g'].indexOf(navigator['connection'].effectiveType) !== -1

// config
const defaultConfig: ConfigInterface = {
  // events
  onLoadingSlow: () => {},
  onSuccess: () => {},
  onError: () => {},
  onErrorRetry,

  errorRetryInterval: (slowConnection ? 10 : 5) * 1000,
  focusThrottleInterval: 5 * 1000,
  dedupingInterval: 2 * 1000,
  loadingTimeout: (slowConnection ? 5 : 3) * 1000,

  refreshInterval: 0,
  revalidateOnFocus: true,
  revalidateOnReconnect: true,
  refreshWhenHidden: false,
  refreshWhenOffline: false,
  shouldRetryOnError: true,
  suspense: false,
  passKeyToFetcher: true,
  compare: deepEqual
}

export { cache }
export default defaultConfig
