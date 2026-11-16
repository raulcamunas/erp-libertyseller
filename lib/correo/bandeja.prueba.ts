import { fusionarPrimeraPagina, leerQueryDeBandeja, mezclarResultadosDeBusqueda, siguienteCursor } from '@/lib/correo/bandeja'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const igual = (n: string, real: unknown, esperado: unknown) => ok(n, JSON.stringify(real) === JSON.stringify(esperado), `${JSON.stringify(real)} (esperaba ${JSON.stringify(esperado)})`)

const ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const h = (id: string, minuto: number, extra: Record<string, unknown> = {}) => ({
  id,
  ultimoMensajeAt: new Date(Date.UTC(2026, 10, 16, 10, minuto)).toISOString(),
  ...extra,
})

console.log('\n1. Leer la consulta')
{
  const r = leerQueryDeBandeja(new URLSearchParams(''))
  igual('por defecto: todos, mios, 40 y silenciados INCLUIDOS', r, {
    ok: true,
    consulta: { vista: 'todos', sinLeer: false, q: null, antes: null, antesId: null, limite: 40, carpeta: 'mios', silenciados: true },
  })
  const o = leerQueryDeBandeja(new URLSearchParams('silenciados=0'))
  ok('silenciados=0 los oculta', o.ok && o.consulta.silenciados === false)
  const s1 = leerQueryDeBandeja({ silenciados: '1' })
  ok('silenciados=1 (y con un objeto en vez de URLSearchParams)', s1.ok && s1.consulta.silenciados === true)
  const t = leerQueryDeBandeja(
    new URLSearchParams({ vista: 'pendientes', sinLeer: '1', q: '  presupuesto   q4 ', antes: '2026-11-16T10:00:00Z', antesId: ID.toUpperCase(), limite: '500', carpeta: 'asignados' }),
  )
  igual('todo puesto: búsqueda limpia, cursor normalizado y límite a 100', t.ok && t.consulta, {
    vista: 'pendientes',
    sinLeer: true,
    q: 'presupuesto q4',
    antes: '2026-11-16T10:00:00.000Z',
    antesId: ID,
    limite: 100,
    carpeta: 'asignados',
    silenciados: true,
  })
  const corta = leerQueryDeBandeja({ q: 'a' })
  ok('búsqueda de 1 carácter: como sin búsqueda', corta.ok && corta.consulta.q === null)
  const cero = leerQueryDeBandeja({ limite: '0' })
  ok('límite 0: sube a 1', cero.ok && cero.consulta.limite === 1)
  const mal = (n: string, q: Record<string, string>) => ok(n, !leerQueryDeBandeja(q).ok)
  mal('vista inventada', { vista: 'papelera' })
  mal('carpeta inventada', { carpeta: 'equipo' })
  mal('silenciados raro', { silenciados: 'quizá' })
  mal('cursor que no es fecha', { antes: 'ayer' })
  mal('antesId sin antes', { antesId: ID })
  mal('antesId que no es UUID', { antes: '2026-11-16T10:00:00Z', antesId: '42' })
  mal('límite que no es número', { limite: 'muchos' })
  mal('búsqueda de 201 caracteres', { q: 'x'.repeat(201) })
}

console.log('\n2. Cursor')
{
  const filas = [h('c', 5), h('b', 4), h('a', 3)]
  igual('sobra una fila: hay siguiente, con la última de la página', siguienteCursor(filas, 2), {
    pagina: [filas[0], filas[1]],
    siguiente: { antes: filas[1].ultimoMensajeAt, antesId: 'b' },
  })
  igual('no sobra ninguna: no hay más', siguienteCursor(filas, 3).siguiente, null)
  igual('vacía', siguienteCursor([], 40), { pagina: [], siguiente: null })
}

console.log('\n3. Mezclar búsquedas de varios buzones')
{
  const r = mezclarResultadosDeBusqueda(
    [
      [h('a1', 1), h('a9', 9)],
      [h('b5', 5), h('a9', 9)],
      [h('x5', 5), h('c7', 7)],
    ],
    4,
  )
  igual('por fecha desc, desempate por id desc, sin repetir y cortado', r.map((x) => x.id), ['a9', 'c7', 'x5', 'b5'])
}

console.log('\n4. Fusionar la primera página (sondeo)')
{
  const actual = { hilos: [h('d', 40), h('c', 30), h('b', 20), h('a', 10)], siguiente: { antes: h('a', 10).ultimoMensajeAt, antesId: 'a' } }
  // Llega «e» nuevo; «c» ha recibido un mensaje y sube; «d» se ha ido (leído con «Sin leer»)
  const primera = { hilos: [h('e', 50), h('c', 45), h('b', 20)], siguiente: { antes: h('b', 20).ultimoMensajeAt, antesId: 'b' } }
  const r = fusionarPrimeraPagina(actual, primera)
  igual('orden: la primera página y debajo lo ya cargado', r.hilos.map((x) => x.id), ['e', 'c', 'b', 'a'])
  igual('marca como nuevas la que no estaba y la que ha recibido un mensaje', r.nuevas, ['e', 'c'])
  igual('se queda el cursor de lo ya cargado', r.siguiente, actual.siguiente)
  ok('la fila que no ha cambiado es el mismo objeto (memo)', r.hilos[2] === actual.hilos[2])

  const fin = fusionarPrimeraPagina(actual, { hilos: [h('e', 50), h('d', 40)], siguiente: null })
  igual('si la primera página dice que no hay más, la lista es solo ella', [fin.hilos.map((x) => x.id), fin.siguiente], [['e', 'd'], null])

  const inicial = fusionarPrimeraPagina({ hilos: [], siguiente: null }, primera)
  igual('la primera carga no anima nada', inicial.nuevas, [])

  const muchas = fusionarPrimeraPagina(
    { hilos: [h('viejo', 0)], siguiente: null },
    { hilos: Array.from({ length: 20 }, (_, i) => h(`n${String(i).padStart(2, '0')}`, 59 - i)), siguiente: null },
  )
  igual('como mucho 12 animadas', muchas.nuevas.length, 12)

  const cambioSinMensaje = fusionarPrimeraPagina({ hilos: [h('a', 10, { destacado: false })], siguiente: null }, { hilos: [h('a', 10, { destacado: true })], siguiente: null })
  ok('un cambio sin mensaje nuevo (destacar) refresca la fila pero no la anima', cambioSinMensaje.nuevas.length === 0 && (cambioSinMensaje.hilos[0] as { destacado?: boolean }).destacado === true)
}

console.log(fallos === 0 ? '\nTODO BIEN' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
