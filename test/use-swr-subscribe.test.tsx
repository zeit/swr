import React from 'react'
import { render } from '@testing-library/react'
import { sleep } from './utils'
import useSWRSubscription from 'swr/subscribe'

describe('useSWRSubscription', () => {
  it('should update state when fetcher is a subscription', async () => {
    const key = 'sub-0'
    let intervalId
    let res = 0
    function subscribe(_key, { onData, onError }) {
      intervalId = setInterval(() => {
        if (res === 3) {
          const err = new Error(_key + 'error')
          onError(err)
        } else {
          onData(_key + res)
        }
        res++
      }, 100)

      return () => {}
    }

    function Page() {
      const { data, error } = useSWRSubscription(key, subscribe)
      return <div>{error ? error.message : data}</div>
    }

    const { container } = render(<Page />)
    await sleep(10)
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`""`)
    await sleep(100)
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"${key}0"`)
    await sleep(100)
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"${key}1"`)
    await sleep(100)
    expect(container.firstChild.textContent).toMatchInlineSnapshot(`"${key}2"`)
    await sleep(100)
    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"${key}error"`
    )
    clearInterval(intervalId)
    await sleep(100)
    expect(container.firstChild.textContent).toMatchInlineSnapshot(
      `"${key}error"`
    )
  })
})
