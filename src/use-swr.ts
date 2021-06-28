// TODO: use @ts-expect-error
import { useCallback, useRef, useDebugValue } from 'react'

import defaultConfig from './config'
import { wrapCache } from './cache'
import { IS_SERVER, rAF, useIsomorphicLayoutEffect } from './env'
import { serialize } from './libs/serialize'
import { isUndefined, UNDEFINED } from './libs/helper'
import ConfigProvider from './config-context'
import useStateWithDeps from './state'
import withArgs from './resolve-args'
import {
  State,
  Broadcaster,
  Fetcher,
  Key,
  MutatorCallback,
  SWRResponse,
  RevalidatorOptions,
  Updater,
  SWRConfiguration,
  Cache,
  ScopedMutator,
  SWRHook
} from './types'

type Revalidator = (...args: any[]) => void

// Generate strictly increasing timestamps.
let __timestamp = 0
const now = () => ++__timestamp

// Global state used to deduplicate requests and store listeners
const SWRGlobalState = new WeakMap<Cache, any>()
const getGlobalState = (cache: Cache) => {
  if (!SWRGlobalState.has(cache)) {
    SWRGlobalState.set(cache, [{}, {}, {}, {}, {}, {}, {}, {}])
  }
  return SWRGlobalState.get(cache) as [
    Record<string, Revalidator[]>, // FOCUS_REVALIDATORS
    Record<string, Revalidator[]>, // RECONNECT_REVALIDATORS
    Record<string, Updater[]>, // CACHE_REVALIDATORS
    Record<string, number>, // MUTATION_TS
    Record<string, number>, // MUTATION_END_TS
    Record<string, any>, // CONCURRENT_PROMISES
    Record<string, number>, // CONCURRENT_PROMISES_TS
    Record<string, number> // RETRY_COUNTS
  ]
}

// Setup DOM events listeners for `focus` and `reconnect` actions
if (!IS_SERVER) {
  const [FOCUS_REVALIDATORS, RECONNECT_REVALIDATORS] = getGlobalState(
    defaultConfig.cache
  )
  const revalidate = (revalidators: Record<string, Revalidator[]>) => {
    if (!defaultConfig.isDocumentVisible() || !defaultConfig.isOnline()) return

    for (const key in revalidators) {
      if (revalidators[key][0]) revalidators[key][0]()
    }
  }
  defaultConfig.registerOnFocus(() => revalidate(FOCUS_REVALIDATORS))
  defaultConfig.registerOnReconnect(() => revalidate(RECONNECT_REVALIDATORS))
}

const broadcastState: Broadcaster = (
  cache: Cache,
  key,
  data,
  error,
  isValidating,
  shouldRevalidate = false
) => {
  const [, , CACHE_REVALIDATORS] = getGlobalState(cache)
  const updaters = CACHE_REVALIDATORS[key]
  const promises = []
  if (updaters) {
    for (let i = 0; i < updaters.length; ++i) {
      promises.push(
        updaters[i](shouldRevalidate, data, error, isValidating, i > 0)
      )
    }
  }
  return Promise.all(promises).then(() => cache.get(key))
}

