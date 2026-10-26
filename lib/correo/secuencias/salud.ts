import { diaCorto, diaDeMadrid, diasHabilesEntre, esDia, horaDeMadrid } from './fechas'
import { topeDeLaRampa, type AjustesDelMotor } from './reglas'

/**
 * LA SALUD DE LOS SEGUIMIENTOS Y DE LOS BUZONES — PURO.
 * =====================================================
 * No toca la base ni la red. Se comprueba con salud.prueba.ts.
 *
 * Convierte lo que se mide (conexión de cada buzón, rebotes, pasadas del motor, cola) en lo que enseña la pestaña «Salud» y en una lista de ALARMAS:
 * cosas que están mal o que pronto lo estarán, cada una con su frase y qué hacer. Lo mira la pantalla (quien está delante) y lo mira el vigía
 * (lib/correo/secuencias/vigia.ts), que avisa por la campana a los administradores —y al dueño del buzón— de lo que de verdad hay que atender.
 *
 *   · ROJA = algo no funciona y hay que atenderlo (un buzón sin conexión, el motor parado, envíos fallidos, rebotes por encima del límite).
 *   · ÁMBAR = algo a lo que estar atento (un buzón en pausa, rebotes subiendo, correos atrasados, lecturas de la IA sin hacer).
 *
 * Solo algunas alarmas llegan a la campana (`avisar`): lo que no es un fallo, como una pausa a propósito, se ve en la pantalla y nada más.
 */

/* ------------------------------------------------------------------ */
/* Umbrales                                                            */
/* ------------------------------------------------------------------ */

/** Con el motor encendido, más de esto sin una pasada lo da por parado. Un despliegue tarda unos 5 minutos: con menos, saltaría en cada uno */
export const MINUTOS_SIN_PASADA_PARA_DAR_POR_PARADO = 10
/** Un buzón al que no se le lee el correo desde hace más de esto no se está sincronizando */
export const MINUTOS_SIN_SINCRONIZAR = 30
/** Fallos seguidos de conexión (que no son la contraseña) a partir de los que se avisa; con el doble, es rojo */
export const FALLOS_SEGUIDOS_PARA_AVISAR = 3
/** Un seguimiento al que se le pasó su hora hace más de esto está atrasado */
export const MINUTOS_DE_RETRASO_EN_LA_COLA = 30
export const CORREOS_ATRASADOS_PARA_AVISAR = 5
/** Pasadas que acaban mal en la última hora a partir de las que se avisa */
export const PASADAS_FALLIDAS_PARA_AVISAR = 5

/* ------------------------------------------------------------------ */
/* Tipos                                                               */
/* ------------------------------------------------------------------ */

export type NivelDeSalud = 'ok' | 'atencion' | 'problema'

export type CodigoDeAlarma =
  | 'motor_parado'
  | 'motor_con_errores'
  | 'contrasena'
  | 'sin_conectar'
  | 'fallando'
  | 'sin_sincronizar'
  | 'rebotes_altos'
  | 'rebotes_subiendo'
  | 'en_pausa'
  | 'cola_atrasada'
  | 'envios_fallidos'
  | 'ia_sin_leer'

export interface Alarma {
  /** Estable entre una mirada y la siguiente: es lo que impide avisar dos veces de lo mismo */
  clave: string
  codigo: CodigoDeAlarma
  gravedad: 'roja' | 'ambar'
  /** Una frase corta, sin cifras que cambien (también es el título del aviso de la campana: dos avisos con el mismo título no se repiten) */
  titulo: string
  /** Qué pasa y qué hacer, con las cifras */
  detalle: string
  buzonId: string | null
  /** El dueño del buzón, si el problema es de su buzón: él también tiene que enterarse */
  duenoId: string | null
  /** ¿Va a la campana? Lo que no es un fallo (una pausa, rebotes subiendo…) se queda en la pantalla */
  avisar: boolean
  /** Lo mismo dicho a la persona dueña del buzón («Tu buzón no se puede conectar»), si el problema es de un buzón que no es de quien mira */
  paraElDueno?: { titulo: string; detalle: string }
}

export interface BuzonParaLaSalud {
  id: string
  direccion: string
  propietario: { id: string; nombre: string }
  esMio: boolean
  participa: boolean
  conectado: boolean
  credencialesInvalidas: boolean
  ultimoSyncAt: number | null
  pausadoHasta: number | null
  motivoPausa: string | null
  topeDiario: number | null
  rampaInicio: string | null
  /** Lo de hoy: lo trae la pantalla; el vigía no lo necesita */
  hoy: { tope: number; enviados: number; manual: number; automaticos: number; programados: number } | null
  vivas: number
}

