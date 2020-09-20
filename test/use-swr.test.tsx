import {
  act,
  cleanup,
  fireEvent,
  render,
  waitForDomChange
} from '@testing-library/react'
import React, { ReactNode, Suspense, useEffect, useState } from 'react'

import useSWR, { mutate, SWRConfig, trigger, cache } from '../src'
import Cache from '../src/cache'

class ErrorBoundary extends React.Component<{ fallback: ReactNode }> {
  state = { hasError: false }
  static getDerivedStateFromError() {
    return {
      hasError: true
    }
  }
  render() {
    if (this.state.hasError) {
      return this.props.fallback
    }
    return this.props.children
  }
}

describe('useSWR', () => {
  afterEach(cleanup)

  it('should return `undefined` on hydration', () => {
    function Page() {
      const { data } = useSWR('constant-1', () => 'SWR')
      return <div>hello, {typeof data === 'undefined' ? '' : 'ERROR'}</div>
    }
    const { container } = render(<Page />)

    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"hello, "`)
  })

  it('should return data after hydration', async () => {
    function Page() {
      const { data } = useSWR('constant-2', () => 'SWR')
      return <div>hello, {data}</div>
    }
    const { container } = render(<Page />)

    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"hello, "`)
    await waitForDomChange({ container }) // mount
    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"hello, SWR"`
    )
  })

  it('should allow functions as key and reuse the cache', async () => {
    function Page() {
      const { data } = useSWR(() => 'constant-2', () => 'SWR')
      return <div>hello, {data}</div>
    }
    const { container } = render(<Page />)

    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"hello, SWR"`
    )
  })

  it('should allow async fetcher functions', async () => {
    function Page() {
      const { data } = useSWR(
        'constant-3',
        () => new Promise(res => setTimeout(() => res('SWR'), 200))
      )
      return <div>hello, {data}</div>
    }
    const { container } = render(<Page />)

    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"hello, "`)
    await waitForDomChange({ container })
    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"hello, SWR"`
    )
  })

  it('should not call fetch function when revalidateOnMount is false', async () => {
    const fetch = jest.fn(() => 'SWR')

    function Page() {
      const { data } = useSWR('revalidateOnMount', fetch, {
        revalidateOnMount: false
      })
      return <div>hello, {data}</div>
    }

    render(<Page />)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('should call fetch function when revalidateOnMount is true even if initialData is set', async () => {
    const fetch = jest.fn(() => 'SWR')

    function Page() {
      const { data } = useSWR('revalidateOnMount', fetch, {
        revalidateOnMount: true,
        initialData: 'gab'
      })
      return <div>hello, {data}</div>
    }

    const { container } = render(<Page />)
    await waitForDomChange({ container })
    expect(fetch).toHaveBeenCalled()
  })

  it('should dedupe requests by default', async () => {
    let count = 0
    const fetch = () => {
      count++
      return new Promise(res => setTimeout(() => res('SWR'), 200))
    }

    function Page() {
      const { data: v1 } = useSWR('constant-4', fetch)
      const { data: v2 } = useSWR('constant-4', fetch)
      return (
        <div>
          {v1}, {v2}
        </div>
      )
    }
    const { container } = render(<Page />)

    expect(container.firstChild.textContent).toMatchInlineSnapshot(`", "`)
    await waitForDomChange({ container })
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"SWR, SWR"`)
    // only fetches once
    expect(count).toEqual(1)
  })

  it('should trigger the onSuccess event', async () => {
    let SWRData = null
    function Page() {
      const { data } = useSWR(
        'constant-5',
        () => new Promise(res => setTimeout(() => res('SWR'), 200)),
        { onSuccess: _data => (SWRData = _data) }
      )
      return <div>hello, {data}</div>
    }
    const { container } = render(<Page />)

    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"hello, "`)
    await waitForDomChange({ container })
    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"hello, SWR"`
    )
    expect(SWRData).toEqual('SWR')
  })

  it('should broadcast data', async () => {
    let cnt = 0

    function Block() {
      const { data } = useSWR('broadcast-1', () => cnt++, {
        refreshInterval: 100,
        // need to turn of deduping otherwise
        // refreshing will be ignored
        dedupingInterval: 10
      })
      return <>{data}</>
    }
    function Page() {
      return (
        <>
          <Block /> <Block /> <Block />
        </>
      )
    }
    const { container } = render(<Page />)
    await act(() => new Promise(res => setTimeout(res, 10)))
    expect(container.textContent).toMatchInlineSnapshot(`"0 0 0"`)
    await act(() => new Promise(res => setTimeout(res, 100)))
    expect(container.textContent).toMatchInlineSnapshot(`"1 1 1"`)
    await act(() => new Promise(res => setTimeout(res, 100)))
    expect(container.textContent).toMatchInlineSnapshot(`"2 2 2"`)
  })

  it('should broadcast error', async () => {
    let cnt = 0

    function Block() {
      const { data, error } = useSWR(
        'broadcast-2',
        () => {
          if (cnt === 2) throw new Error('err')
          return cnt++
        },
        {
          refreshInterval: 100,
          // need to turn of deduping otherwise
          // refreshing will be ignored
          dedupingInterval: 10
        }
      )
      if (error) return error.message
      return <>{data}</>
    }
    function Page() {
      return (
        <>
          <Block /> <Block /> <Block />
        </>
      )
    }
    const { container } = render(<Page />)
    await act(() => new Promise(res => setTimeout(res, 10)))
    expect(container.textContent).toMatchInlineSnapshot(`"0 0 0"`)
    await act(() => new Promise(res => setTimeout(res, 100)))
    expect(container.textContent).toMatchInlineSnapshot(`"1 1 1"`)
    await act(() => new Promise(res => setTimeout(res, 100)))
    expect(container.textContent).toMatchInlineSnapshot(`"err err err"`)
  })

  it('should broadcast isValidating', async () => {
    function useBroadcast3() {
      const { isValidating, revalidate } = useSWR(
        'broadcast-3',
        () => new Promise(res => setTimeout(res, 100)),
        {
          // need to turn of deduping otherwise
          // revalidating will be ignored
          dedupingInterval: 10
        }
      )
      return { isValidating, revalidate }
    }
    function Initiator() {
      const { isValidating, revalidate } = useBroadcast3()
      useEffect(() => {
        const timeout = setTimeout(() => {
          revalidate()
        }, 200)
        return () => clearTimeout(timeout)
      }, [])
      return <>{isValidating ? 'true' : 'false'}</>
    }
    function Consumer() {
      const { isValidating } = useBroadcast3()
      return <>{isValidating ? 'true' : 'false'}</>
    }
    function Page() {
      return (
        <>
          <Initiator /> <Consumer /> <Consumer />
        </>
      )
    }
    const { container } = render(<Page />)
    expect(container.textContent).toMatchInlineSnapshot(`"true true true"`)
    await act(() => new Promise(res => setTimeout(res, 100)))
    expect(container.textContent).toMatchInlineSnapshot(`"false false false"`)
    await act(() => new Promise(res => setTimeout(res, 100)))
    expect(container.textContent).toMatchInlineSnapshot(`"true true true"`)
    await act(() => new Promise(res => setTimeout(res, 100)))
    expect(container.textContent).toMatchInlineSnapshot(`"false false false"`)
  })

  it('should accept object args', async () => {
    const obj = { v: 'hello' }
    const arr = ['world']

    function Page() {
      const { data: v1 } = useSWR(
        ['args-1', obj, arr],
        (a, b, c) => a + b.v + c[0]
      )

      // reuse the cache
      const { data: v2 } = useSWR(['args-1', obj, arr], () => 'not called!')

      // different object
      const { data: v3 } = useSWR(
        ['args-2', obj, 'world'],
        (a, b, c) => a + b.v + c
      )

      return (
        <div>
          {v1}, {v2}, {v3}
        </div>
      )
    }

    const { container } = render(<Page />)

    await waitForDomChange({ container })
    expect(container.textContent).toMatchInlineSnapshot(
      `"args-1helloworld, args-1helloworld, args-2helloworld"`
    )
  })

  it('should accept function returning args', async () => {
    const obj = { v: 'hello' }
    const arr = ['world']

    function Page() {
      const { data } = useSWR(
        () => ['args-3', obj, arr],
        (a, b, c) => a + b.v + c[0]
      )

      return <div>{data}</div>
    }

    const { container } = render(<Page />)

    await waitForDomChange({ container })
    expect(container.textContent).toMatchInlineSnapshot(`"args-3helloworld"`)
  })

  it('should accept initial data', async () => {
    const fetcher = jest.fn(() => 'SWR')

    function Page() {
      const { data } = useSWR('initial-data-1', fetcher, {
        initialData: 'Initial'
      })
      return <div>hello, {data}</div>
    }

    const { container } = render(<Page />)

    expect(fetcher).not.toBeCalled()
    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"hello, Initial"`
    )
  })

  it('should set config as second parameter', async () => {
    const fetcher = jest.fn(() => 'SWR')

    function Page() {
      const { data } = useSWR('config-as-second-param', {
        fetcher
      })

      return <div>hello, {data}</div>
    }

    const { container } = render(<Page />)

    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"hello, "`)
    expect(fetcher).toBeCalled()
    await waitForDomChange({ container }) // mount
    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"hello, SWR"`
    )
  })
})

