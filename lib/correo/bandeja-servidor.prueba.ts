import { crearBaseFalsa } from '@/lib/mcp/comercial/base-falsa'
import { leerQueryDeBandeja, type ConsultaDeBandeja } from '@/lib/correo/bandeja'
import { ACCESOS_RECIENTES } from '@/lib/correo/quien-servidor'
import { listarBandeja } from '@/lib/correo/servidor'

/**
 * LA BANDEJA UNIFICADA TAL Y COMO SE EJECUTA EN PRODUCCIÓN: listarBandeja (servidor.ts) contra la base falsa.
 *   (a) un buzón que se sigue en «Mis correos» pero ya no se puede leer no sale;
 *   (b) si el rastro de un buzón ajeno no se puede dejar, no se devuelve ningún hilo;
 *   (c) el cursor es la última fila de la página, no la que sobra;
 *   (d) sin la función de la 318 (PGRST202), falta_318;
 *   y el tope de 30 buzones.
 */

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const JHANNA = id(1), ANA = id(2), RAUL = id(3)
const B_JHANNA = id(101), B_ANA = id(102), B_RAUL = id(103)
const hiloId = (n: number) => id(1000 + n)

const buzon = (bid: string, userId: string, direccion: string) => ({
  id: bid, user_id: userId, direccion, nombre: null, usuario: direccion, proveedor: 'hostinger', imap_host: 'imap', imap_puerto: 993, imap_seguro: true,
  smtp_host: 'smtp', smtp_puerto: 465, smtp_seguro: true, desde_fecha: '2026-08-01T00:00:00.000Z', firma: null, vinculado_at: '2026-10-01T00:00:00.000Z',
  ultimo_sync_at: null, ultimo_intento_at: null, ultimo_error: null, fallos_seguidos: 0, credenciales_invalidas: false, historico_completo: true, lectura_hasta: null,
})
const hilo = (n: number, buzonId: string, cuando: string) => ({
  id: hiloId(n), buzon_id: buzonId, asunto: `Asunto ${n}`, contraparte: 'Cliente', contraparte_direccion: `cliente${n}@fuera.es`, vista_previa: '…',
  ultimo_mensaje_at: cuando, mensajes: 1, no_leidos: 1, entrantes: 1, salientes: 0, tiene_adjuntos: false, destacado: false, ultimo_es_entrante: true, automatico: false,
})

const datos = () => ({
  profiles: [
    // Jhanna supervisa el correo: lee el buzón de Ana (employee), pero no el de Raúl (admin)
    { id: JHANNA, full_name: 'Jhanna', email: 'jhanna@l.es', role: 'employee', is_comercial: false },
    { id: ANA, full_name: 'Ana', email: 'ana@l.es', role: 'employee', is_comercial: true },
    { id: RAUL, full_name: 'Raúl', email: 'raul@l.es', role: 'admin', is_comercial: false },
  ],
  user_app_permissions: [{ user_id: JHANNA, app_id: 'correo-supervision', can_access: true }],
  correo_buzones: [buzon(B_JHANNA, JHANNA, 'jhanna@l.es'), buzon(B_ANA, ANA, 'ana@l.es'), buzon(B_RAUL, RAUL, 'raul@l.es')],
  correo_buzon_lectores: [] as Array<Record<string, unknown>>,
  correo_buzon_bloqueos: [] as Array<Record<string, unknown>>,
  correo_buzon_asignaciones: [] as Array<Record<string, unknown>>,
  // Jhanna sigue el de Ana y TAMBIÉN el de Raúl (lo siguió cuando podía leerlo)
  correo_buzon_preferencias: [
    { user_id: JHANNA, buzon_id: B_ANA, en_mis_correos: true, orden: 1, silenciado: false, silenciado_hasta: null },
    { user_id: JHANNA, buzon_id: B_RAUL, en_mis_correos: true, orden: 2, silenciado: false, silenciado_hasta: null },
  ],
  correo_hilos: [
    hilo(1, B_JHANNA, '2026-11-16T10:00:00.000Z'),
    hilo(2, B_ANA, '2026-11-16T09:00:00.000Z'),
    hilo(3, B_RAUL, '2026-11-16T09:30:00.000Z'),
    hilo(4, B_ANA, '2026-11-16T08:00:00.000Z'),
    hilo(5, B_JHANNA, '2026-11-16T07:00:00.000Z'),
  ],
  correo_hilo_silencios: [] as Array<Record<string, unknown>>,
  correo_remitente_silencios: [] as Array<Record<string, unknown>>,
  correo_hilo_asignaciones: [] as Array<Record<string, unknown>>,
  correo_accesos: [] as Array<Record<string, unknown>>,
})

