/*
 * EL SERVICE WORKER DE LOS AVISOS PUSH.
 *
 * Hace SOLO dos cosas: enseñar la notificación cuando llega un aviso del servidor y, al pulsarla, llevar a la pantalla que corresponde. NO guarda nada sin conexión ni intercepta
 * peticiones (no hay `fetch` aquí), así que no puede dejar ninguna versión vieja de la app pegada tras un despliegue.
 *
 * Cada aviso se enseña siempre (iOS y los navegadores exigen que cada push se vea). La etiqueta es la dirección a la que lleva: si el navegador ya enseñó por su cuenta el aviso
 * (pestaña oculta), este lo sustituye en vez de salir dos veces.
 */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (evento) => evento.waitUntil(self.clients.claim()))

self.addEventListener('push', (evento) => {
  let datos = {}
  try {
    datos = evento.data ? evento.data.json() : {}
  } catch (e) {
    datos = {}
  }
  const titulo = typeof datos.titulo === 'string' && datos.titulo ? datos.titulo : 'Liberty Seller Hub'
  const url = typeof datos.url === 'string' && datos.url.startsWith('/') ? datos.url : '/dashboard'
  evento.waitUntil(
    self.registration.showNotification(titulo, {
      body: typeof datos.cuerpo === 'string' ? datos.cuerpo : '',
      icon: '/pwa/icono-192.png',
      badge: '/pwa/icono-192.png',
      tag: typeof datos.etiqueta === 'string' && datos.etiqueta ? datos.etiqueta : url,
      renotify: true,
      data: { url },
    })
  )
})

self.addEventListener('notificationclick', (evento) => {
  evento.notification.close()
  const destino = new URL((evento.notification.data && evento.notification.data.url) || '/dashboard', self.location.origin).href
  evento.waitUntil(
    (async () => {
      const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const mia = ventanas.find((v) => v.url.startsWith(self.location.origin))
      if (mia) {
        await mia.focus()
        if ('navigate' in mia) await mia.navigate(destino).catch(() => undefined)
        return
      }
      await self.clients.openWindow(destino)
    })()
  )
})