export interface ConexionDeBuzon {
  ultimoError: string | null
  fallosSeguidos: number
  ultimoIntentoAt: number | null
}

export interface VentanaDeRebotes {
  enviados: number
  rebotes: number
}

export interface EntradaDeSalud {
  ahora: number
  ajustes: Pick<AjustesDelMotor, 'activa' | 'modoEnsayo' | 'frenoRebotesPct' | 'frenoMinimoEnvios' | 'festivos' | 'rampa'>
  buzones: readonly BuzonParaLaSalud[]
  conexion: ReadonlyMap<string, ConexionDeBuzon>
  rebotes24h: ReadonlyMap<string, VentanaDeRebotes>
  rebotes7d: ReadonlyMap<string, VentanaDeRebotes>
  /** null = no se ha podido leer el registro de procesos (migración 137): no se puede saber si el motor corre */
  pasadas: { ultima: { en: number; ok: boolean | null; error: string | null; duracionMs: number | null } | null; enLaUltimaHora: number; fallosEnLaUltimaHora: number; ultimoErrorDeLaHora?: string | null } | null
  cola: { atrasados: number; fallidos: number; iaFallidas: number; iaPendientes: number; ultimoEnvioAt: number | null }
  /** Si se enseña (y se vigila) lo del motor: solo para quien administra */
  conMotor: boolean
}

export interface SaludDelBuzon {
  buzonId: string
  direccion: string
  propietario: string
  esMio: boolean
  conexion: { estado: 'ok' | 'sin_conectar' | 'contrasena' | 'fallando' | 'sin_sincronizar'; texto: string; ultimoSyncAt: number | null; ultimoError: string | null; fallosSeguidos: number }
  hoy: BuzonParaLaSalud['hoy']
  rampa: { fija: boolean; diaHabil: number | null; tope: number }
  rebotes24h: { enviados: number; rebotes: number; pct: number | null }
  rebotes7d: { enviados: number; rebotes: number; pct: number | null }
  limiteDeRebotesPct: number
  /** Con menos envíos que estos en 24 h no se mide el porcentaje de rebotes (un rebote suelto no es una tasa) */
  minimoDeEnvios: number
  participa: boolean
  pausa: { hasta: number; motivo: string | null } | null
  vivas: number
  nivel: NivelDeSalud
}

export interface SaludDelMotor {
  modo: 'apagado' | 'ensayo' | 'real'
  ultimaPasada: { en: number; ok: boolean | null; error: string | null; duracionMs: number | null } | null
  parado: boolean
  pasadasEnLaUltimaHora: number
  fallosEnLaUltimaHora: number
  atrasados: number
  fallidos: number
  iaFallidas: number
  iaPendientes: number
  ultimoEnvioAt: number | null
  /** false = no se puede leer el registro de procesos (falta la migración 137): lo de la última pasada no se sabe */
  registroDisponible: boolean
}

export interface SaludDeSecuencias {
  ahora: number
  nivel: NivelDeSalud
  resumen: string
  alarmas: Alarma[]
  buzones: SaludDelBuzon[]
  motor: SaludDelMotor | null
}

/* ------------------------------------------------------------------ */
/* Cómo se dicen las cosas                                             */
/* ------------------------------------------------------------------ */

/** «6,5 %», «12 %»: con coma y un decimal solo si hace falta */
export function porcentajeTexto(n: number): string {
  const redondo = Math.round(n * 10) / 10
  return `${Number.isInteger(redondo) ? redondo : redondo.toFixed(1).replace('.', ',')} %`
}

/**
 * De qué color se pinta un porcentaje de rebotes en la pantalla de Salud: 'roja' solo si, con la confianza habitual (95 %), la tasa real se pasa del límite; 'ambar' si lo que se
 * ve se acerca o hasta lo pasa pero con tan pocos envíos que podría ser casualidad; null si no hay nada que mirar. Un rebote en 23 correos (4,3 %) no es lo mismo que diez en 40
 * (25 %), y pintarlos igual enseña un problema donde puede no haberlo. Solo colorea, no decide nada: el freno del motor y las alarmas siguen la regla de siempre (más del límite con
 * un mínimo de envíos).
 */
