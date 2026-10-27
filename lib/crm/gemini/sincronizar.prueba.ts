import type { ResultadoDelAnalisis } from './analisis'
import type { CandidatoDeCita } from './casar'
import type { CorreoDeGemini } from './correo'
import type { ContenidoDeDocs, DocumentoDeDocs, ElementoDeDocs } from './documento'
import { clasificarRespuestaDeGoogle, ErrorDeGoogle, FRASE_DE_PERMISOS } from './errores-google'
import type { FuenteDeGoogle } from './google'
import { analizarNotaGuardada, sincronizarNotasDeGemini, type AlmacenDeNotas, type CambiosDeNota, type NotaGuardada, type NotaNueva } from './sincronizar'
import type { AnalisisDeReunion } from './tipos'
import { leerAnalisis } from './analisis'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/* ---------- un Gmail y un Docs de mentira (todo inventado) ---------- */

const b = (s: string) => Buffer.from(s).toString('base64').replace(/=+$/, '')
const t = (content: string, negrita = false, url?: string): ElementoDeDocs => ({ textRun: { content, textStyle: { ...(negrita ? { bold: true } : {}), ...(url ? { link: { url } } : {}) } } })
const p = (estilo: string, ...elements: ElementoDeDocs[]): ContenidoDeDocs => ({ paragraph: { paragraphStyle: { namedStyleType: estilo }, elements } })

/** Un documento «Notas de Gemini» inventado: con invitado y evento si se piden */
function docDe(o: { titulo: string; cuando?: string; invitado?: string; eventId?: string }): DocumentoDeDocs {
  const cabecera: ContenidoDeDocs[] = [p('HEADING_1', t(`${o.titulo}\n`))]
  if (o.invitado) cabecera.push(p('NORMAL_TEXT', t('Invitado ', true), { person: { personProperties: { email: o.invitado, name: 'Invitado' } } }, t('\n')))
  if (o.eventId) cabecera.push(p('NORMAL_TEXT', t('Archivos adjuntos ', true), { richLink: { richLinkProperties: { uri: `https://calendar.google.com/calendar/event?eid=${b(`${o.eventId} business@libertyseller.com`)}`, title: 'evento' } } }, t('\n')))
  const notas: ContenidoDeDocs[] = [
    ...cabecera,
    p('HEADING_2', t('Resumen\n')),
    p('NORMAL_TEXT', t('Una reunión de prueba.\n')),
    p('HEADING_2', t('Próximos pasos\n')),
    { paragraph: { bullet: { nestingLevel: 0 }, elements: [t('[Liberty Seller] Enviar propuesta: El viernes.\n')] } },
    p('HEADING_2', t('Detalles\n')),
    p('NORMAL_TEXT', t('Tema', true), t(' Se habló de cosas.\n')),
  ]
  return {
    title: `${o.titulo} - ${o.cuando ?? '2026/10/20 10:02 CEST'} - Notas de Gemini`,
    tabs: [
      { tabProperties: { title: 'Notas' }, documentTab: { body: { content: notas } } },
      { tabProperties: { title: 'Transcripción' }, documentTab: { body: { content: [p('HEADING_3', t('00:00:00\n')), p('NORMAL_TEXT', t('Liberty Seller:', true), t(' Hola.\n'))] } } },
    ],
  }
}

const TITULO_ANA = 'Consultoría Estratégica Amazon · Liberty Seller · ANA PÉREZ'
const TITULO_LUIS = 'Consultoría Estratégica Amazon · Liberty Seller · LUIS MARTÍN'

function correoDe(id: string, titulo: string, o: { doc?: string; recibido?: string } = {}): CorreoDeGemini {
  return {
    id,
    asunto: `Notas: ${titulo} 20 oct 2026`,
    remitente: 'gemini-notes@google.com',
    recibidoMs: Date.parse(o.recibido ?? '2026-10-20T09:00:00Z'),
    texto: `Notas de ${titulo}\n\nResumen\n\nUna frase del correo.\n\nPasos siguientes recomendados\n\n[Liberty Seller] Hacer algo: Con detalle`,
    html: o.doc ? `<a href="https://docs.google.com/document/d/${o.doc}/edit">Abrir</a>` : '',
  }
}

