import Head from 'next/head'
import dynamic from 'next/dynamic'

const Map = dynamic(() => import('../components/map'), { ssr: false })

export default function MapPage() {
  return (
    <>
      <Head>
        <link
          rel="stylesheet"
          href="//cdnjs.cloudflare.com/ajax/libs/leaflet/1.3.1/leaflet.css"
        />
      </Head>
      <style jsx global>{`
        body {
          margin: 0;
        }
        .leaflet-container {
          height: 100vh;
          width: 100vw;
          margin: 0 auto;
        }
      `}</style>
      <Map />
    </>
  )
}