export function gravedadDeRebotes(v: { enviados: number; rebotes: number; pct: number | null }, limitePct: number, minimoDeEnvios: number): 'roja' | 'ambar' | null {
  if (v.pct === null || v.enviados < minimoDeEnvios || v.enviados <= 0) return null
  // El intervalo de Wilson al 95 % de la proporción de rebotes, en porcentaje
  const z = 1.96
  const p = Math.min(Math.max(v.rebotes / v.enviados, 0), 1)
  const denominador = 1 + (z * z) / v.enviados
  const centro = (p + (z * z) / (2 * v.enviados)) / denominador
  const margen = (z * Math.sqrt((p * (1 - p)) / v.enviados + (z * z) / (4 * v.enviados * v.enviados))) / denominador
  const cotaBaja = Math.max(0, centro - margen) * 100
  if (cotaBaja >= limitePct) return 'roja'
  return v.pct >= limitePct / 2 ? 'ambar' : null
}

/** «4 min», «1 h 5 min», «2 días» */
export function duracionTexto(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000))
  if (min < 1) return 'menos de un minuto'
  if (min < 60) return `${min} min`
  if (min < 24 * 60) {
    const h = Math.floor(min / 60)
    const m = min % 60
    return m === 0 ? `${h} h` : `${h} h ${m} min`
  }
  const d = Math.round(min / (24 * 60))
  return `${d} ${d === 1 ? 'día' : 'días'}`
}

/** «hoy 10:00», «mié 4 nov 10:00» */
function instanteTexto(instante: number, ahora: number): string {
  const dia = diaDeMadrid(instante)
  return `${dia === diaDeMadrid(ahora) ? 'hoy' : diaCorto(dia)} ${horaDeMadrid(instante)}`
}

const recortar = (texto: string | null, max = 140): string => {
  const limpio = (texto ?? '').replace(/\s+/g, ' ').trim()
  return limpio.length > max ? `${limpio.slice(0, max - 1).trimEnd()}…` : limpio
}

const pct = (v: VentanaDeRebotes | undefined): number | null => (v && v.enviados > 0 ? (v.rebotes / v.enviados) * 100 : null)

/* ------------------------------------------------------------------ */
/* Las alarmas                                                         */
/* ------------------------------------------------------------------ */

/** Las alarmas de un buzón, dichas a quien lo mira y, aparte, a su dueño (que es quien lo tiene que arreglar casi siempre) */
function alarmasDelBuzon(b: BuzonParaLaSalud, e: EntradaDeSalud): Alarma[] {
  const suyas = alarmasDelBuzonComo(b, e)
  if (b.esMio) return suyas
  const alDueno = alarmasDelBuzonComo({ ...b, esMio: true }, e)
  return suyas.map((a, i) => ({ ...a, paraElDueno: { titulo: alDueno[i].titulo, detalle: alDueno[i].detalle } }))
}

