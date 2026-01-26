import { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Weekend Loop Backstage',
    short_name: 'Backstage',
    description: 'Gestão profissional de repertório e escalas.',
    start_url: '/',
    id: '/',
    display: 'standalone',
    orientation: 'portrait', // Trava em pé (ideal para músicos no palco)
    background_color: '#020617', // Slate 950
    theme_color: '#020617',      // Slate 950 (funde com a status bar)
    icons: [
      {
        src: '/icon-192x192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  }
}