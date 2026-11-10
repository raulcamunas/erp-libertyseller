'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { FilaDiaria } from '@/lib/ads/rendimiento-calculo'
import { llamar } from './llamar'

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
}

export type Carga<T> = { fase: 'cargando'; nota?: string } | { fase: 'listo'; datos: T; en: number } | { fase: 'error'; mensaje: string }

interface Pedido {
  actual: { id: string; desde: string; hasta: string }
  anterior: { id: string; desde: string; hasta: string }
}

/** Lo ya cargado, por cuenta y periodo: cambiar de pestaña no vuelve a pedirlo a Amazon (cada informe tarda de segundos a minutos). Se renueva a los 15 min o con «Actualizar» */
const CACHE_INFORMES = new Map<string, { datos: Informe; en: number }>()
const CACHE_CAMPANAS = new Map<string, { datos: CampanaViva[]; en: number }>()
const VIGENCIA_MS = 15 * 60_000
const ESPERA_ENTRE_PREGUNTAS_MS = 4000
const MAX_PREGUNTAS = 75 // ≈ 5 minutos

/**
 * El rendimiento de una cuenta: sus campañas (en vivo) y el informe diario de Amazon (periodo y anterior). Las dos cargas son independientes: si el informe falla, las campañas se ven igual.
 */
export function useRendimiento(perfilId: string, dias: 7 | 14 | 30) {
  const clave = `${perfilId}:${dias}`
  const [campanas, setCampanas] = useState<Carga<CampanaViva[]>>(() => {
    const c = CACHE_CAMPANAS.get(perfilId)
    return c && Date.now() - c.en < VIGENCIA_MS ? { fase: 'listo', datos: c.datos, en: c.en } : { fase: 'cargando' }
  })
  const [informe, setInforme] = useState<Carga<Informe>>(() => {
    const c = CACHE_INFORMES.get(clave)
    return c && Date.now() - c.en < VIGENCIA_MS ? { fase: 'listo', datos: c.datos, en: c.en } : { fase: 'cargando' }
  })
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

      // ---- informe diario (asíncrono en Amazon) ----
      const ci = CACHE_INFORMES.get(clave)
      if (!forzar && ci && Date.now() - ci.en < VIGENCIA_MS) {
        setInforme({ fase: 'listo', datos: ci.datos, en: ci.en })
        return
      }
      setInforme({ fase: 'cargando', nota: 'Pidiendo el informe a Amazon…' })
      try {
        const pedido = await llamar<Pedido>('/api/ads/cuenta/rendimiento', { metodo: 'POST', cuerpo: { perfilId, dias } })
        for (let i = 0; i < MAX_PREGUNTAS; i++) {
          if (!vigente()) return
          const r = await llamar<{ listo: boolean; actual?: FilaDiaria[]; anterior?: FilaDiaria[] }>(`/api/ads/cuenta/rendimiento?perfilId=${perfilId}&a=${pedido.actual.id}&b=${pedido.anterior.id}`)
          if (r.listo && r.actual && r.anterior) {
            const datos: Informe = { actual: r.actual, anterior: r.anterior, periodos: { actual: { desde: pedido.actual.desde, hasta: pedido.actual.hasta }, anterior: { desde: pedido.anterior.desde, hasta: pedido.anterior.hasta } } }
            const en = Date.now()
            CACHE_INFORMES.set(clave, { datos, en })
            if (vigente()) setInforme({ fase: 'listo', datos, en })
            return
          }
          if (vigente()) setInforme({ fase: 'cargando', nota: i < 2 ? 'Amazon está preparando el informe…' : 'Amazon sigue preparando el informe (suele tardar menos de un minuto)…' })
          await new Promise((res) => setTimeout(res, ESPERA_ENTRE_PREGUNTAS_MS))
        }
        if (vigente()) setInforme({ fase: 'error', mensaje: 'Amazon tarda más de lo normal en preparar el informe. Pulsa «Actualizar» en un momento.' })
      } catch (e) {
        if (vigente()) setInforme({ fase: 'error', mensaje: e instanceof Error ? e.message : 'No se ha podido leer el informe.' })
      }
    },
    [perfilId, dias, clave]
  )

  useEffect(() => {
    void cargar(false)
    return () => {
      generacion.current++ // al salir o cambiar de periodo, el sondeo en marcha se abandona
    }
  }, [cargar])

  return { campanas, informe, actualizar: () => cargar(true) }
}
