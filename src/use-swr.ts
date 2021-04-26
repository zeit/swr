// TODO: use @ts-expect-error
import { useCallback, useRef, useDebugValue } from 'react'

import defaultConfig, { cache } from './config'
import { IS_SERVER, rAF, useIsomorphicLayoutEffect } from './env'
import SWRConfigContext from './config-context'
import useStateWithDeps from './state'
import useArgs from './resolve-args'

import {
  State,
  Broadcaster,
  Fetcher,
  Key,
  MutatorCallback,
  SWRResponse,
  RevalidatorOptions,
  Trigger,
  Updater,
  SWRConfiguration
} from './types'

type Revalidator = (...args: any[]) => void

// Global states
const CONCURRENT_PROMISES: Record<string, any> = {}
const CONCURRENT_PROMISES_TS: Record<string, number> = {}
const FOCUS_REVALIDATORS: Record<string, Revalidator[]> = {}
const RECONNECT_REVALIDATORS: Record<string, Revalidator[]> = {}
const CACHE_REVALIDATORS: Record<string, Updater[]> = {}
const MUTATION_TS: Record<string, number> = {}
const MUTATION_END_TS: Record<string, number> = {}

// Generate strictly increasing timestamps
const now = (() => {
  let ts = 0
  return () => ++ts
})()

// Setup DOM events listeners for `focus` and `reconnect` actions
if (!IS_SERVER) {
  const revalidate = (revalidators: Record<string, Revalidator[]>) => {
    if (!defaultConfig.isDocumentVisible() || !defaultConfig.isOnline()) return

    for (const key in revalidators) {
      if (revalidators[key][0]) revalidators[key][0]()
    }
  }

  if (typeof defaultConfig.registerOnFocus === 'function') {
    defaultConfig.registerOnFocus(() => revalidate(FOCUS_REVALIDATORS))
  }

  if (typeof defaultConfig.registerOnReconnect === 'function') {
    defaultConfig.registerOnReconnect(() => revalidate(RECONNECT_REVALIDATORS))
  }
}

const trigger: Trigger = (_key, shouldRevalidate = true) => {
  // we are ignoring the second argument which correspond to the arguments
  // the fetcher will receive when key is an array
  const [key, , keyErr, keyValidating] = cache.serializeKey(_key)
  if (!key) return Promise.resolve()

  const updaters = CACHE_REVALIDATORS[key]

  if (key && updaters && updaters.length) {
    const currentData = cache.get(key)
    const currentError = cache.get(keyErr)
    const currentIsValidating = cache.get(keyValidating)
    const promises = []
    for (let i = 0; i < updaters.length; ++i) {
      promises.push(
        updaters[i](
          shouldRevalidate,
          currentData,
          currentError,
          currentIsValidating,
          i > 0
        )
      )
    }
    // return new updated value
    return Promise.all(promises).then(() => cache.get(key))
  } else if (shouldRevalidate) {
    // `updaters` would trigger revalidate if `updaters.length > 0`.
    // So only clear promise of revalidate if `!updaters.length && shouldRevalidate`
    delete CONCURRENT_PROMISES[key]
    delete CONCURRENT_PROMISES_TS[key]
  }
  return Promise.resolve(cache.get(key))
}

const broadcastState: Broadcaster = (key, data, error, isValidating) => {
  const updaters = CACHE_REVALIDATORS[key]
  if (key && updaters) {
    for (let i = 0; i < updaters.length; ++i) {
      updaters[i](false, data, error, isValidating)
    }
  }
}