describe('useSWR - loading', () => {
  afterEach(cleanup)

  const loadData = () => new Promise(res => setTimeout(() => res('data'), 100))

  it('should return loading state', async () => {
    let renderCount = 0
    function Page() {
      const { data, isValidating } = useSWR('is-validating-1', loadData)
      renderCount++
      return (
        <div>
          hello, {data}, {isValidating ? 'loading' : 'ready'}
        </div>
      )
    }

    const { container } = render(<Page />)
    expect(container.textContent).toMatchInlineSnapshot(`"hello, , loading"`)
    await waitForDomChange({ container })
    expect(container.textContent).toMatchInlineSnapshot(`"hello, data, ready"`)

    //    data       isValidating
    // -> undefined, false
    // -> undefined, true
    // -> data,      false
    expect(renderCount).toEqual(3)
  })

  it('should avoid extra rerenders', async () => {
    let renderCount = 0
    function Page() {
      // we never access `isValidating`, so it will not trigger rerendering
      const { data } = useSWR('is-validating-2', loadData)
      renderCount++
      return <div>hello, {data}</div>
    }

    const { container } = render(<Page />)
    await waitForDomChange({ container })
    expect(container.textContent).toMatchInlineSnapshot(`"hello, data"`)

    //    data
    // -> undefined
    // -> data
    expect(renderCount).toEqual(2)
  })

  it('should avoid extra rerenders while fetching', async () => {
    let renderCount = 0,
      dataLoaded = false
    const loadDataWithLog = () =>
      new Promise(res =>
        setTimeout(() => {
          dataLoaded = true
          res('data')
        }, 100)
      )

    function Page() {
      // we never access anything
      useSWR('is-validating-3', loadDataWithLog)
      renderCount++
      return <div>hello</div>
    }

    const { container } = render(<Page />)
    expect(container.textContent).toMatchInlineSnapshot(`"hello"`)

    await act(() => new Promise(res => setTimeout(res, 110))) // wait
    // it doesn't re-render, but fetch was triggered
    expect(renderCount).toEqual(1)
    expect(dataLoaded).toEqual(true)
  })
})

describe('useSWR - refresh', () => {
  afterEach(cleanup)

  it('should rerender automatically on interval', async () => {
    let count = 0

    function Page() {
      const { data } = useSWR('dynamic-1', () => count++, {
        refreshInterval: 200,
        dedupingInterval: 100
      })
      return <div>count: {data}</div>
    }
    const { container } = render(<Page />)

    // hydration
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"count: "`)
    await waitForDomChange({ container }) // mount
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"count: 0"`)
    await act(() => new Promise(res => setTimeout(res, 210))) // update
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"count: 1"`)
    await act(() => new Promise(res => setTimeout(res, 50))) // no update
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"count: 1"`)
    await act(() => new Promise(res => setTimeout(res, 150))) // update
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"count: 2"`)
  })

  it('should dedupe requests combined with intervals', async () => {
    let count = 0

    function Page() {
      const { data } = useSWR('dynamic-2', () => count++, {
        refreshInterval: 200,
        dedupingInterval: 300
      })
      return <div>count: {data}</div>
    }
    const { container } = render(<Page />)

    // hydration
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"count: "`)
    await waitForDomChange({ container }) // mount
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"count: 0"`)
    await act(() => new Promise(res => setTimeout(res, 210))) // no update (deduped)
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"count: 0"`)
    await act(() => new Promise(res => setTimeout(res, 200))) // update
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"count: 1"`)
    await act(() => new Promise(res => setTimeout(res, 200))) // no update (deduped)
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"count: 1"`)
    await act(() => new Promise(res => setTimeout(res, 200))) // update
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"count: 2"`)
  })

  it('should update data upon interval changes', async () => {
    let count = 0
    function Page() {
      const [int, setInt] = React.useState(200)
      const { data } = useSWR('/api', () => count++, {
        refreshInterval: int,
        dedupingInterval: 100
      })
      return (
        <div onClick={() => setInt(num => (num < 400 ? num + 100 : 0))}>
          count: {data}
        </div>
      )
    }
    const { container } = render(<Page />)
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"count: "`)

    await waitForDomChange({ container }) // mount
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"count: 0"`)
    await act(() => {
      return new Promise(res => setTimeout(res, 210))
    })
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"count: 1"`)
    await act(() => {
      return new Promise(res => setTimeout(res, 50))
    })
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"count: 1"`)
    await act(() => {
      return new Promise(res => setTimeout(res, 150))
    })
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"count: 2"`)
    await act(() => {
      fireEvent.click(container.firstElementChild)
      // it will clear 200ms timer and setup a new 300ms timer
      return new Promise(res => setTimeout(res, 200))
    })
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"count: 2"`)
    await act(() => {
      return new Promise(res => setTimeout(res, 110))
    })
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"count: 3"`)
    await act(() => {
      // wait for new 300ms timer
      return new Promise(res => setTimeout(res, 310))
    })
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"count: 4"`)
    await act(() => {
      fireEvent.click(container.firstElementChild)
      // it will clear 300ms timer and setup a new 400ms timer
      return new Promise(res => setTimeout(res, 300))
    })
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"count: 4"`)
    await act(() => {
      return new Promise(res => setTimeout(res, 110))
    })
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"count: 5"`)
    await act(() => {
      fireEvent.click(container.firstElementChild)
      // it will clear 400ms timer and stop
      return new Promise(res => setTimeout(res, 110))
    })
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"count: 5"`)
    await act(() => {
      return new Promise(res => setTimeout(res, 110))
    })
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"count: 5"`)
  })

  it('should update data upon interval changes -- changes happened during revalidate', async () => {
    let count = 0
    const STOP_POLLING_THRESHOLD = 2
    function Page() {
      const [flag, setFlag] = useState(0)
      const shouldPoll = flag < STOP_POLLING_THRESHOLD
      const { data } = useSWR(
        '/interval-changes-during-revalidate',
        () => count++,
        {
          refreshInterval: shouldPoll ? 200 : 0,
          dedupingInterval: 100,
          onSuccess() {
            setFlag(value => value + 1)
          }
        }
      )
      return (
        <div onClick={() => setFlag(0)}>
          count: {data} {flag}
        </div>
      )
    }
    const { container } = render(<Page />)
    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"count:  0"`
    )

    await waitForDomChange({ container }) // mount
    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"count: 0 1"`
    )

    await act(() => {
      return new Promise(res => setTimeout(res, 200))
    })
    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"count: 1 2"`
    )

    await act(() => {
      return new Promise(res => setTimeout(res, 200))
    })
    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"count: 1 2"`
    )

    await act(() => {
      return new Promise(res => setTimeout(res, 200))
    })
    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"count: 1 2"`
    )

    await act(() => {
      return new Promise(res => setTimeout(res, 200))
    })
    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"count: 1 2"`
    )

    await act(() => {
      fireEvent.click(container.firstElementChild)
      // it will setup a new 200ms timer
      return new Promise(res => setTimeout(res, 100))
    })

    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"count: 1 0"`
    )

    await act(() => {
      return new Promise(res => setTimeout(res, 100))
    })

    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"count: 2 1"`
    )

    await act(() => {
      return new Promise(res => setTimeout(res, 200))
    })

    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"count: 3 2"`
    )

    await act(() => {
      return new Promise(res => setTimeout(res, 200))
    })

    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"count: 3 2"`
    )

    await act(() => {
      return new Promise(res => setTimeout(res, 200))
    })

    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"count: 3 2"`
    )
  })

  it('should allow use custom isEqual method', async () => {
    function Page() {
      const { data, revalidate } = useSWR(
        'dynamic-11',
        () => ({
          timestamp: +new Date(),
          version: '1.0'
        }),
        {
          compare: function isEqual(a, b) {
            if (a === b) {
              return true
            }
            if (!a || !b) {
              return false
            }
            return a.version === b.version
          }
        }
      )

      if (!data) {
        return <div>loading</div>
      }
      return <button onClick={revalidate}>{data.timestamp}</button>
    }

    const { container } = render(<Page />)

    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"loading"`)
    await waitForDomChange({ container })
    const firstContent = container.firstChild.textContent
    await act(() => {
      // trigger revalidation
      fireEvent.click(container.firstElementChild)
      return new Promise(res => setTimeout(res, 1))
    })
    const secondContent = container.firstChild.textContent
    expect(firstContent).toEqual(secondContent)
  })
})

describe('useSWR - revalidate', () => {
  afterEach(cleanup)

  it('should rerender after triggering revalidation', async () => {
    let value = 0

    function Page() {
      const { data, revalidate } = useSWR('dynamic-3', () => value++)
      return <button onClick={revalidate}>data: {data}</button>
    }
    const { container } = render(<Page />)

    // hydration
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: "`)
    await waitForDomChange({ container }) // mount
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: 0"`)
    await act(() => {
      // trigger revalidation
      fireEvent.click(container.firstElementChild)
      return new Promise(res => setTimeout(res, 1))
    })
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: 1"`)
  })

  it('should revalidate all the hooks with the same key', async () => {
    let value = 0

    function Page() {
      const { data: v1, revalidate } = useSWR('dynamic-4', () => value++)
      const { data: v2 } = useSWR('dynamic-4', () => value++)
      return (
        <button onClick={revalidate}>
          {v1}, {v2}
        </button>
      )
    }
    const { container } = render(<Page />)

    // hydration
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`", "`)
    await waitForDomChange({ container }) // mount
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"0, 0"`)
    await act(() => {
      // trigger revalidation
      fireEvent.click(container.firstElementChild)
      return new Promise(res => setTimeout(res, 1))
    })
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"1, 1"`)
  })

  it('should respect sequences of revalidation calls (cope with race condition)', async () => {
    let faster = false

    function Page() {
      const { data, revalidate } = useSWR(
        'race',
        () =>
          new Promise(res => {
            const value = faster ? 1 : 0
            setTimeout(() => res(value), faster ? 100 : 200)
          })
      )

      return <button onClick={revalidate}>{data}</button>
    }

    const { container } = render(<Page />)

    expect(container.firstChild.textContent).toMatchInlineSnapshot(`""`)
    await waitForDomChange({ container })
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"0"`)

    await act(async () => {
      // trigger the slower revalidation
      faster = false
      fireEvent.click(container.firstElementChild)
      await new Promise(res => setTimeout(res, 10))
      // trigger the faster revalidation
      faster = true
      fireEvent.click(container.firstElementChild)
      return new Promise(res => setTimeout(res, 210))
    })
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"1"`)
  })
})

