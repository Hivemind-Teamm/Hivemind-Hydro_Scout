import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/', name: 'Hydro-Scout', short_name: 'Hydro-Scout',
    description: 'Station coordination and hydrant monitoring',
    start_url: '/dashboard', scope: '/', display: 'standalone',
    background_color: '#ffffff', theme_color: '#e0353b',
    icons: [{ src: '/Hydro-Scout%20Logo.png', type: 'image/png' }],
  };
}
