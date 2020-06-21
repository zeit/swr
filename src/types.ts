export type fetcherFn<Data> = (...args: any) => Data | Promise<Data>
export interface ConfigInterface<
  Data = any,
  Error = any,
  Fn extends fetcherFn<Data> = fetcherFn<Data>
> {
  errorRetryInterval?: number
  errorRetryCount?: number
  loadingTimeout?: number
  focusThrottleInterval?: number
  dedupingInterval?: number
  refreshInterval?: number
  refreshWhenHidden?: boolean
  refreshWhenOffline?: boolean
  revalidateOnFocus?: boolean
  revalidateOnMount?: boolean
  revalidateOnReconnect?: boolean
  shouldRetryOnError?: boolean
  fetcher?: Fn
  suspense?: boolean
  initialData?: Data

  onLoadingSlow?: (key: string, config: ConfigInterface<Data, Error>) => void
  onSuccess?: (
    data: Data,
    key: string,
    config: ConfigInterface<Data, Error>
  ) => void
  onError?: (
    err: Error,
    key: string,
    config: ConfigInterface<Data, Error>
  ) => void
  onErrorRetry?: (
    err: Error,
    key: string,
    config: ConfigInterface<Data, Error>,
    revalidate: revalidateType,
    revalidateOpts: RevalidateOptionInterface
  ) => void

  compare?: (a: Data | undefined, b: Data | undefined) => boolean
}

export interface RevalidateOptionInterface {
  retryCount?: number
  dedupe?: boolean
}

type keyFunction = () => string | any[] | null
export type keyInterface = keyFunction | string | any[] | null
export type updaterInterface<Data = any, Error = any> = (
  shouldRevalidate?: boolean,
  data?: Data,
  error?: Error,
  shouldDedupe?: boolean
) => boolean | Promise<boolean>
export type triggerInterface = (
  key: keyInterface,
  shouldRevalidate?: boolean
) => Promise<any>
type mutateCallback<Data = any> = (currentValue: Data) => Promise<Data> | Data
export type mutateInterface<Data = any> = (
  key: keyInterface,
  data?: Data | Promise<Data> | mutateCallback<Data>,
  shouldRevalidate?: boolean
) => Promise<Data | undefined>
export type broadcastStateInterface<Data = any, Error = any> = (
  key: string,
  data: Data,
  error?: Error
) => void
export type responseInterface<Data, Error> = {
  data?: Data
  error?: Error
  revalidate: () => Promise<boolean>
  mutate: (
    data?: Data | Promise<Data> | mutateCallback<Data>,
    shouldRevalidate?: boolean
  ) => Promise<Data | undefined>
  isValidating: boolean
}
export type revalidateType = (
  revalidateOpts: RevalidateOptionInterface
) => Promise<boolean>

export type pagesWithSWRType<Data, Error> = (
  swr: responseInterface<Data, Error>
) => responseInterface<Data, Error>
export type pagesPropsInterface<Offset, Data, Error> = {
  // offset can be any type
  offset: Offset
  withSWR: pagesWithSWRType<Data, Error>
}

export type pageComponentType<Offset, Data, Error> = (
  props: pagesPropsInterface<Offset, Data, Error>
) => any
export type pageOffsetMapperType<Offset, Data, Error> = (
  SWR: responseInterface<Data, Error>,
  index: number
) => Offset

export type pagesResponseInterface<Data, Error> = {
  pages: any
  pageCount: number
  pageSWRs: responseInterface<Data, Error>[]
  isLoadingMore: boolean
  isReachingEnd: boolean
  isEmpty: boolean
  loadMore: () => void
}

export type actionType<Data, Error> = {
  data?: Data
  error?: Error
  isValidating?: boolean
}

export interface CacheInterface {
  size(): number
  get(key: keyInterface): any
  set(key: keyInterface, value: any, shouldNotify?: boolean): any
  keys(): string[]
  has(key: keyInterface): boolean
  delete(key: keyInterface, shouldNotify?: boolean): void
  clear(shouldNotify?: boolean): void
  purge(): void
  serializeKey(key: keyInterface): [string, any, string]
  subscribe(listener: cacheListener, key: keyInterface): () => void
  toJSON(): { [key: string]: any }
  activate(key: keyInterface): void
  deactivate(key: keyInterface): void
  isActive(Key: keyInterface): void
}

export type eventType = 'set' | 'delete' | 'clear' | 'purge'

export type subscriptionEvent = { type: eventType; key?: string }

export type cacheListener = (event: subscriptionEvent) => void
