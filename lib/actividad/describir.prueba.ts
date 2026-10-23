import { describirEvento } from '@/lib/actividad/describir'
import type { EventoDeActividad } from '@/lib/actividad/linea'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const conocidas = [
  { route: '/dashboard', name: 'Inicio' },
  { route: '/dashboard/cold-calling', name: 'Cold Calling' },
  { route: '/dashboard/correo', name: 'Correo' },
]
const e = (parte: Partial<EventoDeActividad>): EventoDeActividad => ({ id: 1, t: 0, tipo: 'pagina', ruta: '/dashboard', detalle: null, sesion: null, ...parte })

console.log('\n=== describirEvento ===')
ok('abrir el ERP, con el navegador y la IP', JSON.stringify(describirEvento(e({ tipo: 'sesion', agente: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', ip: '203.0.113.9' }), conocidas)) === JSON.stringify({ texto: 'Abrió el ERP', aparte: 'Chrome · macOS · 203.0.113.9' }))
ok('iniciar sesión', describirEvento(e({ tipo: 'login' }), conocidas).texto === 'Inició sesión')
ok('abrir el ERP sin datos de dónde: sin «aparte»', describirEvento(e({ tipo: 'sesion' }), conocidas).aparte === null)
ok('abrir una pantalla, con su nombre', describirEvento(e({ tipo: 'pagina', ruta: '/dashboard/cold-calling' }), conocidas).texto === 'Abrió «Cold Calling»')
ok('abrir una pantalla sin ruta', describirEvento(e({ tipo: 'pagina', ruta: null }), conocidas).texto === 'Abrió «una pantalla»')
ok('un clic dice el botón y dónde', JSON.stringify(describirEvento(e({ tipo: 'clic', ruta: '/dashboard/correo', detalle: 'Enviar' }), conocidas)) === JSON.stringify({ texto: 'Pulsó «Enviar»', aparte: 'en Correo' }))
ok('un clic sin pantalla', describirEvento(e({ tipo: 'clic', ruta: null, detalle: 'Ok' }), conocidas).aparte === null)
ok('salir de la pestaña', describirEvento(e({ tipo: 'oculta' }), conocidas).texto === 'Salió de la pestaña')
ok('volver a la pestaña', describirEvento(e({ tipo: 'visible' }), conocidas).texto === 'Volvió a la pestaña')
ok('un «sigo aquí»', describirEvento(e({ tipo: 'latido' }), conocidas).texto === 'Activo')

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