async function internalMutate<Data = any>(
  cache: Cache,
  _key: Key,
  _data?: Data | Promise<Data | undefined> | MutatorCallback<Data>,
  shouldRevalidate = true
): Promise<Data | undefined> {
  const [key, , keyErr] = serialize(_key)
  if (!key) return UNDEFINED

  const [, , , MUTATION_TS, MUTATION_END_TS] = getGlobalState(cache)

  // if there is no new data to update, let's just revalidate the key
  if (isUndefined(_data)) {
    return broadcastState(
      cache,
      key,
      cache.get(key),
      cache.get(keyErr),
      UNDEFINED,
      shouldRevalidate
    )
  }

  // update global timestamps
  MUTATION_TS[key] = now()
  MUTATION_END_TS[key] = 0

  // track timestamps before await asynchronously
  const beforeMutationTs = MUTATION_TS[key]

  let data: any, error: unknown
  let isAsyncMutation = false

  if (typeof _data === 'function') {
    // `_data` is a function, call it passing current cache value
    try {
      _data = (_data as MutatorCallback<Data>)(cache.get(key))
    } catch (err) {
      // if `_data` function throws an error synchronously, it shouldn't be cached
      _data = UNDEFINED
      error = err
    }
  }

  if (_data && typeof (_data as Promise<Data>).then === 'function') {
    // `_data` is a promise
    isAsyncMutation = true
    try {
      data = await _data
    } catch (err) {
      error = err
    }
  } else {
    data = _data
  }

  const shouldAbort = (): boolean | void => {
    // check if other mutations have occurred since we've started this mutation
    if (beforeMutationTs !== MUTATION_TS[key]) {
      if (error) throw error
      return true
    }
  }

  // If there's a race we don't update cache or broadcast change, just return the data
  if (shouldAbort()) return data

  if (!isUndefined(data)) {
    // update cached data
    cache.set(key, data)
  }
  // Always update or reset the error
  cache.set(keyErr, error)

  // Reset the timestamp to mark the mutation has ended
  MUTATION_END_TS[key] = now()

  if (!isAsyncMutation) {
    // We skip broadcasting if there's another mutation happened synchronously
    if (shouldAbort()) return data
  }

  // Update existing SWR Hooks' internal states:
  return broadcastState(
    cache,
    key,
    data,
    error,
    UNDEFINED,
    shouldRevalidate
  ).then(res => {
    // Throw error or return data
    if (error) throw error
    return res
  })
}

const addRevalidator = (
  revalidators: Record<string, Revalidator[]>,
  key: string,
  callback: Revalidator
) => {
  if (!revalidators[key]) {
    revalidators[key] = [callback]
  } else {
    revalidators[key].push(callback)
  }

  return () => {
    const keyedRevalidators = revalidators[key]
    const index = keyedRevalidators.indexOf(callback)

    if (index >= 0) {
      // O(1): faster than splice
      keyedRevalidators[index] = keyedRevalidators[keyedRevalidators.length - 1]
      keyedRevalidators.pop()
    }
  }
}

