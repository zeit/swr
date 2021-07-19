import { act, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import useSWRPassive from 'swr/passive'
import { createKey, sleep } from './utils'

const waitForNextTick = () => act(() => sleep(1))

describe('useSWR - passive', () => {
  it('should return data after triggering', async () => {
    const key = createKey()

    function Page() {
      const { data, trigger } = useSWRPassive(key, () => 'data')
      return <button onClick={() => trigger()}>{data || 'pending'}</button>
    }

    render(<Page />)

    // mount
    await screen.findByText('pending')

    fireEvent.click(screen.getByText('pending'))
    await waitForNextTick()

    screen.getByText('data')
  })
})
