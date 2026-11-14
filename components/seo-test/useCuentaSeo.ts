'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { llamar } from '@/components/marketing-test/llamar'
import type { ConsultaAnterior, ConsultaGuardada, FichaGuardada, ProductoSeguido, PuntoDeEvolucion } from '@/lib/seo/datos'

export interface LecturaSeo {
  acceso: 'desconocido' | 'si' | 'no'
  error: string | null
  sincronizando: boolean
  periodoEnCurso: 'WEEK' | 'MONTH' | null
  fichaLeidaAt: string | null
  mesOk: string | null
  semanaOk: string | null
  /** Migración 299 lanzada: hay evolución, competencia y propuestas */
  mejoras?: boolean
  competenciaOk?: string | null
  competenciaError?: string | null
  competenciaEnCurso?: boolean
  periodosLeidos?: number
}

export interface DatosSeo {
  lectura: LecturaSeo
  productos: ProductoSeguido[]
  consultas: { MONTH: ConsultaGuardada[]; WEEK: ConsultaGuardada[] }
  /** Las búsquedas del periodo anterior al último, para comparar (vacío sin la migración 299 o sin dos periodos) */
  anteriores?: { MONTH: ConsultaAnterior[]; WEEK: ConsultaAnterior[] }
  evolucion?: PuntoDeEvolucion[]
  fichas: FichaGuardada[]
  /** El precio de cada producto en el catálogo de la cuenta (para descartar búsquedas que compran a otro precio) */
  precios?: Record<string, number | null>
  /** Las fichas cambiadas en Amazon desde aquí (la ventana de 30 días del SOP) */
  cambios?: Array<{ asin: string; aplicadaAt: string }>
}

const ESPERA_MS = 8000
const MAX_PREGUNTAS = 80

/**
 * Todo lo de una cuenta y país de SEO Test. Lo guardado se enseña al instante; si hay una lectura en marcha (o falta el primer informe), se vuelve a preguntar cada pocos segundos y la pantalla se
 * actualiza sola cuando Amazon termina.
 */
export function useCuentaSeo(cuentaId: string) {
  const [datos, setDatos] = useState<DatosSeo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const generacion = useRef(0)

  const cargar = useCallback(
    async (forzar: boolean) => {
      const mia = ++generacion.current
      const vigente = () => generacion.current === mia
      try {
        if (forzar) await llamar('/api/seo/cuenta', { metodo: 'POST', cuerpo: { cuenta: cuentaId, accion: 'actualizar' } })
        for (let i = 0; i < MAX_PREGUNTAS; i++) {
          if (!vigente()) return
          const d = await llamar<DatosSeo>(`/api/seo/cuenta?cuenta=${encodeURIComponent(cuentaId)}`)
          if (!vigente()) return
          setDatos(d)
          setError(null)
          // Con un error apuntado y nada en marcha no se vuelve a preguntar: la lectura no se reintenta hasta dentro de 30 minutos y la pantalla ya enseña el error (antes se quedaba
          // preguntando diez minutos con la ruedita, sin decir nada)
          const esperar = d.productos.length > 0 && d.lectura.acceso !== 'no' && !(d.lectura.error && !d.lectura.sincronizando) && (d.lectura.sincronizando || !d.lectura.mesOk || !d.lectura.semanaOk || !d.lectura.fichaLeidaAt)
          if (!esperar) return
          await new Promise((r) => setTimeout(r, ESPERA_MS))
        }
      } catch (e) {
        if (vigente()) setError(e instanceof Error ? e.message : 'No se ha podido cargar.')
      }
    },
    [cuentaId]
  )

  useEffect(() => {
    setDatos(null)
    void cargar(false)
    return () => {
      generacion.current++
    }
  }, [cargar])

  return { datos, error, recargar: () => cargar(false), actualizar: () => cargar(true) }
}
