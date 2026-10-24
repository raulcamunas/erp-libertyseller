import type { ClienteFalso } from './cliente-falso'
import { almacenDeSecuencias, type AlmacenDeSecuencias } from './almacen'
import { instanteDeMadrid } from './fechas'
import { inscribir, type PeticionDeInscripcion, type ResultadoDeInscribir } from './inscripcion'
import type { DependenciasDelMotor, EnvioDeSeguimiento, ResultadoDelEnvio } from './motor'
import type { ResultadoDeClasificacionConIa, ResultadoDeRevisionConIa } from './ia'
import type { Clasificacion } from './clasificar'
import type { Revision } from './seguimientos'

/**
 * EL MUNDO DE PRUEBAS DEL MOTOR DE SECUENCIAS — SOLO PARA LAS PRUEBAS.
 * ====================================================================
 * Monta lo mínimo para ejecutar el motor de punta a punta: dos comerciales con su buzón, una secuencia base, los ajustes, un reloj que se
 * mueve a mano, un «correo» que apunta lo que se envía y una «IA» que contesta lo que se le diga. Todo habla con la base a través del cliente
 * de Supabase, así que el MISMO mundo vale para la base en memoria (cliente-falso.ts) y para Postgres de verdad.
 *
 * Las fechas de lo que se siembra van siempre explícitas (nunca se deja que la base ponga «ahora»): así el reloj de la prueba manda.
 */

export const UA = '00000000-0000-4000-8000-0000000000a1'
export const UB = '00000000-0000-4000-8000-0000000000a2'
/** Un administrador sin buzón y una supervisora (sin ser administradora) */
export const UC = '00000000-0000-4000-8000-0000000000a3'
export const UD = '00000000-0000-4000-8000-0000000000a4'
export const B1 = '00000000-0000-4000-8000-0000000000b1'
export const B2 = '00000000-0000-4000-8000-0000000000b2'
export const FIRMA_ANA = 'Ana López\nLiberty Seller'

/** Miércoles 28 de octubre de 2026, 10:00 en Madrid */
export const T0 = instanteDeMadrid('2026-10-28', 600)
export const MIN = 60_000
export const HORA = 3_600_000
export const DIA = 86_400_000

export interface Entorno {
  /** Una base limpia con lo que deja la migración 245 (ajustes, secuencia base) y las tablas de correo y leads vacías */
  nuevo(reloj: () => number): Promise<{ service: ClienteFalso; soloEnMemoria?: { ausentes: Set<string> } }>
}

type Fila = Record<string, unknown>

export interface Mundo {
  service: ClienteFalso
  almacen: AlmacenDeSecuencias
  deps: DependenciasDelMotor
  reloj: { ahora: number }
  enviados: EnvioDeSeguimiento[]
  sincronizaciones: string[]
  revisiones: Array<{ system: string; usuario: string; original: string }>
  /** Lo que contestará la IA, en orden; si se acaba, «enviar» */
  respuestasDeIa: Array<Revision | null>
  /** Lo que contestará la IA al leer la respuesta de un lead, en orden (null = no puede); si se acaba, «otra cosa» */
  clasificaciones: Array<Clasificacion | null>
  /** Cada vez que el motor le ha pedido a la IA que lea una respuesta */
  clasificados: Array<{ system: string; usuario: string }>
  /** Lo que contestará el correo al enviar, en orden; si se acaba, «ha salido» */
  resultadosDeEnvio: ResultadoDelEnvio[]
  /** Se ejecuta justo antes de cada envío (para provocar cosas «mientras se envía») */
  alEnviar: Array<() => Promise<void>>
  ausentes: Set<string> | null
  iso(ms?: number): string
  leer(tabla: string, filtro?: (q: any) => any, columnas?: string): Promise<Fila[]>
  uno(tabla: string, filtro: (q: any) => any, columnas?: string): Promise<Fila | null>
  sembrar(tabla: string, filas: Fila | Fila[]): Promise<void>
  actualizar(tabla: string, cambios: Fila, filtro: (q: any) => any): Promise<void>
  ajustes(cambios: Fila): Promise<void>
  nuevoLead(n: number, opciones?: { email?: string; status?: string; asignado?: string | null; emailsExtra?: string }): Promise<{ id: string; email: string }>
  /** El primer correo ya enviado por la persona (queda en el buzón) y el alta de la secuencia con sus seguimientos */
  secuenciaNueva(n: number, opciones?: Partial<PeticionDeInscripcion> & { buzon?: string; usuario?: string; email?: string; dominio?: string; status?: string }): Promise<{ resultado: ResultadoDeInscribir; leadId: string; email: string; hiloId: string; messageId: string }>
  entrante(datos: { buzon?: string; hilo?: string | null; de: string; asunto?: string; texto?: string; automatico?: boolean; cuando?: number; n?: number }): Promise<string>
  saliente(datos: { buzon?: string; para: string; messageId: string; cuando?: number; hilo?: string | null }): Promise<void>
  nota(leadId: string, datos: { kind?: string; body: string; cuando?: number; esRespuesta?: boolean }): Promise<void>
  pasos(inscripcionId: string): Promise<Fila[]>
  eventos(inscripcionId?: string): Promise<Fila[]>
}