type Datos = ReturnType<typeof datos>

/**
 * La RPC correo_bandeja de la 318, en memoria: los hilos de p_buzones, del más nuevo al más viejo, hasta p_limite + 1. Cada fila dice si
 * p_user la tiene silenciada (el hilo o su remitente) y, con p_ocultar_silenciados, esas se quitan ANTES de cortar, como en SQL.
 */
function rpcBandeja(d: Datos, llamadas: Array<Record<string, unknown>>) {
  return (args: Record<string, unknown>) => {
    llamadas.push(args)
    const buzones = new Set(args.p_buzones as string[])
    const antes = args.p_antes as string | null
    const antesId = args.p_antes_id as string | null
    const vigente = (hasta: unknown) => hasta == null || Date.parse(String(hasta)) > Date.now()
    const silenciado = (h: { id: string; contraparte_direccion: string }) =>
      d.correo_hilo_silencios.some((x) => x.user_id === args.p_user && x.hilo_id === h.id && vigente(x.hasta)) ||
      d.correo_remitente_silencios.some((x) => x.user_id === args.p_user && x.direccion === h.contraparte_direccion.toLowerCase() && vigente(x.hasta))
    return d.correo_hilos
      .filter((h) => buzones.has(h.buzon_id) && h.mensajes > 0)
      // Como en la SQL: un rebote nunca se oculta; el resto, si no es de un buzón silenciado ni está silenciado el hilo o su remitente
      .filter((h) => !args.p_ocultar_silenciados || /^(mailer-daemon|postmaster)/i.test(h.contraparte_direccion) || (!((args.p_buzones_silenciados as string[] | undefined) ?? []).includes(h.buzon_id) && !silenciado(h)))
      .filter((h) => !antes || h.ultimo_mensaje_at < antes || (h.ultimo_mensaje_at === antes && antesId !== null && h.id < antesId))
      .sort((a, b) => (a.ultimo_mensaje_at < b.ultimo_mensaje_at ? 1 : a.ultimo_mensaje_at > b.ultimo_mensaje_at ? -1 : a.id < b.id ? 1 : -1))
      .slice(0, (args.p_limite as number) + 1)
      .map((h) => ({ ...h, silenciado: silenciado(h), asignado_a: null }))
  }
}

function montar(cambiar: (d: Datos) => void = () => undefined, conRpc = true) {
  const d = datos()
  cambiar(d)
  const llamadas: Array<Record<string, unknown>> = []
  // correo_buscar: todo casa; devuelve los hilos de ese buzón y, a propósito, repite uno de otro buzón (no debe salir dos veces)
  const correo_buscar = (args: Record<string, unknown>) => [...d.correo_hilos.filter((h) => h.buzon_id === args.p_buzon), d.correo_hilos[0]].map((h) => ({ hilo_id: h.id }))
  const base = crearBaseFalsa(d as never, conRpc ? { rpc: { correo_bandeja: rpcBandeja(d, llamadas), correo_buscar } } : {})
  return { base, llamadas }
}

const consulta = (q: Record<string, string> = {}): ConsultaDeBandeja => {
  const r = leerQueryDeBandeja(new URLSearchParams(q))
  if (!r.ok) throw new Error(r.error)
  return r.consulta
}
const jhanna = { userId: JHANNA, role: 'employee' }

