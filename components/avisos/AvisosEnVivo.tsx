'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { DURACION_DE_AVISO_DE_EQUIPO_MS, avisoDeEquipo, type FilaDeAvisoDeEquipo } from '@/lib/avisos/equipo'
import { ponerCorreoSinLeer } from '@/lib/avisos/contadores'
import { equipoSilenciado } from '@/lib/avisos/preferencias'
import { publicarAviso } from '@/lib/avisos/pila'
import type { AvisoDeCorreo } from '@/lib/correo/avisos'
import { pedirAlCorreo } from '@/lib/correo/peticiones'
import { createClient } from '@/lib/supabase/client'
import type { UserProfile } from '@/lib/supabase/get-user-profile'
import { PilaDeAvisos } from './PilaDeAvisos'
import { useCorreoNuevo } from './useCorreoNuevo'

/**
 * LO QUE PASA MIENTRAS SE TRABAJA EN OTRA COSA: correo nuevo y noticias del equipo, como avisos abajo a la derecha.
 *
 * Vive en el layout de /dashboard (que no se vuelve a montar al navegar), así que sigue funcionando en TODAS las pantallas, no solo en
 * Correo o Cold Calling. Tiene dos fuentes:
 *
 *   · CORREO NUEVO. Lo lee por detrás components/avisos/useCorreoNuevo.ts (cada minuto, a la vista). Pulsar el aviso lleva a Correo con esa
 *     conversación abierta para contestarla, SIN recargar nada: Cold Calling y Correo se quedan montadas (components/layout/AppsPersistentes.tsx)
 *     y se vuelve a donde se estaba tal como se dejó.
 *   · EL EQUIPO. La tabla `avisos_equipo` (migración 238) se rellena sola con disparadores —alguien llega a 20/40/60/80/100 llamadas hoy,
 *     alguien agenda una cita— y llega por el canal en tiempo real. Solo lo reciben admin y employees del equipo comercial (lo decide la RLS),
 *     no se enseña a quien lo ha hecho, y cada persona lo puede silenciar (en el panel de Notificaciones). Texto en lib/avisos/equipo.ts.
 */

const DURACION_DE_CORREO_MS = 10_000
/** Cuántos correos nuevos se enseñan uno por uno; el resto, en un solo aviso */
const MAX_INDIVIDUALES = 3

export function AvisosEnVivo({ perfil }: { perfil: UserProfile }) {
  const router = useRouter()

  useCorreoNuevo(
    (nuevos: AvisoDeCorreo[]) => {
      const abrirHilo = (n: AvisoDeCorreo) => {
        pedirAlCorreo({ tipo: 'hilo', buzonId: n.buzonId, hiloId: n.hiloId })
        router.push('/dashboard/correo')
      }
      for (const n of nuevos.slice(0, MAX_INDIVIDUALES)) {
        publicarAviso({
          id: `correo-${n.id}`,
          tipo: n.rebote ? 'rebote' : 'correo',
          titulo: n.rebote ? 'Un correo no se ha entregado' : n.de,
          detalle: n.asunto,
          texto: n.rebote ? undefined : n.vistaPrevia || undefined,
          duracionMs: DURACION_DE_CORREO_MS,
          accion: { etiqueta: n.rebote ? 'Verlo' : 'Abrir y contestar', alPulsar: () => abrirHilo(n) },
        })
      }
      if (nuevos.length > MAX_INDIVIDUALES) {
        const resto = nuevos.length - MAX_INDIVIDUALES
        publicarAviso({
          id: `correo-resto-${nuevos[MAX_INDIVIDUALES].id}`,
          tipo: 'correo',
          titulo: `${resto} ${resto === 1 ? 'correo nuevo más' : 'correos nuevos más'}`,
          duracionMs: DURACION_DE_CORREO_MS,
          accion: { etiqueta: 'Ir a Correo', alPulsar: () => router.push('/dashboard/correo') },
        })
      }
    },
    ponerCorreoSinLeer,
    // Solo el equipo tiene correo en el ERP: a un partner o a un cliente ni se le pregunta
    perfil.role === 'admin' || perfil.role === 'employee'
  )

  // Las noticias del equipo. Un partner o un cliente no las reciben (la RLS de la tabla no se lo permite): ni se intenta
  useEffect(() => {
    if (perfil.role !== 'admin' && perfil.role !== 'employee') return
    const supabase = createClient()
    const canal = supabase
      .channel(`avisos_equipo_${perfil.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'avisos_equipo' }, (payload) => {
        const fila = payload.new as FilaDeAvisoDeEquipo
        // Lo que uno mismo ha hecho ya lo sabe
        if (fila.usuario_id === perfil.id) return
        if (equipoSilenciado()) return
        const aviso = avisoDeEquipo(fila)
        if (aviso) publicarAviso({ ...aviso, duracionMs: aviso.duracionMs || DURACION_DE_AVISO_DE_EQUIPO_MS })
      })
      .subscribe()
    return () => {
      void supabase.removeChannel(canal)
    }
  }, [perfil.id, perfil.role])

  return <PilaDeAvisos />
}
