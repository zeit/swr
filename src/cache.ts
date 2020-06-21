import { CacheInterface, keyInterface, cacheListener, eventType } from './types'
import { mutate } from './use-swr'
import hash from './libs/hash'

// This wildcard key exists to allow subscribers to don't specify a key
// The symbol is not exposed to avoid people to use it, it's for internal
// usage only
const WILDCARD_KEY = Symbol()

// This env variable let you customize the max size of the cache
const MAX_SIZE = Number(process.env.SWR_CACHE_MAX_SIZE || 300)

export default class Cache implements CacheInterface {
  private __cache: Map<string, any>
  private __inactive: Set<string>
  private __listeners: Map<string | typeof WILDCARD_KEY, Set<cacheListener>>

  constructor() {
    this.__cache = new Map()
    this.__inactive = new Set()
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
    this.trigger('set', _key)
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
    this.trigger('clear')
  }

  delete(key: keyInterface, shouldNotify = true) {
    const [_key] = this.serializeKey(key)
    if (shouldNotify) mutate(key, null, false)
    this.__cache.delete(_key)
    this.trigger('delete', _key)
  }

  isActive(key: keyInterface) {
    const [_key] = this.serializeKey(key)
    return !this.__inactive.has(_key)
  }

  size() {
    return this.__cache.size
  }

  purge() {
    // only purge keys if we have reached the max allowed size
    if (this.size() < MAX_SIZE) return
    // here we delete the inactive keys first directly from cache
    // this is to avoid triggering an event to listeners
    this.__inactive.forEach(key => this.__cache.delete(key))
    // then we clear the list of inactive keys
    this.__inactive.clear()
    // and now we try to deactivate all the keys
    // this will deactivate any extra key that was not truly active
    this.keys().forEach(key => this.deactivate(key))
    // lastly, we will trigger a purge notification to all the subscribers
    this.trigger('purge')
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
    let errKey: string
    if (key) {
      const serialized = this.serializeKey(key)
      _key = serialized[0]
      errKey = serialized[2]
    }

    let isSubscribed = true
    if (this.__listeners.has(_key)) {
      this.__listeners.get(_key).add(listener)
    } else {
      this.__listeners.set(_key, new Set<cacheListener>([listener]))
    }

    // mark as active the key and error key, if it's not wildcard
    if (_key !== WILDCARD_KEY) {
      this.activate(_key)
      this.activate(errKey)
    }

    return () => {
      if (!isSubscribed) return
      isSubscribed = false
      this.__listeners.get(_key).delete(listener)
      // mark as inactive the key and error key if it's not wildcard
      if (_key !== WILDCARD_KEY) {
        this.deactivate(_key)
        this.deactivate(errKey)
      }
      // every time a key listener is unsubscribed try to purge the cache
      this.purge()
    }
  }

  toJSON() {
    return Object.fromEntries(this.__cache.entries())
  }

  // mark a key as active
  activate(key: keyInterface) {
    const [_key] = this.serializeKey(key)
    // if the key was inactive re-activate it
    if (this.__inactive.has(_key)) {
      this.__inactive.delete(_key)
    }
  }

  // check if a key is active and deactivate it if not
  deactivate(key: keyInterface) {
    const [_key] = this.serializeKey(key)
    // if it's already inactive do nothing
    if (this.__inactive.has(_key)) return
    // if there are no listeners subscriber deactivate it
    if (!this.__listeners.has(_key)) {
      this.__inactive.add(_key)
      return
    }
    // if the list of subscribers is empty deactivate it
    if (this.__listeners.get(_key).size === 0) this.__inactive.add(_key)
  }

  // Notify Cache subscribers about a change in the cache
  private trigger(type: eventType, key?: string) {
    // we handle the purge event in a special way to only notify
    // wildcard subscribers, so they know a purge has happened
    if (type === 'purge') {
      const event = { type }
      this.__listeners.get(WILDCARD_KEY).forEach(listener => listener(event))
    }

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
