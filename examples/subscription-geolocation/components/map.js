import useSWR from 'swr'
import { Map as LeafletMap, TileLayer } from 'react-leaflet'

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

export default function Map() {
  const { data: position } = useSWR('geolocation', fetcher, { subscribe })

  if (!position) return null

  return (
    <LeafletMap center={[position.latitude, position.longitude]} zoom={15}>
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors'
      />
    </LeafletMap>
  )
}