interface GoogleDeMentira extends FuenteDeGoogle {
  /** Los correos que se han abierto ENTEROS (con su cuerpo) */
  leidos: string[]
  /** Los correos de los que solo se ha mirado el asunto y el remitente */
  encabezados: string[]
  documentosAbiertos: string[]
  listados: number
}

function googleDeMentira(opciones: {
  correos: CorreoDeGemini[]
  documentos?: Record<string, DocumentoDeDocs | ErrorDeGoogle>
  falloAlListar?: ErrorDeGoogle
  falloAlLeer?: Record<string, ErrorDeGoogle>
}): GoogleDeMentira {
  const g: GoogleDeMentira = {
    leidos: [],
    encabezados: [],
    documentosAbiertos: [],
    listados: 0,
    async listarCorreos(_desde, maximo) {
      g.listados++
      if (opciones.falloAlListar) throw opciones.falloAlListar
      return opciones.correos.slice(0, maximo).map((c) => c.id)
    },
    async leerEncabezado(id) {
      g.encabezados.push(id)
      const fallo = opciones.falloAlLeer?.[id]
      if (fallo) throw fallo
      const c = opciones.correos.find((x) => x.id === id)
      return c ? { id: c.id, asunto: c.asunto, remitente: c.remitente, recibidoMs: c.recibidoMs } : null
    },
    async leerCorreo(id) {
      g.leidos.push(id)
      const fallo = opciones.falloAlLeer?.[id]
      if (fallo) throw fallo
      return opciones.correos.find((c) => c.id === id) ?? null
    },
    async leerDocumento(id) {
      g.documentosAbiertos.push(id)
      const d = opciones.documentos?.[id]
      if (!d) throw clasificarRespuestaDeGoogle('docs', 404, null)
      if (d instanceof ErrorDeGoogle) throw d
      return d
    },
  }
  return g
}

/* ---------- una base de mentira ---------- */

type Fila = NotaGuardada & NotaNueva & { analisis: AnalisisDeReunion | null; analisis_modelo: string | null; analisis_en: string | null; creada_en: string; actualizada_en: string }

class AlmacenEnMemoria implements AlmacenDeNotas {
  filas: Fila[] = []
  contador = 0
  constructor(public candidatosFijos: CandidatoDeCita[], private reloj: () => Date, public respuestasDelGuion: Record<string, string> = {}) {}

  async conocidos(ids: string[]) {
    return new Set(this.filas.filter((f) => f.gmail_message_id && ids.includes(f.gmail_message_id)).map((f) => f.gmail_message_id as string))
  }
  async candidatos() {
    return this.candidatosFijos
  }
  async insertar(n: NotaNueva) {
    if (this.filas.some((f) => (n.gmail_message_id && f.gmail_message_id === n.gmail_message_id) || (n.drive_file_id && f.drive_file_id === n.drive_file_id))) return 'repetida' as const
    this.filas.push({ ...n, id: `nota-${++this.contador}`, analisis_intentos: 0, error: null, analisis: null, analisis_modelo: null, analisis_en: null, creada_en: this.reloj().toISOString(), actualizada_en: this.reloj().toISOString() })
    return 'creada' as const
  }
  async incompletas(desde: string, max: number) {
    return this.filas.filter((f) => !f.completa && f.drive_file_id && f.estado !== 'ignorada' && f.creada_en >= desde).slice(0, max)
  }
  async sinCita(desde: string, max: number) {
    return this.filas.filter((f) => f.estado === 'sin_cita' && f.creada_en >= desde).slice(0, max)
  }
  async pendientesDeAnalisis(max: number, antesDe: string) {
    return this.filas
      .filter((f) => f.estado === 'pendiente' && f.client_id && (f.error === null || f.actualizada_en < antesDe))
      .sort((a, c) => (c.fecha_reunion ?? '').localeCompare(a.fecha_reunion ?? ''))
      .slice(0, max)
  }
  async actualizar(id: string, cambios: CambiosDeNota) {
    const f = this.filas.find((x) => x.id === id)
    if (!f) return
    Object.assign(f, cambios, { actualizada_en: this.reloj().toISOString() })
  }
  async datosParaAnalizar(id: string) {
    const f = this.filas.find((x) => x.id === id)
    if (!f) return null
    return { titulo: f.titulo, fechaReunion: f.fecha_reunion, resumen: f.resumen, temas: f.temas, proximosPasos: f.proximos_pasos, detalle: f.detalle, transcripcion: f.transcripcion, respuestasDelGuion: this.respuestasDelGuion }
  }
  por(gmail: string) {
    return this.filas.find((f) => f.gmail_message_id === gmail)
  }
}

