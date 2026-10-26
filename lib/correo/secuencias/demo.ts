import type { QuienPide } from '../acceso'
import { almacenDeSecuencias, type AlmacenDeSecuencias } from './almacen'
import type { Clasificacion } from './clasificar'
import { nuevaBase } from './cliente-falso'
import { COMERCIALES_DE_DEMO, PERSONAS_DE_DEMO, type PersonaDeDemo } from './demo-personas'
import { TEXTOS_DE_DEMO } from './demo-textos'
import { esDiaHabil, instanteDeMadrid, partesDeMadrid, sumarDias } from './fechas'
import { inscribir } from './inscripcion'
import { ejecutarPasada } from './motor'
import { B1, B2, CARPETA_DE_ENVIADOS, HILO_POR_DEFECTO, MIN, UA, UB, UC, UD, crearMundo, identificador, type Entorno, type Mundo } from './mundo-de-pruebas'
import { AJUSTES_POR_DEFECTO } from './reglas'

/**
 * LA DEMOSTRACIÓN DE SECUENCIAS — SOLO SERVIDOR.
 * ==============================================
 * Un ERP de mentira, entero y en memoria, para ENSEÑAR las secuencias sin tocar nada de verdad: dos comerciales inventados con su buzón, doce tiendas que no existen y lo que les ha
 * pasado en los últimos nueve días hábiles, que no está escrito a mano: lo ha hecho el MOTOR DE VERDAD (el mismo `ejecutarPasada` que corre cada minuto en producción), moviendo un reloj
 * y con una IA y un correo de mentira (mundo-de-pruebas.ts). Por eso las pantallas de Secuencias —que no saben que es una demostración— lo enseñan todo como en producción: lo de «Hoy», la
 * cola, los próximos días, el flujo, la salud, el detalle de cada una con su rastro y lo que la IA ha entendido de cada respuesta.
 *
 * Qué hay:
 *   · Los textos son de la IA de verdad (demo-textos.ts, escritos una vez con los mismos prompts que usa el ERP). Las respuestas de las tiendas, las llamadas y lo que clasifica la «IA»
 *     de la demo están guionizados aquí: es lo único inventado «a mano», y se nota que es una demo porque las direcciones de las tiendas llevan «-demo» (ceramicamediterranea-demo.es).
 *   · NADA sale de aquí: no hay red, ni base de datos, ni buzón. Cada petición lee un mundo que vive en la memoria del proceso (se guarda un rato para no rehacerlo).
 *   · El reloj de la demostración avanza por días hábiles: `dias` = 0 es «hoy»; con 3, el motor ha seguido trabajando tres días hábiles más (salen seguimientos, contestan, se cierran
 *     leads). La demo se ancla al día hábil más reciente y a una hora de trabajo, así que se ve viva se mire cuando se mire (también un sábado o de madrugada).
 *
 * Se comprueba con demo.prueba.ts.
 */

/** Hasta cuántos días hábiles se puede avanzar el reloj de la demostración */
export const DIAS_MAXIMOS_DE_LA_DEMO = 7
/** Cuántos días hábiles de historia tiene la demo antes de «hoy» */
const DIAS_DE_HISTORIA = 9

export interface Demostracion {
  almacen: AlmacenDeSecuencias
  /** Quien mira: un administrador (ve los dos buzones) */
  quien: QuienPide
  /** El «ahora» de la demostración (el que las pantallas toman por la hora del servidor) */
  ahora: number
  /** El día hábil de «hoy» en la demostración y cuántos se ha avanzado */
  dia: string
  dias: number
}

const QUIEN: QuienPide = { userId: UC, role: 'admin', tienePermisoEquipo: false, tienePermisoCorreo: false }

/* ------------------------------------------------------------------ */
/* El calendario                                                       */
/* ------------------------------------------------------------------ */

const FESTIVOS = AJUSTES_POR_DEFECTO.festivos

