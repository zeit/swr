[![SWR](https://assets.vercel.com/image/upload/v1572289618/swr/banner.png)](https://swr.vercel.app)

<p align="center">

  <a aria-label="Vercel logo" href="https://vercel.com">
    <img src="https://badgen.net/badge/icon/Made%20by%20Vercel?icon=zeit&label&color=black&labelColor=black">
  </a>
  <br/>

  <a aria-label="NPM version" href="https://www.npmjs.com/package/swr">
    <img alt="" src="https://badgen.net/npm/v/swr">
  </a>
  <a aria-label="Package size" href="https://bundlephobia.com/result?p=swr">
    <img alt="" src="https://badgen.net/bundlephobia/minzip/swr">
  </a>
  <a aria-label="License" href="https://github.com/zeit/swr/blob/master/LICENSE">
    <img alt="" src="https://badgen.net/npm/license/swr">
  </a>
</p>

## Introduction

[swr.vercel.app](https://swr.vercel.app)

SWR is a React Hooks library for remote data fetching.

The name “**SWR**” is derived from `stale-while-revalidate`, a cache invalidation strategy popularized by [HTTP RFC 5861](https://tools.ietf.org/html/rfc5861).
**SWR** first returns the data from cache (stale), then sends the fetch request (revalidate), and finally comes with the up-to-date data again.

It features:

- Transport and protocol agnostic data fetching
- Fast page navigation
- Revalidation on focus
- Interval polling
- Request deduplication
- Local mutation
- Pagination
- TypeScript ready
- SSR support
- Suspense mode
- React Native support
- Minimal API

...and a lot more.

With SWR, components will get **a stream of data updates constantly and automatically**. Thus, the UI will be always **fast** and **reactive**.

<br/>

## Quick Start

```js
import useSWR from 'swr'

function Profile() {
  const { data, error } = useSWR('/api/user', fetcher)

  if (error) return <div>failed to load</div>
  if (!data) return <div>loading...</div>
  return <div>hello {data.name}!</div>
}
```

In this example, the React Hook `useSWR` accepts a `key` and a `fetcher` function.
The `key` is a unique identifier of the request, normally the URL of the API. And the `fetcher` accepts
`key` as its parameter and returns the data asynchronously.

`useSWR` also returns 2 values: `data` and `error`. When the request (fetcher) is not yet finished,
`data` will be `undefined`. And when we get a response, it sets `data` and `error` based on the result
of `fetcher` and rerenders the component.

Note that `fetcher` can be any asynchronous function, so you can use your favourite data-fetching
library to handle that part.

Check out [swr.vercel.app](https://swr.vercel.app) for more demos of SWR, and [Examples](#examples) for the best practices.

<br/>

## Usage

Inside your React project directory, run the following:

```
yarn add swr
```

Or with npm:

```
npm install swr
```

### API

```js
const { data, error, isValidating, mutate } = useSWR(key, fetcher, options)
```

#### Parameters

- `key`: a unique key string for the request (or a function / array / null) [(advanced usage)](#conditional-fetching)
- `fetcher`: (_optional_) a Promise returning function to fetch your data [(details)](#data-fetching)
- `options`: (_optional_) an object of options for this SWR hook

#### Return Values

- `data`: data for the given key resolved by `fetcher` (or undefined if not loaded)
- `error`: error thrown by `fetcher` (or undefined)
- `isValidating`: if there's a request or revalidation loading
- `mutate(data?, shouldRevalidate?)`: function to mutate the cached data

#### Options

- `suspense = false`: enable React Suspense mode [(details)](#suspense-mode)
- `fetcher = undefined`: the default fetcher function
- `initialData`: initial data to be returned (note: This is per-hook)
- `revalidateOnMount`: enable or disable automatic revalidation when component is mounted (by default revalidation occurs on mount when initialData is not set, use this flag to force behavior)
- `revalidateOnFocus = true`: auto revalidate when window gets focused
- `revalidateOnReconnect = true`: automatically revalidate when the browser regains a network connection (via `navigator.onLine`)
- `refreshInterval = 0`: polling interval (disabled by default)
- `refreshWhenHidden = false`: polling when the window is invisible (if `refreshInterval` is enabled)
- `refreshWhenOffline = false`: polling when the browser is offline (determined by `navigator.onLine`)
- `shouldRetryOnError = true`: retry when fetcher has an error [(details)](#error-retries)
- `dedupingInterval = 2000`: dedupe requests with the same key in this time span
- `focusThrottleInterval = 5000`: only revalidate once during a time span
- `loadingTimeout = 3000`: timeout to trigger the onLoadingSlow event
- `errorRetryInterval = 5000`: error retry interval [(details)](#error-retries)
- `errorRetryCount`: max error retry count [(details)](#error-retries)
- `subscribe(key, mutate): () => void`: effect handler to run a subscription for the key
- `onLoadingSlow(key, config)`: callback function when a request takes too long to load (see `loadingTimeout`)
- `onSuccess(data, key, config)`: callback function when a request finishes successfully
- `onError(err, key, config)`: callback function when a request returns an error
- `onErrorRetry(err, key, config, revalidate, revalidateOps)`: handler for [error retry](#error-retries)
- `compare(a, b)`: comparison function used to detect when returned data has changed, to avoid spurious rerenders. By default, [`dequal/lite`](https://github.com/lukeed/dequal) is used.

When under a slow network (2G, <= 70Kbps), `errorRetryInterval` will be 10s, and
`loadingTimeout` will be 5s by default.

You can also use a [global configuration](#global-configuration) to provide default options.

<br/>

## Examples

- [Global Configuration](#global-configuration)
- [Data Fetching](#data-fetching)
- [Conditional Fetching](#conditional-fetching)
- [Dependent Fetching](#dependent-fetching)
- [Multiple Arguments](#multiple-arguments)
- [Manually Revalidate](#manually-revalidate)
- [Mutation and Post Request](#mutation-and-post-request)
- [Mutate Based on Current Data](#mutate-based-on-current-data)
- [Returned Data from Mutate](#returned-data-from-mutate)
- [SSR with Next.js](#ssr-with-nextjs)
- [Suspense Mode](#suspense-mode)
- [Error Retries](#error-retries)
- [Prefetching Data](#prefetching-data)
- [Subscriptions](#subscriptions)
- [Request Deduplication](#request-deduplication)

### Global Configuration

The context `SWRConfig` can provide global configurations (`options`) for all SWR hooks.

In this example, all SWRs will use the same fetcher provided to load JSON data, and refresh every 3 seconds by default:

```js
import useSWR, { SWRConfig } from 'swr'

function Dashboard() {
  const { data: events } = useSWR('/api/events')
  const { data: projects } = useSWR('/api/projects')
  const { data: user } = useSWR('/api/user', { refreshInterval: 0 }) // don't refresh
  // ...
}

function App() {
  return (
    <SWRConfig
      value={{
        refreshInterval: 3000,
        fetcher: (...args) => fetch(...args).then(res => res.json())
      }}
    >
      <Dashboard />
    </SWRConfig>
  )
}
```

### Data Fetching

`fetcher` is a function that **accepts the `key`** of SWR, and returns a value or a Promise.
You can use any library to handle data fetching, for example:

```js
import fetch from 'unfetch'

const fetcher = url => fetch(url).then(r => r.json())

function App() {
  const { data } = useSWR('/api/data', fetcher)
  // ...
}
```

Or using GraphQL:

```js
import { request } from 'graphql-request'

const API = 'https://api.graph.cool/simple/v1/movies'
const fetcher = query => request(API, query)

function App() {
  const { data, error } = useSWR(
    `{
      Movie(title: "Inception") {
        releaseDate
        actors {
          name
        }
      }
    }`,
    fetcher
  )
  // ...
}
```

_If you want to pass variables to a GraphQL query, check out [Multiple Arguments](#multiple-arguments)._

Note that `fetcher` can be omitted from the parameters if it's provided globally.

### Conditional Fetching

Use `null` or pass a function as the `key` to `useSWR` to conditionally fetch data. If the functions throws an error or returns a falsy value, SWR will cancel the request.

```js
// conditionally fetch
const { data } = useSWR(shouldFetch ? '/api/data' : null, fetcher)

// ...or return a falsy value
const { data } = useSWR(() => shouldFetch ? '/api/data' : null, fetcher)

// ... or throw an error when user.id is not defined
const { data } = useSWR(() => '/api/data?uid=' + user.id, fetcher)
```

### Dependent Fetching

SWR also allows you to fetch data that depends on other data. It ensures the maximum possible parallelism (avoiding waterfalls), as well as serial fetching when a piece of dynamic data is required for the next data fetch to happen.

```js
function MyProjects() {
  const { data: user } = useSWR('/api/user')
  const { data: projects } = useSWR(() => '/api/projects?uid=' + user.id)
  // When passing a function, SWR will use the return
  // value as `key`. If the function throws or returns
  // falsy, SWR will know that some dependencies are not
  // ready. In this case `user.id` throws when `user`
  // isn't loaded.

  if (!projects) return 'loading...'
  return 'You have ' + projects.length + ' projects'
}
```

### Multiple Arguments

In some scenarios, it's useful to pass multiple arguments (can be any value or object) to the `fetcher` function. For example:

```js
useSWR('/api/user', url => fetchWithToken(url, token))
```

This is **incorrect**. Because the identifier (also the index of the cache) of the data is `'/api/data'`,
so even if `token` changes, SWR will still have the same key and return the wrong data.

Instead, you can use an **array** as the `key` parameter, which contains multiple arguments of `fetcher`:

```js
const { data: user } = useSWR(['/api/user', token], fetchWithToken)

// ...and pass it as an argument to another query
const { data: orders } = useSWR(user ? ['/api/orders', user] : null, fetchWithUser)
```

The key of the request is now the combination of both values. SWR **shallowly** compares
the arguments on every render and triggers revalidation if any of them has changed.
Keep in mind that you should not recreate objects when rendering, as they will be treated as different objects on every render:

```js
// Don’t do this! Deps will be changed on every render.
useSWR(['/api/user', { id }], query)

// Instead, you should only pass “stable” values.
useSWR(['/api/user', id], (url, id) => query(url, { id }))
```

Dan Abramov explains dependencies very well in [this blog post](https://overreacted.io/a-complete-guide-to-useeffect/#but-i-cant-put-this-function-inside-an-effect).

### Manually Revalidate

You can broadcast a revalidation message globally to all SWRs with the same key by calling
`mutate(key)`.

This example shows how to automatically refetch the login info (e.g.: inside `<Profile/>`)
when the user clicks the “Logout” button.

```js
import useSWR, { mutate } from 'swr'

function App() {
  return (
    <div>
      <Profile />
      <button onClick={() => {
        // set the cookie as expired
        document.cookie = 'token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'

        // tell all SWRs with this key to revalidate
        mutate('/api/user')
      }}>
        Logout
      </button>
    </div>
  )
}
```

### Mutation and Post Request

In many cases, applying local mutations to data is a good way to make changes
feel faster — no need to wait for the remote source of data.

With `mutate`, you can update your local data programmatically, while
revalidating and finally replace it with the latest data.

```js
import useSWR, { mutate } from 'swr'

function Profile() {
  const { data } = useSWR('/api/user', fetcher)

  return (
    <div>
      <h1>My name is {data.name}.</h1>
      <button onClick={async () => {
        const newName = data.name.toUpperCase()
        // send a request to the API to update the data
        await requestUpdateUsername(newName)
        // update the local data immediately and revalidate (refetch)
        // NOTE: key has to be passed to mutate as it's not bound
        mutate('/api/user', { ...data, name: newName })
      }}>Uppercase my name!</button>
    </div>
  )
}
```

Clicking the button in the example above will send a POST request to modify the remote data, locally update the client data and
try to fetch the latest one (revalidate).

But many POST APIs will just return the updated data directly, so we don’t need to revalidate again.
Here’s an example showing the “local mutate - request - update” usage:

```js
mutate('/api/user', newUser, false)      // use `false` to mutate without revalidation
mutate('/api/user', updateUser(newUser)) // `updateUser` is a Promise of the request,
                                         // which returns the updated document
```

### Mutate Based on Current Data

In many cases, you are receiving a single value back from your API and want to update a list of them.

With `mutate`, you can pass an async function which will receive the current cached value, if any, and let you return an updated document.

```js
mutate('/api/users', async users => {
  const user = await fetcher('/api/users/1')
  return [user, ...users.slice(1)]
})
```

### Returned Data from Mutate

Most probably, you need some data to update the cache. The data is resolved or returned from the promise or async function you passed to `mutate`.

The function will return an updated document to let `mutate` update the corresponding cache value. It could throw an error somehow, every time when you call it.

```js
try {
  const user = await mutate('/api/user', updateUser(newUser))
} catch (error) {
  // Handle an error while updating the user here
}
```

### Bound `mutate()`

The SWR object returned by `useSWR` also contains a `mutate()` function that is pre-bound to the SWR's key.

It is functionally equivalent to the global `mutate` function but does not require the `key` parameter.

```js
import useSWR from 'swr'

function Profile() {
  const { data, mutate } = useSWR('/api/user', fetcher)

  return (
    <div>
      <h1>My name is {data.name}.</h1>
      <button onClick={async () => {
        const newName = data.name.toUpperCase()
        // send a request to the API to update the data
        await requestUpdateUsername(newName)
        // update the local data immediately and revalidate (refetch)
        // NOTE: key is not required when using useSWR's mutate as it's pre-bound
        mutate({ ...data, name: newName })
      }}>Uppercase my name!</button>
    </div>
  )
}
```

### SSR with Next.js

With the `initialData` option, you pass an initial value to the hook. It works perfectly with many SSR solutions
such as `getServerSideProps` in [Next.js](https://github.com/zeit/next.js):

```js
export async function getServerSideProps() {
  const data = await fetcher('/api/data')
  return { props: { data } }
}

function App(props) {
  const initialData = props.data
  const { data } = useSWR('/api/data', fetcher, { initialData })

  return <div>{data}</div>
}
```

It is still a server-side rendered site, but it’s also fully powered by SWR in the client-side.
Which means the data can be dynamic and update itself over time and user interactions.

### Suspense Mode

You can enable the `suspense` option to use SWR with React Suspense:

```js
import { Suspense } from 'react'
import useSWR from 'swr'

function Profile() {
  const { data } = useSWR('/api/user', fetcher, { suspense: true })
  return <div>hello, {data.name}</div>
}

function App() {
  return (
    <Suspense fallback={<div>loading...</div>}>
      <Profile/>
    </Suspense>
  )
}
```

In Suspense mode, `data` is always the fetch response (so you don't need to check if it's `undefined`).
But if an error occurred, you need to use an [error boundary](https://reactjs.org/docs/concurrent-mode-suspense.html#handling-errors) to catch it.

_Note that Suspense is not supported in SSR mode._

### Error Retries

By default, SWR uses the [exponential backoff algorithm](https://en.wikipedia.org/wiki/Exponential_backoff) to handle error retries.
You can read more from the source code.

It's also possible to override the behavior:

```js
useSWR(key, fetcher, {
  onErrorRetry: (error, key, option, revalidate, { retryCount }) => {
    if (retryCount >= 10) return
    if (error.status === 404) return

    // retry after 5 seconds
    setTimeout(() => revalidate({ retryCount: retryCount + 1 }), 5000)
  }
})
```

### Prefetching Data

There’re many ways to prefetch the data for SWR. For top-level requests, [`rel="preload"`](https://developer.mozilla.org/en-US/docs/Web/HTML/Preloading_content) is highly recommended:

```html
<link rel="preload" href="/api/data" as="fetch" crossorigin="anonymous">
```

This will prefetch the data before the JavaScript starts downloading. And your incoming fetch requests will reuse the result (including SWR, of course).

Another choice is to prefetch the data conditionally. You can have a function to refetch and set the cache:

```js
function prefetch() {
  mutate('/api/data', fetch('/api/data').then(res => res.json()))
  // the second parameter is a Promise
  // SWR will use the result when it resolves
}
```

And use it when you need to preload the **resources** (for example when [hovering](https://github.com/GoogleChromeLabs/quicklink) [a](https://github.com/guess-js/guess) [link](https://instant.page)).
Together with techniques like [page prefetching](https://nextjs.org/docs#prefetching-pages) in Next.js, you will be able to load both next page and data instantly.

### Subscriptions

You can run a subscription to get new data in real-time and update the cache passing a `subscribe` option to SWR. This function receives the `key` passed to SWR, and it receives the `mutate` function with the key already defined, as received from `useSWR`, this `mutate` function should be used to update the value when a new one comes from the stream of data the hook is subscribed to.

The `subscribe` function must return a new function used to unsubscribe. This is similar to how effects work.

```js
import useSWR from 'swr'

function fetcher() {
  return new Promise((resolve, reject) => {
    const onSuccess = ({ coords }) => {
      resolve({
        latitude: coords.latitude,
        longitude: coords.longitude
      })
    }

    navigator.geolocation.getCurrentPosition(onSuccess, reject)
  })
}

function subscribe(_, mutate) {
  const id = navigator.geolocation.watchPosition(position => {
    const coords = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude
    }

    mutate(coords, false)
  })
  return () => navigator.geolocation.clearWatch(id)
}

function App() {
  const { data: position } = useSWR('geolocation', fetcher, { subscribe })

  if (!position) return null

  return <Map latitude={position.latitude} longitude={position.longitude} />
}
```

_Note the subscribe function must be stable between renders, use [useCallback](https://reactjs.org/docs/hooks-reference.html#usecallback) if you need to use props or state inside the subscribe function. Everytime the subscribe function change SWR will unsubscribe and subscribe again.

### Request Deduplication

SWR deduplicates requests by default. If you call the hook with the same key multiple times, only one request is made. Duplicated calls will receive a value from cache.
Here, the 'api/user' key is used in two requests:

```js
import useSWR from 'swr'

function UserProfileName() {
  const { data, error } = useSWR('/api/user', fetcher)

  if (error) return <div>failed to load</div>
  if (!data) return <div>loading...</div>
  return <p>Name: {data.name}!</p>
}

function UserProfileAvatar() {
  const { data, error } = useSWR('/api/user', fetcher)

  if (error) return <div>failed to load</div>
  if (!data) return <div>loading...</div>
  return <img src={data.avatarUrl} alt="Profile image" />
}

export default function App() {
  return (
    <div>
      <UserAvatar />
      <UserProfile />
    </div>
  )
}
```

By default, requests made within 2 seconds are deduped. This can be changed by setting the `dedupingInterval` option:

```js
const { data, error } = useSWR('/api/user', fetcher, { dedupingInterval: 1000 })
```

This will deduplicate requests at an interval of 1 second.

<br/>

## Authors

- Shu Ding ([@shuding_](https://twitter.com/shuding_)) – [Vercel](https://vercel.com)
- Guillermo Rauch ([@rauchg](https://twitter.com/rauchg)) – [Vercel](https://vercel.com)
- Joe Haddad ([@timer150](https://twitter.com/timer150)) - [Vercel](https://vercel.com)
- Paco Coursey ([@pacocoursey](https://twitter.com/pacocoursey)) - [Vercel](https://vercel.com)

Thanks to Ryan Chen for providing the awesome `swr` npm package name!

<br/>

## License

The MIT License.
