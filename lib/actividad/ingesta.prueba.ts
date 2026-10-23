import { MAX_ANTIGUEDAD_MS, MAX_EVENTOS_POR_PETICION, prepararLote, TIPOS_DE_EVENTO } from '@/lib/actividad/ingesta'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const AHORA = Date.UTC(2026, 9, 23, 10, 0, 0)
const ctx = { userId: 'u-1', ahoraMs: AHORA, ip: '203.0.113.9', agente: 'Mozilla/5.0 (Macintosh) Chrome/130' }
const SESION = 'abcDEF123_-xyz'

console.log('\n=== lo básico ===')
{
  const { filas, descartados } = prepararLote(
    {
      sesion: SESION,
      eventos: [
        { t: 'pagina', ruta: '/dashboard/cold-calling?lead=abc', hace: 2000 },
        { t: 'clic', ruta: '/dashboard/cold-calling', detalle: 'Guardar', hace: 500 },
        { t: 'latido', ruta: '/dashboard/cold-calling' },
      ],
    },
    ctx
  )
  ok('tres filas', filas.length === 3 && descartados === 0)
  ok('el usuario lo pone el servidor', filas.every((f) => f.user_id === 'u-1'))
  ok('la hora se calcula con «hace»', filas[0].ocurrio_at === new Date(AHORA - 2000).toISOString())
  ok('sin «hace», es ahora', filas[2].ocurrio_at === new Date(AHORA).toISOString())
  ok('la ruta va limpia', filas[0].ruta === '/dashboard/cold-calling')
  ok('el clic lleva su etiqueta', filas[1].detalle === 'Guardar')
  ok('lo demás no lleva detalle', filas[0].detalle === null && filas[2].detalle === null)
  ok('todas llevan la sesión', filas.every((f) => f.sesion === SESION))
  ok('la IP y el navegador NO se guardan en un clic', filas.every((f) => f.ip === null && f.agente === null))
}

console.log('\n=== la IP solo al abrir ===')
{
  const { filas } = prepararLote({ sesion: SESION, eventos: [{ t: 'sesion', ruta: '/dashboard' }, { t: 'login', ruta: '/auth/login' }] }, ctx)
  ok('al abrir sesión se guarda de dónde', filas[0].ip === '203.0.113.9' && filas[0].agente?.includes('Chrome') === true)
  ok('y al iniciar sesión', filas[1].ip === '203.0.113.9')
}

console.log('\n=== lo que no se fía ===')
{
  const { filas, descartados } = prepararLote({ sesion: SESION, eventos: [{ t: 'hackear', ruta: '/x' }, { t: 'pagina', ruta: '/dashboard' }, 5, null, 'x'] }, ctx)
  ok('un tipo desconocido y lo que no es objeto se descartan', filas.length === 1 && descartados === 4, `${filas.length}/${descartados}`)
}
{
  const { filas } = prepararLote({ sesion: SESION, eventos: [{ t: 'clic', ruta: '/dashboard', detalle: '   ' }, { t: 'clic', ruta: '/dashboard' }] }, ctx)
  ok('un clic sin nombre no deja fila', filas.length === 0)
}
{
  const { filas } = prepararLote({ sesion: SESION, eventos: [{ t: 'clic', ruta: '/dashboard', detalle: 'Llamar a juan@x.com' }] }, ctx)
  ok('un correo en un botón no se guarda', filas[0].detalle === '(dato oculto)')
}
{
  const { filas } = prepararLote({ sesion: SESION, eventos: [{ t: 'latido', ruta: 'https://evil.com' }] }, ctx)
  ok('una ruta de fuera queda sin ruta', filas[0].ruta === null)
}
{
  const { filas } = prepararLote({ sesion: 'no vale!', eventos: [{ t: 'latido', ruta: '/dashboard' }] }, ctx)
  ok('una sesión con forma rara se ignora', filas[0].sesion === null)
}
{
  const { filas } = prepararLote({ user_id: 'otro', eventos: [{ t: 'latido', ruta: '/dashboard', user_id: 'otro' }] }, ctx)
  ok('un user_id en el cuerpo no cuenta', filas[0].user_id === 'u-1')
}

console.log('\n=== la hora no se puede falsear ===')
{
  const { filas } = prepararLote({ sesion: SESION, eventos: [{ t: 'latido', hace: 99_999_999_999 }, { t: 'latido', hace: -50_000 }, { t: 'latido', hace: Number.NaN }, { t: 'latido', hace: 'ayer' }] }, ctx)
  ok('lo muy antiguo se acota a diez minutos', filas[0].ocurrio_at === new Date(AHORA - MAX_ANTIGUEDAD_MS).toISOString())
  ok('un «hace» negativo (el futuro) se vuelve ahora', filas[1].ocurrio_at === new Date(AHORA).toISOString())
  ok('NaN y texto, ahora', filas[2].ocurrio_at === new Date(AHORA).toISOString() && filas[3].ocurrio_at === new Date(AHORA).toISOString())
}

console.log('\n=== el tope del lote ===')
{
  const muchos = Array.from({ length: MAX_EVENTOS_POR_PETICION + 25 }, () => ({ t: 'latido', ruta: '/dashboard' }))
  const { filas, descartados } = prepararLote({ sesion: SESION, eventos: muchos }, ctx)
  ok('se guardan los primeros', filas.length === MAX_EVENTOS_POR_PETICION)
  ok('y se cuenta lo que sobra', descartados === 25)
}

console.log('\n=== cuerpos que no son un lote ===')
ok('null', prepararLote(null, ctx).filas.length === 0)
ok('un texto', prepararLote('hola', ctx).filas.length === 0)
ok('sin eventos', prepararLote({ sesion: SESION }, ctx).filas.length === 0)
ok('eventos que no es una lista', prepararLote({ eventos: { t: 'latido' } }, ctx).filas.length === 0)
ok('la lista de tipos', TIPOS_DE_EVENTO.join() === 'sesion,login,pagina,clic,latido,oculta,visible')

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
