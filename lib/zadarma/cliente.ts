'use client'

import { useSyncExternalStore } from 'react'

/**
 * EL TELÉFONO DE ZADARMA EN EL NAVEGADOR (llamadas a México) — el motor y su estado. Lo pinta components/zadarma/TelefonoZadarma.tsx, montado en el layout del
 * dashboard: así una llamada NO se corta al cambiar de app dentro del ERP.
 *
 * Se usa el MOTOR WebRTC de Zadarma (v9) sin su interfaz: `window.zdrmWebPhone = new ZadarmaWebphoneAPI()`, `init({...callbacks})` y `reg(sip)`. Tiene que llamarse
 * exactamente `window.zdrmWebPhone`: Zadarma le contesta por JSONP a ese nombre. Y no marca sin `reg` antes. Comprobado contra Zadarma el 19 nov 2026 (llamada
 * interna de la 100 a la 102: «outgoing» y «rejected»). Los avisos llegan por `getStatusMessage`: outgoing, confirmed (contestada), incoming, accepted, busy,
 * rejected, canceled, noMicrophone; y `callbackEndCall` al colgar.
 *
 * Solo se ENCIENDE cuando la comercial tiene abierta su lista de México en Cold Calling (`pedirTelefono(true)`); si cambia de lista con una llamada en curso, se apaga al colgar.
 */

const SCRIPT = 'https://my.zadarma.com/webphoneWebRTCWidget/v9/js/loader-phone-lib.js?sub_v=1'

export type FaseDelTelefono = 'apagado' | 'cargando' | 'listo' | 'error'
export type EstadoDeLlamada = 'marcando' | 'entrante' | 'conectando' | 'en_curso' | 'terminada'

export interface Llamada {
  estado: EstadoDeLlamada
  numero: string
  etiqueta: string | null
  inicio: number | null
  silenciado: boolean
  motivo: string | null
}

export interface EstadoDelTelefono {
  fase: FaseDelTelefono
  mensaje: string | null
  numero: string | null
  pedido: boolean
  llamada: Llamada | null
}

let estado: EstadoDelTelefono = { fase: 'apagado', mensaje: null, numero: null, pedido: false, llamada: null }
const oyentes = new Set<() => void>()
function poner(cambios: Partial<EstadoDelTelefono>) {
  estado = { ...estado, ...cambios }
  for (const o of oyentes) o()
}
const ponerLlamada = (cambios: Partial<Llamada> | null) => poner({ llamada: cambios === null ? null : ({ ...(estado.llamada ?? { estado: 'marcando', numero: '', etiqueta: null, inicio: null, silenciado: false, motivo: null }), ...cambios } as Llamada) })

export function useTelefonoZadarma(): EstadoDelTelefono {
  return useSyncExternalStore(
    (o) => {
      oyentes.add(o)
      return () => oyentes.delete(o)
    },
    () => estado,
    () => estado
  )
}

interface Motor {
  init: (o: Record<string, unknown>) => string
  reg: (sip: string) => void
  unreg: () => void
  call: (n: string) => unknown
  answer: () => void
  finishCall: () => void
  micSwitch: (s: 'on' | 'off') => void
  sendDTMF: (d: number) => void
  /** La llamada de JsSIP en curso (RTCSession) */
  webCallSession?: {
    mute?: (o: { audio: boolean }) => void
    unmute?: (o: { audio: boolean }) => void
    connection?: RTCPeerConnection
  } | null
}
declare global {
  interface Window {
    ZadarmaWebphoneAPI?: new () => Motor
    zdrmWebPhone?: Motor
  }
}

let scriptCargado: Promise<void> | null = null
let sip: string | null = null
let llaveEn = 0
let apagarAlColgar = false
let borrarTerminada: ReturnType<typeof setTimeout> | null = null

const llamadaViva = () => Boolean(estado.llamada && estado.llamada.estado !== 'terminada')

function cargarScript(): Promise<void> {
  if (scriptCargado) return scriptCargado
  scriptCargado = new Promise((ok, mal) => {
    const s = document.createElement('script')
    s.src = SCRIPT
    s.onload = () => ok()
    s.onerror = () => {
      scriptCargado = null
      mal(new Error('No se ha podido cargar el teléfono de Zadarma.'))
    }
    document.body.appendChild(s)
  })
  return scriptCargado
}

const esperar = async (cond: () => boolean, ms: number) => {
  const fin = Date.now() + ms
  while (!cond()) {
    if (Date.now() > fin) return false
    await new Promise((r) => setTimeout(r, 150))
  }
  return true
}

function terminar(motivo: string) {
  if (!estado.llamada) return
  if (estado.llamada.estado === 'terminada') return
  ponerLlamada({ estado: 'terminada', motivo })
  if (borrarTerminada) clearTimeout(borrarTerminada)
  borrarTerminada = setTimeout(() => {
    if (estado.llamada?.estado === 'terminada') ponerLlamada(null)
  }, 3500)
  if (apagarAlColgar) {
    apagarAlColgar = false
    if (!estado.pedido) apagarMotor()
  }
}

function alAviso(msg: string, p?: Record<string, string>) {
  switch (msg) {
    case 'outgoing':
      return ponerLlamada({ estado: 'marcando', motivo: null })
    case 'accepted':
      return ponerLlamada({ estado: 'conectando' })
    case 'confirmed':
      return ponerLlamada({ estado: 'en_curso', inicio: Date.now() })
    case 'incoming':
      if (llamadaViva()) return
      return ponerLlamada({ estado: 'entrante', numero: p?.caller ?? 'Número oculto', etiqueta: p?.callername || null, inicio: null, silenciado: false, motivo: null })
    case 'busy':
      return terminar('Comunica')
    case 'rejected':
      return terminar(estado.llamada?.estado === 'en_curso' ? 'Llamada terminada' : 'No contesta o ha rechazado la llamada')
    case 'canceled':
      return terminar(estado.llamada?.estado === 'entrante' ? 'Llamada perdida' : 'Llamada cancelada')
    case 'noMicrophone':
      return terminar('Sin micrófono: da permiso al navegador para usarlo')
    default:
  }
}