/** El día hábil que está `n` días hábiles de `dia` (hacia atrás si es negativo) */
export function diaHabilRelativo(dia: string, n: number, festivos: ReadonlySet<string> | readonly string[] = FESTIVOS): string {
  let d = dia
  while (!esDiaHabil(d, festivos)) d = sumarDias(d, -1)
  let quedan = Math.abs(n)
  const paso = n < 0 ? -1 : 1
  while (quedan > 0) {
    d = sumarDias(d, paso)
    if (esDiaHabil(d, festivos)) quedan--
  }
  return d
}

/**
 * Dónde está «hoy» en la demostración: el día hábil de `real` (o el anterior, si es fin de semana o festivo) y siempre las 14:00 de Madrid: a esa hora la mañana ya está vivida (hay
 * correos enviados, respuestas leídas) y todavía queda algo por salir esta tarde. Así la demostración se ve igual de viva se mire cuando se mire, también de madrugada o un domingo.
 */
export function momentoDeLaDemo(real: number = Date.now()): { dia: string; minutos: number } {
  return { dia: diaHabilRelativo(partesDeMadrid(real).dia, 0), minutos: 14 * 60 }
}

/* ------------------------------------------------------------------ */
/* La historia                                                         */
/* ------------------------------------------------------------------ */

interface Respuesta {
  persona: string
  /** Días hábiles desde «hoy» (negativo = ya pasó) y hora */
  dia: number
  hora: number
  texto: string
  asunto?: string
  /** Lo que «entiende» la IA de la demostración */
  clasificacion: Clasificacion
}

const RESPUESTAS: readonly Respuesta[] = [
  {
    persona: 'penya',
    dia: -4,
    hora: 9 * 60 + 50,
    texto: 'Buenos días,\n\nGracias por escribir, pero ahora mismo no nos interesa: ya trabajamos con otra empresa para lo de Amazon.\n\nUn saludo,\nJavier',
    clasificacion: { clase: 'no_interesa', confianza: 'alta', evidencia: 'ahora mismo no nos interesa', resumen: 'No les interesa: ya trabajan con otra empresa.', fecha: null },
  },
  {
    persona: 'audiomax',
    dia: -3,
    hora: 10 * 60 + 40,
    texto: 'Hola Marcos,\n\nGracias por escribir. Nos interesa lo que comentáis sobre las fichas y las campañas. ¿Podéis llamarnos mañana por la mañana y lo vemos con calma?\n\nUn saludo,\nPablo (Audiomax)',
    clasificacion: { clase: 'interesado', confianza: 'alta', evidencia: 'Nos interesa lo que comentáis', resumen: 'Le interesa y pide que le llamen mañana por la mañana.', fecha: null },
  },
  {
    persona: 'atlas',
    dia: 1,
    hora: 11 * 60 + 20,
    texto: 'Hola,\n\nGracias por el seguimiento. Ahora estamos en plena campaña de Navidad y no podemos mirarlo. Escribidme en enero y lo vemos.\n\nUn saludo,\nElena',
    clasificacion: { clase: 'mas_tarde', confianza: 'alta', evidencia: 'Escribidme en enero', resumen: 'Pide que le escriban en enero: están en plena campaña de Navidad.', fecha: '2027-01-11' },
  },
  {
    persona: 'cosmetica',
    dia: 4,
    hora: 12 * 60 + 5,
    texto: 'Hola,\n\nMe interesa lo de ordenar el catálogo por líneas, pero antes me gustaría saber qué condiciones tenéis y cuánto tiempo suele llevar montarlo. ¿Me lo podéis explicar?\n\nGracias,\nCarmen',
    clasificacion: { clase: 'pide_info', confianza: 'alta', evidencia: 'qué condiciones tenéis', resumen: 'Le interesa y pide saber las condiciones y cuánto lleva ponerlo en marcha.', fecha: null },
  },
]

/** Lo que el comercial apunta en la ficha entre un correo y otro: es lo que la IA lee antes de escribir cada seguimiento «a medida» */
interface Apunte {
  persona: string
  dia: number
  hora: number
  kind: string
  body: string
}

