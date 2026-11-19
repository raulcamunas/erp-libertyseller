'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { FilaDiaria } from '@/lib/ads/rendimiento-calculo'
import type { VentaDeAsin } from '@/lib/ads/ventas-totales'
import { llamar } from './llamar'
import { consultaDePeriodo, type Periodo } from './piezas'

export interface CampanaViva {
  campaignId: string
  nombre: string
  estado: 'ENABLED' | 'PAUSED' | 'ARCHIVED'
  segmentacion: 'AUTO' | 'MANUAL' | null
  presupuesto: number | null
  estrategiaPuja: string | null
  topDeBusquedas: number | null
}

export interface Informe {
  actual: FilaDiaria[]
  anterior: FilaDiaria[]
  periodos: { actual: { desde: string; hasta: string }; anterior: { desde: string; hasta: string } }
  /** Hay una lectura nueva en marcha: lo que se ve es lo guardado, y se refrescará solo */
  sincronizando: boolean
  /** El último error de la lectura automática, si lo hubo (los datos que se ven son los de antes) */
  aviso: string | null
  datosHasta: string | null
  /** Las ventas TOTALES de cada ASIN en el mismo periodo (de la cuenta de vendedor), para el TACoS. Vacío si aún no se han leído */
  ventasTotales: { porAsin: Record<string, VentaDeAsin>; leidoAt: string | null; error: string | null }
  /** El día más antiguo guardado: hasta ahí se puede elegir un periodo a mano */
  primerDia: string | null
}

export type Carga<T> = { fase: 'cargando'; nota?: string } | { fase: 'listo'; datos: T; en: number } | { fase: 'error'; mensaje: string }

interface Guardado {
  hayDatos: boolean
  sincronizando: boolean
  actualizadoAt: string | null
  datosHasta: string | null
  error: string | null
  periodos: Informe['periodos']
  actual: FilaDiaria[]
  anterior: FilaDiaria[]
  ventasTotales?: Informe['ventasTotales']
  primerDia?: string | null
}

/** Las campañas en vivo, por cuenta: cambiar de pestaña no vuelve a pedirlas (15 min). El rendimiento NO se guarda aquí: viene de la base y es instantáneo */
const CACHE_CAMPANAS = new Map<string, { datos: CampanaViva[]; en: number }>()
const VIGENCIA_MS = 15 * 60_000
const ESPERA_ENTRE_PREGUNTAS_MS = 6000
const ESPERA_CON_DATOS_MS = 30_000
const MAX_PREGUNTAS = 90 // ≈ 9 minutos: la primera lectura de una cuenta trae 60 días y Amazon puede tardar

/**
 * El rendimiento de una cuenta: sus campañas (en vivo) y las cifras diarias guardadas por el proceso automático. Las dos cargas son independientes: si las cifras fallan, las campañas se ven igual.
 *
 * Lo guardado se enseña AL INSTANTE. Si hay una lectura en marcha (o es la primera vez que se abre esta cuenta, y todavía no hay nada guardado), se sigue preguntando cada pocos segundos y la pantalla se
 * actualiza sola cuando Amazon termina.
 */