function alarmasDelBuzonComo(b: BuzonParaLaSalud, e: EntradaDeSalud): Alarma[] {
  const salida: Alarma[] = []
  const quien = b.esMio ? 'Tu buzón' : `El buzón de ${b.propietario.nombre}`
  const duenoId = b.propietario.id
  const base = { buzonId: b.id, duenoId }
  const c = e.conexion.get(b.id)
  const fallos = c?.fallosSeguidos ?? 0

  if (b.credencialesInvalidas) {
    salida.push({
      ...base,
      clave: `contrasena:${b.id}`,
      codigo: 'contrasena',
      gravedad: b.participa ? 'roja' : 'ambar',
      titulo: `${quien} no se puede conectar`,
      detalle: `La contraseña ya no vale: no envía ni recibe correo. ${b.esMio ? 'Ponla' : `${b.propietario.nombre} tiene que ponerla`} de nuevo en Correo.`,
      avisar: b.participa,
    })
  } else if (!b.conectado) {
    salida.push({ ...base, clave: `sin_conectar:${b.id}`, codigo: 'sin_conectar', gravedad: 'ambar', titulo: `${quien} no está conectado`, detalle: 'No tiene la contraseña guardada: no envía ni recibe correo.', avisar: false })
  } else if (fallos >= FALLOS_SEGUIDOS_PARA_AVISAR) {
    const roja = fallos >= FALLOS_SEGUIDOS_PARA_AVISAR * 2
    salida.push({
      ...base,
      clave: `fallando:${b.id}`,
      codigo: 'fallando',
      gravedad: roja ? 'roja' : 'ambar',
      titulo: `${quien} no consigue conectar`,
      detalle: `Lleva ${fallos} fallos seguidos al leer su correo${c?.ultimoError ? ` (${recortar(c.ultimoError, 100)})` : ''}. Se reintenta cada vez más tarde.`,
      avisar: roja && b.participa,
    })
  } else if (c && (c.ultimoIntentoAt !== null || b.ultimoSyncAt !== null)) {
    // Conectado y sin fallos, pero no se le lee el correo: el proceso que lo lee no está llegando a este buzón
    const ultima = b.ultimoSyncAt
    if (ultima === null || e.ahora - ultima > MINUTOS_SIN_SINCRONIZAR * 60_000) {
      salida.push({
        ...base,
        clave: `sin_sincronizar:${b.id}`,
        codigo: 'sin_sincronizar',
        gravedad: 'ambar',
        titulo: `${quien} no se sincroniza`,
        detalle: ultima === null ? 'Todavía no se ha leído nunca su correo.' : `Hace ${duracionTexto(e.ahora - ultima)} que no se lee su correo.`,
        avisar: false,
      })
    }
  }

  // Rebotes en 24 h: el límite es el del freno del motor
  const v = e.rebotes24h.get(b.id)
  const p = pct(v)
  if (v && p !== null && v.enviados >= e.ajustes.frenoMinimoEnvios) {
    const limite = e.ajustes.frenoRebotesPct
    const pausado = b.pausadoHasta !== null && b.pausadoHasta > e.ahora
    // Una pausa que ya ha terminado (hace menos de un día): los rebotes de las últimas 24 h son los que la provocaron, y el freno cuenta de nuevo
    // desde que acabó. No es una alarma roja: si sigue rebotando, el motor lo vuelve a pausar solo
    const pausaYaTerminada = b.pausadoHasta !== null && b.pausadoHasta <= e.ahora && e.ahora - b.pausadoHasta < 24 * 3_600_000
    if (p >= limite) {
      salida.push({
        ...base,
        clave: `rebotes_altos:${b.id}`,
        codigo: 'rebotes_altos',
        gravedad: pausaYaTerminada ? 'ambar' : 'roja',
        titulo: `${quien} rebota demasiado`,
        detalle: `${v.rebotes} rebotes en ${v.enviados} correos en 24 h (${porcentajeTexto(p)}; el límite es ${porcentajeTexto(limite)}). ${pausado ? 'El motor lo ha pausado.' : pausaYaTerminada ? 'La pausa ya ha terminado: si sigue rebotando, el motor lo volverá a pausar.' : 'El motor lo pausará.'} Suele ser una lista con direcciones malas.`,
        avisar: !pausaYaTerminada,
      })
    } else if (p >= limite / 2) {
      salida.push({
        ...base,
        clave: `rebotes_subiendo:${b.id}`,
        codigo: 'rebotes_subiendo',
        gravedad: 'ambar',
        titulo: `${quien} empieza a rebotar`,
        detalle: `${v.rebotes} rebotes en ${v.enviados} correos en 24 h (${porcentajeTexto(p)}). A partir del ${porcentajeTexto(limite)} el motor lo pausa.`,
        avisar: false,
      })
    }
  }

  if (b.pausadoHasta !== null && b.pausadoHasta > e.ahora) {
    salida.push({
      ...base,
      clave: `en_pausa:${b.id}`,
      codigo: 'en_pausa',
      gravedad: 'ambar',
      titulo: `${quien} está en pausa`,
      detalle: `Hasta ${instanteTexto(b.pausadoHasta, e.ahora)}${b.motivoPausa ? `: ${recortar(b.motivoPausa, 160)}` : '.'}`,
      avisar: false,
    })
  }
  return salida
}

