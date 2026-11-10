'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { llamar } from '@/components/marketing-test/llamar'
import type { ConsultaGuardada, FichaGuardada, ProductoSeguido } from '@/lib/seo/datos'

export interface LecturaSeo {
  acceso: 'desconocido' | 'si' | 'no'
  error: string | null
  sincronizando: boolean
  periodoEnCurso: 'WEEK' | 'MONTH' | null
  fichaLeidaAt: string | null
  mesOk: string | null
  semanaOk: string | null
}

export interface DatosSeo {
  lectura: LecturaSeo
  productos: ProductoSeguido[]
  consultas: { MONTH: ConsultaGuardada[]; WEEK: ConsultaGuardada[] }
  fichas: FichaGuardada[]
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
          const esperar = d.productos.length > 0 && d.lectura.acceso !== 'no' && (d.lectura.sincronizando || !d.lectura.mesOk || !d.lectura.semanaOk || !d.lectura.fichaLeidaAt)
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