export function useRendimiento(perfilId: string, periodo: Periodo) {
  const consulta = consultaDePeriodo(periodo)
  const [campanas, setCampanas] = useState<Carga<CampanaViva[]>>(() => {
    const c = CACHE_CAMPANAS.get(perfilId)
    return c && Date.now() - c.en < VIGENCIA_MS ? { fase: 'listo', datos: c.datos, en: c.en } : { fase: 'cargando' }
  })
  const [informe, setInforme] = useState<Carga<Informe>>({ fase: 'cargando', nota: 'Leyendo los datos guardados…' })
  const generacion = useRef(0)

  const cargar = useCallback(
    async (forzar: boolean) => {
      const mia = ++generacion.current
      const vigente = () => generacion.current === mia

      // ---- campañas (en vivo) ----
      const cc = CACHE_CAMPANAS.get(perfilId)
      if (!forzar && cc && Date.now() - cc.en < VIGENCIA_MS) setCampanas({ fase: 'listo', datos: cc.datos, en: cc.en })
      else {
        setCampanas({ fase: 'cargando' })
        llamar<{ campanas: CampanaViva[] }>(`/api/ads/cuenta/campanas?perfilId=${perfilId}`)
          .then((r) => {
            const en = Date.now()
            CACHE_CAMPANAS.set(perfilId, { datos: r.campanas, en })
            if (vigente()) setCampanas({ fase: 'listo', datos: r.campanas, en })
          })
          .catch((e) => vigente() && setCampanas({ fase: 'error', mensaje: e instanceof Error ? e.message : 'No se han podido leer las campañas.' }))
      }

      // ---- cifras (guardadas en la base; las rellena el proceso automático) ----
      try {
        if (forzar) await llamar('/api/ads/cuenta/rendimiento', { metodo: 'POST', cuerpo: { perfilId, accion: 'actualizar' } })
        for (let i = 0; i < MAX_PREGUNTAS; i++) {
          if (!vigente()) return
          const g = await llamar<Guardado>(`/api/ads/cuenta/rendimiento?perfilId=${perfilId}&${consulta}`)
          if (!vigente()) return
          if (g.hayDatos) {
            setInforme({
              fase: 'listo',
              datos: { actual: g.actual, anterior: g.anterior, periodos: g.periodos, sincronizando: g.sincronizando, aviso: g.error, datosHasta: g.datosHasta, ventasTotales: g.ventasTotales ?? { porAsin: {}, leidoAt: null, error: null }, primerDia: g.primerDia ?? null },
              en: g.actualizadoAt ? Date.parse(g.actualizadoAt) : Date.now(),
            })
          } else if (!g.sincronizando && g.error) {
            setInforme({ fase: 'error', mensaje: g.error })
            return
          } else {
            setInforme({ fase: 'cargando', nota: i < 2 ? 'Primera lectura de esta cuenta: Amazon está preparando los últimos 60 días…' : 'Amazon sigue preparando el informe (la primera vez puede tardar unos minutos; las siguientes se abren al instante)…' })
          }
          if (!g.sincronizando && g.hayDatos) return
          // Con cifras ya en pantalla no hay prisa: se mira cada 30 s (antes, cada 6 s durante 9 minutos); solo la primera lectura de una cuenta pregunta a menudo
          await new Promise((res) => setTimeout(res, g.hayDatos ? ESPERA_CON_DATOS_MS : ESPERA_ENTRE_PREGUNTAS_MS))
        }
        if (vigente()) setInforme((prev) => (prev.fase === 'listo' ? prev : { fase: 'error', mensaje: 'Amazon tarda más de lo normal en preparar el informe. Se seguirá leyendo en segundo plano: vuelve en unos minutos.' }))
      } catch (e) {
        if (vigente()) setInforme({ fase: 'error', mensaje: e instanceof Error ? e.message : 'No se ha podido leer el rendimiento.' })
      }
    },
    [perfilId, consulta]
  )

  useEffect(() => {
    void cargar(false)
    return () => {
      generacion.current++ // al salir o cambiar de periodo, el sondeo en marcha se abandona
    }
  }, [cargar])

  /** Una campaña pausada o activada desde la pantalla: se cambia aquí (y en lo guardado) sin volver a pedir la lista a Amazon */
  const cambiarEstado = useCallback(
    (campaignId: string, estado: CampanaViva['estado']) => {
      const cambiar = (lista: CampanaViva[]) => lista.map((c) => (c.campaignId === campaignId ? { ...c, estado } : c))
      const cc = CACHE_CAMPANAS.get(perfilId)
      if (cc) CACHE_CAMPANAS.set(perfilId, { ...cc, datos: cambiar(cc.datos) })
      setCampanas((prev) => (prev.fase === 'listo' ? { ...prev, datos: cambiar(prev.datos) } : prev))
    },
    [perfilId]
  )

  return { campanas, informe, actualizar: () => cargar(true), cambiarEstado }
}