function alarmasDelMotor(e: EntradaDeSalud): Alarma[] {
  const salida: Alarma[] = []
  const base = { buzonId: null, duenoId: null }
  const { activa, modoEnsayo } = e.ajustes
  const real = activa && !modoEnsayo

  if (activa && e.pasadas) {
    const ultima = e.pasadas.ultima
    const sinPasar = ultima ? e.ahora - ultima.en : null
    if (sinPasar === null || sinPasar > MINUTOS_SIN_PASADA_PARA_DAR_POR_PARADO * 60_000) {
      salida.push({
        ...base,
        clave: 'motor_parado',
        codigo: 'motor_parado',
        gravedad: 'roja',
        titulo: 'El motor de seguimientos se ha parado',
        detalle: `${sinPasar === null ? 'No hay ninguna pasada registrada' : `Lleva ${duracionTexto(sinPasar)} sin ejecutarse`} (lo normal es una cada minuto): no se vigilan las respuestas ni sale ningún seguimiento. Mira Sistema → «Seguimientos de correo».`,
        avisar: true,
      })
    } else if (e.pasadas.fallosEnLaUltimaHora >= PASADAS_FALLIDAS_PARA_AVISAR) {
      const roja = e.pasadas.fallosEnLaUltimaHora >= Math.max(PASADAS_FALLIDAS_PARA_AVISAR, e.pasadas.enLaUltimaHora / 2)
      salida.push({
        ...base,
        clave: 'motor_con_errores',
        codigo: 'motor_con_errores',
        gravedad: roja ? 'roja' : 'ambar',
        titulo: 'El motor de seguimientos está fallando',
        detalle: `${e.pasadas.fallosEnLaUltimaHora} de las últimas ${e.pasadas.enLaUltimaHora} pasadas han acabado mal${e.pasadas.ultimoErrorDeLaHora ?? ultima?.error ? `. Último error: ${recortar(e.pasadas.ultimoErrorDeLaHora ?? ultima?.error ?? null, 140)}` : '.'} Mira Sistema → «Seguimientos de correo».`,
        avisar: roja,
      })
    }
  }

  if (real && e.cola.atrasados >= CORREOS_ATRASADOS_PARA_AVISAR) {
    salida.push({
      ...base,
      clave: 'cola_atrasada',
      codigo: 'cola_atrasada',
      gravedad: 'ambar',
      titulo: 'Hay seguimientos atrasados',
      detalle: `${e.cola.atrasados} seguimientos llevan más de ${MINUTOS_DE_RETRASO_EN_LA_COLA} min de retraso sobre su hora. Suele ser que un buzón ha llegado a su tope del día o que está en pausa.`,
      avisar: false,
    })
  }

  if (e.cola.fallidos > 0) {
    salida.push({
      ...base,
      clave: 'envios_fallidos',
      codigo: 'envios_fallidos',
      gravedad: 'roja',
      titulo: 'Hay seguimientos que no han podido salir',
      detalle: `${e.cola.fallidos} ${e.cola.fallidos === 1 ? 'envío ha fallado' : 'envíos han fallado'}: están en la Cola marcados con error, para reintentarlos o saltarlos.`,
      avisar: true,
    })
  }

  if (e.cola.iaFallidas > 0) {
    salida.push({
      ...base,
      clave: 'ia_sin_leer',
      codigo: 'ia_sin_leer',
      gravedad: 'ambar',
      titulo: 'La IA no ha podido leer respuestas de leads',
      detalle: `${e.cola.iaFallidas} ${e.cola.iaFallidas === 1 ? 'respuesta se ha quedado' : 'respuestas se han quedado'} sin leer tras varios intentos: las tiene que mirar una persona.`,
      avisar: false,
    })
  }
  return salida
}

/** Las alarmas de lo medido. Primero las rojas, y dentro de cada gravedad, en el orden en que se han encontrado */
export function alarmasDe(e: EntradaDeSalud): Alarma[] {
  const todas = [...(e.conMotor ? alarmasDelMotor(e) : []), ...e.buzones.flatMap((b) => alarmasDelBuzon(b, e))]
  return [...todas.filter((a) => a.gravedad === 'roja'), ...todas.filter((a) => a.gravedad === 'ambar')]
}

/* ------------------------------------------------------------------ */
/* La pantalla                                                         */
/* ------------------------------------------------------------------ */

const nivelDe = (alarmas: readonly Alarma[]): NivelDeSalud => (alarmas.some((a) => a.gravedad === 'roja') ? 'problema' : alarmas.length > 0 ? 'atencion' : 'ok')

function textoDeConexion(estado: SaludDelBuzon['conexion']['estado'], b: BuzonParaLaSalud, ahora: number): string {
  switch (estado) {
    case 'contrasena':
      return 'Contraseña rechazada'
    case 'sin_conectar':
      return 'Sin conectar'
    case 'fallando':
      return 'Fallando al conectar'
    case 'sin_sincronizar':
      return b.ultimoSyncAt === null ? 'Sin leer todavía' : `Sin leer desde hace ${duracionTexto(ahora - b.ultimoSyncAt)}`
    default:
      return b.ultimoSyncAt === null ? 'Conectado' : `Conectado · leído hace ${duracionTexto(ahora - b.ultimoSyncAt)}`
  }
}