export const TEXTO_PRIMERO =
  'Hola,\n\nHe estado viendo vuestra tienda de decoración y creo que hay una oportunidad clara en Amazon para vuestras lámparas y textiles. En Liberty Seller nos encargamos de todo el alta, sin cargar a vuestro equipo. ¿Te viene mejor una videollamada de 10-15 minutos esta semana o la próxima?\n\nUn saludo,'
export const TEXTO_S1 = 'Hola,\n\nTe escribí hace unos días sobre vuestro catálogo. Una idea distinta: revisar cómo aparecen vuestras lámparas cuando alguien busca por estilo y no por marca. Si te encaja, lo vemos en diez minutos.\n\nUn saludo,'
export const TEXTO_S2 = 'Hola,\n\nNo quiero ser pesado, así que este es mi último mensaje. Si ahora no es buen momento, dímelo con una palabra y lo dejamos para más adelante.\n\nUn saludo,'

let contadorDeMundos = 0

/** Un identificador de la forma de un UUID, repetible: `e` + número para los leads, `d` para los hilos, `f` para los mensajes… */
export const identificador = (letra: string, n: number): string => `00000000-0000-4000-8000-${letra}${String(n).padStart(11, '0')}`

/** El hilo y las carpetas de cada buzón (los correos de las pruebas cuelgan de ellos) */
export const HILO_POR_DEFECTO: Record<string, string> = { [B1]: identificador('d', 900), [B2]: identificador('d', 901) }
export const CARPETA_DE_ENTRADA: Record<string, string> = { [B1]: identificador('c', 1), [B2]: identificador('c', 2) }
export const CARPETA_DE_ENVIADOS: Record<string, string> = { [B1]: identificador('c', 3), [B2]: identificador('c', 4) }

