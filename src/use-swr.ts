// TODO: use @ts-expect-error
import {
  useCallback,
  useContext,
  useState,
  useRef,
  useMemo,
  useDebugValue
} from 'react'

import defaultConfig, { cache } from './config'
import { IS_SERVER, rAF, useIsomorphicLayoutEffect } from './env'
import SWRConfigContext from './swr-config-context'
import {
  Action,
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

// global state managers
const CONCURRENT_PROMISES: Record<string, any> = {}
const CONCURRENT_PROMISES_TS: Record<string, number> = {}
const FOCUS_REVALIDATORS: Record<string, Revalidator[]> = {}
const RECONNECT_REVALIDATORS: Record<string, Revalidator[]> = {}
const CACHE_REVALIDATORS: Record<string, Updater[]> = {}
const MUTATION_TS: Record<string, number> = {}
const MUTATION_END_TS: Record<string, number> = {}

// generate strictly increasing timestamps
const now = (() => {
  let ts = 0
  return () => ++ts
})()

// setup DOM events listeners for `focus` and `reconnect` actions
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

  if (key && updaters) {
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
  const beforeConcurrentPromisesTs = CONCURRENT_PROMISES_TS[key]

  let data: any, error: unknown
  let isAsyncMutation = false

  if (_data && typeof _data === 'function') {
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
    if (
      beforeMutationTs !== MUTATION_TS[key] ||
      beforeConcurrentPromisesTs !== CONCURRENT_PROMISES_TS[key]
    ) {
      if (error) throw error
      return true
    }
  }

  // if there's a race we don't update cache or broadcast change, just return the data
  if (shouldAbort()) return data

  if (typeof data !== 'undefined') {
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
  if (updaters) {
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
  }
  // throw error or return data to be used by caller of mutate
  if (error) throw error
  return data
}

const clearDedupingInterval = (_key: keyInterface) => {
  const [key] = cache.serializeKey(_key)
  delete CONCURRENT_PROMISES[key]
  delete CONCURRENT_PROMISES_TS[key]
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
  const _key = args[0]
  const config = Object.assign(
    {},
    defaultConfig,
    useContext(SWRConfigContext),
    args.length > 2
      ? args[2]
      : args.length === 2 && typeof args[1] === 'object'
      ? args[1]
      : {}
  )

  // in typescript args.length > 2 is not same as args.lenth === 3
  // we do a safe type assertion here
  // args.length === 3
  const fn = (args.length > 2
    ? args[1]
    : args.length === 2 && typeof args[1] === 'function'
    ? args[1]
    : /**
          pass fn as null will disable revalidate
          https://paco.sh/blog/shared-hook-state-with-swr
        */
    args[1] === null
    ? args[1]
    : config.fetcher) as Fetcher<Data> | null

  // we assume `key` as the identifier of the request
  // `key` can change but `fn` shouldn't
  // (because `revalidate` only depends on `key`)
  // `keyErr` is the cache key for error objects
  const [key, fnArgs, keyErr, keyValidating] = cache.serializeKey(_key)

  const configRef = useRef(config)
  useIsomorphicLayoutEffect(() => {
    configRef.current = config
  })

  const willRevalidateOnMount = () => {
    return (
      config.revalidateOnMount ||
      (!config.initialData && config.revalidateOnMount === undefined)
    )
  }

  const resolveData = () => {
    const cachedData = cache.get(key)
    return typeof cachedData === 'undefined' ? config.initialData : cachedData
  }

  const resolveIsValidating = () => {
    return !!cache.get(keyValidating) || (key && willRevalidateOnMount())
  }

  const initialData = resolveData()
  const initialError = cache.get(keyErr)
  const initialIsValidating = resolveIsValidating()

  // if a state is accessed (data, error or isValidating),
  // we add the state to dependencies so if the state is
  // updated in the future, we can trigger a rerender
  const stateDependencies = useRef({
    data: false,
    error: false,
    isValidating: false
  })
  const stateRef = useRef({
    data: initialData,
    error: initialError,
    isValidating: initialIsValidating
  })

  // display the data label in the React DevTools next to SWR hooks
  useDebugValue(stateRef.current.data)

  const rerender = useState<unknown>({})[1]

  let dispatch = useCallback(
    (payload: Action<Data, Error>) => {
      let shouldUpdateState = false
      for (let k in payload) {
        // @ts-ignore
        if (stateRef.current[k] === payload[k]) {
          continue
        }
        // @ts-ignore
        stateRef.current[k] = payload[k]
        // @ts-ignore
        if (stateDependencies.current[k]) {
          shouldUpdateState = true
        }
      }

      if (shouldUpdateState) {
        // if component is unmounted, should skip rerender
        // if component is not mounted, should skip rerender
        if (unmountedRef.current || !initialMountedRef.current) return
        rerender({})
      }
    },
    // config.suspense isn't allowed to change during the lifecycle
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  // error ref inside revalidate (is last request errored?)
  const unmountedRef = useRef(false)
  const keyRef = useRef(key)

  // check if component is mounted in suspense mode
  const initialMountedRef = useRef(false)

  // do unmount check for callbacks
  const eventsCallback = useCallback(
    (event, ...params) => {
      if (unmountedRef.current) return
      if (!initialMountedRef.current) return
      if (key !== keyRef.current) return
      // @ts-ignore
      configRef.current[event](...params)
    },
    [key]
  )

  const boundMutate: SWRResponse<Data, Error>['mutate'] = useCallback(
    (data, shouldRevalidate) => {
      return mutate(keyRef.current, data, shouldRevalidate)
    },
    []
  )

  const addRevalidator = (
    revalidators: Record<string, Revalidator[]>,
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
        keyedRevalidators[index] =
          keyedRevalidators[keyedRevalidators.length - 1]
        keyedRevalidators.pop()
      }
    }
  }

  // start a revalidation
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
        dispatch({
          isValidating: true
        })
        cache.set(keyValidating, true)
        if (!shouldDeduping) {
          // also update other hooks
          broadcastState(
            key,
            stateRef.current.data,
            stateRef.current.error,
            true
          )
        }

        let newData
        let startAt

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
              if (loading) eventsCallback('onLoadingSlow', key, config)
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
            delete CONCURRENT_PROMISES[key]
            delete CONCURRENT_PROMISES_TS[key]
          }, config.dedupingInterval)

          // trigger the success event,
          // only do this for the original request.
          eventsCallback('onSuccess', newData, key, config)
        }

        // if there're other ongoing request(s), started after the current one,
        // we need to ignore the current one to avoid possible race conditions:
        //   req1------------------>res1        (current one)
        //        req2---------------->res2
        // the request that fired later will always be kept.
        if (CONCURRENT_PROMISES_TS[key] > startAt) {
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
          MUTATION_TS[key] &&
          // case 1
          (startAt <= MUTATION_TS[key] ||
            // case 2
            startAt <= MUTATION_END_TS[key] ||
            // case 3
            MUTATION_END_TS[key] === 0)
        ) {
          dispatch({ isValidating: false })
          return false
        }

        cache.set(keyErr, undefined)
        cache.set(keyValidating, false)

        // new state for the reducer
        const newState: Action<Data, Error> = {
          isValidating: false
        }

        if (typeof stateRef.current.error !== 'undefined') {
          // we don't have an error
          newState.error = undefined
        }
        if (!config.compare(stateRef.current.data, newData)) {
          // deep compare to avoid extra re-render
          // data changed
          newState.data = newData
        }

        if (!config.compare(cache.get(key), newData)) {
          cache.set(key, newData)
        }
        // merge the new state
        dispatch(newState)

        if (!shouldDeduping) {
          // also update other hooks
          broadcastState(key, newData, newState.error, false)
        }
      } catch (err) {
        delete CONCURRENT_PROMISES[key]
        delete CONCURRENT_PROMISES_TS[key]
        if (configRef.current.isPaused()) {
          dispatch({
            isValidating: false
          })
          return false
        }

        cache.set(keyErr, err)

        // get a new error
        // don't use deep equal for errors
        if (stateRef.current.error !== err) {
          // we keep the stale data
          dispatch({
            isValidating: false,
            error: err
          })

          if (!shouldDeduping) {
            // also broadcast to update other hooks
            broadcastState(key, undefined, err, false)
          }
        }

        // events and retry
        eventsCallback('onError', err, key, config)
        if (config.shouldRetryOnError) {
          // when retrying, we always enable deduping
          eventsCallback('onErrorRetry', err, key, config, revalidate, {
            retryCount: retryCount + 1,
            dedupe: true
          })
        }
      }

      loading = false
      return true
    },
    // dispatch is immutable, and `eventsCallback`, `fnArgs`, `keyErr`, and `keyValidating` are based on `key`,
    // so we can them from the deps array.
    //
    // FIXME:
    // `fn` and `config` might be changed during the lifecycle,
    // but they might be changed every render like this.
    // useSWR('key', () => fetch('/api/'), { suspense: true })
    // So we omit the values from the deps array
    // even though it might cause unexpected behaviors.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key]
  )

  // mounted (client side rendering)
  useIsomorphicLayoutEffect(() => {
    if (!key) return undefined

    // after `key` updates, we need to mark it as mounted
    unmountedRef.current = false

    const isUpdating = initialMountedRef.current
    initialMountedRef.current = true

    // after the component is mounted (hydrated),
    // we need to update the data from the cache
    // and trigger a revalidation

    const currentHookData = stateRef.current.data
    const latestKeyedData = resolveData()

    // update the state if the key changed (not the inital render) or cache updated
    keyRef.current = key

    if (!config.compare(currentHookData, latestKeyedData)) {
      dispatch({ data: latestKeyedData })
    }

    // revalidate with deduping
    const softRevalidate = () => revalidate({ dedupe: true })

    // trigger a revalidation
    if (isUpdating || willRevalidateOnMount()) {
      if (typeof latestKeyedData !== 'undefined' && !IS_SERVER) {
        // delay revalidate if there's cache
        // to not block the rendering

        // @ts-ignore it's safe to use requestAnimationFrame in browser
        rAF(softRevalidate)
      } else {
        softRevalidate()
      }
    }

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
      // update hook state
      const newState: Action<Data, Error> = {}
      let needUpdate = false

      if (
        typeof updatedData !== 'undefined' &&
        !config.compare(stateRef.current.data, updatedData)
      ) {
        newState.data = updatedData
        needUpdate = true
      }

      // always update error
      // because it can be `undefined`
      if (stateRef.current.error !== updatedError) {
        newState.error = updatedError
        needUpdate = true
      }

      if (
        typeof updatedIsValidating !== 'undefined' &&
        stateRef.current.isValidating !== updatedIsValidating
      ) {
        newState.isValidating = updatedIsValidating
        needUpdate = true
      }

      if (needUpdate) {
        dispatch(newState)
      }

      if (shouldRevalidate) {
        if (dedupe) {
          return softRevalidate()
        } else {
          return revalidate()
        }
      }
      return false
    }

    const unsubFocus = addRevalidator(FOCUS_REVALIDATORS, onFocus)
    const unsubReconnect = addRevalidator(RECONNECT_REVALIDATORS, onReconnect)
    const unsubUpdate = addRevalidator(CACHE_REVALIDATORS, onUpdate)

    return () => {
      // cleanup
      dispatch = () => null

      // mark it as unmounted
      unmountedRef.current = true

      unsubFocus()
      unsubReconnect()
      unsubUpdate()
    }
  }, [key, revalidate])

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

  // suspense
  let latestData: Data | undefined
  let latestError: unknown
  if (config.suspense) {
    // in suspense mode, we can't return empty state
    // (it should be suspended)

    // try to get data and error from cache
    latestData = cache.get(key)
    latestError = cache.get(keyErr)

    if (typeof latestData === 'undefined') {
      latestData = initialData
    }
    if (typeof latestError === 'undefined') {
      latestError = initialError
    }

    if (
      typeof latestData === 'undefined' &&
      typeof latestError === 'undefined'
    ) {
      // need to start the request if it hasn't
      if (!CONCURRENT_PROMISES[key]) {
        // trigger revalidate immediately
        // to get the promise
        // in this revalidate, should not rerender
        revalidate()
      }

      if (
        CONCURRENT_PROMISES[key] &&
        typeof CONCURRENT_PROMISES[key].then === 'function'
      ) {
        // if it is a promise
        throw CONCURRENT_PROMISES[key]
      }

      // it's a value, return it directly (override)
      latestData = CONCURRENT_PROMISES[key]
    }

    if (typeof latestData === 'undefined' && latestError) {
      // in suspense mode, throw error if there's no content
      throw latestError
    }
  }

  // define returned state
  // can be memorized since the state is a ref
  const memoizedState = useMemo(() => {
    // revalidate will be deprecated in the 1.x release
    // because mutate() covers the same use case of revalidate().
    // This remains only for backward compatibility
    const state = { revalidate, mutate: boundMutate } as SWRResponse<
      Data,
      Error
    >
    Object.defineProperties(state, {
      error: {
        // `key` might be changed in the upcoming hook re-render,
        // but the previous state will stay
        // so we need to match the latest key and data (fallback to `initialData`)
        get: function() {
          stateDependencies.current.error = true
          if (config.suspense) {
            return latestError
          }
          return keyRef.current === key ? stateRef.current.error : initialError
        },
        enumerable: true
      },
      data: {
        get: function() {
          stateDependencies.current.data = true
          if (config.suspense) {
            return latestData
          }
          return keyRef.current === key ? stateRef.current.data : initialData
        },
        enumerable: true
      },
      isValidating: {
        get: function() {
          stateDependencies.current.isValidating = true
          return key ? stateRef.current.isValidating : false
        },
        enumerable: true
      }
    })

    return state
    // `config.suspense` isn't allowed to change during the lifecycle.
    // `boundMutate` is immutable, and the immutability of `revalidate` depends on `key`
    // so we can omit them from the deps array,
    // but we put it to enable react-hooks/exhaustive-deps rule.
    // `initialData` and `initialError` are not initial values
    // because they are changed during the lifecycle
    // so we should add them in the deps array.
  }, [
    revalidate,
    initialData,
    initialError,
    boundMutate,
    key,
    config.suspense,
    latestError,
    latestData
  ])
  return memoizedState
}

Object.defineProperty(SWRConfigContext.Provider, 'default', {
  value: defaultConfig
})
const SWRConfig = SWRConfigContext.Provider as typeof SWRConfigContext.Provider & {
  default: SWRConfiguration
}

export { trigger, mutate, clearDedupingInterval, SWRConfig }
export default useSWR
