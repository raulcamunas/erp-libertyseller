import type { MetadataRoute } from 'next'

/**
 * EL ERP COMO APLICACIÓN INSTALABLE (móvil y escritorio): «Añadir a pantalla de inicio» en el móvil y «Instalar» en Chrome. Se abre sin la barra del navegador y arranca en
 * el panel. No lleva service worker a propósito: no guarda nada sin conexión, así que no hay nada viejo que se quede pegado tras un despliegue.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Liberty Seller Hub',
    short_name: 'Liberty Hub',
    description: 'ERP interno de Liberty Seller',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    background_color: '#0F1114',
    theme_color: '#0F1114',
    lang: 'es',
    icons: [
      { src: '/pwa/icono-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa/icono-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/pwa/icono-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