describe('useSWR - error', () => {
  afterEach(cleanup)

  it('should handle errors', async () => {
    function Page() {
      const { data, error } = useSWR(
        'error-1',
        () =>
          new Promise((_, rej) =>
            setTimeout(() => rej(new Error('error!')), 200)
          )
      )
      if (error) return <div>{error.message}</div>
      return <div>hello, {data}</div>
    }
    const { container } = render(<Page />)

    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"hello, "`)
    await waitForDomChange({ container })
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"error!"`)
  })

  it('should trigger the onError event', async () => {
    let erroredSWR = null
    function Page() {
      const { data, error } = useSWR(
        'error-2',
        () =>
          new Promise((_, rej) =>
            setTimeout(() => rej(new Error('error!')), 200)
          ),
        { onError: (_, key) => (erroredSWR = key) }
      )
      if (error) return <div>{error.message}</div>
      return <div>hello, {data}</div>
    }
    const { container } = render(<Page />)

    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"hello, "`)
    await waitForDomChange({ container })
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"error!"`)
    expect(erroredSWR).toEqual('error-2')
  })

  it('should trigger error retry', async () => {
    let count = 0
    function Page() {
      const { data, error } = useSWR(
        'error-3',
        () => {
          return new Promise((_, rej) =>
            setTimeout(() => rej(new Error('error: ' + count++)), 100)
          )
        },
        {
          onErrorRetry: (_, __, ___, revalidate, revalidateOpts) => {
            setTimeout(() => revalidate(revalidateOpts), 100)
          },
          dedupingInterval: 0
        }
      )
      if (error) return <div>{error.message}</div>
      return <div>hello, {data}</div>
    }
    const { container } = render(<Page />)

    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"hello, "`)
    await waitForDomChange({ container })
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"error: 0"`)
    await act(() => new Promise(res => setTimeout(res, 210))) // retry
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"error: 1"`)
    await act(() => new Promise(res => setTimeout(res, 210))) // retry
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"error: 2"`)
  })

  it('should trigger the onLoadingSlow and onSuccess event', async () => {
    let loadingSlow = null,
      success = null
    function Page() {
      const { data } = useSWR(
        'error-4',
        () => new Promise(res => setTimeout(() => res('SWR'), 200)),
        {
          onLoadingSlow: key => (loadingSlow = key),
          onSuccess: (_, key) => (success = key),
          loadingTimeout: 100
        }
      )
      return <div>hello, {data}</div>
    }
    const { container } = render(<Page />)

    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"hello, "`)
    expect(loadingSlow).toEqual(null)
    await act(() => new Promise(res => setTimeout(res, 110))) // slow
    expect(loadingSlow).toEqual('error-4')
    expect(success).toEqual(null)
    await act(() => new Promise(res => setTimeout(res, 100))) // finish
    expect(success).toEqual('error-4')
    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"hello, SWR"`
    )
  })
  it('should trigger limited error retries if errorRetryCount exists', async () => {
    let count = 0
    function Page() {
      const { data, error } = useSWR(
        'error-5',
        () => {
          return new Promise((_, rej) =>
            setTimeout(() => rej(new Error('error: ' + count++)), 100)
          )
        },
        {
          errorRetryCount: 1,
          errorRetryInterval: 50,
          dedupingInterval: 0
        }
      )
      if (error) return <div>{error.message}</div>
      return <div>hello, {data}</div>
    }
    const { container } = render(<Page />)

    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"hello, "`)
    await waitForDomChange({ container })
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"error: 0"`)
    await act(() => new Promise(res => setTimeout(res, 210))) // retry
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"error: 1"`)
    await act(() => new Promise(res => setTimeout(res, 210))) // retry
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"error: 1"`)
  })

  it('should not trigger the onLoadingSlow and onSuccess event after component unmount', async () => {
    let loadingSlow = null,
      success = null
    function Page() {
      const { data } = useSWR(
        'error-6',
        () => new Promise(res => setTimeout(() => res('SWR'), 200)),
        {
          onLoadingSlow: key => {
            loadingSlow = key
          },
          onSuccess: (_, key) => {
            success = key
          },
          loadingTimeout: 100
        }
      )
      return <div>{data}</div>
    }

    function App() {
      const [on, toggle] = useState(true)
      return (
        <div id="app" onClick={() => toggle(s => !s)}>
          {on && <Page />}
        </div>
      )
    }

    const { container } = render(<App />)

    expect(loadingSlow).toEqual(null)
    expect(success).toEqual(null)

    await act(async () => new Promise(res => setTimeout(res, 10)))
    await act(() => fireEvent.click(container.firstElementChild))
    await act(async () => new Promise(res => setTimeout(res, 200)))

    expect(success).toEqual(null)
    expect(loadingSlow).toEqual(null)
  })

  it('should not trigger the onError and onErrorRetry event after component unmount', async () => {
    let retry = null,
      failed = null
    function Page() {
      const { data } = useSWR(
        'error-7',
        () =>
          new Promise((_, rej) =>
            setTimeout(() => rej(new Error('error!')), 200)
          ),
        {
          onError: (_, key) => {
            failed = key
          },
          onErrorRetry: (_, key) => {
            retry = key
          },
          dedupingInterval: 0
        }
      )
      return <div>{data}</div>
    }

    function App() {
      const [on, toggle] = useState(true)
      return (
        <div id="app" onClick={() => toggle(s => !s)}>
          {on && <Page />}
        </div>
      )
    }

    const { container } = render(<App />)

    expect(retry).toEqual(null)
    expect(failed).toEqual(null)

    await act(async () => new Promise(res => setTimeout(res, 10)))
    await act(() => fireEvent.click(container.firstElementChild))
    await act(async () => new Promise(res => setTimeout(res, 200)))

    expect(retry).toEqual(null)
    expect(failed).toEqual(null)
  })

  it('should not trigger error retries if errorRetryCount is set to 0', async () => {
    let count = 0
    function Page() {
      const { data, error } = useSWR(
        'error-8',
        () => {
          return new Promise((_, rej) =>
            setTimeout(() => rej(new Error('error: ' + count++)), 100)
          )
        },
        {
          errorRetryCount: 0,
          errorRetryInterval: 50,
          dedupingInterval: 0
        }
      )
      if (error) return <div>{error.message}</div>
      return <div>hello, {data}</div>
    }
    const { container } = render(<Page />)

    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"hello, "`)
    await waitForDomChange({ container })
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"error: 0"`)
    await act(() => new Promise(res => setTimeout(res, 210))) // retry
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"error: 0"`)
  })
})

describe('useSWR - focus', () => {
  afterEach(cleanup)

  it('should revalidate on focus by default', async () => {
    let value = 0

    function Page() {
      const { data } = useSWR('dynamic-5', () => value++, {
        dedupingInterval: 0
      })
      return <div>data: {data}</div>
    }
    const { container } = render(<Page />)

    // hydration
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: "`)
    await waitForDomChange({ container }) // mount
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: 0"`)
    await act(() => {
      // trigger revalidation
      fireEvent.focus(window)
      return new Promise(res => setTimeout(res, 1))
    })
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: 1"`)
  })

  it("shouldn't revalidate on focus when revalidateOnFocus is false", async () => {
    let value = 0

    function Page() {
      const { data } = useSWR('dynamic-6', () => value++, {
        dedupingInterval: 0,
        revalidateOnFocus: false
      })
      return <div>data: {data}</div>
    }
    const { container } = render(<Page />)

    // hydration
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: "`)
    await waitForDomChange({ container }) // mount
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: 0"`)
    await act(() => {
      // trigger revalidation
      fireEvent.focus(window)
      return new Promise(res => setTimeout(res, 1))
    })
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: 0"`)
  })
  it('revalidateOnFocus shoule be stateful', async () => {
    let value = 0

    function Page() {
      const [revalidateOnFocus, toggle] = useState(false)
      const { data } = useSWR('dynamic-revalidateOnFocus', () => value++, {
        dedupingInterval: 0,
        revalidateOnFocus,
        focusThrottleInterval: 0
      })
      return <div onClick={() => toggle(s => !s)}>data: {data}</div>
    }
    const { container } = render(<Page />)

    // hydration
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: "`)
    await waitForDomChange({ container }) // mount

    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: 0"`)
    await act(() => {
      // trigger revalidation
      fireEvent.focus(window)
      return new Promise(res => setTimeout(res, 1))
    })
    // data should not change
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: 0"`)

    // change revalidateOnFocus to true
    fireEvent.click(container.firstElementChild)

    await act(() => {
      // trigger revalidation
      fireEvent.focus(window)
      return new Promise(res => setTimeout(res, 1))
    })
    // data should update
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: 1"`)

    await act(() => {
      // trigger revalidation
      fireEvent.focus(window)
      return new Promise(res => setTimeout(res, 1))
    })
    // data should update
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: 2"`)

    // change revalidateOnFocus to false
    fireEvent.click(container.firstElementChild)
    await act(() => {
      // trigger revalidation
      fireEvent.focus(window)
      return new Promise(res => setTimeout(res, 1))
    })
    // data should not change
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: 2"`)
  })

  it('focusThrottleInterval should work', async () => {
    let value = 0

    function Page() {
      const { data } = useSWR(
        'focusThrottleInterval should work',
        () => value++,
        {
          dedupingInterval: 0,
          revalidateOnFocus: true,
          focusThrottleInterval: 200
        }
      )
      return <div>data: {data}</div>
    }
    const { container } = render(<Page />)

    // hydration
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: "`)
    await waitForDomChange({ container }) // mount

    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: 0"`)

    await act(() => {
      // trigger revalidation
      fireEvent.focus(window)
      return new Promise(res => setTimeout(res, 1))
    })

    await act(() => {
      fireEvent.focus(window)
      return new Promise(res => setTimeout(res, 210))
    })

    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: 1"`)

    await act(() => {
      fireEvent.focus(window)
      return new Promise(res => setTimeout(res, 1))
    })

    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: 2"`)
  })

  it('focusThrottleInterval should be stateful', async () => {
    let value = 0

    function Page() {
      const [focusThrottleInterval, setInterval] = useState(200)
      const { data } = useSWR(
        'focusThrottleInterval should be stateful',
        () => value++,
        {
          dedupingInterval: 0,
          revalidateOnFocus: true,
          focusThrottleInterval
        }
      )
      return <div onClick={() => setInterval(s => s + 100)}>data: {data}</div>
    }
    const { container } = render(<Page />)

    // hydration
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: "`)
    await waitForDomChange({ container }) // mount

    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: 0"`)

    await act(() => {
      fireEvent.focus(window)
      return new Promise(res => setTimeout(res, 210))
    })

    await act(() => {
      fireEvent.focus(window)
      return new Promise(res => setTimeout(res, 210))
    })

    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: 2"`)
    fireEvent.click(container.firstElementChild)

    await act(() => {
      fireEvent.focus(window)
      return new Promise(res => setTimeout(res, 1))
    })

    await act(() => {
      fireEvent.focus(window)
      return new Promise(res => setTimeout(res, 210))
    })

    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: 3"`)

    await act(() => {
      return new Promise(res => setTimeout(res, 100))
    })

    await act(() => {
      fireEvent.focus(window)
      return new Promise(res => setTimeout(res, 310))
    })

    await act(() => {
      fireEvent.focus(window)
      return new Promise(res => setTimeout(res, 1))
    })

    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: 5"`)
  })
})

