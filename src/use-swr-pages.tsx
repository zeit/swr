import React, { useCallback, useMemo, useState, useRef, useEffect } from 'react'

import { cache } from './config'
import {
  pagesResponseInterface,
  responseInterface,
  pageComponentType,
  pageOffsetMapperType
} from './types'

/*
The idea

A "Page" component renders the content of 1 API request, it accepts an offset (in this example it's from),
uses a SWR hook (useSWR(API + '?limit=' + limit + '&from=' + from)) and returns items (Projects).

The UI:
      +------------------------------------------+
      |   Projects                               |
+------------------------------------------------------+
|     |   +----------------+                     |     |
|     |                                          |     |
|     |   +------------+                         |     |
|     |                                          |     +--> 1 Page
|     |   +-----------------+                    |     |
|     |                                          |     |  /projects/list?limit=4
|     |   +---------+                            |     |
+------------------------------------------------------+
      |                                          |
      |   +------------+                         |     +  /projects/list?limit=4&from=123
      |                                          |     |
      |   +----------------+                     |     |
      |                                          |     |
      |   +---------+                            |     |
      |                                          |     |
      |   +--------------+                       |     +
      |                                          |
      |   +-------------------+                  |     +  /projects/list?limit=4&from=456
      |                                          |     |
      |   +------------+                         |     |
      |                                          |     |
      |   +----------------+                     |     |
      |                                          |     |
      |                                          |     +

The API
// (inside `render`)

function App () {
  const {
    pages,    // an array of each page component
    pageSWRs, // an array of SWRs of each page
    isLoadingMore,
    isReachingEnd,
    isEmpty,
    loadMore
  } = useSWRPages(
    'project-page', // key of this page

    // ======== the actual Page component!
    ({ offset, withSWR }) => {
      // required: use `withSWR` to wrap your main SWR (source of your pagination API)
      const { data } = withSWR(
        useSWR(API + '?limit=10&from=' + offset) // request projects with offset
      )
      if (!data) return <Placeholder>
      return data.projects.map(project => <Card project={project} team={team}>)
    },
    // ========

    // a function accepts a SWR's `data`, and returns the offset of the next page (or null)
    data => data && data.length >= 10 ? data[data.length - 1].createdAt : null,

    // (optional) outside deps of your Page component. in this case it's empty
    []
  )

  // ...

  if (isEmpty) return <EmptyProjectsPage/>

  return <div>
    {pages}
    {isReachingEnd
      ? null
      : <button loading={isLoadingMore} onClick={loadMore}>Load More</button>}
  </div>
}
*/

const pageCacheMap = new Map()

export function useSWRPages<OffsetType = any, Data = any, Error = any>(
  pageKey: string,
  pageFn: pageComponentType<OffsetType, Data, Error>,
  SWRToOffset: pageOffsetMapperType<OffsetType, Data, Error>,
  deps: any[] = []
): pagesResponseInterface<Data, Error> {
  const pageCountKey = `_swr_page_count_` + pageKey
  const pageOffsetKey = `_swr_page_offset_` + pageKey

  const [pageCount, setPageCount] = useState<number>(
    cache.get(pageCountKey) || 1
  )
  const [pageOffsets, setPageOffsets] = useState<OffsetType[]>(
    cache.get(pageOffsetKey) || [null]
  )
  const [pageSWRs, setPageSWRs] = useState<responseInterface<Data, Error>[]>([])

  const pageFnRef = useRef(pageFn)
  const emptyPageRef = useRef(false)

  // Page component (wraps `pageFn`)
  // for performance reason we need to memorize it
  const Page = useCallback(props => {
    // render the page component
    const dataList = pageFnRef.current(props)

    // if dataList is [], we can assume this page is empty
    // TODO: this API is not stable
    if (dataList && !dataList.length) {
      emptyPageRef.current = true
    } else {
      emptyPageRef.current = false
    }

    return dataList
  }, [])

  // Doesn't have a next page
  const isReachingEnd = pageOffsets[pageCount] === null
  const isLoadingMore = pageCount === pageOffsets.length
  const isEmpty = isReachingEnd && pageCount === 1 && emptyPageRef.current
  const loadMore = useCallback(() => {
    if (isLoadingMore || isReachingEnd) return
    setPageCount(c => {
      cache.set(pageCountKey, c + 1)
      return c + 1
    })
  }, [isLoadingMore || isReachingEnd])
  const _pageFn = useCallback(pageFn, deps)
  pageFnRef.current = _pageFn

  const pages = useMemo(() => {
    const getWithSWR = id => swr => {
      if (
        !pageSWRs[id] ||
        pageSWRs[id].data !== swr.data ||
        pageSWRs[id].error !== swr.error ||
        pageSWRs[id].revalidate !== swr.revalidate
      ) {
        // hoist side effects: setPageSWRs and setPageOffsets -- https://reactjs.org/blog/2020/02/26/react-v16.13.0.html#warnings-for-some-updates-during-render
        setTimeout(() => {
          setPageSWRs(swrs => {
            const _swrs = [...swrs]
            _swrs[id] = {
              data: swr.data,
              error: swr.error,
              revalidate: swr.revalidate,
              isValidating: swr.isValidating,
              mutate: swr.mutate
            }
            return _swrs
          })
          if (typeof swr.data !== 'undefined') {
            // set next page's offset
            const newPageOffset = SWRToOffset(swr, id)
            if (pageOffsets[id + 1] !== newPageOffset) {
              setPageOffsets(arr => {
                const _arr = [...arr]
                _arr[id + 1] = newPageOffset
                cache.set(pageOffsetKey, _arr)
                return _arr
              })
            }
          }
        })
      }
      return swr
    }

    // render each page
    const p = []
    if (!pageCacheMap.has(pageKey)) {
      pageCacheMap.set(pageKey, [])
    }
    const pageCache = pageCacheMap.get(pageKey)
    for (let i = 0; i < pageCount; ++i) {
      if (
        !pageCache[i] ||
        pageCache[i].offset !== pageOffsets[i] ||
        pageCache[i].pageFn !== _pageFn
      ) {
        // when props change or at init
        // render the page and cache it
        pageCache[i] = {
          component: (
            <Page
              key={`page-${pageOffsets[i]}-${i}`}
              offset={pageOffsets[i]}
              withSWR={getWithSWR(i)}
            />
          ),
          pageFn: _pageFn,
          offset: pageOffsets[i]
        }
      }
      p.push(pageCache[i].component)
    }
    return p
  }, [_pageFn, pageCount, pageSWRs, pageOffsets, pageKey])

  // This effect is used to keep track of the active keys
  // The listener does nothing, but is recreated on each useEffect call
  // So it's always a new function and don't get deduped by Set
  useEffect(() => {
    const unsubscribeCount = cache.subscribe(() => {}, pageCountKey)
    const unsubscribeOffset = cache.subscribe(() => {}, pageOffsetKey)
    return () => {
      unsubscribeCount()
      unsubscribeOffset()
    }
  }, [pageCountKey, pageOffsetKey])

  return {
    pages,
    pageCount,
    pageSWRs,
    isLoadingMore,
    isReachingEnd,
    isEmpty,
    loadMore
  }
}
