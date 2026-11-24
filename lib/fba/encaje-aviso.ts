import { publicarEnElChat } from '@/lib/chat/sistema-servidor'
import { createServiceClient } from '@/lib/supabase/service'
import { destinatariosDelGrupo } from './plan-avisos'

/**
 * «EL CLIENTE HA TERMINADO DE ENCAJAR» — AVISO AL EQUIPO (24 nov 2026, Raúl). SOLO ESCRIBE AVISOS.
 * =================================================================================================
 * Cuando un cliente pasa un envío de «Encajando» a «Lista para enviar» (desde su enlace público o desde el ERP con su cuenta), la
 * agencia tiene que enterarse para crear el envío en Amazon y mandarlo. Se avisa:
 *
 *   · En la campana (`notifications`, tipo `fba_alerta`) de quien lleva a ese cliente: admins, empleados con la casilla `remesas` y
 *     los que tienen acceso a ese cliente (`destinatariosDelGrupo`, la misma regla que los avisos del plan). La clave es una por
 *     envío y paso a «lista», así que si se reabre y se vuelve a terminar, se avisa otra vez.
 *   · En #notificaciones-erp, sin repetir el aviso de la campana (`avisar: false`).
 *
 * Nunca lanza: que no salga el aviso no puede deshacer el «he terminado» del cliente.
 */

type Servicio = ReturnType<typeof createServiceClient>

export async function avisarEncajeTerminado(service: Servicio, remesaId: string, desde: 'enlace' | 'cliente', listaAt: string): Promise<void> {
  try {
    const { data: r } = await service.from('fba_remesas').select('id, nombre, client_id').eq('id', remesaId).maybeSingle()
    const remesa = r as { id: string; nombre: string | null; client_id: string | null } | null
    if (!remesa?.client_id) return
    const [{ data: c }, { data: lineas }, { count: cajas }] = await Promise.all([
      service.from('amazon_clients').select('name').eq('id', remesa.client_id).maybeSingle(),
      service.from('fba_remesa_lineas').select('unidades').eq('remesa_id', remesaId).gt('unidades', 0),
      service.from('fba_cajas').select('id', { count: 'exact', head: true }).eq('remesa_id', remesaId),
    ])
    const cliente = (c as { name: string | null } | null)?.name ?? 'Un cliente'
    const unidades = ((lineas ?? []) as Array<{ unidades: number }>).reduce((a, l) => a + (l.unidades || 0), 0)
    const nombre = remesa.nombre?.trim() || 'su envío'
    const cifras = [unidades > 0 ? `${unidades.toLocaleString('es-ES')} ud` : null, cajas ? `${cajas} ${cajas === 1 ? 'caja' : 'cajas'}` : null].filter(Boolean).join(' · ')
    const titulo = `${cliente} ha terminado de encajar`
    const cuerpo = `«${nombre}»${cifras ? ` (${cifras})` : ''} está lista para enviar${desde === 'enlace' ? ', desde su enlace' : ''}. Toca crear el envío en Amazon.`
    const url = `/dashboard/remesas?cliente=${encodeURIComponent(remesa.client_id)}&remesa=${encodeURIComponent(remesaId)}`
    const clave = `fba_encaje_terminado:${remesaId}:${listaAt}`

    const destinatarios = await destinatariosDelGrupo(service, remesa.client_id)
    if (destinatarios.length > 0) {
      const filas = destinatarios.map((userId) => ({
        user_id: userId,
        type: 'fba_alerta',
        title: titulo.slice(0, 100),
        message: cuerpo.slice(0, 260),
        clave,
        datos: { app: 'remesas', clienteId: remesa.client_id, remesaId, url },
      }))
      const { error } = await service.from('notifications').upsert(filas, { onConflict: 'user_id,clave', ignoreDuplicates: true })
      if (error) console.error('[fba/encaje-aviso] campana', error.message)
    }
    await publicarEnElChat({ clave, titulo, cuerpo, avisar: false })
  } catch (error) {
    console.error('[fba/encaje-aviso] aviso de encaje terminado', remesaId, error)
  }
}