describe('useSWR - local mutation', () => {
  afterEach(cleanup)

  it('should trigger revalidation programmatically', async () => {
    let value = 0

    function Page() {
      const { data } = useSWR('dynamic-7', () => value++, {
        dedupingInterval: 0
      })
      return <div>data: {data}</div>
    }
    const { container } = render(<Page />)

    // hydration
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: "`)
    await waitForDomChange({ container }) // mount
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: 0"`)
    await act(() => {
      // trigger revalidation
      trigger('dynamic-7')
      return new Promise(res => setTimeout(res, 1))
    })
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: 1"`)
  })

  it('should trigger revalidation programmatically within a dedupingInterval', async () => {
    let value = 0

    function Page() {
      const { data } = useSWR('dynamic-12', () => value++, {
        dedupingInterval: 2000
      })
      return <div>data: {data}</div>
    }
    const { container } = render(<Page />)

    // hydration
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: "`)
    await waitForDomChange({ container }) // mount
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: 0"`)
    await act(() => {
      // trigger revalidation
      trigger('dynamic-12')
      return new Promise(res => setTimeout(res, 1))
    })
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: 1"`)
  })

  it('should mutate the cache and revalidate', async () => {
    let value = 0

    function Page() {
      const { data } = useSWR('dynamic-8', () => value++, {
        dedupingInterval: 0
      })
      return <div>data: {data}</div>
    }
    const { container } = render(<Page />)

    // hydration
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: "`)
    await waitForDomChange({ container }) // mount
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: 0"`)
    await act(() => {
      // mutate and revalidate
      mutate('dynamic-8', 'mutate')
      return new Promise(res => setTimeout(res, 1))
    })
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: 1"`)
  })

  it('should dedupe extra requests after mutation', async () => {
    let value = 0

    function Page() {
      const { data } = useSWR('dynamic-13', () => value++, {
        dedupingInterval: 2000
      })
      useSWR('dynamic-13', () => value++, {
        dedupingInterval: 2000
      })
      return <div>data: {data}</div>
    }
    const { container } = render(<Page />)

    // hydration
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: "`)
    await waitForDomChange({ container }) // mount
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: 0"`)
    await act(() => {
      // mutate and revalidate
      mutate('dynamic-13')
      return new Promise(res => setTimeout(res, 1))
    })
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: 1"`)
  })

  it('should mutate the cache and revalidate in async', async () => {
    function Page() {
      const { data } = useSWR(
        'dynamic-9',
        () => new Promise(res => setTimeout(() => res('truth'), 200)),
        { dedupingInterval: 0 }
      )
      return <div>data: {data}</div>
    }
    const { container } = render(<Page />)

    // hydration
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: "`)
    await waitForDomChange({ container }) // mount
    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"data: truth"`
    )
    await act(() => {
      // mutate and revalidate
      mutate('dynamic-9', 'local')
      return new Promise(res => setTimeout(res, 1))
    })
    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"data: local"`
    )
    await act(() => new Promise(res => setTimeout(res, 200))) // recovers
    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"data: truth"`
    )
  })

  it('should support async mutation', async () => {
    function Page() {
      const { data } = useSWR('mutate-1', () => 0, {
        dedupingInterval: 0
      })
      return <div>data: {data}</div>
    }
    const { container } = render(<Page />)

    // hydration
    expect(container.textContent).toMatchInlineSnapshot(`"data: "`)
    await waitForDomChange({ container }) // mount
    expect(container.textContent).toMatchInlineSnapshot(`"data: 0"`)
    await act(() => {
      // mutate and revalidate
      return mutate(
        'mutate-1',
        new Promise(res => setTimeout(() => res(999), 100)),
        false
      )
    })
    await act(() => new Promise(res => setTimeout(res, 110)))
    expect(container.textContent).toMatchInlineSnapshot(`"data: 999"`)
  })

  it('should trigger on mutation without data', async () => {
    let value = 0

    function Page() {
      const { data } = useSWR('dynamic-14', () => value++, {
        dedupingInterval: 0
      })
      return <div>data: {data}</div>
    }
    const { container } = render(<Page />)

    // hydration
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: "`)
    await waitForDomChange({ container }) // mount
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: 0"`)
    await act(() => {
      // trigger revalidation
      mutate('dynamic-14')
      return new Promise(res => setTimeout(res, 1))
    })
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: 1"`)
  })

  it('should call function as data passing current cached value', async () => {
    // prefill cache with data
    cache.set('dynamic-15', 'cached data')
    const callback = jest.fn()
    await mutate('dynamic-15', callback)
    expect(callback).toHaveBeenCalledWith('cached data')
  })

  it('should return results of the mutation', async () => {
    // returns the data if promise resolved
    expect(mutate('dynamic-16', Promise.resolve('data'))).resolves.toBe('data')

    // throw the error if promise rejected
    expect(
      mutate('dynamic-16', Promise.reject(new Error('error')))
    ).rejects.toBeInstanceOf(Error)
  })

  it('should get bound mutate from useSWR', async () => {
    function Page() {
      // eslint-disable-next-line no-shadow
      const { data, mutate: boundMutate } = useSWR(
        'dynamic-17',
        () => 'fetched'
      )
      return (
        <div onClick={() => boundMutate('mutated', false)}>data: {data}</div>
      )
    }
    const { container } = render(<Page />)

    // hydration
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: "`)
    await waitForDomChange({ container }) // mount
    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"data: fetched"`
    )
    // call bound mutate
    fireEvent.click(container.firstElementChild)
    // expect new updated value
    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"data: mutated"`
    )
  })

  it('should ignore in flight requests when mutating', async () => {
    // set it to 1
    mutate('mutate-2', 1)

    function Section() {
      const { data } = useSWR(
        'mutate-2',
        () => new Promise(res => setTimeout(() => res(2), 200))
      )
      return <div>{data}</div>
    }

    const { container } = render(<Section />)

    expect(container.textContent).toMatchInlineSnapshot(`"1"`) // directly from cache
    await act(() => new Promise(res => setTimeout(res, 150))) // still suspending
    mutate('mutate-2', 3) // set it to 3. this will drop the ongoing request
    expect(container.textContent).toMatchInlineSnapshot(`"3"`)
    await act(() => new Promise(res => setTimeout(res, 100)))
    expect(container.textContent).toMatchInlineSnapshot(`"3"`)
  })

  it('should ignore in flight mutations when calling another async mutate', async () => {
    let value = 'off'
    function Page() {
      const { data } = useSWR(
        'mutate-3',
        () => new Promise(res => setTimeout(() => res(value), 200))
      )

      return <div>{data}</div>
    }

    const { container } = render(<Page />)

    await act(() => new Promise(res => setTimeout(res, 250)))
    expect(container.textContent).toMatchInlineSnapshot(`"off"`) // Initial state

    // Simulate toggling "on"
    await act(async () => {
      mutate('mutate-3', 'on', false)
      expect(
        mutate(
          'mutate-3',
          new Promise(res =>
            setTimeout(() => {
              value = 'on'
              res('on')
            }, 200)
          ),
          false
        )
      ).resolves.toBe('on')
    })

    // Validate local state is now "on"
    expect(container.textContent).toMatchInlineSnapshot(`"on"`)

    // Simulate toggling "off"
    await act(async () => {
      mutate('mutate-3', 'off', false)
      expect(
        mutate(
          'mutate-3',
          new Promise(res =>
            setTimeout(() => {
              value = 'off'
              res('off')
            }, 400)
          ),
          false
        )
      ).resolves.toBe('off')
    })

    // Validate local state is now "off"
    expect(container.textContent).toMatchInlineSnapshot(`"off"`)

    // Wait for toggling "on" promise to resolve, but the "on" mutation is cancelled
    await act(() => new Promise(res => setTimeout(res, 200)))
    expect(container.textContent).toMatchInlineSnapshot(`"off"`)

    // Wait for toggling "off" promise to resolve
    await act(() => new Promise(res => setTimeout(res, 200)))
    expect(container.textContent).toMatchInlineSnapshot(`"off"`)
  })

  it('null is stringified when found inside an array', async () => {
    let value = 0

    function Page() {
      const { data } = useSWR([null], () => value++, {
        dedupingInterval: 0
      })
      return <div>data: {data}</div>
    }
    const { container } = render(<Page />)

    // hydration
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: "`)
    await waitForDomChange({ container }) // mount
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: 0"`)
    await act(() => {
      // trigger revalidation
      trigger([null])
      return new Promise(res => setTimeout(res, 1))
    })
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: 1"`)
  })

  it('should return promise from mutate without data', async () => {
    let value = 0
    function Page() {
      const { data } = useSWR('dynamic-18', () => value++, {
        dedupingInterval: 0
      })
      return <div>data: {data}</div>
    }
    const { container } = render(<Page />)
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: "`)
    await waitForDomChange({ container }) // mount
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: 0"`)
    let promise
    await act(() => {
      promise = mutate('dynamic-18')
      return promise
    })
    expect(promise).toBeInstanceOf(Promise) // mutate returns a promise
    expect(promise).resolves.toBe(1) // the return value should be the new cache
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: 1"`)
  })

  it('should update error in cache when mutate failed with error', async () => {
    const value = 0
    const key = 'mutate-4'
    const message = 'mutate-error'
    function Page() {
      const { data, error } = useSWR(key, () => value)
      return <div>{error ? error.message : `data: ${data}`}</div>
    }
    const { container } = render(<Page />)
    await waitForDomChange({ container })
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: 0"`)
    await act(async () => {
      // mutate error will be thrown, add try catch to avoid crashing
      try {
        await mutate(
          key,
          () => {
            throw new Error(message)
          },
          false
        )
      } catch (e) {
        // do nothing
      }
    })

    const [, , keyErr] = cache.serializeKey(key)
    let cacheError = cache.get(keyErr)
    expect(cacheError.message).toMatchInlineSnapshot(`"${message}"`)
    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"${message}"`
    )
    // if mutate succeed, error should be cleared
    await act(async () => {
      await mutate(key, value, false)
    })
    cacheError = cache.get(keyErr)
    expect(cacheError).toMatchInlineSnapshot(`undefined`)
  })
})

describe('useSWR - context configs', () => {
  afterEach(cleanup)

  it('should read the config fallback from the context', async () => {
    let value = 0
    const fetcher = () => value++

    function Section() {
      const { data } = useSWR('dynamic-10')
      return <div>data: {data}</div>
    }
    function Page() {
      // config provider
      return (
        <SWRConfig
          value={{ fetcher, refreshInterval: 100, dedupingInterval: 0 }}
        >
          <Section />
        </SWRConfig>
      )
    }
    const { container } = render(<Page />)

    // hydration
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: "`)
    await waitForDomChange({ container }) // mount
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: 0"`)
    await act(() => new Promise(res => setTimeout(res, 110))) // update
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: 1"`)
  })
})