const APUNTES: readonly Apunte[] = [
  { persona: 'ortega', dia: -3, hora: 15 * 60, kind: 'llamada', body: 'Habló el responsable: ahora mismo están con el inventario del trimestre y pidió que le escribamos después de Reyes.' },
  { persona: 'clip', dia: -2, hora: 12 * 60, kind: 'llamada', body: 'Habló la dueña. Le suena interesante pero no sabe por dónde empezar con Amazon y teme la logística. Quiere ver cómo se haría sin complicarse.' },
  { persona: 'aurora', dia: -1, hora: 16 * 60, kind: 'nota', body: 'Han renovado las fotos de producto de la tienda online y en su Instagram anuncian una colección de otoño.' },
]

/** Qué pasa con las personas que no se detallan arriba: ya sale solo de sus pasos (enviar, esperar, cerrar) */
const REBOTE = { persona: 'bicisnorte', dia: -3, hora: 14 * 60 }

/* ------------------------------------------------------------------ */
/* Pequeñas ayudas                                                     */
/* ------------------------------------------------------------------ */

const entorno: Entorno = {
  async nuevo(reloj) {
    const { base, service } = nuevaBase(reloj)
    // Lo que deja la migración 245
    base.sembrar('correo_secuencias', { nombre: 'Prospección: primer correo y 2 seguimientos', es_base: true, activa: true, pasos: [{ orden: 1, dias: 3 }, { orden: 2, dias: 7 }] })
    base.sembrar('correo_secuencia_ajustes', { id: true, activa: false, modo_ensayo: true })
    return { service, soloEnMemoria: { ausentes: base.ausentes } }
  },
}