const ANALISIS = leerAnalisis(JSON.stringify({ resumen: 'Resumen del análisis.' }))!
const iaBuena = async (): Promise<ResultadoDelAnalisis> => ({ analisis: ANALISIS, modelo: 'gpt-5.6-terra', aviso: null, reintentable: false, general: false, tokens: { entrada: 1000, salida: 500 }, costeUsd: 0.01 })
const iaQueFalla = (o: { reintentable?: boolean; general?: boolean } = {}) => async (): Promise<ResultadoDelAnalisis> => ({ analisis: null, modelo: 'gpt-5.6-terra', aviso: 'La IA tiene un problema ahora mismo.', reintentable: o.reintentable ?? true, general: o.general ?? false, tokens: null, costeUsd: 0 })

const CANDIDATOS: CandidatoDeCita[] = [
  { clientId: 'cli-ana', appointmentId: 'cita-ana', googleEventId: 'evt-ana', email: 'ana@tienda.com', nombre: 'Ana Pérez', inicio: '2026-10-20T08:00:00Z' },
  { clientId: 'cli-luis', appointmentId: 'cita-luis', googleEventId: 'evt-luis', email: 'luis@otra.com', nombre: 'Luis Martín', inicio: '2026-10-21T08:00:00Z' },
]

async function main() {
  console.log('\n=== una pasada normal: cliente con cita, reunión interna y cliente sin cita ===')
  {
    const ahora = () => new Date('2026-10-27T10:00:00Z')
    const google = googleDeMentira({
      correos: [
        correoDe('m1', TITULO_ANA, { doc: 'doc-ana-0123456789' }),
        correoDe('m2', 'Reunión Semanal | Comerciales Liberty Seller', { doc: 'doc-interna-0123456789' }),
        correoDe('m3', 'Consultoría Estratégica Amazon · Liberty Seller · PEDRO NADIE', { doc: 'doc-pedro-0123456789' }),
      ],
      documentos: {
        'doc-ana-0123456789': docDe({ titulo: TITULO_ANA, invitado: 'ana@tienda.com', eventId: 'evt-ana' }),
        'doc-interna-0123456789': docDe({ titulo: 'Reunión Semanal | Comerciales Liberty Seller' }),
        'doc-pedro-0123456789': docDe({ titulo: 'Consultoría Estratégica Amazon · Liberty Seller · PEDRO NADIE', invitado: 'pedro@nadie.com' }),
      },
    })
    const almacen = new AlmacenEnMemoria(CANDIDATOS, ahora)
    const r = await sincronizarNotasDeGemini(google, almacen, { ahora, analizar: iaBuena })

    ok('se miran los tres correos', r.revisados === 3, JSON.stringify(r))
    ok('dos notas de clientes, una reunión interna ignorada', r.nuevas === 2 && r.ignoradas === 1)
    const ana = almacen.por('m1')!
    ok('la de Ana se casa por el evento del calendario', ana.client_id === 'cli-ana' && ana.appointment_id === 'cita-ana' && ana.metodo_cita === 'evento', JSON.stringify([ana.client_id, ana.metodo_cita]))
    ok('con el documento leído: completa, con transcripción y el invitado', ana.completa && !!ana.transcripcion && ana.invitados[0] === 'ana@tienda.com' && ana.drive_file_id === 'doc-ana-0123456789')
    ok('y la hora de inicio de la reunión, la del documento', ana.fecha_reunion === '2026-10-20T08:02:00.000Z', String(ana.fecha_reunion))
    ok('se analiza en la misma pasada', ana.estado === 'procesada' && ana.analisis?.resumen === 'Resumen del análisis.' && ana.analisis_modelo === 'gpt-5.6-terra' && r.analizadas === 1)
    ok('el coste de la pasada se suma', Math.abs(r.costeUsd - 0.01) < 1e-9)

    const interna = almacen.por('m2')!
    ok('la reunión interna queda apuntada SIN contenido', interna.estado === 'ignorada' && interna.resumen === null && interna.detalle === null && interna.transcripcion === null && interna.titulo.startsWith('Reunión Semanal'))
    ok('y su documento NO se abrió (su texto no sale de Gmail)', !google.documentosAbiertos.includes('doc-interna-0123456789'))

    const pedro = almacen.por('m3')!
    ok('el cliente sin cita queda «sin_cita», con su contenido, sin analizar', pedro.estado === 'sin_cita' && pedro.client_id === null && pedro.completa && pedro.invitados[0] === 'pedro@nadie.com' && pedro.analisis === null)

    const segunda = await sincronizarNotasDeGemini(google, almacen, { ahora, analizar: iaBuena })
    ok('repetir la pasada no duplica ni gasta: es idempotente', segunda.revisados === 0 && segunda.nuevas === 0 && segunda.analizadas === 0 && segunda.costeUsd === 0 && almacen.filas.length === 3)
    ok('y no vuelve a leer los correos ya guardados', google.encabezados.length === 3 && google.leidos.length === 2)
    ok('la reunión interna NO se abre entera: de ella solo se miró el asunto (su texto no sale de Gmail)', !google.leidos.includes('m2') && google.encabezados.includes('m2'), google.leidos.join())
  }

  console.log('\n=== el orden y el tope por pasada ===')
  {
    const ahora = () => new Date('2026-10-27T10:00:00Z')
    const correos = ['a', 'b', 'c', 'd', 'e'].map((x) => correoDe(`m-${x}`, `Reunión Semanal ${x}`))
    const google = googleDeMentira({ correos })
    const almacen = new AlmacenEnMemoria(CANDIDATOS, ahora)
    const r = await sincronizarNotasDeGemini(google, almacen, { ahora, analizar: iaBuena, maxNuevos: 2 })
    ok('con maxNuevos 2 solo se tratan dos, en el orden en que llegaron', r.ignoradas === 2 && google.encabezados.join() === 'm-a,m-b', google.encabezados.join())
    const r2 = await sincronizarNotasDeGemini(google, almacen, { ahora, analizar: iaBuena, maxNuevos: 2 })
    ok('y la siguiente pasada sigue donde se quedó', r2.ignoradas === 2 && google.encabezados.join() === 'm-a,m-b,m-c,m-d' && google.leidos.length === 0)
  }

  console.log('\n=== Google sin permisos ===')
  {
    const ahora = () => new Date('2026-10-27T10:00:00Z')
    const permisos = new ErrorDeGoogle(FRASE_DE_PERMISOS, 'permisos', 'token', 401)
    const almacen = new AlmacenEnMemoria(CANDIDATOS, ahora)
    // Ya había una nota guardada de antes, pendiente de analizar
    await almacen.insertar({ estado: 'pendiente', client_id: 'cli-ana', appointment_id: 'cita-ana', metodo_cita: 'evento', gmail_message_id: 'vieja', drive_file_id: null, google_event_id: null, titulo: TITULO_ANA, fecha_reunion: '2026-10-19T08:00:00Z', invitados: [], resumen: 'Algo.', temas: [], proximos_pasos: [], detalle: null, transcripcion: null, completa: false })
    const r = await sincronizarNotasDeGemini(googleDeMentira({ correos: [], falloAlListar: permisos }), almacen, { ahora, analizar: iaBuena })
    ok('se para lo de Google y dice qué hay que hacer', r.detenida === FRASE_DE_PERMISOS && r.revisados === 0)
    ok('pero lo ya guardado se sigue analizando: eso no necesita a Google', r.analizadas === 1 && almacen.por('vieja')?.estado === 'procesada')
  }

  console.log('\n=== la API de Docs apagada: el correo sirve, el documento ya vendrá ===')
  {
    let t = Date.parse('2026-10-27T10:00:00Z')
    const ahora = () => new Date(t)
    const apagada = clasificarRespuestaDeGoogle('docs', 403, { error: { message: 'Google Docs API has not been used in project 1 before or it is disabled.', errors: [{ reason: 'accessNotConfigured' }] } })
    const documentos: Record<string, DocumentoDeDocs | ErrorDeGoogle> = { 'doc-ana-0123456789': apagada, 'doc-luis-0123456789': apagada }
    const google = googleDeMentira({ correos: [correoDe('m1', TITULO_ANA, { doc: 'doc-ana-0123456789' }), correoDe('m2', TITULO_LUIS, { doc: 'doc-luis-0123456789' })], documentos })
    const almacen = new AlmacenEnMemoria(CANDIDATOS, ahora)
    const r = await sincronizarNotasDeGemini(google, almacen, { ahora, analizar: iaBuena })
    ok('las dos notas se guardan solo con el correo (incompletas)', r.nuevas === 2 && almacen.filas.every((f) => !f.completa && f.transcripcion === null))
    ok('el documento solo se intenta UNA vez: la API apagada no se pregunta dos', google.documentosAbiertos.length === 1, google.documentosAbiertos.join())
    ok('queda el aviso con la frase de qué activar', r.avisos.some((a) => a.includes('Google Docs') && a.includes('Biblioteca')) && r.detenida === null)
    ok('por el correo solo, a Ana se la casa por el nombre y la fecha', almacen.por('m1')?.metodo_cita === 'nombre' || almacen.por('m1')?.estado === 'sin_cita')

    // Se activa la API: la siguiente pasada las completa
    t += 5 * 60_000
    documentos['doc-ana-0123456789'] = docDe({ titulo: TITULO_ANA, invitado: 'ana@tienda.com', eventId: 'evt-ana' })
    documentos['doc-luis-0123456789'] = docDe({ titulo: TITULO_LUIS, invitado: 'luis@otra.com', eventId: 'evt-luis' })
    const r2 = await sincronizarNotasDeGemini(google, almacen, { ahora, analizar: iaBuena })
    ok('con la API activada se completan solas', r2.completadas === 2 && almacen.filas.every((f) => f.completa && !!f.transcripcion), JSON.stringify(r2))
    ok('y con el invitado y el evento, quedan casadas con su cliente', almacen.por('m1')?.client_id === 'cli-ana' && almacen.por('m2')?.client_id === 'cli-luis')
    ok('y la que se había analizado con solo el correo vuelve a analizarse con la transcripción', almacen.filas.every((f) => f.estado === 'procesada') && r2.analizadas >= 1)
  }

  console.log('\n=== un documento concreto que no se abre ===')
  {
    const ahora = () => new Date('2026-10-27T10:00:00Z')
    const sinAcceso = clasificarRespuestaDeGoogle('docs', 403, { error: { message: 'The caller does not have permission' } })
    const google = googleDeMentira({
      correos: [correoDe('m1', TITULO_ANA, { doc: 'doc-ana-0123456789' }), correoDe('m2', TITULO_LUIS, { doc: 'doc-luis-0123456789' })],
      documentos: { 'doc-ana-0123456789': sinAcceso, 'doc-luis-0123456789': docDe({ titulo: TITULO_LUIS, invitado: 'luis@otra.com', eventId: 'evt-luis' }) },
    })
    const almacen = new AlmacenEnMemoria(CANDIDATOS, ahora)
    const r = await sincronizarNotasDeGemini(google, almacen, { ahora, analizar: iaBuena })
    ok('no para nada: las dos notas se guardan', r.nuevas === 2 && r.detenida === null)
    ok('la que no se pudo abrir queda incompleta y con un aviso; la otra, completa', !almacen.por('m1')!.completa && almacen.por('m2')!.completa && r.avisos.length === 1 && r.avisos[0].includes('ANA'))
    ok('y se sigue intentando abrir el de Ana con el tiempo (hay documento al que ir)', google.documentosAbiertos.filter((d) => d === 'doc-ana-0123456789').length >= 2)
  }

  console.log('\n=== un correo que no se puede leer ===')
  {
    const ahora = () => new Date('2026-10-27T10:00:00Z')
    const google = googleDeMentira({
      correos: [correoDe('m1', TITULO_ANA), correoDe('m2', 'Reunión Semanal')],
      falloAlLeer: { m1: clasificarRespuestaDeGoogle('gmail', 404, null) },
    })
    const almacen = new AlmacenEnMemoria(CANDIDATOS, ahora)
    const r = await sincronizarNotasDeGemini(google, almacen, { ahora, analizar: iaBuena })
    ok('uno que ya no existe no frena al resto', r.ignoradas === 1 && r.detenida === null && r.avisos.length === 1)
  }

  console.log('\n=== reuniones sin título ===')
  {
    const ahora = () => new Date('2026-10-27T10:00:00Z')
    const SIN = 'Reunión del 20 oct 2026 a las 10:02 AM CEST'
    const google = googleDeMentira({
      correos: [correoDe('m1', SIN, { doc: 'doc-1-0123456789' }), correoDe('m2', SIN.replace('20', '21'), { doc: 'doc-2-0123456789' })],
      documentos: {
        'doc-1-0123456789': docDe({ titulo: SIN, invitado: 'luis@otra.com', eventId: 'evt-luis' }),
        'doc-2-0123456789': docDe({ titulo: SIN.replace('20', '21'), invitado: 'desconocido@x.com' }),
      },
    })
    const almacen = new AlmacenEnMemoria(CANDIDATOS, ahora)
    const r = await sincronizarNotasDeGemini(google, almacen, { ahora, analizar: iaBuena })
    ok('una sin título que enlaza una cita del ERP es de un cliente: se guarda y se casa', almacen.por('m1')?.client_id === 'cli-luis' && almacen.por('m1')?.metodo_cita === 'evento')
    ok('una sin título que no es de nadie conocido, se apunta como ignorada', almacen.por('m2')?.estado === 'ignorada' && almacen.por('m2')?.transcripcion === null && r.ignoradas === 1)
  }
  {
    const ahora = () => new Date('2026-10-27T10:00:00Z')
    const SIN = 'Reunión del 20 oct 2026 a las 10:02 AM CEST'
    const apagada = clasificarRespuestaDeGoogle('docs', 403, { error: { message: 'x', errors: [{ reason: 'accessNotConfigured' }] } })
    const google = googleDeMentira({ correos: [correoDe('m1', SIN, { doc: 'doc-1-0123456789' })], documentos: { 'doc-1-0123456789': apagada } })
    const almacen = new AlmacenEnMemoria(CANDIDATOS, ahora)
    await sincronizarNotasDeGemini(google, almacen, { ahora, analizar: iaBuena })
    ok('sin título y sin poder abrir el documento: no se apunta nada (se reintentará cuando se pueda)', almacen.filas.length === 0)
  }

  console.log('\n=== recasar las notas sin cita ===')
  {
    const ahora = () => new Date('2026-10-27T10:00:00Z')
    const google = googleDeMentira({ correos: [correoDe('m1', TITULO_ANA, { doc: 'doc-ana-0123456789' })], documentos: { 'doc-ana-0123456789': docDe({ titulo: TITULO_ANA, invitado: 'ana@tienda.com' }) } })
    const almacen = new AlmacenEnMemoria([], ahora) // todavía no existe la ficha de Ana
    await sincronizarNotasDeGemini(google, almacen, { ahora, analizar: iaBuena })
    ok('sin ficha, queda sin cita', almacen.por('m1')?.estado === 'sin_cita')
    almacen.candidatosFijos = CANDIDATOS // llega la cita de Google Calendar
    const r2 = await sincronizarNotasDeGemini(google, almacen, { ahora, analizar: iaBuena })
    ok('al aparecer la ficha, la siguiente pasada la casa por el correo y la analiza', almacen.por('m1')?.client_id === 'cli-ana' && almacen.por('m1')?.metodo_cita === 'invitado' && almacen.por('m1')?.estado === 'procesada' && r2.recasadas === 1)
  }

  console.log('\n=== cuando falla la IA ===')
  {
    let t = Date.parse('2026-10-27T10:00:00Z')
    const ahora = () => new Date(t)
    const google = googleDeMentira({ correos: [correoDe('m1', TITULO_ANA, { doc: 'doc-ana-0123456789' })], documentos: { 'doc-ana-0123456789': docDe({ titulo: TITULO_ANA, eventId: 'evt-ana' }) } })
    const almacen = new AlmacenEnMemoria(CANDIDATOS, ahora)
    const falla = iaQueFalla()
    await sincronizarNotasDeGemini(google, almacen, { ahora, analizar: falla })
    const n = almacen.por('m1')!
    ok('un fallo reintentable suma un intento y la nota sigue pendiente, con el motivo', n.estado === 'pendiente' && n.analisis_intentos === 1 && n.error === 'La IA tiene un problema ahora mismo.')
    await sincronizarNotasDeGemini(google, almacen, { ahora, analizar: falla })
    ok('no se reintenta antes de que pasen unos minutos', n.analisis_intentos === 1)
    for (let i = 0; i < 5; i++) {
      t += 11 * 60_000
      await sincronizarNotasDeGemini(google, almacen, { ahora, analizar: falla })
    }
    ok('tras cuatro intentos se rinde: queda en «error» y ya no gasta más', n.estado === 'error' && n.analisis_intentos === 4, `${n.estado}/${n.analisis_intentos}`)

    const almacen2 = new AlmacenEnMemoria(CANDIDATOS, ahora)
    await sincronizarNotasDeGemini(google, almacen2, { ahora, analizar: iaQueFalla({ reintentable: false }) })
    ok('un fallo que no se arregla reintentando (la IA se niega) la deja en «error» a la primera', almacen2.por('m1')?.estado === 'error')

    const almacen3 = new AlmacenEnMemoria(CANDIDATOS, ahora)
    const r3 = await sincronizarNotasDeGemini(google, almacen3, { ahora, analizar: iaQueFalla({ general: true }) })
    ok('un fallo de la cuenta de la IA (clave, saldo) no se le apunta a la nota y avisa', almacen3.por('m1')?.analisis_intentos === 0 && almacen3.por('m1')?.estado === 'pendiente' && r3.avisos.length === 1)
  }

  console.log('\n=== el tiempo ===')
  {
    const ahora = () => new Date('2026-10-27T10:00:00Z')
    let ms = 0
    const google = googleDeMentira({ correos: [correoDe('m1', 'Reunión Semanal 1'), correoDe('m2', 'Reunión Semanal 2'), correoDe('m3', 'Reunión Semanal 3')] })
    const almacen = new AlmacenEnMemoria(CANDIDATOS, ahora)
    const reloj = () => (ms += 100_000)
    const r = await sincronizarNotasDeGemini(google, almacen, { ahora, reloj, analizar: iaBuena, presupuestoMs: 240_000 })
    ok('con el reloj corriendo no se pasa del presupuesto: no procesa los correos que no caben', r.ignoradas < 3, JSON.stringify(r))

    ms = 0
    const almacen2 = new AlmacenEnMemoria(CANDIDATOS, ahora)
    await almacen2.insertar({ estado: 'pendiente', client_id: 'cli-ana', appointment_id: 'cita-ana', metodo_cita: 'evento', gmail_message_id: 'p', drive_file_id: null, google_event_id: null, titulo: TITULO_ANA, fecha_reunion: null, invitados: [], resumen: 'Algo.', temas: [], proximos_pasos: [], detalle: null, transcripcion: null, completa: true })
    const lento = () => (ms += 200_000)
    const r2 = await sincronizarNotasDeGemini(googleDeMentira({ correos: [] }), almacen2, { ahora, reloj: lento, analizar: iaBuena })
    ok('si queda menos de un minuto no se empieza un análisis (puede tardar dos y medio)', r2.analizadas === 0 && almacen2.por('p')?.estado === 'pendiente')
  }

  console.log('\n=== analizar una nota a mano ===')
  {
    const ahora = () => new Date('2026-10-27T10:00:00Z')
    const almacen = new AlmacenEnMemoria(CANDIDATOS, ahora)
    await almacen.insertar({ estado: 'error', client_id: 'cli-ana', appointment_id: 'cita-ana', metodo_cita: 'manual', gmail_message_id: 'x', drive_file_id: null, google_event_id: null, titulo: TITULO_ANA, fecha_reunion: null, invitados: [], resumen: 'Algo.', temas: [], proximos_pasos: [], detalle: null, transcripcion: null, completa: true })
    const fila = almacen.por('x')!
    const bien = await analizarNotaGuardada(almacen, fila, { ahora, analizar: iaBuena, manual: true })
    ok('el botón analiza y deja la nota como procesada, sin error ni intentos', bien.ok && fila.estado === 'procesada' && fila.error === null && fila.analisis_intentos === 0)
    fila.estado = 'pendiente'
    const mal = await analizarNotaGuardada(almacen, fila, { ahora, analizar: iaQueFalla(), manual: true })
    ok('si falla a mano: lo dice, anota el motivo y NO la deja en «error» ni cuenta intento', !mal.ok && mal.aviso === 'La IA tiene un problema ahora mismo.' && fila.estado === 'pendiente' && fila.analisis_intentos === 0 && fila.error === 'La IA tiene un problema ahora mismo.')
    const vacia = await almacen.insertar({ estado: 'pendiente', client_id: 'cli-ana', appointment_id: null, metodo_cita: 'manual', gmail_message_id: 'vacia', drive_file_id: null, google_event_id: null, titulo: 'x', fecha_reunion: null, invitados: [], resumen: null, temas: [], proximos_pasos: [], detalle: null, transcripcion: null, completa: false })
    const nv = almacen.por('vacia')!
    const sinNada = await analizarNotaGuardada(almacen, nv, { ahora, analizar: iaBuena })
    ok('una nota sin nada que analizar: lo dice y la marca como error (no gasta la IA)', vacia === 'creada' && !sinNada.ok && nv.estado === 'error' && sinNada.costeUsd === 0)
    await almacen.insertar({ estado: 'sin_cita', client_id: null, appointment_id: null, metodo_cita: null, gmail_message_id: 'suelta', drive_file_id: null, google_event_id: null, titulo: TITULO_LUIS, fecha_reunion: null, invitados: [], resumen: 'Algo.', temas: [], proximos_pasos: [], detalle: null, transcripcion: null, completa: true })
    const suelta = almacen.por('suelta')!
    const analizada = await analizarNotaGuardada(almacen, suelta, { ahora, analizar: iaBuena, manual: true })
    ok('una nota sin cliente se puede analizar y SIGUE sin cita (le falta que la asignen)', analizada.ok && suelta.estado === 'sin_cita' && suelta.analisis?.resumen === 'Resumen del análisis.')
    const noExiste = await analizarNotaGuardada(almacen, { id: 'no-existe', analisis_intentos: 0 }, { ahora, analizar: iaBuena })
    ok('una nota que ya no existe: avisa sin reventar', !noExiste.ok && /ya no existe/.test(noExiste.aviso ?? ''))
  }

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