export async function crearMundo(entorno: Entorno, opciones: { activa?: boolean; ensayo?: boolean; ahora?: number; ajustes?: Fila } = {}): Promise<Mundo> {
  const reloj = { ahora: opciones.ahora ?? T0 }
  const { service, soloEnMemoria } = await entorno.nuevo(() => reloj.ahora)
  const almacen = almacenDeSecuencias(service as unknown as Parameters<typeof almacenDeSecuencias>[0])
  const iso = (ms: number = reloj.ahora) => new Date(ms).toISOString()
  const prefijo = `m${++contadorDeMundos}`

  const m = {} as Mundo
  const enviados: EnvioDeSeguimiento[] = []
  const sincronizaciones: string[] = []
  const revisiones: Mundo['revisiones'] = []
  const respuestasDeIa: Array<Revision | null> = []
  const clasificaciones: Array<Clasificacion | null> = []
  const clasificados: Mundo['clasificados'] = []
  const resultadosDeEnvio: ResultadoDelEnvio[] = []
  const alEnviar: Array<() => Promise<void>> = []
  let idDeEnvio = 0

  const comprobar = (r: { error: unknown }, donde: string) => {
    if (r.error) throw new Error(`Mundo de pruebas: ${donde}: ${JSON.stringify(r.error)}`)
  }

  Object.assign(m, {
    service,
    almacen,
    reloj,
    enviados,
    sincronizaciones,
    revisiones,
    respuestasDeIa,
    clasificaciones,
    clasificados,
    resultadosDeEnvio,
    alEnviar,
    ausentes: soloEnMemoria?.ausentes ?? null,
    iso,
    async leer(tabla: string, filtro?: (q: any) => any, columnas = '*') {
      const q = service.from(tabla).select(columnas)
      const r = await (filtro ? filtro(q) : q)
      comprobar(r, `leer ${tabla}`)
      return (r.data ?? []) as Fila[]
    },
    async uno(tabla: string, filtro: (q: any) => any, columnas = '*') {
      const r = await filtro(service.from(tabla).select(columnas)).maybeSingle()
      comprobar(r, `leer uno de ${tabla}`)
      return (r.data ?? null) as Fila | null
    },
    async sembrar(tabla: string, filas: Fila | Fila[]) {
      comprobar(await service.from(tabla).insert(filas), `sembrar ${tabla}`)
    },
    async actualizar(tabla: string, cambios: Fila, filtro: (q: any) => any) {
      comprobar(await filtro(service.from(tabla).update(cambios)), `actualizar ${tabla}`)
    },
    async ajustes(cambios: Fila) {
      comprobar(await service.from('correo_secuencia_ajustes').update(cambios).eq('id', true), 'ajustes')
    },
  } satisfies Partial<Mundo>)

  /* ---- lo que deja la migración y lo que hay antes de empezar ---- */
  await m.sembrar('profiles', [
    { id: UA, full_name: 'Ana', email: 'ana@libertyseller.com', role: 'employee', is_comercial: true },
    { id: UB, full_name: 'Alejandro', email: 'alejandro@libertyseller.com', role: 'employee', is_comercial: true },
    { id: UC, full_name: 'Raúl', email: 'raul@libertyseller.com', role: 'admin', is_comercial: false },
    { id: UD, full_name: 'Jhanna', email: 'jhanna@libertyseller.com', role: 'employee', is_comercial: false },
  ])
  await m.sembrar('correo_buzones', [
    { id: B1, user_id: UA, direccion: 'ana@libertyseller.es', nombre: 'Ana López', firma: FIRMA_ANA, usuario: 'ana@libertyseller.es', imap_host: 'imap.ejemplo.test', smtp_host: 'smtp.ejemplo.test', desde_fecha: iso(reloj.ahora - 365 * DIA), credenciales_invalidas: false, ultimo_sync_at: iso(reloj.ahora - MIN) },
    { id: B2, user_id: UB, direccion: 'alejandro@libertyseller.es', nombre: 'Alejandro', firma: null, usuario: 'alejandro@libertyseller.es', imap_host: 'imap.ejemplo.test', smtp_host: 'smtp.ejemplo.test', desde_fecha: iso(reloj.ahora - 365 * DIA), credenciales_invalidas: false, ultimo_sync_at: iso(reloj.ahora - MIN) },
  ])
  await m.sembrar('correo_credenciales', [{ buzon_id: B1, secreto_cifrado: 'cifrado-de-prueba' }, { buzon_id: B2, secreto_cifrado: 'cifrado-de-prueba' }])
  await m.sembrar('correo_carpetas', [
    { id: CARPETA_DE_ENTRADA[B1], buzon_id: B1, ruta: 'INBOX', rol: 'entrada' },
    { id: CARPETA_DE_ENVIADOS[B1], buzon_id: B1, ruta: 'Sent', rol: 'enviados' },
    { id: CARPETA_DE_ENTRADA[B2], buzon_id: B2, ruta: 'INBOX', rol: 'entrada' },
    { id: CARPETA_DE_ENVIADOS[B2], buzon_id: B2, ruta: 'Sent', rol: 'enviados' },
  ])
  await m.sembrar('correo_hilos', [
    { id: HILO_POR_DEFECTO[B1], buzon_id: B1, asunto: 'Varios', primer_mensaje_at: iso(reloj.ahora - DIA), ultimo_mensaje_at: iso(reloj.ahora - DIA) },
    { id: HILO_POR_DEFECTO[B2], buzon_id: B2, asunto: 'Varios', primer_mensaje_at: iso(reloj.ahora - DIA), ultimo_mensaje_at: iso(reloj.ahora - DIA) },
  ])
  await m.sembrar('correo_secuencia_buzones', [
    { buzon_id: B1, participa: true, rampa_inicio: '2026-10-01', llamadas_desde_min: 600, llamadas_hasta_min: 840 },
    { buzon_id: B2, participa: true, rampa_inicio: '2026-10-01', llamadas_desde_min: 600, llamadas_hasta_min: 960 },
  ])
  await m.ajustes({ activa: opciones.activa ?? true, modo_ensayo: opciones.ensayo ?? false, ...(opciones.ajustes ?? {}) })

  /* ---- el correo y la IA de mentira ---- */
  const deps: DependenciasDelMotor = {
    almacen,
    ahora: () => reloj.ahora,
    nuevoId: () => `${prefijo}-envio-${String(++idDeEnvio).padStart(3, '0')}`,
    async sincronizar(buzonId) {
      sincronizaciones.push(buzonId)
      comprobar(await service.from('correo_buzones').update({ ultimo_sync_at: iso() }).eq('id', buzonId), 'sincronizar')
    },
    async enviar(e) {
      for (const hacer of alEnviar.splice(0)) await hacer()
      enviados.push(e)
      const resultado = resultadosDeEnvio.shift()
      const messageId = `${e.id}@libertyseller.es`.toLowerCase()
      if (resultado && !resultado.ok && resultado.codigo !== 'base') return resultado
      // Lo que hace `enviarCorreo` de verdad: el correo queda en el buzón, en el hilo del primero
      const buzon = await m.uno('correo_buzones', (q) => q.eq('id', e.buzonId))
      const previo = e.enRespuestaA ? await m.uno('correo_mensajes', (q) => q.eq('message_id', e.enRespuestaA!.toLowerCase())) : null
      await m.sembrar('correo_mensajes', {
        buzon_id: e.buzonId,
        hilo_id: (previo?.hilo_id as string | undefined) ?? HILO_POR_DEFECTO[e.buzonId],
        carpeta_id: CARPETA_DE_ENVIADOS[e.buzonId],
        message_id: messageId,
        direccion: 'saliente',
        de_direccion: buzon?.direccion,
        destinatarios: e.para,
        asunto: e.asunto,
        fecha: iso(),
        texto: e.texto,
        creado_at: iso(),
      })
      return resultado && !resultado.ok ? resultado : { ok: true, messageId, fecha: reloj.ahora, copiadoAEnviados: true }
    },
    async revisar(mensajes, original): Promise<ResultadoDeRevisionConIa> {
      revisiones.push({ ...mensajes, original })
      const siguiente = respuestasDeIa.length > 0 ? respuestasDeIa.shift()! : { decision: 'enviar' as const, motivo: 'No cambia nada.', texto: '' }
      return { revision: siguiente, modelo: 'gpt-6-luna', aviso: siguiente ? null : 'La IA no está disponible.', tokens: null }
    },
    async clasificar(mensajes): Promise<ResultadoDeClasificacionConIa> {
      clasificados.push({ ...mensajes })
      const siguiente = clasificaciones.length > 0 ? clasificaciones.shift()! : { clase: 'otro' as const, confianza: 'alta' as const, evidencia: '', resumen: 'Otra cosa.', fecha: null }
      return { clasificacion: siguiente, modelo: 'gpt-6-luna', aviso: siguiente ? null : 'La IA no está disponible.', tokens: null }
    },
  }
  m.deps = deps

  /* ---- sembrar leads, correos y secuencias ---- */
  const id = identificador

  m.nuevoLead = async (n, o = {}) => {
    const email = o.email ?? `ana${n}@tienda${n}.es`
    const leadId = id('e', n)
    await m.sembrar('cold_leads', {
      id: leadId,
      store_name: `Tienda ${n}`,
      company: `TIENDA ${n} SL`,
      status: o.status ?? 'email_enviado',
      assigned_to: o.asignado === undefined ? UA : o.asignado,
      email,
      emails_extra: o.emailsExtra ?? null,
      category: 'Hogar',
      vende_en_amazon: 'no_vende',
      updated_at: iso(),
    })
    return { id: leadId, email }
  }

  m.saliente = async (d) => {
    const buzon = d.buzon ?? B1
    await m.sembrar('correo_mensajes', {
      buzon_id: buzon,
      hilo_id: d.hilo ?? HILO_POR_DEFECTO[buzon],
      carpeta_id: CARPETA_DE_ENVIADOS[buzon],
      message_id: d.messageId.toLowerCase(),
      direccion: 'saliente',
      de_direccion: buzon === B1 ? 'ana@libertyseller.es' : 'alejandro@libertyseller.es',
      destinatarios: d.para,
      asunto: 'x',
      fecha: iso(d.cuando ?? reloj.ahora),
      texto: 'x',
      creado_at: iso(d.cuando ?? reloj.ahora),
    })
  }

  let entrantes = 0
  m.entrante = async (d) => {
    const cuando = d.cuando ?? reloj.ahora
    const numero = d.n ?? ++entrantes + 1000
    const mensajeId = id('f', numero)
    await m.sembrar('correo_mensajes', {
      id: mensajeId,
      buzon_id: d.buzon ?? B1,
      // Todo mensaje cuelga de algún hilo: «sin hilo» es uno cualquiera que no es el del primer correo
      hilo_id: d.hilo ?? HILO_POR_DEFECTO[d.buzon ?? B1],
      carpeta_id: CARPETA_DE_ENTRADA[d.buzon ?? B1],
      message_id: `entrante-${numero}@externo.example`,
      direccion: 'entrante',
      de_direccion: d.de,
      destinatarios: 'ana@libertyseller.es',
      asunto: d.asunto ?? 'Re: Casa Luz en Amazon',
      fecha: iso(cuando),
      texto: d.texto ?? 'Gracias por tu correo, me interesa.',
      automatico: d.automatico ?? false,
      creado_at: iso(cuando),
    })
    return mensajeId
  }

  m.nota = async (leadId, d) => {
    await m.sembrar('cold_lead_notes', { lead_id: leadId, author_id: UA, kind: d.kind ?? 'nota', body: d.body, occurred_at: iso(d.cuando ?? reloj.ahora), created_at: iso(d.cuando ?? reloj.ahora), es_respuesta: d.esRespuesta ?? false })
  }

  m.secuenciaNueva = async (n, o = {}) => {
    const buzon = o.buzon ?? o.buzonId ?? B1
    const usuario = o.usuario ?? o.userId ?? (buzon === B1 ? UA : UB)
    const lead = await m.nuevoLead(n, { email: o.email ?? o.destinatario, status: o.status ?? 'email_enviado', asignado: usuario })
    const messageId = `p${n}@libertyseller.es`
    const hiloId = id('d', n)
    await m.sembrar('correo_hilos', { id: hiloId, buzon_id: buzon, asunto: 'Casa Luz en Amazon', primer_mensaje_at: iso(), ultimo_mensaje_at: iso() })
    await m.sembrar('correo_mensajes', {
      buzon_id: buzon,
      hilo_id: hiloId,
      carpeta_id: CARPETA_DE_ENVIADOS[buzon],
      message_id: messageId,
      direccion: 'saliente',
      de_direccion: buzon === B1 ? 'ana@libertyseller.es' : 'alejandro@libertyseller.es',
      destinatarios: lead.email,
      asunto: 'Casa Luz en Amazon',
      fecha: iso(),
      texto: TEXTO_PRIMERO,
      creado_at: iso(),
    })
    const resultado = await inscribir(
      { almacen, ahora: deps.ahora },
      {
        leadId: lead.id,
        buzonId: buzon,
        userId: usuario,
        destinatario: lead.email,
        primerCorreo: { asunto: 'Casa Luz en Amazon', texto: TEXTO_PRIMERO, messageId, hiloId, enviadoAt: reloj.ahora },
        seguimientos: o.seguimientos ?? [{ texto: TEXTO_S1 }, { texto: TEXTO_S2 }],
        iaModelo: 'gpt-6-luna',
        ...(o.primerCorreo ? { primerCorreo: o.primerCorreo } : {}),
      }
    )
    return { resultado, leadId: lead.id, email: lead.email, hiloId, messageId }
  }

  m.pasos = (inscripcionId) => m.leer('correo_secuencia_pasos', (q) => q.eq('inscripcion_id', inscripcionId).order('orden', { ascending: true }))
  m.eventos = (inscripcionId) => m.leer('correo_secuencia_eventos', (q) => (inscripcionId ? q.eq('inscripcion_id', inscripcionId) : q).order('id', { ascending: true }))

  return m
}
