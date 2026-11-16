'use client'

import { useEffect, useRef } from 'react'
import { accionDeTecla, esCampoDeTexto, type AccionDeAtajo, type EventoDeTecla } from '@/lib/correo/atajos'

/**
 * LOS ATAJOS DE TECLADO DE CORREO, ENCHUFADOS A LA VENTANA.
 * =========================================================
 * Qué tecla hace qué lo decide `accionDeTecla` (lib/correo/atajos.ts, puro). Este gancho solo:
 *   - escucha `keydown` en `window`, y solo mientras `activa` (Correo es la app visible en AppsPersistentes);
 *   - mira si el foco está en un campo (input, textarea, select o contenteditable);
 *   - lleva el prefijo «g» (espera la segunda tecla 1 s);
 *   - llama al manejador de la acción y hace preventDefault SOLO si había acción y manejador (si no, la tecla hace lo suyo).
 *
 * El cuerpo del correo va en un iframe y CuerpoDeCorreo reenvía a `window` un KeyboardEvent NUEVO (sintético): su `isTrusted` es false y su
 * `target` es la ventana. Por eso aquí no se mira ninguno de los dos: el foco se saca de `document.activeElement` (con el foco en el marco es el
 * propio <iframe>, que no es un campo; si fuera un marco del mismo origen con un campo dentro, se mira también su activeElement).
 *
 * Un manejador que no se pasa es un atajo apagado: así la pantalla no pasa `responder` si quien mira no puede responder, aunque se le diga
 * `puedeResponder` (los dos filtros suman). Los manejadores se leen de una ref: cambiarlos en cada render no vuelve a enganchar el listener.
 *
 *   useAtajosDeCorreo({ activa: visible && !redactando, puedeResponder, hiloAbierto: !!hilo, manejadores: { siguiente, anterior, ayuda: () => setAyuda(true) } })
 */

export type ManejadoresDeAtajos = Partial<Record<Exclude<AccionDeAtajo, 'prefijo-g'>, () => void>>

export interface OpcionesDeAtajos {
  /** Correo es la app visible. Sin esto no hay listener */
  activa: boolean
  manejadores: ManejadoresDeAtajos
  /** Quien mira puede responder desde el buzón del hilo (por defecto true: entonces manda que haya manejador) */
  puedeResponder?: boolean
  /** Hay una conversación abierta (por defecto true: entonces manda que haya manejador) */
  hiloAbierto?: boolean
}

/** Cuánto se espera la segunda tecla tras «g» */
export const ESPERA_DE_G_MS = 1000

/** ¿El foco está en un campo donde se escribe? Mira dentro de un iframe del mismo origen si el foco está en él (sin romper si es de otro) */
export function focoEnCampo(documento: { activeElement?: unknown } | null | undefined): boolean {
  let activo: unknown = documento?.activeElement ?? null
  for (let vueltas = 0; vueltas < 3 && activo; vueltas++) {
    if (esCampoDeTexto(activo)) return true
    const e = activo as { tagName?: unknown; contentDocument?: unknown; shadowRoot?: unknown }
    let dentro: unknown = null
    try {
      if (typeof e.tagName === 'string' && e.tagName.toUpperCase() === 'IFRAME') dentro = (e.contentDocument as { activeElement?: unknown } | null)?.activeElement ?? null
      else if (e.shadowRoot) dentro = (e.shadowRoot as { activeElement?: unknown }).activeElement ?? null
    } catch {
      dentro = null
    }
    if (!dentro || dentro === activo) return false
    activo = dentro
  }
  return false
}

export interface EstadoDelGancho {
  activa: boolean
  enCampo: boolean
  gDesde: number | null
  ahora: number
  puedeResponder: boolean
  hiloAbierto: boolean
  manejadores: ManejadoresDeAtajos
}

export interface ResultadoDeTecla {
  /** Lo que hay que llamar (null si nada) */
  ejecutar: (() => void) | null
  /** Hay que hacer preventDefault */
  prevenir: boolean
  /** Cómo queda el prefijo «g» */
  gDesde: number | null
}

/** PURO: qué hacer con una tecla. Lo usa el gancho y lo comprueba useAtajosDeCorreo.prueba.ts */
export function resolverTecla(evento: EventoDeTecla, estado: EstadoDelGancho): ResultadoDeTecla {
  // El prefijo caduca a ESPERA_DE_G_MS aunque accionDeTecla admita algo más
  const gVigente = estado.gDesde != null && estado.ahora - estado.gDesde >= 0 && estado.ahora - estado.gDesde <= ESPERA_DE_G_MS ? estado.gDesde : null
  const accion = accionDeTecla(
    { key: evento.key, metaKey: evento.metaKey, ctrlKey: evento.ctrlKey, altKey: evento.altKey, shiftKey: evento.shiftKey, isComposing: evento.isComposing, enCampo: estado.enCampo },
    { activa: estado.activa, puedeResponder: estado.puedeResponder, hiloAbierto: estado.hiloAbierto, gDesde: gVigente, ahora: estado.ahora },
  )
  if (accion === 'prefijo-g') {
    // Sin ninguna carpeta a la que ir, «g» es una tecla más
    const hayDestino = !!(estado.manejadores['ir-mis-correos'] || estado.manejadores['ir-asignados'])
    return { ejecutar: null, prevenir: hayDestino, gDesde: hayDestino ? estado.ahora : null }
  }
  // Las teclas de modificador solas (⇧ para escribir «?» o «U») no anulan el prefijo ni hacen nada
  if (accion === null && ['Shift', 'Meta', 'Control', 'Alt', 'CapsLock'].includes(evento.key)) return { ejecutar: null, prevenir: false, gDesde: gVigente }
  if (accion === null) return { ejecutar: null, prevenir: false, gDesde: null }
  const manejador = estado.manejadores[accion]
  return { ejecutar: manejador ?? null, prevenir: !!manejador, gDesde: null }
}

export function useAtajosDeCorreo({ activa, manejadores, puedeResponder = true, hiloAbierto = true }: OpcionesDeAtajos): void {
  const refManejadores = useRef(manejadores)
  refManejadores.current = manejadores
  const refEstado = useRef({ puedeResponder, hiloAbierto })
  refEstado.current = { puedeResponder, hiloAbierto }

  useEffect(() => {
    if (!activa || typeof window === 'undefined') return
    let gDesde: number | null = null
    let temporizador: ReturnType<typeof setTimeout> | null = null
    const limpiarG = () => {
      gDesde = null
      if (temporizador) clearTimeout(temporizador)
      temporizador = null
    }

    const alPulsar = (e: KeyboardEvent) => {
      // Otro (un diálogo, el propio campo) ya la ha usado
      if (e.defaultPrevented) return
      const r = resolverTecla(e, {
        activa: true,
        enCampo: focoEnCampo(document),
        gDesde,
        ahora: Date.now(),
        puedeResponder: refEstado.current.puedeResponder,
        hiloAbierto: refEstado.current.hiloAbierto,
        manejadores: refManejadores.current,
      })
      if (r.gDesde !== gDesde) {
        limpiarG()
        if (r.gDesde != null) {
          gDesde = r.gDesde
          temporizador = setTimeout(limpiarG, ESPERA_DE_G_MS)
        }
      }
      if (r.prevenir) e.preventDefault()
      r.ejecutar?.()
    }

    window.addEventListener('keydown', alPulsar)
    return () => {
      window.removeEventListener('keydown', alPulsar)
      limpiarG()
    }
  }, [activa])
}
