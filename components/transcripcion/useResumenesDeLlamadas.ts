'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { esperaResumen, leToca, type LlamadaTranscribible } from '@/lib/transcripcion/pantalla'
import { CAMPOS_DEL_RESUMEN, type ResumenDeLlamadaGuardado } from '@/lib/transcripcion/tipos'

/**
 * LOS RESÚMENES DE LAS LLAMADAS QUE SE ESTÁN MIRANDO.
 *
 * Se leen con la sesión de quien mira (RLS de la migración 244): cada comercial ve los de sus llamadas y quien supervisa el equipo, los de todos. La
 * transcripción entera NO viaja aquí (es larga): se pide aparte cuando alguien la abre.
 *
 * Mientras una llamada reciente espera su resumen —el proceso lo hace unos minutos después de colgar— se vuelve a preguntar cada 30 segundos, solo con
 * la pestaña a la vista y hasta una hora después de colgar (lib/transcripcion/pantalla.ts). Sin la migración 244 la consulta falla y no hay resúmenes
 * que enseñar: la pantalla sigue como siempre.
 */

type Cliente = ReturnType<typeof createClient>

/** Cuántas llamadas se piden por consulta: la lista de ids va en la dirección y una de 300 se pasaría de largo */
const POR_CONSULTA = 80

export async function leerResumenes(supabase: Cliente, ids: readonly string[]): Promise<Map<string, ResumenDeLlamadaGuardado>> {
  const mapa = new Map<string, ResumenDeLlamadaGuardado>()
  for (let i = 0; i < ids.length; i += POR_CONSULTA) {
    const { data, error } = await supabase.from('rinkel_transcripciones').select(CAMPOS_DEL_RESUMEN).in('llamada_id', ids.slice(i, i + POR_CONSULTA))
    if (error) continue
    for (const fila of (data ?? []) as ResumenDeLlamadaGuardado[]) mapa.set(fila.llamada_id, fila)
  }
  return mapa
}

const CADA_MS = 30_000

export function useResumenesDeLlamadas(llamadas: readonly LlamadaTranscribible[]): ReadonlyMap<string, ResumenDeLlamadaGuardado> {
  const supabase = useMemo(() => createClient(), [])
  const [resumenes, setResumenes] = useState<ReadonlyMap<string, ResumenDeLlamadaGuardado>>(() => new Map())

  // Solo se preguntan las llamadas a las que el proceso les hace resumen. Se compara por contenido para no volver a pedir si la lista se rehace igual
  const clave = llamadas.filter(leToca).map((l) => l.id).join(',')
  const ids = useMemo(() => (clave ? clave.split(',') : []), [clave])

  useEffect(() => {
    if (ids.length === 0) {
      setResumenes((previos) => (previos.size === 0 ? previos : new Map()))
      return
    }
    let activo = true
    void leerResumenes(supabase, ids).then((m) => {
      if (activo) setResumenes(m)
    })
    return () => {
      activo = false
    }
  }, [supabase, ids])

  // Al volver a preguntar solo se piden las que siguen esperando (una semana entera de llamadas serían decenas de consultas cada 30 s)
  const ahora = Date.now()
  const claveDeLasQueEsperan = llamadas.filter((l) => esperaResumen(l, resumenes.get(l.id), ahora)).map((l) => l.id).join(',')
  useEffect(() => {
    if (!claveDeLasQueEsperan) return
    const esperadas = claveDeLasQueEsperan.split(',')
    let activo = true
    const t = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void leerResumenes(supabase, esperadas).then((m) => {
        if (!activo) return
        // Se mezcla con lo que ya había: siempre es un mapa nuevo, así que la pantalla se vuelve a calcular y, pasada la hora, deja de preguntar
        setResumenes((previos) => new Map([...previos, ...m]))
      })
    }, CADA_MS)
    return () => {
      activo = false
      clearInterval(t)
    }
  }, [claveDeLasQueEsperan, supabase])

  return resumenes
}
