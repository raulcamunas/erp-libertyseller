'use client'

import { useEffect, useState } from 'react'
import { SIN_FILTROS, type FiltrosDeCartera } from '@/lib/cold-calling/cartera'
import type { ColdSort } from '@/lib/types/cold-leads'
import type { VistaDeCartera } from './BarraDeCartera'

/**
 * LA SESIÓN DE TRABAJO SE RECUERDA: si Maoli se pasa el día en «+100k, sin contactar, vista tabla», mañana entra exactamente ahí.
 *
 * La clave lleva el id del usuario por si comparten ordenador, y tiene el MISMO formato de siempre (`view`, `statusFilter`,
 * `listFilter`…) para que quien ya tenía sus preferencias guardadas no las pierda con el rediseño. La búsqueda no se recuerda: un texto
 * de ayer en la caja de búsqueda parece un filtro roto.
 *
 * Hasta haber leído lo anterior no se guarda nada, o el estado inicial pisaría lo que dejó la persona la última vez.
 */

export interface Preferencias {
  vista: VistaDeCartera
  filtros: FiltrosDeCartera
  propietario: string | null
}

const VISTAS: ReadonlySet<string> = new Set(['ficha', 'tabla', 'rellamadas'])
const ORDENES: ReadonlySet<string> = new Set(['revenue_desc', 'revenue_asc', 'due_first', 'name', 'prioridad'])

const clave = (userId: string) => `coldCalling:${userId}`

/** Lo guardado, validado campo a campo: unas preferencias estropeadas se ignoran en vez de romper la pantalla */
export function leerPreferencias(texto: string | null, puedeVerTodos: boolean): Partial<Preferencias> {
  if (!texto) return {}
  try {
    const p = JSON.parse(texto) as Record<string, unknown>
    const salida: Partial<Preferencias> = {}
    if (typeof p.view === 'string' && VISTAS.has(p.view)) salida.vista = p.view as VistaDeCartera
    const filtros: Partial<FiltrosDeCartera> = {}
    if (typeof p.statusFilter === 'string') filtros.estado = p.statusFilter as FiltrosDeCartera['estado']
    if (typeof p.listFilter === 'string') filtros.lista = p.listFilter
    if (p.nivelFilter === 1 || p.nivelFilter === 2 || p.nivelFilter === 3) filtros.nivel = p.nivelFilter
    if (typeof p.minRev === 'string') filtros.minRev = p.minRev
    if (typeof p.maxRev === 'string') filtros.maxRev = p.maxRev
    if (typeof p.sort === 'string' && ORDENES.has(p.sort)) filtros.orden = p.sort as ColdSort
    if (Object.keys(filtros).length > 0) salida.filtros = { ...SIN_FILTROS, ...filtros }
    if (puedeVerTodos && typeof p.ownerFilter === 'string') salida.propietario = p.ownerFilter
    return salida
  } catch {
    return {}
  }
}

export function usePreferencias(userId: string, puedeVerTodos: boolean, estado: Preferencias, alLeer: (leidas: Partial<Preferencias>) => void) {
  const [listo, setListo] = useState(false)

  useEffect(() => {
    let texto: string | null = null
    try {
      texto = window.localStorage.getItem(clave(userId))
    } catch {
      // Sin almacenamiento (ventana privada, datos bloqueados): se arranca en limpio
    }
    alLeer(leerPreferencias(texto, puedeVerTodos))
    setListo(true)
    // Solo al montar: leer las preferencias es cosa de una vez
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, puedeVerTodos])

  useEffect(() => {
    if (!listo) return
    try {
      window.localStorage.setItem(
        clave(userId),
        JSON.stringify({
          view: estado.vista,
          statusFilter: estado.filtros.estado,
          listFilter: estado.filtros.lista,
          nivelFilter: estado.filtros.nivel,
          minRev: estado.filtros.minRev,
          maxRev: estado.filtros.maxRev,
          sort: estado.filtros.orden,
          ownerFilter: estado.propietario ?? undefined,
        })
      )
    } catch {
      // Lo mismo: si no se puede guardar, la sesión de trabajo no se recuerda y ya está
    }
  }, [listo, userId, estado.vista, estado.filtros.estado, estado.filtros.lista, estado.filtros.nivel, estado.filtros.minRev, estado.filtros.maxRev, estado.filtros.orden, estado.propietario])

  return listo
}
