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

SWR is a React Hooks library for data fetching.

The name “**SWR**” is derived from `stale-while-revalidate`, a cache invalidation strategy popularized by [HTTP RFC 5861](https://tools.ietf.org/html/rfc5861).
**SWR** first returns the data from cache (stale), then sends the fetch request (revalidate), and finally comes with the up-to-date data again.

With just one single line of code, you can simplify the logic of data fetching in your project, and also have all these amazing features out-of-the-box:

- Transport and protocol agnostic
- Fast, lightweight and reusable
- Built-in cache and request deduplication
- Built-in error retry
- Revalidation on focus and network recovery
- Pagination and scroll position recovery
- Local mutation (Optimistic UI)
- Polling support
- SSR support
- Suspense mode
- React Native ready
- TypeScript ready

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

<br/>

## Documentation and Examples

Check out [swr.vercel.app](https://swr.vercel.app) for documentation and examples!

<br/>

## Authors

- Shu Ding ([@shuding\_](https://twitter.com/shuding_)) – [Vercel](https://vercel.com)
- Guillermo Rauch ([@rauchg](https://twitter.com/rauchg)) – [Vercel](https://vercel.com)
- Joe Haddad ([@timer150](https://twitter.com/timer150)) - [Vercel](https://vercel.com)
- Paco Coursey ([@pacocoursey](https://twitter.com/pacocoursey)) - [Vercel](https://vercel.com)

Thanks to Ryan Chen for providing the awesome `swr` npm package name!

<br/>

## License

The MIT License.