export function armarSalud(e: EntradaDeSalud): SaludDeSecuencias {
  const alarmas = alarmasDe(e)
  const hoy = diaDeMadrid(e.ahora)

  const buzones: SaludDelBuzon[] = e.buzones.map((b) => {
    const suyas = alarmas.filter((a) => a.buzonId === b.id)
    const c = e.conexion.get(b.id)
    const estado: SaludDelBuzon['conexion']['estado'] = suyas.some((a) => a.codigo === 'contrasena')
      ? 'contrasena'
      : suyas.some((a) => a.codigo === 'sin_conectar')
        ? 'sin_conectar'
        : suyas.some((a) => a.codigo === 'fallando')
          ? 'fallando'
          : suyas.some((a) => a.codigo === 'sin_sincronizar')
            ? 'sin_sincronizar'
            : 'ok'
    const fija = b.topeDiario !== null && b.topeDiario > 0
    const inicio = b.rampaInicio && esDia(b.rampaInicio) ? b.rampaInicio : hoy
    const diaHabil = fija ? null : inicio >= hoy ? 1 : diasHabilesEntre(inicio, hoy, e.ajustes.festivos) + 1
    const v24 = e.rebotes24h.get(b.id)
    const v7 = e.rebotes7d.get(b.id)
    return {
      buzonId: b.id,
      direccion: b.direccion,
      propietario: b.propietario.nombre,
      esMio: b.esMio,
      conexion: { estado, texto: textoDeConexion(estado, b, e.ahora), ultimoSyncAt: b.ultimoSyncAt, ultimoError: c?.ultimoError ?? null, fallosSeguidos: c?.fallosSeguidos ?? 0 },
      hoy: b.hoy,
      rampa: { fija, diaHabil, tope: fija ? (b.topeDiario as number) : topeDeLaRampa(e.ajustes.rampa, diaHabil ?? 1) },
      rebotes24h: { enviados: v24?.enviados ?? 0, rebotes: v24?.rebotes ?? 0, pct: pct(v24) },
      rebotes7d: { enviados: v7?.enviados ?? 0, rebotes: v7?.rebotes ?? 0, pct: pct(v7) },
      limiteDeRebotesPct: e.ajustes.frenoRebotesPct,
      minimoDeEnvios: e.ajustes.frenoMinimoEnvios,
      participa: b.participa,
      pausa: b.pausadoHasta !== null && b.pausadoHasta > e.ahora ? { hasta: b.pausadoHasta, motivo: b.motivoPausa } : null,
      vivas: b.vivas,
      nivel: nivelDe(suyas),
    }
  })
  // Lo que tiene problemas, primero; a igualdad, por nombre
  const orden: Record<NivelDeSalud, number> = { problema: 0, atencion: 1, ok: 2 }
  buzones.sort((a, b) => orden[a.nivel] - orden[b.nivel] || a.propietario.localeCompare(b.propietario, 'es'))

  const motor: SaludDelMotor | null = e.conMotor
    ? {
        modo: !e.ajustes.activa ? 'apagado' : e.ajustes.modoEnsayo ? 'ensayo' : 'real',
        ultimaPasada: e.pasadas?.ultima ?? null,
        parado: alarmas.some((a) => a.codigo === 'motor_parado'),
        pasadasEnLaUltimaHora: e.pasadas?.enLaUltimaHora ?? 0,
        fallosEnLaUltimaHora: e.pasadas?.fallosEnLaUltimaHora ?? 0,
        atrasados: e.cola.atrasados,
        fallidos: e.cola.fallidos,
        iaFallidas: e.cola.iaFallidas,
        iaPendientes: e.cola.iaPendientes,
        ultimoEnvioAt: e.cola.ultimoEnvioAt,
        registroDisponible: e.pasadas !== null,
      }
    : null

  const nivel = nivelDe(alarmas)
  const rojas = alarmas.filter((a) => a.gravedad === 'roja').length
  const resumen =
    nivel === 'ok'
      ? 'Todo en orden'
      : nivel === 'problema'
        ? `${rojas} ${rojas === 1 ? 'cosa que atender' : 'cosas que atender'}${alarmas.length > rojas ? ` y ${alarmas.length - rojas} a las que estar atento` : ''}`
        : `${alarmas.length} ${alarmas.length === 1 ? 'cosa a la que estar atento' : 'cosas a las que estar atento'}`
  return { ahora: e.ahora, nivel, resumen, alarmas, buzones, motor }
}