async function mutate<Data = any>(
  _key: Key,
  _data?: Data | Promise<Data | undefined> | MutatorCallback<Data>,
  shouldRevalidate = true
): Promise<Data | undefined> {
  const [key, , keyErr] = cache.serializeKey(_key)
  if (!key) return undefined

  // if there is no new data to update, let's just revalidate the key
  if (typeof _data === 'undefined') return trigger(_key, shouldRevalidate)

  // update global timestamps
  MUTATION_TS[key] = now() - 1
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
      _data = undefined
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

  // if there's a race we don't update cache or broadcast change, just return the data
  if (shouldAbort()) return data

  if (data !== undefined) {
    // update cached data
    cache.set(key, data)
  }
  // always update or reset the error
  cache.set(keyErr, error)

  // reset the timestamp to mark the mutation has ended
  MUTATION_END_TS[key] = now() - 1

  if (!isAsyncMutation) {
    // we skip broadcasting if there's another mutation happened synchronously
    if (shouldAbort()) return data
  }

  // enter the revalidation stage
  // update existing SWR Hooks' state
  const updaters = CACHE_REVALIDATORS[key]
  if (updaters && updaters.length) {
    const promises = []
    for (let i = 0; i < updaters.length; ++i) {
      promises.push(
        updaters[i](!!shouldRevalidate, data, error, undefined, i > 0)
      )
    }
    // return new updated value
    return Promise.all(promises).then(() => {
      if (error) throw error
      return cache.get(key)
    })
  } else if (shouldRevalidate) {
    // `updaters` would trigger revalidate if `updaters.length > 0`.
    // So only clear promise of revalidate if `!updaters.length && shouldRevalidate`
    delete CONCURRENT_PROMISES[key]
    delete CONCURRENT_PROMISES_TS[key]
  }
  // throw error or return data to be used by caller of mutate
  if (error) throw error
  return data
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

function useSWR<Data = any, Error = any>(
  ...args:
    | readonly [Key]
    | readonly [Key, Fetcher<Data> | null]
    | readonly [Key, SWRConfiguration<Data, Error> | undefined]
    | readonly [
        Key,
        Fetcher<Data> | null,
        SWRConfiguration<Data, Error> | undefined
      ]
): SWRResponse<Data, Error> {
  const [_key, config, fn] = useArgs<Key, SWRConfiguration<Data, Error>, Data>(
    args
  )

  // `key` is the identifier of the SWR `data` state.
  // `keyErr` and `keyValidating` are indentifiers of `error` and `isValidating`
  // which are derived from `key`.
  // `fnArgs` is a list of arguments for `fn`.
  const [key, fnArgs, keyErr, keyValidating] = cache.serializeKey(_key)

  const configRef = useRef(config)
  useIsomorphicLayoutEffect(() => {
    configRef.current = config
  })

  // If it's the first render of this hook.
  const initialMountedRef = useRef(false)

  // error ref inside revalidate (is last request errored?)
  const unmountedRef = useRef(false)
  const keyRef = useRef(key)

  // Get the current state that SWR should return.
  const resolveData = () => {
    const cachedData = cache.get(key)
    return cachedData === undefined ? config.initialData : cachedData
  }
  const data = resolveData()
  const error = cache.get(keyErr)

  // A revalidation must be triggered when mounted if:
  // - `revalidateOnMount` is explicitly set to `true`.
  // - Suspense mode and there's stale data for the inital render.
  // - Not suspense mode and there is no `initialData`.
  const shouldRevalidateOnMount = () => {
    if (config.revalidateOnMount !== undefined) return config.revalidateOnMount

    return config.suspense
      ? !initialMountedRef.current && data !== undefined
      : config.initialData === undefined
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
      let shouldDeduping =
        typeof CONCURRENT_PROMISES[key] !== 'undefined' && dedupe

      // start fetching
      try {
        cache.set(keyValidating, true)
        setState({
          isValidating: true
        })
        if (!shouldDeduping) {
          // also update other hooks
          broadcastState(
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
          MUTATION_TS[key] !== undefined &&
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

        cache.set(keyErr, undefined)
        cache.set(keyValidating, false)

        const newState: State<Data, Error> = {
          isValidating: false
        }

        if (stateRef.current.error !== undefined) {
          newState.error = undefined
        }

        // Deep compare with latest state to avoid extra re-renders.
        // For local state, compare and assign.
        if (!config.compare(stateRef.current.data, newData)) {
          newState.data = newData
        }
        // For global state, it's possible that the key has changed.
        // https://github.com/vercel/swr/pull/1058
        if (!config.compare(cache.get(key), newData)) {
          cache.set(key, newData)
        }

        // merge the new state
        setState(newState)

        if (!shouldDeduping) {
          // also update other hooks
          broadcastState(key, newData, newState.error, false)
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
            broadcastState(key, undefined, err, false)
          }
        }

        // events and retry
        safeCallback(() => configRef.current.onError(err, key, config))
        if (config.shouldRetryOnError) {
          // when retrying, we always enable deduping
          safeCallback(() =>
            configRef.current.onErrorRetry(err, key, config, revalidate, {
              retryCount: retryCount + 1,
              dedupe: true
            })
          )
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

  // After mounted or key changed.
  useIsomorphicLayoutEffect(() => {
    if (!key) return undefined

    // Not the inital render.
    const keyChanged = initialMountedRef.current

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

    const softRevalidate = () => revalidate({ dedupe: true })

    // Trigger a revalidation.
    if (keyChanged || shouldRevalidateOnMount()) {
      if (data !== undefined && !IS_SERVER) {
        // Delay the revalidate if we have data to return so we won't block
        // rendering.
        // @ts-ignore it's safe to use requestAnimationFrame in browser
        rAF(softRevalidate)
      } else {
        softRevalidate()
      }
    }

    // Add event listeners

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

    // register global cache update listener
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
        ...(!config.compare(updatedData, stateRef.current.data)
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
    let timer: any = null
    const tick = async () => {
      if (
        !stateRef.current.error &&
        (configRef.current.refreshWhenHidden ||
          configRef.current.isDocumentVisible()) &&
        (configRef.current.refreshWhenOffline || configRef.current.isOnline())
      ) {
        // only revalidate when the page is visible
        // if API request errored, we stop polling in this round
        // and let the error retry function handle it
        await revalidate({ dedupe: true })
      }
      // Read the latest refreshInterval
      if (configRef.current.refreshInterval && timer) {
        timer = setTimeout(tick, configRef.current.refreshInterval)
      }
    }
    if (configRef.current.refreshInterval) {
      timer = setTimeout(tick, configRef.current.refreshInterval)
    }
    return () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }
  }, [
    config.refreshInterval,
    config.refreshWhenHidden,
    config.refreshWhenOffline,
    revalidate
  ])

  // In Suspense mode, we can't return the empty `data` state.
  // If there is `error`, the `error` needs to be thrown to the error boundary.
  // If there is no `error`, the `revalidation` promise needs to be thrown to
  // the suspense boundary.
  if (config.suspense && data === undefined) {
    if (error === undefined) {
      throw revalidate({ dedupe: true })
    }
    throw error
  }

  // `mutate`, but bound to the current key.
  const boundMutate: SWRResponse<Data, Error>['mutate'] = useCallback(
    (newData, shouldRevalidate) => {
      return mutate(keyRef.current, newData, shouldRevalidate)
    },
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
  Object.defineProperties(state, {
    data: {
      get: function() {
        stateDependenciesRef.current.data = true
        return data
      },
      enumerable: true
    },
    error: {
      get: function() {
        stateDependenciesRef.current.error = true
        return error
      },
      enumerable: true
    },
    isValidating: {
      get: function() {
        stateDependenciesRef.current.isValidating = true
        return isValidating
      },
      enumerable: true
    }
  })

  // Display debug info in React DevTools.
  useDebugValue(data)

  return state
}

Object.defineProperty(SWRConfigContext.Provider, 'default', {
  value: defaultConfig
})
const SWRConfig = SWRConfigContext.Provider as typeof SWRConfigContext.Provider & {
  default: SWRConfiguration
}

export { trigger, mutate, SWRConfig }
export default useSWR
