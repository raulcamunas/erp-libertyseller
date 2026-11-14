import { createServiceClient } from '@/lib/supabase/service'
import type { SesionFba } from './acceso'
import type { EstadoRemesa } from './flujo'
import { leerTodo } from './paginar'
import { aTarjeta, type FilaDeTablero, type TarjetaDeTablero } from './tablero'

/**
 * LA LECTURA DEL TABLERO DE REMESAS. SOLO SERVIDOR.
 *
 * Cuatro consultas en total, se vean los clientes que se vean (nada de una por remesa): las remesas en
 * marcha de los clientes permitidos, sus líneas (solo unidades), sus cajas (solo para contarlas) y los
 * nombres de los clientes. Las columnas de la 309 se piden aparte y, si no están, el tablero sale igual sin
 * distinguir «con el cliente» ni «revisar».
 */

const EN_MARCHA: EstadoRemesa[] = ['borrador', 'aprobada', 'encajando', 'lista']

export async function tableroDeRemesas(sesion: SesionFba, hoy: string, service = createServiceClient()): Promise<TarjetaDeTablero[]> {
  let q = service.from('fba_remesas').select('id, client_id, nombre, fecha_envio, estado, updated_at').in('estado', EN_MARCHA)
  if (sesion.clientesPermitidos) q = q.in('client_id', sesion.clientesPermitidos)
  const { data, error } = await q.order('fecha_envio', { ascending: true }).limit(500)
  if (error) throw error
  const remesas = (data ?? []) as Array<{ id: string; client_id: string; nombre: string | null; fecha_envio: string; estado: EstadoRemesa; updated_at: string | null }>
  if (remesas.length === 0) return []
  const ids = remesas.map((r) => r.id)

  const propuesta = new Map<string, { enviada: string | null; acepto: string | null }>()
  {
    const { data: p, error: e } = await service.from('fba_remesas').select('id, propuesta_enviada_at, cliente_acepto_at').in('id', ids)
    if (!e) for (const x of (p ?? []) as Array<{ id: string; propuesta_enviada_at: string | null; cliente_acepto_at: string | null }>) propuesta.set(x.id, { enviada: x.propuesta_enviada_at, acepto: x.cliente_acepto_at })
  }

  const lineas = await leerTodo<{ remesa_id: string; unidades: number }>((a, b) =>
    service.from('fba_remesa_lineas').select('remesa_id, unidades').in('remesa_id', ids).order('id', { ascending: true }).range(a, b)
  )
  const porRemesa = new Map<string, { refs: number; uds: number }>()
  for (const l of lineas) {
    const x = porRemesa.get(l.remesa_id) ?? { refs: 0, uds: 0 }
    if (l.unidades > 0) x.refs++
    x.uds += l.unidades
    porRemesa.set(l.remesa_id, x)
  }

  const cajas = await leerTodo<{ remesa_id: string }>((a, b) => service.from('fba_cajas').select('remesa_id').in('remesa_id', ids).order('id', { ascending: true }).range(a, b))
  const cajasPor = new Map<string, number>()
  for (const c of cajas) cajasPor.set(c.remesa_id, (cajasPor.get(c.remesa_id) ?? 0) + 1)

  const clientes = [...new Set(remesas.map((r) => r.client_id))]
  const { data: nombres } = await service.from('amazon_clients').select('id, name').in('id', clientes)
  const nombre = new Map(((nombres ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]))

  return remesas
    .map((r): FilaDeTablero => ({
      id: r.id,
      clienteId: r.client_id,
      clienteNombre: nombre.get(r.client_id) ?? 'Cliente',
      nombre: r.nombre,
      fechaEnvio: r.fecha_envio,
      estado: r.estado,
      actualizadaAt: r.updated_at,
      propuestaEnviadaAt: propuesta.get(r.id)?.enviada ?? null,
      clienteAceptoAt: propuesta.get(r.id)?.acepto ?? null,
      referencias: porRemesa.get(r.id)?.refs ?? 0,
      unidades: porRemesa.get(r.id)?.uds ?? 0,
      cajas: cajasPor.get(r.id) ?? 0,
    }))
    .map((f) => aTarjeta(f, hoy))
    .filter((t): t is TarjetaDeTablero => t !== null)
}
