import type { TipoDeEvento } from '@/lib/actividad/ingesta'
import { construirDia, HUECO_MAXIMO_MIN, nombreDePantalla, type EventoDeActividad } from '@/lib/actividad/linea'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const MIN = 60_000
const BASE = Date.UTC(2026, 9, 23, 13, 0, 0) // 13:00 UTC
let idSiguiente = 1
const ev = (minuto: number, tipo: TipoDeEvento, ruta: string | null = '/dashboard', detalle: string | null = null, seg = 0): EventoDeActividad => ({
  id: idSiguiente++,
  t: BASE + minuto * MIN + seg * 1000,
  tipo,
  ruta,
  detalle,
  sesion: 's1',
})

console.log('\n=== un día sin nada ===')
{
  const d = construirDia([])
  ok('sin actividad', d.primera === null && d.ultima === null && d.minutosActivos === 0 && d.tramos.length === 0 && d.pantallas.length === 0)
}

console.log('\n=== minutos activos ===')
{
  const d = construirDia([ev(0, 'sesion'), ev(0, 'latido'), ev(1, 'latido'), ev(2, 'latido'), ev(2, 'clic', '/dashboard', 'Guardar')])
  ok('tres minutos (el clic cae en un minuto que ya tenía latido)', d.minutosActivos === 3, String(d.minutosActivos))
  ok('un solo tramo', d.tramos.length === 1)
  ok('el tramo cubre del minuto 0 al fin del 2', d.tramos[0].desde === BASE && d.tramos[0].hasta === BASE + 3 * MIN)
}
{
  const d = construirDia([ev(0, 'latido'), ev(0, 'latido', '/dashboard', null, 20)])
  ok('dos señales en el mismo minuto son un minuto', d.minutosActivos === 1)
}
{
  const d = construirDia([ev(5, 'clic', '/dashboard/correo', 'Enviar')])
  ok('un clic solo ya cuenta como actividad', d.minutosActivos === 1 && d.clics === 1)
}
{
  const d = construirDia([ev(0, 'oculta'), ev(1, 'visible')])
  ok('salir de la pestaña o volver no es actividad', d.minutosActivos === 0 && d.primera === null && d.ultima === null)
}

console.log('\n=== tramos: una pausa corta no parte, una larga sí ===')
{
  // minutos 0,1 · hueco de 2 minutos vacíos (2 y 3) · 4,5  →  sigue siendo uno (4 - 1 = 3 ≤ HUECO_MAXIMO_MIN)
  const corta = construirDia([ev(0, 'latido'), ev(1, 'latido'), ev(4, 'latido'), ev(5, 'latido')])
  ok(`con ${HUECO_MAXIMO_MIN - 1} minutos vacíos se queda en un tramo`, corta.tramos.length === 1, JSON.stringify(corta.tramos))
  ok('pero los minutos activos son 4, no 6', corta.minutosActivos === 4)
  // minutos 0 · 10 → dos tramos
  const larga = construirDia([ev(0, 'latido'), ev(10, 'latido')])
  ok('con diez minutos de por medio, dos tramos', larga.tramos.length === 2)
  ok('cada tramo dura un minuto', larga.tramos.every((t) => t.hasta - t.desde === MIN))
}

console.log('\n=== primera y última ===')
{
  const d = construirDia([ev(30, 'latido'), ev(0, 'sesion'), ev(45, 'oculta'), ev(40, 'clic', '/dashboard', 'Ok')])
  ok('la primera es la más temprana, desordenada o no', d.primera === BASE)
  ok('la última es la última cosa que hizo (no salir de la pestaña)', d.ultima === BASE + 40 * MIN, String(d.ultima))
}

console.log('\n=== tiempo por pantalla ===')
{
  const d = construirDia([
    ev(0, 'pagina', '/dashboard/cold-calling'),
    ev(0, 'latido', '/dashboard/cold-calling'),
    ev(1, 'latido', '/dashboard/cold-calling'),
    ev(2, 'latido', '/dashboard/cold-calling'),
    ev(2, 'clic', '/dashboard/cold-calling', 'Guardar'),
    ev(3, 'pagina', '/dashboard/correo'),
    ev(3, 'latido', '/dashboard/correo'),
    ev(4, 'pagina', '/dashboard/cold-calling'),
    ev(4, 'latido', '/dashboard/cold-calling'),
    ev(9, 'pagina', '/dashboard/tracker'),
  ])
  const por = Object.fromEntries(d.pantallas.map((p) => [p.ruta, p]))
  ok('Cold Calling: 4 minutos activos, 2 visitas y 1 clic', por['/dashboard/cold-calling'].minutos === 4 && por['/dashboard/cold-calling'].visitas === 2 && por['/dashboard/cold-calling'].clics === 1, JSON.stringify(por['/dashboard/cold-calling']))
  ok('Correo: 1 minuto y 1 visita', por['/dashboard/correo'].minutos === 1 && por['/dashboard/correo'].visitas === 1)
  ok('una pantalla abierta sin llegar a un minuto activo también sale (0 min)', por['/dashboard/tracker'].minutos === 0 && por['/dashboard/tracker'].visitas === 1)
  ok('ordenadas por tiempo', d.pantallas[0].ruta === '/dashboard/cold-calling' && d.pantallas[d.pantallas.length - 1].ruta === '/dashboard/tracker')
  ok('4 páginas abiertas en total contando la repetida', d.paginas === 4)
}

console.log('\n=== el registro ===')
{
  const d = construirDia([ev(0, 'sesion'), ev(0, 'latido'), ev(1, 'latido'), ev(1, 'clic', '/dashboard', 'Abrir'), ev(2, 'oculta')])
  ok('el registro no lleva los «sigo aquí»', d.registro.every((e) => e.tipo !== 'latido') && d.registro.length === 3)
  ok('y va en orden', d.registro.map((e) => e.tipo).join() === 'sesion,clic,oculta')
}
{
  const d = construirDia([ev(0, 'login', '/auth/login'), ev(1, 'sesion'), ev(2, 'sesion')])
  ok('cuenta inicios de sesión y sesiones abiertas', d.logins === 1 && d.sesiones === 2)
}
{
  const original = [ev(2, 'latido'), ev(1, 'latido')]
  const copia = JSON.stringify(original)
  construirDia(original)
  ok('no toca la lista que recibe', JSON.stringify(original) === copia)
}

console.log('\n=== nombres de pantalla ===')
const conocidas = [
  { route: '/dashboard', name: 'Inicio' },
  { route: '/dashboard/cold-calling', name: 'Cold Calling' },
  { route: '/dashboard/rendimiento', name: 'Mi rendimiento' },
  { route: '/dashboard/rendimiento/informe', name: 'Informe' },
]
ok('Inicio', nombreDePantalla('/dashboard', conocidas) === 'Inicio')
ok('una app', nombreDePantalla('/dashboard/cold-calling', conocidas) === 'Cold Calling')
ok('una subruta cae en su app', nombreDePantalla('/dashboard/cold-calling/algo', conocidas) === 'Cold Calling')
ok('gana el prefijo más largo', nombreDePantalla('/dashboard/rendimiento/informe', conocidas) === 'Informe')
ok('una ruta que no se conoce se enseña tal cual', nombreDePantalla('/dashboard/zzz', conocidas) === '/dashboard/zzz')
ok('el login', nombreDePantalla('/auth/login', conocidas) === 'Inicio de sesión')
ok('no confunde prefijos parecidos', nombreDePantalla('/dashboard/cold-calling-2', conocidas) === '/dashboard/cold-calling-2')

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
