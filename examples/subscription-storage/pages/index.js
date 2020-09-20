import useSWR from 'swr'

function fetcher(key) {
  const data = localStorage.getItem(key)
  if (data) return data
  localStorage.setItem(key, '')
  return ''
}

function subscribe(key, mutate) {
  const listener = event => {
    if (event.key !== key) return
    mutate() // trigger a revalidation
  }
  window.addEventListener('storage', listener)
  return () => window.removeEventListener('storage', listener)
}

export default function Page() {
  const { data, mutate } = useSWR('username', fetcher, { subscribe })

  const handleChange = React.useCallback(
    event => {
      localStorage.setItem('username', event.target.value)
      mutate(event.target.value)
    },
    [mutate]
  )

  return (
    <div style={{ textAlign: 'center' }}>
      <p>
        Open this page in another tab side by side with this tab and write below
      </p>
      <label htmlFor="name">Name</label>
      <input
        id="name"
        name="name"
        type="text"
        value={data}
        onChange={handleChange}
      />
    </div>
  )
}