describe('useSWR - suspense', () => {
  afterEach(cleanup)

  it('should render fallback', async () => {
    function Section() {
      const { data } = useSWR(
        'suspense-1',
        () => new Promise(res => setTimeout(() => res('SWR'), 100)),
        {
          suspense: true
        }
      )
      return <div>{data}</div>
    }
    const { container } = render(
      <Suspense fallback={<div>fallback</div>}>
        <Section />
      </Suspense>
    )

    // hydration
    expect(container.textContent).toMatchInlineSnapshot(`"fallback"`)
    await act(() => new Promise(res => setTimeout(res, 110))) // update
    expect(container.textContent).toMatchInlineSnapshot(`"SWR"`)
  })

  it('should render multiple SWR fallbacks', async () => {
    function Section() {
      const { data: v1 } = useSWR<number>(
        'suspense-2',
        () => new Promise(res => setTimeout(() => res(1), 100)),
        {
          suspense: true
        }
      )
      const { data: v2 } = useSWR<number>(
        'suspense-3',
        () => new Promise(res => setTimeout(() => res(2), 100)),
        {
          suspense: true
        }
      )
      return <div>{v1 + v2}</div>
    }
    const { container } = render(
      <Suspense fallback={<div>fallback</div>}>
        <Section />
      </Suspense>
    )

    // hydration
    expect(container.textContent).toMatchInlineSnapshot(`"fallback"`)
    await act(() => new Promise(res => setTimeout(res, 150))) // still suspending
    expect(container.textContent).toMatchInlineSnapshot(`"fallback"`)
    await act(() => new Promise(res => setTimeout(res, 100))) // should recover
    expect(container.textContent).toMatchInlineSnapshot(`"3"`)
  })

  it('should work for non-promises', async () => {
    function Section() {
      const { data } = useSWR('suspense-4', () => 'hello', {
        suspense: true
      })
      return <div>{data}</div>
    }
    const { container } = render(
      <Suspense fallback={<div>fallback</div>}>
        <Section />
      </Suspense>
    )

    // hydration
    expect(container.textContent).toMatchInlineSnapshot(`"hello"`)
  })

  it('should throw errors', async () => {
    function Section() {
      const { data } = useSWR(
        'suspense-5',
        () =>
          new Promise((_, reject) => setTimeout(() => reject('error'), 100)),
        {
          suspense: true
        }
      )
      return <div>{data}</div>
    }
    // https://reactjs.org/docs/concurrent-mode-suspense.html#handling-errors
    const { container } = render(
      <ErrorBoundary fallback={<div>error boundary</div>}>
        <Suspense fallback={<div>fallback</div>}>
          <Section />
        </Suspense>
      </ErrorBoundary>
    )

    // hydration
    expect(container.textContent).toMatchInlineSnapshot(`"fallback"`)
    await act(() => new Promise(res => setTimeout(res, 150))) // still suspending
    expect(container.textContent).toMatchInlineSnapshot(`"error boundary"`)

    console.info('*The warning above can be ignored (caught by ErrorBoundary).')
  })

  it('should render cached data with error', async () => {
    mutate('suspense-6', 'hello')

    function Section() {
      const { data, error } = useSWR(
        // this value is cached
        'suspense-6',
        () =>
          new Promise((_, reject) => setTimeout(() => reject('error'), 100)),
        {
          suspense: true
        }
      )
      return (
        <div>
          {data}, {error}
        </div>
      )
    }

    const { container } = render(
      <Suspense fallback={<div>fallback</div>}>
        <Section />
      </Suspense>
    )

    expect(container.textContent).toMatchInlineSnapshot(`"hello, "`) // directly from cache
    await act(() => new Promise(res => setTimeout(res, 150))) // still suspending
    expect(container.textContent).toMatchInlineSnapshot(`"hello, error"`) // get error with cache
  })

  it('should pause when key changes', async () => {
    const renderedResults = []

    function Section() {
      const [key, setKey] = useState('suspense-7')
      const { data } = useSWR(
        key,
        k => new Promise(res => setTimeout(() => res(k), 50)),
        {
          suspense: true
        }
      )

      useEffect(() => {
        if (data === 'suspense-7') {
          setKey('suspense-8')
        }
      }, [data])

      if (data !== renderedResults[renderedResults.length - 1]) {
        renderedResults.push(data)
      }

      return <>{data}</>
    }

    render(
      <Suspense fallback={<div>fallback</div>}>
        <Section />
      </Suspense>
    )

    await act(() => new Promise(res => setTimeout(res, 110)))

    // fixes https://github.com/zeit/swr/issues/57
    // 'suspense-7' -> undefined -> 'suspense-8'
    expect(renderedResults).toEqual(['suspense-7', 'suspense-8'])
  })

  it('should render initial data if set', async () => {
    const fetcher = jest.fn(() => 'SWR')

    function Page() {
      const { data } = useSWR('suspense-9', fetcher, {
        initialData: 'Initial',
        suspense: true
      })
      return <div>hello, {data}</div>
    }

    const { container } = render(
      <Suspense fallback={<div>fallback</div>}>
        <Page />
      </Suspense>
    )

    expect(fetcher).not.toBeCalled()
    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"hello, Initial"`
    )
  })
})

describe('useSWR - cache', () => {
  it('should not react to direct cache updates but mutate', async () => {
    cache.set('cache-1', 'custom cache message')

    function Page() {
      const { data } = useSWR('cache-1', () => 'random message', {
        suspense: true
      })
      return <div>{data}</div>
    }

    // render using custom cache
    const { queryByText, findByText } = render(
      <React.Suspense fallback={null}>
        <Page />
      </React.Suspense>
    )

    // content should come from custom cache
    expect(queryByText('custom cache message')).toMatchInlineSnapshot(`
      <div>
        custom cache message
      </div>
    `)

    // content should be updated with fetcher results
    expect(await findByText('random message')).toMatchInlineSnapshot(`
      <div>
        random message
      </div>
    `)

    act(async () => {
      const value = 'a different message'
      cache.set('cache-1', value)
      await mutate('cache-1', value, false)
    })

    // content should be updated from new cache value, after mutate without revalidate
    expect(await findByText('a different message')).toMatchInlineSnapshot(`
      <div>
        a different message
      </div>
    `)

    act(async () => {
      cache.delete('cache-1')
      mutate('cache-1')
    })

    // content should go back to be the fetched value
    expect(await findByText('random message')).toMatchInlineSnapshot(`
      <div>
        random message
      </div>
    `)
  })

  it('should notify subscribers when a cache item changed', async () => {
    // create new cache instance to don't get affected by other tests
    // updating the normal cache instance
    const tmpCache = new Cache()

    const listener = jest.fn()
    const unsubscribe = tmpCache.subscribe(listener)
    tmpCache.set('cache-2', 'random message')

    expect(listener).toHaveBeenCalled()

    unsubscribe()
    tmpCache.set('cache-2', 'a different message')

    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('useSWR - key', () => {
  afterEach(cleanup)

  it('should respect requests after key has changed', async () => {
    let rerender

    function Page() {
      const [mounted, setMounted] = useState(0)
      const key = `key-1-${mounted ? 'short' : 'long'}`
      const { data } = useSWR(key, async () => {
        if (mounted) {
          await new Promise(res => setTimeout(res, 100))
          return 'short request'
        }
        await new Promise(res => setTimeout(res, 200))
        return 'long request'
      })
      useEffect(() => setMounted(1), [])
      rerender = setMounted

      return <div>{data}</div>
    }

    const { container } = render(<Page />)
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`""`)
    await waitForDomChange({ container })
    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"short request"`
    )
    await act(() => new Promise(res => setTimeout(res, 110))) // wait 100ms until "long request" finishes
    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"short request"`
    ) // should be "short request" still

    // manually trigger a re-render from outside
    // this triggers a re-render, and a read access to `swr.data`
    // but the result should still be "short request"
    await act(() => rerender(x => x + 1))
    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"short request"`
    )
  })

  it('should render undefined after key has changed', async () => {
    function Page() {
      const [mounted, setMounted] = useState(false)
      const key = `key-${mounted ? '1' : '0'}`
      const { data } = useSWR(key, async k => {
        await new Promise(res => setTimeout(res, 200))
        return k
      })
      useEffect(() => {
        setTimeout(() => setMounted(true), 320)
      }, [])
      return <div>{data}</div>
    }

    //    time     data       key
    // -> 0        undefined, '0'
    // -> 200      0,         '0'
    // -> 320      undefined, '1' <- this state is required; we can't show 0 here
    // -> 520      1,         '1'
    const { container } = render(<Page />)
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`""`) // undefined, time=0
    await act(() => new Promise(res => setTimeout(res, 210)))
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"key-0"`) // 0, time=210
    await act(() => new Promise(res => setTimeout(res, 200)))
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`""`) // undefined, time=410
    await act(() => new Promise(res => setTimeout(res, 140)))
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"key-1"`) // 1, time=550
  })

  it('should return undefined after key change when fetcher is synchronized', async () => {
    const samples = {
      '1': 'a',
      '2': 'b',
      '3': 'c'
    }

    function Page() {
      const [sampleKey, setKey] = React.useState(1)
      const { data } = useSWR(
        `key-2-${sampleKey}`,
        key => samples[key.replace('key-2-', '')]
      )
      return (
        <div
          onClick={() => {
            setKey(sampleKey + 1)
          }}
        >
          hello, {sampleKey}:{data}
        </div>
      )
    }
    const { container } = render(<Page />)
    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"hello, 1:"`
    )
    await waitForDomChange({ container }) // mount
    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"hello, 1:a"`
    )
    fireEvent.click(container.firstElementChild)
    // first rerender on key change
    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"hello, 2:"`
    )
    await act(() => new Promise(res => setTimeout(res, 100)))
    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"hello, 2:b"`
    )
  })

  it('should revalidate if a function key changes identity', async () => {
    const closureFunctions: { [key: string]: () => Promise<string> } = {}

    const closureFactory = id => {
      if (closureFunctions[id]) return closureFunctions[id]
      closureFunctions[id] = () => Promise.resolve(`data-${id}`)
      return closureFunctions[id]
    }

    let updateId

    const fetcher = fn => fn()

    function Page() {
      const [id, setId] = React.useState('first')
      updateId = setId
      const fnWithClosure = closureFactory(id)
      const { data } = useSWR([fnWithClosure], fetcher)

      return <div>{data}</div>
    }

    const { container } = render(<Page />)
    const closureSpy = jest.spyOn(closureFunctions, 'first')
    await waitForDomChange({ container })
    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"data-first"`
    )
    expect(closureSpy).toHaveBeenCalledTimes(1)

    // update, but don't change the id.
    // Function identity should stay the same, and useSWR should not call the function again.
    await act(() => updateId('first'))
    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"data-first"`
    )
    expect(closureSpy).toHaveBeenCalledTimes(1)

    await act(() => updateId('second'))
    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"data-second"`
    )
  })
})

describe('useSWR - subscription', () => {
  it('should setup subscription if a subscribe function is passed', async () => {
    const subscribe = jest.fn(() => () => {})

    let value = 0
    function Page() {
      const { data } = useSWR('subscribe-1', () => value++, {
        subscribe,
        dedupingInterval: 0
      })
      return <div>data: {data}</div>
    }

    const { container } = render(<Page />)

    // hydration
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: "`)
    await waitForDomChange({ container }) // mount
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: 0"`)

    expect(subscribe).toHaveBeenCalledTimes(1)
  })

  it('should resubscribe when key change', async () => {
    const unsubscribe = jest.fn()
    const subscribe = jest.fn(() => unsubscribe)

    let value = 0
    function Page({ swrKey = 'subscribe-2' } = {}) {
      const { data } = useSWR(swrKey, () => value++, {
        subscribe,
        dedupingInterval: 0
      })

      return <div>data: {data}</div>
    }

    const { container, rerender } = render(<Page />)

    // hydration
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: "`)
    await waitForDomChange({ container }) // mount
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: 0"`)

    rerender(<Page swrKey="subscribe-2-updated" />)

    await waitForDomChange({ container }) // mount
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: 1"`)

    expect(subscribe).toHaveBeenCalledTimes(2)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('should receive the key and mutate in subscribe', async () => {
    const subscribe = jest.fn(() => () => {})

    let value = 0
    function Page() {
      const { data } = useSWR('subscribe-3', () => value++, {
        subscribe,
        dedupingInterval: 0
      })
      return <div>data: {data}</div>
    }

    const { container } = render(<Page />)

    // hydration
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: "`)
    await waitForDomChange({ container }) // mount
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: 0"`)

    expect(subscribe).toHaveBeenCalledWith('subscribe-3', expect.any(Function))
  })

  it('should unsubscribe when component unmount', async () => {
    const unsubscribe = jest.fn()
    const subscribe = () => unsubscribe

    let value = 0
    function Page() {
      const { data } = useSWR('subscribe-4', () => value++, {
        subscribe,
        dedupingInterval: 0
      })

      return <div>data: {data}</div>
    }

    const { container, unmount } = render(<Page />)

    // hydration
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: "`)
    await waitForDomChange({ container }) // mount
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: 0"`)

    unmount()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('should unsubscribe when subscribe function changed', async () => {
    const unsubscribe = jest.fn()
    const subscribe1 = jest.fn(() => unsubscribe)
    const subscribe2 = jest.fn(() => unsubscribe)

    let value = 0
    function Page({ subscribe = subscribe1 } = {}) {
      const { data } = useSWR('subscribe-5', () => value++, {
        subscribe,
        dedupingInterval: 0
      })

      return <div>data: {data}</div>
    }

    const { container, rerender } = render(<Page />)

    // hydration
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: "`)
    await waitForDomChange({ container }) // mount
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: 0"`)

    rerender(<Page subscribe={subscribe2} />)

    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(subscribe1).toHaveBeenCalledTimes(1)
    expect(subscribe2).toHaveBeenCalledTimes(1)
  })

  it('should be able to mutate cache from subscribe', async () => {
    jest.useFakeTimers()
    const subscribe = jest.fn((_, boundMutate) => {
      const timer = setTimeout(
        () => boundMutate(currentValue => currentValue + 1),
        100
      )
      return () => clearTimeout(timer)
    })

    let value = 0
    function Page() {
      const { data } = useSWR('subscribe-6', () => value++, {
        subscribe,
        dedupingInterval: 0
      })

      return <div>data: {data}</div>
    }

    const { container } = render(<Page />)

    // hydration
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: "`)
    await waitForDomChange({ container }) // mount
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: 0"`)

    jest.runAllTimers() // run the setTimeout in subscribe

    await waitForDomChange({ container }) // mount
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: 1"`)
    expect(subscribe).toHaveBeenCalled()
  })

  it('should support global subscribe', async () => {
    const subscribe = jest.fn(() => () => {})

    let value = 0
    function Page() {
      const { data } = useSWR('subscribe-7', () => value++, {
        dedupingInterval: 0
      })
      return <div>data: {data}</div>
    }

    const { container } = render(
      <SWRConfig value={{ subscribe }}>
        <Page />
      </SWRConfig>
    )

    // hydration
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: "`)
    await waitForDomChange({ container }) // mount
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"data: 0"`)

    expect(subscribe).toHaveBeenCalledWith('subscribe-7', expect.any(Function))
  })

  it('should only subscribe one time per key', async () => {
    const unsubscribe = jest.fn(() => {})
    const subscribe = jest.fn(() => unsubscribe)

    let value = 0
    function Page() {
      const { data } = useSWR('subscribe-8', () => value++, {
        subscribe,
        dedupingInterval: 0
      })

      return <div>data: {data}</div>
    }

    const { container, rerender, unmount } = render(
      <>
        <Page />
        <Page />
      </>
    )

    expect(container).toMatchInlineSnapshot(`
      <div>
        <div>
          data: 
        </div>
        <div>
          data: 
        </div>
      </div>
    `)
    await waitForDomChange({ container }) // mount
    expect(container).toMatchInlineSnapshot(`
      <div>
        <div>
          data: 
          0
        </div>
        <div>
          data: 
          0
        </div>
      </div>
    `)

    expect(subscribe).toHaveBeenCalledTimes(1)

    rerender(<Page />)

    expect(container).toMatchInlineSnapshot(`
      <div>
        <div>
          data: 
          0
        </div>
      </div>
    `)

    expect(subscribe).toHaveBeenCalledTimes(1)

    unmount()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})

describe('useSWR - config callbacks', () => {
  it('should trigger the onSuccess event with the latest version of the onSuccess callback', async () => {
    let state = null
    let count = 0

    function Page(props) {
      const { data, revalidate } = useSWR(
        'config callbacks - onSuccess',
        () => new Promise(res => setTimeout(() => res(count++), 200)),
        { onSuccess: () => (state = props.text) }
      )
      return (
        <div onClick={revalidate}>
          hello, {data}, {props.text}
        </div>
      )
    }
    const { container, rerender } = render(<Page text={'a'} />)
    // the onSuccess callback does not trigger yet, the state still null.
    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"hello, , a"`
    )
    expect(state).toEqual(null)

    await waitForDomChange({ container })
    // since the promise resolved, the onSuccess callback assign `props.text` to `state`
    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"hello, 0, a"`
    )
    expect(state).toEqual('a')

    // props changed, but the onSuccess callback does not trigger yet, `state` is same as before
    rerender(<Page text={'b'} />)
    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"hello, 0, b"`
    )
    expect(state).toEqual('a')

    await act(() => {
      // trigger revalidation, this would re-trigger the onSuccess callback
      fireEvent.click(container.firstElementChild)
      return new Promise(res => setTimeout(res, 201))
    })
    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"hello, 1, b"`
    )
    // the onSuccess callback should capture the latest `props.text`
    expect(state).toEqual('b')
  })

  it('should trigger the onError event with the latest version of the onError callback', async () => {
    let state = null
    let count = 0

    function Page(props) {
      const { data, revalidate, error } = useSWR(
        'config callbacks - onError',
        () =>
          new Promise((_, rej) =>
            setTimeout(() => rej(new Error(`Error: ${count++}`)), 200)
          ),
        { onError: () => (state = props.text) }
      )
      if (error)
        return (
          <div title={props.text} onClick={revalidate}>
            {error.message}
          </div>
        )
      return (
        <div onClick={revalidate}>
          hello, {data}, {props.text}
        </div>
      )
    }

    const { container, rerender } = render(<Page text="a" />)

    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"hello, , a"`
    )
    expect(state).toEqual(null)

    await waitForDomChange({ container })

    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"Error: 0"`)
    expect(state).toEqual('a')

    // props changed, but the onError callback doese not trigger yet.
    rerender(<Page text="b" />)
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"Error: 0"`)
    expect(container.firstElementChild.getAttribute('title')).toEqual('b')
    expect(state).toEqual('a')

    await act(() => {
      fireEvent.click(container.firstElementChild)
      return new Promise(res => setTimeout(res, 201))
    })
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"Error: 1"`)
    expect(container.firstElementChild.getAttribute('title')).toEqual('b')
    expect(state).toEqual('b')
  })

  it('should trigger the onErrorRetry event with the latest version of the onErrorRetry callback', async () => {
    let state = null
    let count = 0
    function Page(props) {
      const { data, error } = useSWR(
        'config callbacks - onErrorRetry',
        () =>
          new Promise((_, rej) =>
            setTimeout(() => rej(new Error(`Error: ${count++}`)), 200)
          ),
        {
          onErrorRetry: (_, __, ___, revalidate, revalidateOpts) => {
            state = props.text
            setTimeout(() => revalidate(revalidateOpts), 100)
          }
        }
      )
      if (error) return <div title={props.text}>{error.message}</div>
      return (
        <div>
          hello, {data}, {props.text}
        </div>
      )
    }

    const { container, rerender } = render(<Page text="a" />)
    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"hello, , a"`
    )
    expect(state).toEqual(null)

    await waitForDomChange({ container })

    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"Error: 0"`)
    expect(container.firstElementChild.getAttribute('title')).toEqual('a')
    expect(state).toEqual('a')

    // since the onErrorRetry schedule a timer to trigger revalidation, update props.text now
    rerender(<Page text="b" />)
    // not revalidate yet.
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"Error: 0"`)
    expect(container.firstElementChild.getAttribute('title')).toEqual('b')
    expect(state).toEqual('a')

    await act(() => {
      return new Promise(res => setTimeout(res, 301))
    })
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"Error: 1"`)
    expect(container.firstElementChild.getAttribute('title')).toEqual('b')
    expect(state).toEqual('b')
  })

  it('should trigger the onLoadingSlow and onSuccess event with the lastest version of the callbacks', async () => {
    let state = null
    let count = 0

    function Page(props) {
      const { data } = useSWR(
        'config callbacks - onLoadingSlow',
        () => new Promise(res => setTimeout(() => res(count++), 200)),
        {
          onLoadingSlow: () => {
            state = props.text
          },
          onSuccess: () => {
            state = props.text
          },
          loadingTimeout: 100
        }
      )
      return (
        <div>
          hello, {data}, {props.text}
        </div>
      )
    }

    const { container, rerender } = render(<Page text="a" />)

    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"hello, , a"`
    )
    expect(state).toEqual(null)

    await act(() => {
      // wait 100ms to trigger onLoadingSlow event, but not success yet.
      return new Promise(res => setTimeout(res, 101))
    })
    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"hello, , a"`
    )
    expect(state).toEqual('a')
    rerender(<Page text="b" />)

    await act(() => {
      // now trigger onSuccess event
      return new Promise(res => setTimeout(res, 100))
    })
    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"hello, 0, b"`
    )
    expect(state).toEqual('b')
  })
})