/** Un azar repetible (LCG): la misma demostración sale siempre igual */
function azar(semilla: number): () => number {
  let s = (semilla * 2654435761) >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

const ms = (v: unknown): number => Date.parse(String(v))

const porId = (id: string) => PERSONAS_DE_DEMO.find((p) => p.id === id)!
const uuidDeLead = (p: PersonaDeDemo) => identificador('e', p.n)
const uuidDeHilo = (p: PersonaDeDemo) => identificador('d', p.n)

interface Evento {
  en: number
  hacer: () => Promise<void>
}

/* ------------------------------------------------------------------ */
/* Construir el mundo                                                  */
/* ------------------------------------------------------------------ */

async function construir(opciones: { dia: string; minutos: number; dias: number }): Promise<Demostracion> {
  const { dia: hoy, minutos, dias } = opciones
  const diaDe = (n: number) => diaHabilRelativo(hoy, n)
  const instante = (n: number, min: number) => instanteDeMadrid(diaDe(n), min)
  const final = instante(dias, minutos)
  const inicio = instante(-DIAS_DE_HISTORIA, 8 * 60)

  const m: Mundo = await crearMundo(entorno, { activa: true, ensayo: false, redactar: true, ahora: inicio })

  // Quiénes son: nadie real. Los perfiles y buzones que trae el mundo de pruebas se renombran
  const a = COMERCIALES_DE_DEMO.A
  const b = COMERCIALES_DE_DEMO.B
  await m.actualizar('profiles', { full_name: a.nombre, email: a.direccion }, (q) => q.eq('id', UA))
  await m.actualizar('profiles', { full_name: b.nombre, email: b.direccion }, (q) => q.eq('id', UB))
  await m.actualizar('profiles', { full_name: 'Administración (demo)', email: 'admin@demo.libertyseller.example' }, (q) => q.eq('id', UC))
  await m.actualizar('profiles', { full_name: 'Supervisión (demo)', email: 'supervision@demo.libertyseller.example' }, (q) => q.eq('id', UD))
  await m.actualizar('correo_buzones', { nombre: a.buzon, direccion: a.direccion, usuario: a.direccion, firma: a.firma }, (q) => q.eq('id', B1))
  await m.actualizar('correo_buzones', { nombre: b.buzon, direccion: b.direccion, usuario: b.direccion, firma: b.firma }, (q) => q.eq('id', B2))

  /* ---- la IA y el correo de mentira: leen de lo guionizado ---- */
  const persona = (usuario: string): PersonaDeDemo | undefined => PERSONAS_DE_DEMO.find((p) => usuario.includes(`Nombre comercial: ${String(p.lead.store_name)}`))
  m.deps.redactar = async (mensajes) => {
    const p = persona(mensajes.usuario)
    const numero = (/BORRADOR DEL SEGUIMIENTO (\d) DE/.exec(mensajes.usuario)?.[1] ?? '1') as '1' | '2'
    const hecho = p ? TEXTOS_DE_DEMO[p.id]?.medida[numero] : undefined
    const borrador = p ? TEXTOS_DE_DEMO[p.id].borradores[Number(numero) - 1] : ''
    const r = hecho ? { decision: hecho.decision, motivo: hecho.motivo, texto: hecho.texto } : { decision: 'escribir' as const, motivo: 'Escrito con lo que consta del lead.', texto: borrador }
    return { redaccion: r, modelo: 'gpt-6-luna', aviso: null, tokens: null, llamadas: 1 }
  }
  m.deps.clasificar = async (mensajes) => {
    const dicho = RESPUESTAS.find((r) => mensajes.usuario.includes(r.clasificacion.evidencia))
    const clasificacion: Clasificacion = dicho?.clasificacion ?? { clase: 'otro', confianza: 'alta', evidencia: '', resumen: 'Otra cosa.', fecha: null }
    return { clasificacion, modelo: 'gpt-6-luna', aviso: null, tokens: null }
  }

  /* ---- lo que pasa y cuándo ---- */
  const eventos: Evento[] = []
  const agendar = (en: number, hacer: () => Promise<void>) => {
    eventos.push({ en, hacer })
    eventos.sort((x, y) => x.en - y.en)
  }
  /** Una pasada unos minutos después de algo que el motor tiene que leer (una respuesta, un rebote, una nota) */
  const luego = (en: number) => agendar(en + 3 * MIN, async () => {})

  // Las altas: el comercial escribe el primer correo a mano y programa los seguimientos
  for (const p of PERSONAS_DE_DEMO) {
    const t = TEXTOS_DE_DEMO[p.id]
    const quien = p.buzon === 'A' ? { buzon: B1, usuario: UA, carpeta: a } : { buzon: B2, usuario: UB, carpeta: b }
    agendar(instante(p.inscrita, p.hora), async () => {
      const leadId = uuidDeLead(p)
      await m.sembrar('cold_leads', {
        id: leadId,
        ...p.lead,
        assigned_to: quien.usuario,
        email: p.email,
        updated_at: m.iso(),
        last_contacted_at: m.iso(),
      })
      const messageId = `demo-${p.n}@${quien.carpeta.direccion.split('@')[1]}`
      const hiloId = uuidDeHilo(p)
      await m.sembrar('correo_hilos', { id: hiloId, buzon_id: quien.buzon, asunto: t.primero.asunto, primer_mensaje_at: m.iso(), ultimo_mensaje_at: m.iso() })
      await m.saliente({ buzon: quien.buzon, para: p.email, messageId, cuando: m.reloj.ahora, hilo: hiloId })
      await m.actualizar('correo_mensajes', { asunto: t.primero.asunto, texto: t.primero.texto }, (q) => q.eq('message_id', messageId))
      const r = await inscribir(
        { almacen: m.almacen, ahora: m.deps.ahora },
        {
          leadId,
          buzonId: quien.buzon,
          userId: quien.usuario,
          destinatario: p.email,
          primerCorreo: { asunto: t.primero.asunto, texto: t.primero.texto, messageId, hiloId, enviadoAt: m.reloj.ahora },
          seguimientos: t.borradores.map((texto) => ({ texto })),
          iaModelo: 'gpt-6-luna',
        }
      )
      if (!r.ok) throw new Error(`Demostración: no se pudo dar de alta a ${p.id}: ${r.mensaje}`)
      // Lo que el comercial apunta en su ficha cuando llama: justo antes del seguimiento 1 de Casa Luz (salió sin que cogieran el teléfono)
      if (p.id === 'casaluz') {
        const s1 = r.pasos[0]?.programadoAt
        if (s1) {
          agendar(s1 - 25 * MIN, async () => {
            await m.nota(leadId, { kind: 'llamada', body: 'Llamo y no contesta nadie (salta el buzón de voz).', cuando: m.reloj.ahora })
            await m.actualizar('cold_leads', { status: 'no_contesta', call_attempts: 1 }, (q) => q.eq('id', leadId))
          })
        }
      }
    })
  }

  for (const ap of APUNTES) {
    const p = porId(ap.persona)
    agendar(instante(ap.dia, ap.hora), async () => {
      await m.nota(uuidDeLead(p), { kind: ap.kind, body: ap.body, cuando: m.reloj.ahora })
    })
  }

  for (const r of RESPUESTAS) {
    const p = porId(r.persona)
    const en = instante(r.dia, r.hora)
    agendar(en, async () => {
      await m.entrante({ buzon: p.buzon === 'A' ? B1 : B2, de: p.email, hilo: uuidDeHilo(p), asunto: `Re: ${TEXTOS_DE_DEMO[p.id].primero.asunto}`, texto: r.texto, cuando: m.reloj.ahora, n: 2000 + p.n })
    })
    luego(en)
  }

  {
    const p = porId(REBOTE.persona)
    const en = instante(REBOTE.dia, REBOTE.hora)
    agendar(en, async () => {
      await m.entrante({
        buzon: B1,
        de: 'mailer-daemon@googlemail.com',
        hilo: null,
        automatico: true,
        asunto: 'Delivery Status Notification (Failure)',
        texto: `Address not found. Your message wasn't delivered to ${p.email} because the address couldn't be found. 550 5.1.1 user unknown`,
        cuando: m.reloj.ahora,
        n: 3000 + p.n,
      })
    })
    luego(en)
  }

  /* ---- mover el reloj: el motor pasa cuando algo toca ---- */
  let vueltas = 0
  while (vueltas++ < 4000) {
    const pasos = await m.leer('correo_secuencia_pasos', (q) => q.eq('estado', 'pendiente'))
    const insc = await m.leer('correo_secuencia_inscripciones')
    const pendientes = [
      ...pasos.map((p) => ms(p.programado_at)),
      ...insc.map((i) => (i.no_interesa_en ? ms(i.no_interesa_en) : NaN)),
    ].filter((t) => Number.isFinite(t) && t >= m.reloj.ahora)
    const siguiente = Math.min(eventos[0]?.en ?? Infinity, ...pendientes)
    if (!(siguiente <= final)) break
    m.reloj.ahora = Math.min(final, Math.max(m.reloj.ahora, siguiente) + 20_000)
    while (eventos.length > 0 && eventos[0].en <= m.reloj.ahora) await eventos.shift()!.hacer()
    await ejecutarPasada(m.deps)
  }
  if (vueltas >= 4000) throw new Error('Demostración: el reloj no ha terminado de avanzar')

  // Lo que queda por pasar antes de «ahora» (el último minuto) y la fotografía final
  m.reloj.ahora = final
  while (eventos.length > 0 && eventos[0].en <= final) await eventos.shift()!.hacer()
  await ejecutarPasada(m.deps)

  // Lo que los comerciales mandan a mano cada día (sin secuencia): hace que la capacidad de cada buzón se vea como en un día normal de trabajo. Se siembra al final y de una vez:
  // no hace falta que el motor pase por cada uno, y así los identificadores de las secuencias (que salen de un contador) no cambian según hasta dónde se avance el reloj
  {
    const filas: Array<Record<string, unknown>> = []
    for (let d = -DIAS_DE_HISTORIA; d <= dias; d++) {
      const dia = diaDe(d)
      const sorteo = azar(d + 100)
      for (const [buzon, cuantos, dominio] of [[B1, 14, a.direccion.split('@')[1]], [B2, 9, b.direccion.split('@')[1]]] as const) {
        const hasta = d === dias ? final : instanteDeMadrid(dia, 17 * 60 + 30)
        for (let i = 0; i < cuantos; i++) {
          const en = instanteDeMadrid(dia, 9 * 60 + Math.floor(sorteo() * 8.5 * 60))
          if (en >= hasta) continue
          const numero = filas.length + 1
          filas.push({
            buzon_id: buzon,
            hilo_id: HILO_POR_DEFECTO[buzon],
            carpeta_id: CARPETA_DE_ENVIADOS[buzon],
            message_id: `mano-${numero}@${dominio}`,
            direccion: 'saliente',
            de_direccion: buzon === B1 ? a.direccion : b.direccion,
            destinatarios: `cliente${numero}@otras-tiendas.example`,
            asunto: 'Presentación',
            fecha: new Date(en).toISOString(),
            texto: 'x',
            creado_at: new Date(en).toISOString(),
          })
        }
      }
    }
    await m.sembrar('correo_mensajes', filas)
  }

  /* ---- la salud: el cron ha pasado cada minuto de la última hora y los buzones están sincronizados ---- */
  await m.sembrar(
    'cron_ejecuciones',
    Array.from({ length: 60 }, (_, i) => ({
      tarea: 'correo-secuencias',
      iniciado_at: new Date(final - (i + 1) * MIN + 4_000).toISOString(),
      terminado_at: new Date(final - (i + 1) * MIN + 4_300).toISOString(),
      ok: true,
      resumen: 'Sin nada que hacer',
      duracion_ms: 220 + ((i * 37) % 160),
      lanzado_por: null,
    }))
  )
  await m.actualizar('correo_buzones', { ultimo_sync_at: new Date(final - 40_000).toISOString() }, (q) => q.in('id', [B1, B2]))

  return { almacen: m.almacen, quien: QUIEN, ahora: final, dia: hoy, dias }
}

/* ------------------------------------------------------------------ */
/* Lo que se guarda un rato                                            */
/* ------------------------------------------------------------------ */

const GUARDADOS = new Map<string, { hasta: number; mundo: Promise<Demostracion> }>()
const VIDA_MS = 20 * 60_000
const MAXIMO_GUARDADOS = 12

/**
 * La demostración con el reloj `dias` días hábiles después de «hoy» (0 a DIAS_MAXIMOS_DE_LA_DEMO). El mundo se construye una vez (unos cientos de milisegundos) y se reutiliza 20 minutos: las
 * pantallas piden el tablero, la cola y el detalle por separado y todas deben ver el mismo mundo. `real` solo se pasa en las pruebas.
 */
export function demostracion(opciones: { dias?: number; real?: number } = {}): Promise<Demostracion> {
  const pedidos = Number(opciones.dias ?? 0)
  const dias = Number.isFinite(pedidos) ? Math.min(Math.max(Math.round(pedidos), 0), DIAS_MAXIMOS_DE_LA_DEMO) : 0
  const real = opciones.real ?? Date.now()
  const { dia, minutos } = momentoDeLaDemo(real)
  const clave = `${dia}|${minutos}|${dias}`
  const guardado = GUARDADOS.get(clave)
  if (guardado && guardado.hasta > real) return guardado.mundo
  const mundo = construir({ dia, minutos, dias })
  GUARDADOS.set(clave, { hasta: real + VIDA_MS, mundo })
  // Si falla no se queda guardado el fallo
  mundo.catch(() => GUARDADOS.delete(clave))
  for (const [k, v] of GUARDADOS) if (v.hasta <= real) GUARDADOS.delete(k)
  while (GUARDADOS.size > MAXIMO_GUARDADOS) GUARDADOS.delete(GUARDADOS.keys().next().value as string)
  return mundo
}

/** Para las pruebas: olvidar lo guardado */
export function olvidarDemostraciones(): void {
  GUARDADOS.clear()
}
