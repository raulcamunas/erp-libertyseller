import { RUTA_DE_WHATSAPP_IA, SUGERENCIAS_DE_CAMBIO_DE_WHATSAPP, pedirMensajeConIa } from '@/lib/whatsapp/ia-cliente'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const PETICION = { leadId: '11111111-1111-4111-8111-111111111111', situacion: 'no_contesta' as const }

/** Un fetch falso que contesta lo que se le diga y apunta qué se le ha pedido */
function falso(respuesta: { status?: number; json?: unknown; sinJson?: boolean } | Error | 'cuelga') {
  const peticiones: Array<{ url: string; init?: RequestInit }> = []
  const fetcher = (async (url: string, init?: RequestInit) => {
    peticiones.push({ url, init })
    if (respuesta === 'cuelga') {
      return new Promise((_r, rechazar) => init?.signal?.addEventListener('abort', () => rechazar(Object.assign(new Error('abortado'), { name: 'AbortError' }))))
    }
    if (respuesta instanceof Error) throw respuesta
    const status = respuesta.status ?? 200
    return { ok: status >= 200 && status < 300, status, json: async () => (respuesta.sinJson ? Promise.reject(new Error('no es json')) : respuesta.json) }
  }) as unknown as typeof fetch
  return { fetcher, peticiones }
}

async function main() {
  console.log('\n=== lo que se pide ===')
  {
    const f = falso({ json: { ok: true, mensaje: 'Hola, soy Raúl.', base: 'x', aviso: null } })
    await pedirMensajeConIa({ ...PETICION, indicaciones: 'Más corto', anterior: 'Hola' }, { fetcher: f.fetcher })
    ok('va por POST a la ruta con JSON', f.peticiones[0].url === RUTA_DE_WHATSAPP_IA && f.peticiones[0].init?.method === 'POST' && (f.peticiones[0].init?.headers as Record<string, string>)['Content-Type'] === 'application/json')
    const cuerpo = JSON.parse(String(f.peticiones[0].init?.body))
    ok('manda el lead, el momento, lo que se quiere cambiar y el mensaje anterior', cuerpo.leadId === PETICION.leadId && cuerpo.situacion === 'no_contesta' && cuerpo.indicaciones === 'Más corto' && cuerpo.anterior === 'Hola')
    ok('la ruta es la de Cold Calling', RUTA_DE_WHATSAPP_IA === '/api/cold-calling/whatsapp-ia')
  }

  console.log('\n=== lo que vuelve ===')
  {
    const bien = await pedirMensajeConIa(PETICION, { fetcher: falso({ json: { ok: true, mensaje: 'Hola, soy Raúl.', base: 'Que vende cerámica', aviso: 'Es largo' } }).fetcher })
    ok('el mensaje, en qué se apoya y el aviso', bien.ok && bien.mensaje === 'Hola, soy Raúl.' && bien.base === 'Que vende cerámica' && bien.aviso === 'Es largo', JSON.stringify(bien))
    const sinAviso = await pedirMensajeConIa(PETICION, { fetcher: falso({ json: { ok: true, mensaje: 'Hola', base: 'x', aviso: null } }).fetcher })
    ok('sin aviso, null', sinAviso.ok && sinAviso.aviso === null)
    const frase = await pedirMensajeConIa(PETICION, { fetcher: falso({ status: 429, json: { error: 'Has pedido 60 mensajes en la última hora: espera un rato para pedir más.' } }).fetcher })
    ok('el error que dice el servidor se enseña tal cual', !frase.ok && /última hora/.test(frase.ok ? '' : frase.error))
    const sesion = await pedirMensajeConIa(PETICION, { fetcher: falso({ status: 401, json: {} }).fetcher })
    ok('sin sesión, lo dice', !sesion.ok && /sesión/.test(sesion.ok ? '' : sesion.error))
    const caido = await pedirMensajeConIa(PETICION, { fetcher: falso({ status: 502, sinJson: true }).fetcher })
    ok('una respuesta sin JSON (el servidor de delante caído) es un fallo corriente', !caido.ok && /No se ha podido escribir/.test(caido.ok ? '' : caido.error))
    const vacio = await pedirMensajeConIa(PETICION, { fetcher: falso({ json: { ok: true, mensaje: '   ' } }).fetcher })
    ok('un mensaje vacío no es un mensaje', !vacio.ok)
    const raro = await pedirMensajeConIa(PETICION, { fetcher: falso({ json: { ok: false } }).fetcher })
    ok('un «ok» que no lo es', !raro.ok)
    const sinRed = await pedirMensajeConIa(PETICION, { fetcher: falso(new TypeError('Failed to fetch')).fetcher })
    ok('sin conexión', !sinRed.ok && /conexión/.test(sinRed.ok ? '' : sinRed.error))
    const t0 = Date.now()
    const lento = await pedirMensajeConIa(PETICION, { fetcher: falso('cuelga').fetcher, esperaMaximaMs: 60 })
    ok('si tarda demasiado, se corta y se dice', !lento.ok && /tardado demasiado/.test(lento.ok ? '' : lento.error) && Date.now() - t0 < 2000)
  }

  console.log('\n=== los atajos para cambiar el mensaje ===')
  {
    ok('hay cuatro, con etiqueta corta e indicación para la IA', SUGERENCIAS_DE_CAMBIO_DE_WHATSAPP.length === 4 && SUGERENCIAS_DE_CAMBIO_DE_WHATSAPP.every((s) => s.etiqueta.length <= 14 && s.indicacion.length > 15 && s.indicacion.length <= 300))
    ok('incluyen «Otra versión»', SUGERENCIAS_DE_CAMBIO_DE_WHATSAPP.some((s) => s.etiqueta === 'Otra versión'))
  }

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
