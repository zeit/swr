import { CacheInterface, keyInterface, cacheListener, eventType } from './types'
import { mutate } from './use-swr'
import hash from './libs/hash'

// This wildcard key exists to allow subscribers to don't specify a key
// The symbol is not exposed to avoid people to use it, it's for internal
// usage only
const WILDCARD_KEY = Symbol()

export default class Cache implements CacheInterface {
  private __cache: Map<string, any>
  private __listeners: Map<string | typeof WILDCARD_KEY, Set<cacheListener>>

  constructor() {
    this.__cache = new Map()
    this.__listeners = new Map([[WILDCARD_KEY, new Set<cacheListener>()]])
  }

  get(key: keyInterface): any {
    const [_key] = this.serializeKey(key)
    return this.__cache.get(_key)
  }

  set(key: keyInterface, value: any, shouldNotify = true): any {
    const [_key] = this.serializeKey(key)
    this.__cache.set(_key, value)
    if (shouldNotify) mutate(key, value, false)
    this.notify('set', _key)
  }

  keys() {
    return Array.from(this.__cache.keys())
  }

  has(key: keyInterface) {
    const [_key] = this.serializeKey(key)
    return this.__cache.has(_key)
  }

  clear(shouldNotify = true) {
    if (shouldNotify) this.__cache.forEach(key => mutate(key, null, false))
    this.__cache.clear()
    this.notify('clear')
  }

  delete(key: keyInterface, shouldNotify = true) {
    const [_key] = this.serializeKey(key)
    if (shouldNotify) mutate(key, null, false)
    this.__cache.delete(_key)
    this.notify('delete', _key)
  }

  // TODO: introduce namespace for the cache
  serializeKey(key: keyInterface): [string, any, string] {
    let args = null
    if (typeof key === 'function') {
      try {
        key = key()
      } catch (err) {
        // dependencies not ready
        key = ''
      }
    }

    if (Array.isArray(key)) {
      // args array
      args = key
      key = hash(key)
    } else {
      // convert null to ''
      key = String(key || '')
    }

    const errorKey = key ? 'err@' + key : ''

    return [key, args, errorKey]
  }

  subscribe(listener: cacheListener, key?: keyInterface) {
    if (typeof listener !== 'function') {
      throw new Error('Expected the listener to be a function.')
    }

    let _key: string | typeof WILDCARD_KEY = WILDCARD_KEY
    if (key) {
      _key = this.serializeKey(key)[0]
    }

    let isSubscribed = true
    if (this.__listeners.has(_key)) {
      this.__listeners.get(_key).add(listener)
    } else {
      this.__listeners.set(_key, new Set<cacheListener>([listener]))
    }

    return () => {
      if (!isSubscribed) return
      isSubscribed = false
      this.__listeners.get(_key).delete(listener)
    }
  }

  toJSON() {
    return Object.fromEntries(this.__cache.entries())
  }

  // Notify Cache subscribers about a change in the cache
  private notify(type: eventType, key?: string) {
    if (key) {
      const event = { key, type }
      // Call listeners subscribed to all keys
      this.__listeners.get(WILDCARD_KEY).forEach(listener => listener(event))
      if (this.__listeners.has(key)) {
        // Call listeners subscribed to the updated key
        this.__listeners.get(key).forEach(listener => listener(event))
      }
    } else {
      const typeEvent = { type }
      // Call all the listeners regardless of the key
      this.__listeners.forEach((listeners, _key) => {
        const event = typeof _key === 'symbol' ? typeEvent : { type, key: _key }
        listeners.forEach(listener => listener(event))
      })
    }
  }
}