async function encenderMotor() {
  poner({ fase: 'cargando', mensaje: null })
  const r = await fetch('/api/zadarma/llave', { cache: 'no-store' })
  if (r.status === 404) return poner({ fase: 'apagado' })
  const j = (await r.json().catch(() => ({}))) as { key?: string; sip?: string; numero?: string | null; error?: string }
  if (!r.ok || !j.key || !j.sip) throw new Error(j.error ?? 'No se ha podido preparar el teléfono.')
  await cargarScript()
  if (!(await esperar(() => typeof window.ZadarmaWebphoneAPI === 'function', 20_000))) throw new Error('El teléfono de Zadarma no ha arrancado.')
  if (!window.zdrmWebPhone || Date.now() - llaveEn > 24 * 3_600_000 || sip !== j.sip) {
    window.zdrmWebPhone = new window.ZadarmaWebphoneAPI!()
    let errorDeSips: string | null = null
    window.zdrmWebPhone.init({
      type: 'site',
      key: j.key,
      sip: j.sip,
      language: 'es',
      getStatusMessage: (m: string, p?: Record<string, string>) => alAviso(m, p),
      getSipsCallback: (_s: unknown, codigo?: string, texto?: string) => {
        if (codigo) errorDeSips = texto || codigo
      },
      callbackGetPrice: () => {},
      callbackEndCall: () => terminar('Llamada terminada'),
    })
    llaveEn = Date.now()
    await new Promise((res) => setTimeout(res, 1500))
    if (errorDeSips) throw new Error(`Zadarma: ${errorDeSips}`)
  }
  sip = j.sip
  window.zdrmWebPhone.reg(j.sip)
  poner({ fase: 'listo', numero: j.numero ?? null, mensaje: null })
}

function apagarMotor() {
  try {
    window.zdrmWebPhone?.unreg()
  } catch {}
  poner({ fase: 'apagado' })
}

/** Cold Calling pide el teléfono cuando se abre una lista de México y lo suelta al salir de ella */
export function pedirTelefono(si: boolean) {
  if (si === estado.pedido) return
  poner({ pedido: si })
  if (si) {
    apagarAlColgar = false
    if (estado.fase === 'apagado' || estado.fase === 'error') encenderMotor().catch((e) => poner({ fase: 'error', mensaje: e instanceof Error ? e.message : 'No se ha podido preparar el teléfono.' }))
  } else if (estado.fase === 'listo' || estado.fase === 'cargando') {
    // Con una llamada en marcha no se corta nada: se apaga al colgar
    if (llamadaViva()) apagarAlColgar = true
    else apagarMotor()
  }
}

export const reintentarTelefono = () => {
  if (estado.pedido) encenderMotor().catch((e) => poner({ fase: 'error', mensaje: e instanceof Error ? e.message : 'No se ha podido preparar el teléfono.' }))
}

/** Llama a un número internacional («+52…»). Devuelve por qué no, o null si ha empezado */
export function llamarConZadarma(numero: string, etiqueta: string | null = null): string | null {
  if (estado.fase !== 'listo' || !window.zdrmWebPhone) return 'El teléfono de México no está listo.'
  if (llamadaViva()) return 'Ya hay una llamada en curso.'
  const limpio = numero.replace(/[^\d+]/g, '')
  if (limpio.replace(/\D/g, '').length < 3) return 'Ese número no es válido.'
  ponerLlamada({ estado: 'marcando', numero: limpio, etiqueta, inicio: null, silenciado: false, motivo: null })
  try {
    window.zdrmWebPhone.call(limpio)
    return null
  } catch {
    ponerLlamada(null)
    return 'No se ha podido llamar.'
  }
}

export function colgar() {
  try {
    window.zdrmWebPhone?.finishCall()
  } catch {}
  terminar(estado.llamada?.estado === 'entrante' ? 'Llamada rechazada' : 'Llamada terminada')
}

export function contestar() {
  try {
    window.zdrmWebPhone?.answer()
    ponerLlamada({ estado: 'conectando' })
  } catch {}
}

/**
 * Silenciar el micrófono. El `micSwitch` de Zadarma NO funciona (llama a `connection.mute`, que una RTCPeerConnection no tiene): se hace aquí con la sesión de
 * JsSIP (`mute`/`unmute`) y, además, apagando la pista de audio que sale, que es lo que de verdad deja de mandar sonido.
 */
export function silenciar(si: boolean) {
  const sesion = window.zdrmWebPhone?.webCallSession
  let hecho = false
  try {
    if (si) sesion?.mute?.({ audio: true })
    else sesion?.unmute?.({ audio: true })
    hecho = Boolean(sesion?.mute)
  } catch {}
  try {
    for (const emisor of sesion?.connection?.getSenders() ?? []) {
      if (emisor.track && emisor.track.kind === 'audio') {
        emisor.track.enabled = !si
        hecho = true
      }
    }
  } catch {}
  if (hecho) ponerLlamada({ silenciado: si })
}

export function tecla(d: number) {
  try {
    window.zdrmWebPhone?.sendDTMF(d)
  } catch {}
}
