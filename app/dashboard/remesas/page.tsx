import { redirect } from 'next/navigation'
import { Truck } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { contarAlertasGraves, leerPanelDeAlertas, type PanelDeAlertas } from '@/lib/fba/alertas-lectura'
import { clientesDeSesion, sesionFbaDe } from '@/lib/fba/clientes-de-sesion'
import { panelDeCliente, type PanelRemesas } from '@/lib/fba/datos'
import { diaEnEspana } from '@/lib/fba/fechas'
import { vistaDesdeUrl, type VistaPedida } from '@/lib/fba/vista-url'
import { EstadoVacio } from '@/components/ui-ls'
import { EspacioRemesas } from '@/components/remesas/EspacioRemesas'

/**
 * REMESAS A FBA · LA PÁGINA (spec remesas-pro §1.2-§1.4 y §11 D25, D27, D37, D39).
 *
 * Qué mandamos a los almacenes de Amazon, cuánto queda vivo de cada envío y qué hay que enviar después. Una sola ruta con las vistas en
 * `?vista=` (hoy · plan · cliente · tablero · alertas) y, dentro de «cliente», la sección en `?seccion=`. Los enlaces viejos (alertas,
 * campana, correos) los traduce `vistaDesdeUrl` (lib/fba/vista-url.ts), en un solo sitio.
 *
 * ============ QUIÉN ENTRA Y QUÉ VE ============
 * La lista de clientes sale de `clientesDeSesion` (lib/fba/clientes-de-sesion.ts), la única puerta:
 *   · admin (no CEO)                         → todos, edita, agencia.
 *   · empleado con la casilla `remesas`      → todos, edita, agencia (no es admin). CAMBIO DE COMPORTAMIENTO (D27).
 *   · otro empleado / cliente de fuera       → sus `fba_accesos`.
 * La lista se calcula AQUÍ y es la única que la pantalla conoce; las rutas de /api/fba lo vuelven a comprobar (requireFbaAccess).
 *
 * ============ QUÉ SE CALCULA AQUÍ Y QUÉ NO (D25) ============
 * La página resuelve la sesión, los clientes y sus contadores ligeros. CAMBIO DE COMPORTAMIENTO (anotado, §11.9): antes calculaba SIEMPRE el
 * panel del cliente (todas sus remesas con su reparto de ventas), mirase lo que mirase la persona. Ahora solo lo calcula cuando hace falta:
 *   · `vista=cliente` y la sección es `envios` o `propuestas`, o
 *   · hay `?remesa=` (las cajas de esa remesa vienen con él, `cajasDe`, como siempre).
 * El cliente de fuera lo recibe recortado (`paraCliente`: sin el análisis de la IA, D26). Hoy, Plan, Resumen, Stock, Ventas, Reposición,
 * Lotes y el Tablero piden sus datos desde el navegador (useAgencia, memoria de 5 min). Las alertas (`vista=alertas`) se leen aquí.
 * Las 24 llamadas a `router.refresh()` del módulo siguen funcionando: vuelven a pasar por aquí con la URL de ese momento.
 */
export const dynamic = 'force-dynamic'

type Params = Record<string, string | string[] | undefined>

const uno = (v: string | string[] | undefined): string | undefined => {
  const s = (Array.isArray(v) ? v[0] : v)?.trim()
  return s ? s : undefined
}

/**
 * También pinta `/dashboard/remesas/alertas`: aquella página llama a esta con `vista=alertas` (sin redirección, para no romper los
 * marcadores) después de echar al cliente de fuera. La carcasa sabe por la ruta (`usePathname`) que está en las alertas.
 */
