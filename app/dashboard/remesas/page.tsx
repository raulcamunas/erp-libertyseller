import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { panelDeCliente } from '@/lib/fba/datos'
import { diaEnEspana } from '@/lib/fba/fechas'
import { EspacioRemesas } from '@/components/remesas/EspacioRemesas'

/**
 * REMESAS A FBA · LA APP.
 *
 * Qué mandamos a los almacenes de Amazon y cuánto queda vivo de cada envío.
 * Sustituye a un Excel con una pestaña por envío donde la columna «Unidades
 * Vendidas» se rellenaba a mano.
 *
 *
 * ============ QUIÉN ENTRA, Y QUÉ VE ============
 *
 * Es la primera app del ERP en la que entra gente de FUERA de la agencia. Cada
 * uno ve una lista de clientes distinta:
 *
 *   · admin       -> todos los clientes de amazon_clients.
 *   · cualquier otro -> SOLO los que tenga en fba_accesos. Un 'cliente' de
 *                    verdad suele tener uno; un employee puede tener varios.
 *
 * La lista se calcula AQUÍ, en el servidor, y es la única que la pantalla
 * conoce: no hay forma de pedir un cliente que no esté en ella. Y las rutas de
 * /api/fba vuelven a comprobarlo por su cuenta (lib/fba/acceso.ts), así que
 * cambiar el id en la URL tampoco sirve.
 */
export const dynamic = 'force-dynamic'

interface ClienteRemesas {
  id: string
  nombre: string
  puedeEditar: boolean
  /** Cuántas remesas tiene en total. Sirve para que un cliente sin ninguna se vea
      de un vistazo y no haya que pinchar en los once para averiguarlo */
  remesas: number
  /** De esas, los envíos reales (enviada o cerrada) */
  envios: number
  /** Y las propuestas que se están trabajando (borrador, aprobada, encajando, lista) */
  propuestas: number
}

export default async function RemesasPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const profile = await getUserProfile()
  if (!profile) redirect('/auth/login')

  const service = createServiceClient()
  const esAdmin = profile.role === 'admin'

  let clientes: ClienteRemesas[] = []

  if (esAdmin) {
    const { data } = await service
      .from('amazon_clients')
      .select('id, name')
      .order('name', { ascending: true })
    clientes = ((data ?? []) as Array<{ id: string; name: string }>).map((c) => ({
      id: c.id,
      nombre: c.name,
      puedeEditar: true,
      remesas: 0,
      envios: 0,
      propuestas: 0,
    }))
  } else {
    const { data: accesos } = await service
      .from('fba_accesos')
      .select('client_id, puede_editar, amazon_clients ( id, name )')
      .eq('user_id', user.id)
    // El join lo tipa Supabase como array aunque sea uno-a-uno; se acepta
    // cualquiera de las dos formas para no depender de cómo lo infiera.
    type Ficha = { id: string; name: string }
    const filas = (accesos ?? []) as unknown as Array<{
      client_id: string
      puede_editar: boolean
      amazon_clients: Ficha | Ficha[] | null
    }>
    clientes = filas
      .map((a) => {
        const ficha = Array.isArray(a.amazon_clients) ? a.amazon_clients[0] : a.amazon_clients
        return ficha
          ? { id: a.client_id, nombre: ficha.name, puedeEditar: a.puede_editar, remesas: 0, envios: 0, propuestas: 0 }
          : null
      })
      .filter((c): c is ClienteRemesas => c !== null)
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
  }

  // Sin ningún cliente no hay nada que enseñar. Para un 'cliente' de fuera es
  // que la agencia no le ha dado acceso todavía; se le dice sin dramatizar.
  if (clientes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-10">
        <div className="glass-card max-w-md p-8 text-center">
          <p className="text-sm text-white/70">
            {esAdmin
              ? 'No hay ningún cliente de Amazon dado de alta todavía.'
              : 'Tu cuenta todavía no tiene acceso a ninguna cuenta de Amazon. Pídeselo a Liberty Seller.'}
          </p>
        </div>
      </div>
    )
  }

  /**
   * Cuántas remesas tiene cada uno.
   *
   * Una sola lectura de `client_id` y se cuenta aquí, en vez de una consulta de
   * recuento por cliente: con once clientes serían once viajes a la base para
   * pintar una cifra pequeña.
   */
  const { data: cuentas } = await service
    .from('fba_remesas')
    .select('client_id, estado')
    .in('client_id', clientes.map((c) => c.id))
  const envios = new Map<string, number>()
  const propuestas = new Map<string, number>()
  for (const r of (cuentas ?? []) as Array<{ client_id: string; estado: string | null }>) {
    // Sin estado = remesa de antes de la migración 195: historia, o sea envío
    const real = ['enviada', 'cerrada'].includes(r.estado ?? 'cerrada')
    const mapa = real ? envios : propuestas
    mapa.set(r.client_id, (mapa.get(r.client_id) ?? 0) + 1)
  }
  clientes = clientes.map((c) => ({
    ...c,
    envios: envios.get(c.id) ?? 0,
    propuestas: propuestas.get(c.id) ?? 0,
    remesas: (envios.get(c.id) ?? 0) + (propuestas.get(c.id) ?? 0),
  }))

  const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const pedido = uno(searchParams.cliente)
  // ACOTADO a la lista: un id que no esté en ella cae al primero, sin error y
  // sin confirmar si existe.
  const cliente = clientes.find((c) => c.id === pedido) ?? clientes[0]

  // La remesa que se está mirando: sus cajas se leen aquí para no pedirlas
  // desde el navegador en una segunda vuelta.
  const remesaAbierta = uno(searchParams.remesa) ?? null
  const panel = await panelDeCliente(cliente.id, {
    hoy: diaEnEspana(),
    cajasDe: remesaAbierta,
  })

  return (
    <EspacioRemesas
      clientes={clientes}
      cliente={cliente}
      panel={panel}
      esAdmin={esAdmin}
      remesaAbierta={remesaAbierta}
      nombreUsuario={profile.full_name ?? profile.email ?? ''}
    />
  )
}