export function useSWRHandler<Data = any, Error = any>(
  _key: Key,
  fn: Fetcher<Data> | null,
  config: typeof defaultConfig & SWRConfiguration<Data, Error>
): SWRResponse<Data, Error> {
  const {
    cache,
    compare,
    initialData,
    suspense,
    revalidateOnMount,
    refreshInterval,
    refreshWhenHidden,
    refreshWhenOffline
  } = config
  const [
    FOCUS_REVALIDATORS,
    RECONNECT_REVALIDATORS,
    CACHE_REVALIDATORS,
    MUTATION_TS,
    MUTATION_END_TS,
    CONCURRENT_PROMISES,
    CONCURRENT_PROMISES_TS,
    RETRY_COUNTS
  ] = getGlobalState(cache)

  // `key` is the identifier of the SWR `data` state.
  // `keyErr` and `keyValidating` are indentifiers of `error` and `isValidating`
  // which are derived from `key`.
  // `fnArgs` is a list of arguments for `fn`.
  const [key, fnArgs, keyErr, keyValidating] = serialize(_key)

  // If it's the first render of this hook.
  const initialMountedRef = useRef(false)
  const unmountedRef = useRef(false)

  // The ref to trace the current key.
  const keyRef = useRef(key)
  const configRef = useRef(config)

  // Get the current state that SWR should return.
  const resolveData = () => {
    const cachedData = cache.get(key)
    return isUndefined(cachedData) ? initialData : cachedData
  }
  const data = resolveData()
  const error = cache.get(keyErr)

  // A revalidation must be triggered when mounted if:
  // - `revalidateOnMount` is explicitly set to `true`.
  // - Suspense mode and there's stale data for the inital render.
  // - Not suspense mode and there is no `initialData`.
  const shouldRevalidateOnMount = () => {
    if (!isUndefined(revalidateOnMount)) return revalidateOnMount

    return suspense
      ? !initialMountedRef.current && !isUndefined(data)
      : isUndefined(initialData)
  }

  // Resolve the current validating state.
  const resolveValidating = () => {
    if (!key) return false
    if (cache.get(keyValidating)) return true

    // If it's not mounted yet and it should revalidate on mount, revalidate.
    return !initialMountedRef.current && shouldRevalidateOnMount()
  }
  const isValidating = resolveValidating()

  // do unmount check for callbacks
  // if key changed during the revalidation, old dispatch and config callback should not take effect.
  const safeCallback = useCallback(
    (callback: () => void) => {
      if (unmountedRef.current) return
      if (key !== keyRef.current) return
      if (!initialMountedRef.current) return
      callback()
    },
    [key]
  )

  const [stateRef, stateDependenciesRef, setState] = useStateWithDeps<
    Data,
    Error
  >(
    {
      data,
      error,
      isValidating
    },
    unmountedRef
  )

  // The revalidation function is a carefully crafted wrapper of the original
  // `fetcher`, to correctly handle the many edge cases.
  const revalidate = useCallback(
    async (revalidateOpts: RevalidatorOptions = {}): Promise<boolean> => {
      if (!key || !fn) return false
      if (unmountedRef.current) return false
      if (configRef.current.isPaused()) return false
      const { retryCount = 0, dedupe = false } = revalidateOpts

      let loading = true
      const shouldDeduping = !isUndefined(CONCURRENT_PROMISES[key]) && dedupe

      // start fetching
      try {
        cache.set(keyValidating, true)
        setState({
          isValidating: true
        })
        if (!shouldDeduping) {
          // also update other hooks
          broadcastState(
            cache,
            key,
            stateRef.current.data,
            stateRef.current.error,
            true
          )
        }

        let newData: Data
        let startAt: number

        if (shouldDeduping) {
          // there's already an ongoing request,
          // this one needs to be deduplicated.
          startAt = CONCURRENT_PROMISES_TS[key]
          newData = await CONCURRENT_PROMISES[key]
        } else {
          // if no cache being rendered currently (it shows a blank page),
          // we trigger the loading slow event.
          if (config.loadingTimeout && !cache.get(key)) {
            setTimeout(() => {
              if (loading)
                safeCallback(() => configRef.current.onLoadingSlow(key, config))
            }, config.loadingTimeout)
          }

          if (fnArgs !== null) {
            CONCURRENT_PROMISES[key] = fn(...fnArgs)
          } else {
            CONCURRENT_PROMISES[key] = fn(key)
          }

          CONCURRENT_PROMISES_TS[key] = startAt = now()

          newData = await CONCURRENT_PROMISES[key]

          setTimeout(() => {
            // CONCURRENT_PROMISES_TS[key] maybe be `undefined` or a number
            if (CONCURRENT_PROMISES_TS[key] === startAt) {
              delete CONCURRENT_PROMISES[key]
              delete CONCURRENT_PROMISES_TS[key]
            }
          }, config.dedupingInterval)

          // trigger the success event,
          // only do this for the original request.
          safeCallback(() => configRef.current.onSuccess(newData, key, config))
        }
        // CONCURRENT_PROMISES[key] should be resolved at this point so we can
        // delete the key from RETRY_COUNTS
        delete RETRY_COUNTS[key]
        // if there're other ongoing request(s), started after the current one,
        // we need to ignore the current one to avoid possible race conditions:
        //   req1------------------>res1        (current one)
        //        req2---------------->res2
        // the request that fired later will always be kept.
        // CONCURRENT_PROMISES_TS[key] maybe be `undefined` or a number
        if (CONCURRENT_PROMISES_TS[key] !== startAt) {
          return false
        }

        // if there're other mutations(s), overlapped with the current revalidation:
        // case 1:
        //   req------------------>res
        //       mutate------>end
        // case 2:
        //         req------------>res
        //   mutate------>end
        // case 3:
        //   req------------------>res
        //       mutate-------...---------->
        // we have to ignore the revalidation result (res) because it's no longer fresh.
        // meanwhile, a new revalidation should be triggered when the mutation ends.
        if (
          !isUndefined(MUTATION_TS[key]) &&
          // case 1
          (startAt <= MUTATION_TS[key] ||
            // case 2
            startAt <= MUTATION_END_TS[key] ||
            // case 3
            MUTATION_END_TS[key] === 0)
        ) {
          setState({ isValidating: false })
          return false
        }

        cache.set(keyErr, UNDEFINED)
        cache.set(keyValidating, false)

        const newState: State<Data, Error> = {
          isValidating: false
        }

        if (!isUndefined(stateRef.current.error)) {
          newState.error = UNDEFINED
        }

        // Deep compare with latest state to avoid extra re-renders.
        // For local state, compare and assign.
        if (!compare(stateRef.current.data, newData)) {
          newState.data = newData
        }
        // For global state, it's possible that the key has changed.
        // https://github.com/vercel/swr/pull/1058
        if (!compare(cache.get(key), newData)) {
          cache.set(key, newData)
        }

        // merge the new state
        setState(newState)

        if (!shouldDeduping) {
          // also update other hooks
          broadcastState(cache, key, newData, newState.error, false)
        }
      } catch (err) {
        delete CONCURRENT_PROMISES[key]
        delete CONCURRENT_PROMISES_TS[key]
        if (configRef.current.isPaused()) {
          setState({
            isValidating: false
          })
          return false
        }

        // get a new error
        // don't use deep equal for errors
        cache.set(keyErr, err)

        if (stateRef.current.error !== err) {
          // we keep the stale data
          setState({
            isValidating: false,
            error: err
          })
          if (!shouldDeduping) {
            // also broadcast to update other hooks
            broadcastState(cache, key, UNDEFINED, err, false)
          }
        }

        // events and retry
        safeCallback(() => configRef.current.onError(err, key, config))
        if (config.shouldRetryOnError) {
          // when retrying, we always enable deduping

          safeCallback(() => {
            if (isUndefined(RETRY_COUNTS[key])) {
              RETRY_COUNTS[key] = 0
            }
            if (RETRY_COUNTS[key] === retryCount) {
              configRef.current.onErrorRetry(err, key, config, revalidate, {
                retryCount: retryCount + 1,
                dedupe: true
              })
              RETRY_COUNTS[key]++
            }
          })
        }
      }

      loading = false
      return true
    },
    // `setState` is immutable, and `eventsCallback`, `fnArgs`, `keyErr`,
    // and `keyValidating` are depending on `key`, so we can exclude them from
    // the deps array.
    //
    // FIXME:
    // `fn` and `config` might be changed during the lifecycle,
    // but they might be changed every render like this.
    // `useSWR('key', () => fetch('/api/'), { suspense: true })`
    // So we omit the values from the deps array
    // even though it might cause unexpected behaviors.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key]
  )

  // Always update config.
  useIsomorphicLayoutEffect(() => {
    configRef.current = config
  })

  // After mounted or key changed.
  useIsomorphicLayoutEffect(() => {
    if (!key) return UNDEFINED

    // Not the inital render.
    const keyChanged = initialMountedRef.current
    const softRevalidate = () => revalidate({ dedupe: true })

    // Mark the component as mounted and update corresponding refs.
    unmountedRef.current = false
    keyRef.current = key

    // When `key` updates, reset the state to the initial value
    // and trigger a rerender if necessary.
    if (keyChanged) {
      setState({
        data,
        error,
        isValidating
      })
    }

    // Trigger a revalidation.
    if (keyChanged || shouldRevalidateOnMount()) {
      if (isUndefined(data) || IS_SERVER) {
        softRevalidate()
      } else {
        // Delay the revalidate if we have data to return so we won't block
        // rendering.
        rAF(softRevalidate)
      }
    }

    // Add event listeners.
    let pending = false
    const onFocus = () => {
      if (pending || !configRef.current.revalidateOnFocus) return
      pending = true
      softRevalidate()
      setTimeout(
        () => (pending = false),
        configRef.current.focusThrottleInterval
      )
    }

    const onReconnect = () => {
      if (configRef.current.revalidateOnReconnect) {
        softRevalidate()
      }
    }

    // Register global cache update listener.
    const onUpdate: Updater<Data, Error> = (
      shouldRevalidate = true,
      updatedData,
      updatedError,
      updatedIsValidating,
      dedupe = true
    ) => {
      setState({
        error: updatedError,
        isValidating: updatedIsValidating,
        // if data is undefined we should not update stateRef.current.data
        ...(!compare(updatedData, stateRef.current.data)
          ? {
              data: updatedData
            }
          : null)
      })

      if (shouldRevalidate) {
        return (dedupe ? softRevalidate : revalidate)()
      }
      return false
    }

    const unsubFocus = addRevalidator(FOCUS_REVALIDATORS, key, onFocus)
    const unsubReconn = addRevalidator(RECONNECT_REVALIDATORS, key, onReconnect)
    const unsubUpdate = addRevalidator(CACHE_REVALIDATORS, key, onUpdate)

    // Finally, the component is mounted.
    initialMountedRef.current = true

    return () => {
      // mark it as unmounted
      unmountedRef.current = true

      unsubFocus()
      unsubReconn()
      unsubUpdate()
    }
  }, [key, revalidate])

  // Polling
  useIsomorphicLayoutEffect(() => {
    let timer: any = 0

    function nextTick() {
      if (refreshInterval) {
        timer = setTimeout(tick, refreshInterval)
      }
    }

    async function tick() {
      if (
        !stateRef.current.error &&
        (refreshWhenHidden || config.isDocumentVisible()) &&
        (refreshWhenOffline || config.isOnline())
      ) {
        // only revalidate when the page is visible
        // if API request errored, we stop polling in this round
        // and let the error retry function handle it
        await revalidate({ dedupe: true })
      }

      // Read the latest refreshInterval
      if (timer) nextTick()
    }

    nextTick()

    return () => {
      if (timer) {
        clearTimeout(timer)
        timer = 0
      }
    }
  }, [refreshInterval, refreshWhenHidden, refreshWhenOffline, revalidate])

  // In Suspense mode, we can't return the empty `data` state.
  // If there is `error`, the `error` needs to be thrown to the error boundary.
  // If there is no `error`, the `revalidation` promise needs to be thrown to
  // the suspense boundary.
  if (suspense && isUndefined(data)) {
    if (isUndefined(error)) {
      throw revalidate({ dedupe: true })
    }
    throw error
  }

  // `mutate`, but bound to the current key.
  const boundMutate: SWRResponse<Data, Error>['mutate'] = useCallback(
    (newData, shouldRevalidate) => {
      return internalMutate(cache, keyRef.current, newData, shouldRevalidate)
    },
    // `cache` isn't allowed to change during the lifecycle
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  // Define the SWR state.
  // `revalidate` will be deprecated in the 1.x release
  // because `mutate()` covers the same use case of `revalidate()`.
  // This remains only for backward compatibility
  const state = {
    revalidate,
    mutate: boundMutate
  } as SWRResponse<Data, Error>
  const currentStateDependencies = stateDependenciesRef.current
  Object.defineProperties(state, {
    data: {
      get: function() {
        currentStateDependencies.data = true
        return data
      },
      enumerable: true
    },
    error: {
      get: function() {
        currentStateDependencies.error = true
        return error
      },
      enumerable: true
    },
    isValidating: {
      get: function() {
        currentStateDependencies.isValidating = true
        return isValidating
      },
      enumerable: true
    }
  })

  // Display debug info in React DevTools.
  useDebugValue(data)

  return state
}

export const SWRConfig = ConfigProvider as typeof ConfigProvider & {
  default: SWRConfiguration
}
Object.defineProperty(SWRConfig, 'default', {
  value: defaultConfig
})

export const mutate = internalMutate.bind(
  null,
  defaultConfig.cache
) as ScopedMutator

export function createCache<Data>(
  provider: Cache
): {
  cache: Cache
  mutate: ScopedMutator<Data>
} {
  const cache = wrapCache<Data>(provider)
  return {
    cache,
    mutate: internalMutate.bind(null, cache) as ScopedMutator<Data>
  }
}

export default withArgs<SWRHook>(useSWRHandler)
