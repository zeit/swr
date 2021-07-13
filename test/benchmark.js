// This benchmark demonstrates the performance overhead of the `useSWR()` call.
// It renders 1000 components which contain the SWR hook of 50 unique keys,
// that is a reasonable estimation of the usage in a normal sized web app.
//
// However it doesn't include benchmarks for other parts of the lib, as we are
// mainly focused on the FMP metrics and that's the most noticable thing.
// Revalidations and subsequent re-renders will happen quietly when idle.
//
// To run this benchmark, install `react-benchmark` globally and execute:
//
//   react-benchmark test/benchmark.js
//
// You can also use this command to debug with Chrome DevTools even further
// (remember to format `dist/index.js` first):
//
// . react-benchmark test/benchmark.js -td
//

import React from 'react'
import useSWR from '../dist/index.js'

const fetcher = key =>
  new Promise(resolve => setTimeout(resolve('res-' + key), 100))

function Component({ index }) {
  const { data } = useSWR('key-' + ~~(index % 50), fetcher)
  return data || 'loading...'
}

export default function() {
  const arr = []
  for (let i = 0; i < 1000; ++i) {
    arr.push(i)
  }

  return React.createElement(
    'div',
    {},
    arr.map(index => React.createElement(Component, { index, key: index }))
  )
}
