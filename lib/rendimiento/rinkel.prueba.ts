import {
  ErrorRinkel,
  MENSAJE_DE_ERROR,
  comprobarClave,
  finalDeClave,
  leerPaginaDeLlamadas,
  limpiarClave,
  normalizarLlamada,
  pedirRinkel,
  pedirUrlDeGrabacion,
  type DepsRinkel,
} from '@/lib/rendimiento/rinkel'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * EL CLIENTE DE RINKEL.
 *
 * Las llamadas de abajo tienen la forma de las reales (leídas de la API el 22 de octubre de 2026): lo único
 * inventado son los identificadores y los números de teléfono.
 */

const CLAVE = 'a'.repeat(64)

const llamadaContestada = {
  id: '6a00000000000000000000a1',
  callId: 'd900000000000000000000b1',
  date: '2026-10-21T11:54:28.741Z',
  direction: 'outbound',
  externalNumber: { anonymous: false, localized: '+34 600 11 22 33', e164: '+34600112233', isOnClientBlacklist: false, isOnGlobalBlacklist: false },
  internalNumber: { id: '6a00000000000000000000c1', label: 'Maoli Liberty Seller', localizedNumber: '+34 931 11 22 33', number: '+34931112233' },
  duration: 25,
  status: 'ANSWERED',
  missedReason: null,
  menuOption: null,
  user: { id: '6a00000000000000000000d1', fullName: 'Raul Camuñas' },
  users: [{ id: '6a00000000000000000000d1' }],
  contact: null,
  voicemail: null,
  callRecording: { id: '6a00000000000000000000a1', availableUntil: '2027-01-19T12:54:28.741Z', playUrl: 'https://api.rinkel.com/v1/call-recordings/6a00000000000000000000a1/stream' },
  hasNotes: false,
  insights: { id: null, status: 'UNAVAILABLE', summary: null },
}

const llamadaPerdida = {
  ...llamadaContestada,
  id: '6a00000000000000000000a2',
  callId: 'd900000000000000000000b2',
  date: '2026-10-21T12:01:26.352Z',
  duration: 36,
  status: 'MISSED',
  missedReason: 'NO_ANSWER',
  callRecording: null,
}