async function main() {
  console.log('\n=== (a) lo que se sigue pero ya no se puede leer ===')
  {
    ACCESOS_RECIENTES.clear()
    const { base, llamadas } = montar()
    const r = await listarBandeja(base.servicio, jhanna, consulta())
    ok('contesta', r.tipo === 'ok')
    const ids = r.tipo === 'ok' ? r.hilos.map((h) => h.id) : []
    ok('el hilo del buzón de Raúl (seguido, pero ya no legible) NO sale', !ids.includes(hiloId(3)), ids.join())
    ok('ni se le pide a la RPC', llamadas.length === 1 && !(llamadas[0].p_buzones as string[]).includes(B_RAUL))
    ok('salen los de Jhanna y los de Ana, del más nuevo al más viejo', ids.join() === [hiloId(1), hiloId(2), hiloId(4), hiloId(5)].join(), ids.join())
    const rastro = base.tablas.get('correo_accesos')!
    ok('una fila de rastro «lista» por el buzón ajeno que sale (el de Ana), ninguna por el propio', rastro.length === 1 && rastro[0].buzon_id === B_ANA && rastro[0].accion === 'lista', JSON.stringify(rastro))
  }

  console.log('\n=== (b) sin rastro, nada ===')
  {
    ACCESOS_RECIENTES.clear()
    const { base } = montar()
    base.errores.set('correo_accesos', { code: '42501', message: 'permission denied' })
    let devuelto: unknown = 'nada'
    let lanzado: unknown = null
    try {
      devuelto = await listarBandeja(base.servicio, jhanna, consulta())
    } catch (e) {
      lanzado = e
    }
    ok('si el rastro del buzón de Ana falla, lanza', lanzado instanceof Error && /constancia del acceso/.test((lanzado as Error).message), String(lanzado))
    ok('y no devuelve ningún hilo (ni los propios)', devuelto === 'nada')
  }

  console.log('\n=== (c) el cursor ===')
  {
    ACCESOS_RECIENTES.clear()
    const { base } = montar()
    const r = await listarBandeja(base.servicio, jhanna, consulta({ limite: '2' }))
    ok('una página de 2', r.tipo === 'ok' && r.hilos.length === 2)
    ok('el cursor es la ÚLTIMA DE LA PÁGINA (hilo 2), no la que sobra (hilo 4)', r.tipo === 'ok' && r.siguiente?.antesId === hiloId(2) && r.siguiente?.antes === '2026-11-16T09:00:00.000Z', JSON.stringify(r.tipo === 'ok' ? r.siguiente : null))
    const s = r.tipo === 'ok' && r.siguiente ? r.siguiente : null
    const r2 = await listarBandeja(base.servicio, jhanna, consulta({ limite: '2', antes: s?.antes ?? '', antesId: s?.antesId ?? '' }))
    ok('la siguiente página sigue sin saltarse ni repetir nada, y es la última', r2.tipo === 'ok' && r2.hilos.map((h) => h.id).join() === [hiloId(4), hiloId(5)].join() && r2.siguiente === null, JSON.stringify(r2))
  }

  console.log('\n=== buscar ===')
  {
    ACCESOS_RECIENTES.clear()
    const { base } = montar()
    const r = await listarBandeja(base.servicio, jhanna, consulta({ q: 'asunto', limite: '3' }))
    const ids = r.tipo === 'ok' ? r.hilos.map((h) => h.id) : []
    ok('mezclado por fecha, sin repetir, sin el buzón ilegible y cortado al límite', ids.join() === [hiloId(1), hiloId(2), hiloId(4)].join(), ids.join())
    ok('sin cursor', r.tipo === 'ok' && r.siguiente === null)
    const rastro = base.tablas.get('correo_accesos')!
    ok('rastro «busqueda» del buzón de Ana', rastro.length === 1 && rastro[0].accion === 'busqueda')
  }

  console.log('\n=== (d) sin la 318 ===')
  {
    ACCESOS_RECIENTES.clear()
    const { base } = montar(undefined, false)
    const r = await listarBandeja(base.servicio, jhanna, consulta())
    ok('la RPC no existe (PGRST202): falta_318', r.tipo === 'falta_318')
    const sinTabla = montar((d) => ((d as unknown as Record<string, unknown>).correo_buzon_preferencias = null)).base
    ok('sin la tabla de preferencias: falta_318', (await listarBandeja(sinTabla.servicio, jhanna, consulta())).tipo === 'falta_318')
  }

  console.log('\n=== el tope de 30 buzones ===')
  {
    ACCESOS_RECIENTES.clear()
    const { base, llamadas } = montar((d) => {
      for (let i = 0; i < 35; i++) {
        const b = id(500 + i)
        d.correo_buzones.push(buzon(b, ANA, `ana${i}@l.es`))
        d.correo_buzon_preferencias.push({ user_id: JHANNA, buzon_id: b, en_mis_correos: true, orden: 10 + i, silenciado: false, silenciado_hasta: null })
      }
    })
    const r = await listarBandeja(base.servicio, jhanna, consulta())
    ok('contesta', r.tipo === 'ok')
    ok('a la RPC le llegan 30 buzones, los primeros por orden', llamadas.length === 1 && (llamadas[0].p_buzones as string[]).length === 30 && (llamadas[0].p_buzones as string[])[0] === B_ANA, String((llamadas[0]?.p_buzones as string[] | undefined)?.length))
  }

  console.log('\n=== ocultar silenciados: una primera página entera de un remitente silenciado no deja la lista vacía ===')
  {
    ACCESOS_RECIENTES.clear()
    const { base, llamadas } = montar((d) => {
      // 5 correos nuevos del mismo remitente ruidoso en el buzón de Jhanna (más nuevos que todo lo demás), silenciado «siempre»
      for (let i = 0; i < 5; i++) d.correo_hilos.push({ ...hilo(50 + i, B_JHANNA, `2026-11-16T1${i + 1}:00:00.000Z`), contraparte_direccion: 'ruido@fuera.es' })
      d.correo_remitente_silencios.push({ user_id: JHANNA, direccion: 'ruido@fuera.es', hasta: null })
    })
    const oculto = await listarBandeja(base.servicio, jhanna, consulta({ silenciados: '0', limite: '3' }))
    const ids = oculto.tipo === 'ok' ? oculto.hilos.map((h) => h.id) : []
    ok('a la RPC le llega p_ocultar_silenciados = true', llamadas[0]?.p_ocultar_silenciados === true, String(llamadas[0]?.p_ocultar_silenciados))
    ok('la página trae 3 correos de verdad (ninguno del silenciado)', ids.length === 3 && ids.every((x) => x !== hiloId(50) && x !== hiloId(54)), ids.join(','))
    ok('y sigue habiendo más', oculto.tipo === 'ok' && oculto.siguiente !== null)
    const visto = await listarBandeja(base.servicio, jhanna, consulta({ limite: '3' }))
    ok('sin ocultar: salen, atenuados (silenciado = true)', visto.tipo === 'ok' && visto.hilos.length === 3 && visto.hilos.every((h) => h.silenciado), visto.tipo === 'ok' ? visto.hilos.map((h) => `${h.id.slice(-2)}:${h.silenciado}`).join(',') : '')
    ok('y a la RPC le llega p_ocultar_silenciados = false', llamadas[1]?.p_ocultar_silenciados === false)
  }

  console.log('\n=== un BUZÓN silenciado: sus filas atenuadas con silenciados=1, fuera con silenciados=0 ===')
  {
    ACCESOS_RECIENTES.clear()
    const { base } = montar((d) => {
      d.correo_buzon_preferencias[0] = { ...d.correo_buzon_preferencias[0], silenciado: true, silenciado_hasta: null }
      // Una conversación del buzón de Ana encargada a Jhanna, para «Asignados a mí»
      d.correo_hilo_asignaciones.push({ hilo_id: hiloId(2), persona_id: JHANNA, asignado_por: ANA, asignado_at: '2026-11-16T09:05:00.000Z', hecho_at: null, nota: null })
    })
    const visto = await listarBandeja(base.servicio, jhanna, consulta())
    const filas = visto.tipo === 'ok' ? visto.hilos : []
    const deAna = filas.filter((h) => h.buzonId === B_ANA)
    ok('silenciados=1: las del buzón de Ana salen y con silenciado = true', deAna.length === 2 && deAna.every((h) => h.silenciado), filas.map((h) => `${h.id.slice(-2)}:${h.silenciado}`).join(','))
    ok('las del propio buzón, sin atenuar', filas.some((h) => h.buzonId === B_JHANNA) && filas.filter((h) => h.buzonId === B_JHANNA).every((h) => !h.silenciado))
    const oculto = await listarBandeja(base.servicio, jhanna, consulta({ silenciados: '0' }))
    ok('silenciados=0: las del buzón de Ana no salen', oculto.tipo === 'ok' && oculto.hilos.length > 0 && oculto.hilos.every((h) => h.buzonId !== B_ANA))
    const buscado = await listarBandeja(base.servicio, jhanna, consulta({ q: 'asunto' }))
    const buscadasDeAna = buscado.tipo === 'ok' ? buscado.hilos.filter((h) => h.buzonId === B_ANA) : []
    ok('al buscar, también atenuadas', buscadasDeAna.length === 2 && buscadasDeAna.every((h) => h.silenciado))
    const asignados = await listarBandeja(base.servicio, jhanna, consulta({ carpeta: 'asignados' }))
    ok('en «Asignados a mí», también atenuada', asignados.tipo === 'ok' && asignados.hilos.length === 1 && asignados.hilos[0].silenciado === true, JSON.stringify(asignados))
    const asignadosOcultos = await listarBandeja(base.servicio, jhanna, consulta({ carpeta: 'asignados', silenciados: '0' }))
    ok('y con silenciados=0 no sale', asignadosOcultos.tipo === 'ok' && asignadosOcultos.hilos.length === 0)
  }

  console.log('\n=== un REBOTE de un buzón silenciado no se oculta nunca, ni con silenciados=0 ===')
  {
    ACCESOS_RECIENTES.clear()
    const { base, llamadas } = montar((d) => {
      d.correo_buzon_preferencias[0] = { ...d.correo_buzon_preferencias[0], silenciado: true, silenciado_hasta: null }
      d.correo_hilos.push({ ...hilo(9, B_ANA, '2026-11-16T09:10:00.000Z'), contraparte_direccion: 'mailer-daemon@googlemail.com', asunto: 'Delivery Status Notification (Failure)' })
    })
    const oculto = await listarBandeja(base.servicio, jhanna, consulta({ silenciados: '0' }))
    const deAna = oculto.tipo === 'ok' ? oculto.hilos.filter((h) => h.buzonId === B_ANA) : []
    ok('el buzón de Ana silenciado: solo sale su rebote', deAna.length === 1 && deAna[0].id === hiloId(9), deAna.map((h) => h.id.slice(-2)).join(','))
    ok('a la RPC le llega el buzón silenciado en p_buzones_silenciados', JSON.stringify(llamadas[0]?.p_buzones_silenciados) === JSON.stringify([B_ANA]), JSON.stringify(llamadas[0]?.p_buzones_silenciados))
    const buscado = await listarBandeja(base.servicio, jhanna, consulta({ q: 'asunto', silenciados: '0' }))
    const deAnaBuscado = buscado.tipo === 'ok' ? buscado.hilos.filter((h) => h.buzonId === B_ANA) : []
    ok('al buscar con silenciados=0 pasa lo mismo: solo el rebote', deAnaBuscado.length === 1 && deAnaBuscado[0].id === hiloId(9), deAnaBuscado.map((h) => h.id.slice(-2)).join(','))
  }

  console.log(`\n${comprobaciones - fallos}/${comprobaciones} comprobaciones bien${fallos ? ` — ${fallos} FALLAN` : ''}`)
  if (fallos) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