export default async function RemesasPage({ searchParams }: { searchParams: Params }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const hoy = diaEnEspana()
  const { sesion, clientes, vacio } = await clientesDeSesion(user.id, { hoy })

  if (vacio !== null || clientes.length === 0) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <EstadoVacio icono={Truck} acento="remesas" titulo="Remesas a FBA" descripcion={vacio ?? 'No hay ningún cliente de Amazon dado de alta todavía.'} />
      </div>
    )
  }

  /* ---------- ?remesa=: de qué cliente es y en qué estado está (para abrir su sección) ---------- */
  const remesaPedida = uno(searchParams.remesa)
  let remesa: { id: string; clienteId: string; estado: string | null } | null = null
  if (remesaPedida && /^[0-9a-f-]{36}$/i.test(remesaPedida)) {
    const { data } = await createServiceClient().from('fba_remesas').select('id, client_id, estado').eq('id', remesaPedida).maybeSingle()
    const fila = data as { id: string; client_id: string; estado: string | null } | null
    // Solo si es de un cliente que esta persona ve: si no, como si no existiera (sin confirmar nada)
    if (fila && clientes.some((c) => c.id === fila.client_id)) remesa = { id: fila.id, clienteId: fila.client_id, estado: fila.estado }
  }

  /* ---------- qué pantalla pide la URL ---------- */
  let pedida: VistaPedida = vistaDesdeUrl(searchParams, sesion.actor, remesa?.estado ?? null)
  // El tablero del cliente de fuera solo existe si tiene varias cuentas (D39)
  if (pedida.vista === 'tablero' && sesion.actor === 'cliente' && clientes.length < 2) pedida = { ...pedida, vista: 'cliente', seccion: 'resumen', modo: undefined }

  // ACOTADO a la lista: un id que no esté en ella cae al de la remesa o al primero, sin error y sin confirmar si existe
  const cliente =
    clientes.find((c) => c.id === pedida.clienteId) ?? (remesa ? clientes.find((c) => c.id === remesa?.clienteId) : undefined) ?? clientes[0]

  // La base de datos solo existe para los clientes que la tienen (D40)
  if (pedida.vista === 'cliente' && pedida.seccion === 'base' && !cliente.tieneCatalogo) pedida = { ...pedida, seccion: 'envios' }

  /* ---------- el panel del cliente, solo si la sección lo necesita (D25) ---------- */
  const remesaDeEste = remesa && remesa.clienteId === cliente.id ? remesa.id : null
  const necesitaPanel = pedida.vista === 'cliente' && (pedida.seccion === 'envios' || pedida.seccion === 'propuestas' || remesaDeEste !== null)
  let panel: PanelRemesas | null = null
  if (necesitaPanel) {
    panel = await panelDeCliente(cliente.id, { hoy, cajasDe: remesaDeEste, paraCliente: sesion.actor === 'cliente' })
  }

  /* ---------- alertas: la insignia (agencia) y, en su vista, el tablero entero ---------- */
  let alertas: { criticas: number; altas: number } | null = null
  let panelAlertas: PanelDeAlertas | null = null
  if (sesion.actor === 'agencia') {
    const fba = sesionFbaDe(sesion)
    const [cuenta, tablero] = await Promise.all([
      // Sin romper la pantalla si falta la migración 267 o la lectura falla
      contarAlertasGraves(fba).catch(() => ({ criticas: 0, altas: 0 })),
      pedida.vista === 'alertas' ? leerPanelDeAlertas(fba, hoy).catch(() => null) : Promise.resolve(null),
    ])
    alertas = cuenta
    panelAlertas = tablero
  }

  /* ---------- la conexión de Amazon de cada cliente: solo un admin la necesita («Leer de Amazon» gasta cupo de informes) ---------- */
  const conexiones: Record<string, string> = {}
  if (sesion.esAdmin) {
    const { data } = await createServiceClient()
      .from('amazon_connections')
      .select('id, client_id')
      .in('client_id', clientes.map((c) => c.id))
      .eq('is_active', true)
    for (const c of (data ?? []) as Array<{ id: string; client_id: string }>) if (!conexiones[c.client_id]) conexiones[c.client_id] = c.id
  }

  return (
    <EspacioRemesas
      sesion={sesion}
      clientes={clientes}
      clienteInicial={cliente.id}
      remesa={remesa ? { id: remesa.id, estado: remesa.estado } : null}
      panel={panel}
      panelAlertas={panelAlertas}
      alertas={alertas}
      hoy={hoy}
      conexiones={conexiones}
    />
  )
}