/** Un `fetch` que contesta lo que se le diga y apunta qué se le pidió */
function falso(respuestas: Array<{ estado?: number; cuerpo?: unknown; texto?: string; lanza?: boolean }>) {
  const peticiones: Array<{ url: string; cabeceras: Record<string, string> }> = []
  let i = 0
  const fetchFalso = (async (url: RequestInfo | URL, init?: RequestInit) => {
    peticiones.push({ url: String(url), cabeceras: { ...((init?.headers as Record<string, string>) ?? {}) } })
    const r = respuestas[Math.min(i, respuestas.length - 1)]
    i += 1
    if (r.lanza) throw new TypeError('fallo de red')
    const estado = r.estado ?? 200
    return new Response(r.texto ?? JSON.stringify(r.cuerpo ?? {}), { status: estado, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  const deps: Partial<DepsRinkel> = { fetch: fetchFalso, esperaMs: 1000 }
  return { deps, peticiones }
}

const falla = async (f: () => Promise<unknown>): Promise<ErrorRinkel | null> => {
  try {
    await f()
    return null
  } catch (e) {
    return e instanceof ErrorRinkel ? e : null
  }
}

async function main() {
  console.log('\n=== una llamada contestada y grabada ===')
  {
    const f = normalizarLlamada(llamadaContestada)
    ok('se entiende', f !== null)
    ok('con su id, su fecha en ISO y su dirección', f?.rinkel_id === '6a00000000000000000000a1' && f.fecha === '2026-10-21T11:54:28.741Z' && f.direccion === 'outbound')
    ok('contestada, 25 s', f?.estado === 'ANSWERED' && f.duracion_s === 25 && f.motivo_perdida === null)
    ok('el número del otro lado, en E.164', f?.numero === '+34600112233' && f.numero_anonimo === false)
    ok('la línea de Rinkel, con la etiqueta', f?.numero_propio === 'Maoli Liberty Seller')
    ok('la grabación con su caducidad', f?.grabacion_id === '6a00000000000000000000a1' && f.grabacion_hasta === '2027-01-19T12:54:28.741Z')
  }

  console.log('\n=== una llamada que no se cogió ===')
  {
    const f = normalizarLlamada(llamadaPerdida)
    ok('sin contestar y con su motivo', f?.estado === 'MISSED' && f.motivo_perdida === 'NO_ANSWER')
    ok('sin grabación', f?.grabacion_id === null && f.grabacion_hasta === null)
    ok('una llamada perdida también dura (36 s de tono)', f?.duracion_s === 36)
  }

  console.log('\n=== lo raro ===')
  {
    ok('un número oculto no guarda número', normalizarLlamada({ ...llamadaContestada, externalNumber: { anonymous: true, e164: null } })?.numero === null && normalizarLlamada({ ...llamadaContestada, externalNumber: { anonymous: true, e164: null } })?.numero_anonimo === true)
    ok('una entrante', normalizarLlamada({ ...llamadaContestada, direction: 'inbound' })?.direccion === 'inbound')
    ok('la dirección y el estado se normalizan a minúsculas y mayúsculas', normalizarLlamada({ ...llamadaContestada, direction: 'OUTBOUND', status: 'answered' })?.direccion === 'outbound' && normalizarLlamada({ ...llamadaContestada, status: 'answered' })?.estado === 'ANSWERED')
    ok('sin id no es una llamada', normalizarLlamada({ ...llamadaContestada, id: undefined }) === null)
    ok('sin fecha legible no es una llamada', normalizarLlamada({ ...llamadaContestada, date: 'ayer' }) === null && normalizarLlamada({ ...llamadaContestada, date: undefined }) === null)
    ok('lo que no es un objeto se descarta', normalizarLlamada(null) === null && normalizarLlamada('x') === null && normalizarLlamada([]) === null && normalizarLlamada(7) === null)
    ok('una duración que no es un número vale 0, y una negativa también', normalizarLlamada({ ...llamadaContestada, duration: 'mucha' })?.duracion_s === 0 && normalizarLlamada({ ...llamadaContestada, duration: -5 })?.duracion_s === 0)
    ok('una duración con decimales se redondea', normalizarLlamada({ ...llamadaContestada, duration: 24.6 })?.duracion_s === 25)
    ok('sin objeto de grabación, sin grabación', normalizarLlamada({ ...llamadaContestada, callRecording: undefined })?.grabacion_id === null)
    ok('sin línea interna, sin etiqueta', normalizarLlamada({ ...llamadaContestada, internalNumber: undefined })?.numero_propio === null)
  }

  console.log('\n=== pedir a Rinkel ===')
  {
    const { deps, peticiones } = falso([{ cuerpo: { data: [] } }])
    await pedirRinkel(CLAVE, '/users', { page: 2, perPage: 50, startDate: undefined }, deps)
    ok('va a la API con el /v1', peticiones[0].url.startsWith('https://api.rinkel.com/v1/users?'), peticiones[0].url)
    ok('con la clave como Bearer', peticiones[0].cabeceras.Authorization === `Bearer ${CLAVE}`)
    ok('los parámetros que no están no se mandan', !peticiones[0].url.includes('startDate') && peticiones[0].url.includes('page=2') && peticiones[0].url.includes('perPage=50'))

    const cases: Array<[number, string]> = [[401, 'clave_invalida'], [403, 'sin_permiso'], [404, 'no_encontrada'], [429, 'limite'], [500, 'servidor'], [503, 'servidor'], [418, 'respuesta']]
    for (const [estado, codigo] of cases) {
      const e = await falla(() => pedirRinkel(CLAVE, '/x', {}, falso([{ estado, cuerpo: { errors: ['secreto interno'] } }]).deps))
      ok(`HTTP ${estado} -> «${codigo}»`, e?.codigo === codigo && e.estado === estado, String(e?.codigo))
      ok(`…y el mensaje es el nuestro, no el cuerpo de Rinkel ni la clave`, !!e && e.message === MENSAJE_DE_ERROR[e.codigo] && !e.message.includes('secreto') && !e.message.includes(CLAVE))
    }
    ok('un corte de red', (await falla(() => pedirRinkel(CLAVE, '/x', {}, falso([{ lanza: true }]).deps)))?.codigo === 'red')
    ok('una respuesta que no es JSON', (await falla(() => pedirRinkel(CLAVE, '/x', {}, falso([{ texto: '<html>502</html>' }]).deps)))?.codigo === 'respuesta')
  }

  console.log('\n=== una página de llamadas ===')
  {
    const cuerpo = {
      data: [llamadaContestada, llamadaPerdida, { id: null }, 'basura'],
      meta: { pagination: { totalItems: 2096, totalPages: 42, currentPage: 3, perPage: 50 } },
    }
    const { deps, peticiones } = falso([{ cuerpo }])
    const p = await leerPaginaDeLlamadas(CLAVE, { pagina: 3, desdeSeg: 1792540800, hastaSeg: 1792627199 }, deps)
    ok('entiende las dos buenas y descarta las dos malas, contándolas', p.filas.length === 2 && p.descartadas === 2)
    ok('con el total y las páginas que dice Rinkel', p.total === 2096 && p.totalPaginas === 42 && p.pagina === 3)
    ok('pide 50 por página y la página 3', peticiones[0].url.includes('perPage=50') && peticiones[0].url.includes('page=3'))
    ok('el filtro de fechas va en SEGUNDOS UNIX', peticiones[0].url.includes('startDate=1792540800') && peticiones[0].url.includes('endDate=1792627199'))
    const grande = falso([{ cuerpo: { data: [] } }])
    await leerPaginaDeLlamadas(CLAVE, { pagina: 1, porPagina: 500 }, grande.deps)
    ok('no pide más de 50 aunque se le pida (Rinkel diría INVALID)', grande.peticiones[0].url.includes('perPage=50'))
    ok('una respuesta sin lista de datos es un error', (await falla(() => leerPaginaDeLlamadas(CLAVE, { pagina: 1 }, falso([{ cuerpo: { data: 'x' } }]).deps)))?.codigo === 'respuesta')
    ok('sin meta, lo que llega es lo que hay', (await leerPaginaDeLlamadas(CLAVE, { pagina: 1 }, falso([{ cuerpo: { data: [llamadaContestada] } }]).deps)).total === 1)
  }

  console.log('\n=== comprobar una clave ===')
  {
    const { deps, peticiones } = falso([
      { cuerpo: { data: [llamadaContestada], meta: { pagination: { totalItems: 2096, totalPages: 2096, currentPage: 1, perPage: 1 } } } },
      { cuerpo: { data: [{ id: 'u1', fullName: 'Maoli Gómez' }] } },
      { cuerpo: { data: [{ id: 'n1', label: 'Maoli Liberty Seller', localizedNumber: '+34 931 11 22 33' }] } },
    ])
    const c = await comprobarClave(CLAVE, deps)
    ok('lee UNA llamada para validar, que es lo que va a hacer después', peticiones[0].url.includes('call-detail-records') && peticiones[0].url.includes('perPage=1'))
    ok('devuelve de quién es y cuántas llamadas tiene', c.usuario === 'Maoli Gómez' && c.numero === 'Maoli Liberty Seller · +34 931 11 22 33' && c.totalLlamadas === 2096, JSON.stringify(c))

    ok('una clave que Rinkel no reconoce se rechaza', (await falla(() => comprobarClave(CLAVE, falso([{ estado: 401 }]).deps)))?.codigo === 'clave_invalida')
    ok('un plan sin API se dice como tal', (await falla(() => comprobarClave(CLAVE, falso([{ estado: 403 }]).deps)))?.codigo === 'sin_permiso')

    // Una clave que lee llamadas pero no usuarios (no es de administrador): vale igual, sin el nombre
    const sinUsuarios = await comprobarClave(CLAVE, falso([{ cuerpo: { data: [llamadaContestada], meta: { pagination: { totalItems: 10, totalPages: 10, currentPage: 1, perPage: 1 } } } }, { estado: 403 }, { estado: 403 }]).deps)
    ok('una clave sin permiso para ver usuarios y números vale igual, sin esos datos', sinUsuarios.usuario === null && sinUsuarios.numero === null && sinUsuarios.totalLlamadas === 10)
    // Pero si en la segunda lectura la clave resulta no valer, se rechaza
    ok('y si en esa segunda lectura Rinkel dice que la clave no vale, se rechaza', (await falla(() => comprobarClave(CLAVE, falso([{ cuerpo: { data: [llamadaContestada] } }, { estado: 401 }]).deps)))?.codigo === 'clave_invalida')
  }

  console.log('\n=== la URL de una grabación ===')
  {
    const buena = 'https://api.rinkel.com/v1/audio/call-recording/6a00000000000000000000a1?token=abc.def.ghi'
    const { deps, peticiones } = falso([{ cuerpo: { data: { url: buena } } }])
    const u = await pedirUrlDeGrabacion(CLAVE, '6a00000000000000000000a1', deps)
    ok('devuelve la URL temporal de Rinkel', u === buena)
    ok('la pidió al endpoint de la grabación', peticiones[0].url === 'https://api.rinkel.com/v1/call-recordings/6a00000000000000000000a1/stream')

    for (const [nombre, url] of [
      ['a otro dominio', 'https://malo.example.com/audio.mp3'],
      ['a un dominio que EMPIEZA como el de Rinkel', 'https://api.rinkel.com.malo.example.com/x'],
      ['sin cifrar', 'http://api.rinkel.com/v1/audio/x'],
      ['con usuario delante para engañar', 'https://api.rinkel.com@malo.example.com/x'],
      ['que no es una URL', 'no-es-una-url'],
    ] as const) {
      const e = await falla(() => pedirUrlDeGrabacion(CLAVE, '6a00000000000000000000a1', falso([{ cuerpo: { data: { url } } }]).deps))
      ok(`rechaza una URL ${nombre}`, e?.codigo === 'respuesta', String(e?.codigo))
    }
    ok('una respuesta sin URL', (await falla(() => pedirUrlDeGrabacion(CLAVE, '6a00000000000000000000a1', falso([{ cuerpo: { data: {} } }]).deps)))?.codigo === 'respuesta')
    ok('una grabación que ya no existe', (await falla(() => pedirUrlDeGrabacion(CLAVE, '6a00000000000000000000a1', falso([{ estado: 404 }]).deps)))?.codigo === 'no_encontrada')
    for (const malo of ['../users', '6ad8/../x', 'a b', 'x'.repeat(80), '', '1234567']) {
      const e = await falla(() => pedirUrlDeGrabacion(CLAVE, malo, falso([{ cuerpo: { data: { url: buena } } }]).deps))
      ok(`un id raro («${malo.slice(0, 12)}») no llega ni a pedirse`, e?.codigo === 'no_encontrada', String(e?.codigo))
    }
  }

  console.log('\n=== la clave que escribe una persona ===')
  {
    const buena = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'
    ok('una clave de 64 cifras se acepta tal cual', limpiarClave(buena) === buena)
    ok('con espacios o saltos de línea al copiar', limpiarClave(`  ${buena}\n`) === buena)
    ok('con «Bearer » delante', limpiarClave(`Bearer ${buena}`) === buena && limpiarClave(`bearer   ${buena}`) === buena)
    ok('lo que no parece una clave no se acepta', limpiarClave('') === null && limpiarClave('corta') === null && limpiarClave('con espacios en medio de la clave') === null && limpiarClave(`${buena}\n${buena}`) === null && limpiarClave(null) === null && limpiarClave(12345) === null)
    ok('ni con caracteres que no caben en una cabecera', limpiarClave('abc<script>alert(1)</script>abcdef') === null)
    ok('el final para reconocerla en pantalla', finalDeClave(buena) === '8f90')
  }
}

main()
  .then(() => {
    console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
    if (fallos > 0) process.exit(1)
  })
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
