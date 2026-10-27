import { redirect } from 'next/navigation'
import { PanelBriefing } from '@/components/briefing/PanelBriefing'
import { BRIEFING_DE_EJEMPLO } from '@/lib/briefing/ejemplo'
import { etiquetaDelDia, normalizarBriefing } from '@/lib/briefing/esquema'
import { diasConBriefing, estadoDelConector, leerBriefing, marcasDelDia, migracionLanzada } from '@/lib/briefing/servidor'
import { APP_BRIEFING, type BriefingGuardado, type DiaConBriefing, type EstadoDelConector, type MarcaDeResuelto } from '@/lib/briefing/tipos'
import { diaDeMadrid, esDia } from '@/lib/correo/secuencias/fechas'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * BRIEFING.
 *
 * El briefing de la mañana que publica la rutina «Briefing diario Liberty Seller», pintado como una pantalla: titular y agenda, «Revisa hoy» con casillas de resuelto,
 * el equipo comercial, las cuentas, las tareas de clientes y el correo. Lo ve un administrador y quien tenga la casilla «Briefing» ('briefing') en Gestión de Usuarios.
 *
 * LAS TABLAS ESTÁN CERRADAS AL NAVEGADOR (migración 254): esta página lee con el cliente de servicio, así que lo único que decide quién ve algo es la comprobación de
 * acceso de aquí abajo (y requireAppAccess('briefing') en la ruta que guarda las marcas). Se hace ANTES de tocar la base.
 *
 *   ?dia=2026-10-26  enseña ese día (sin él, el último publicado; un día que no existe vuelve al último)
 *   ?ejemplo=1       enseña un briefing de mentira para ver cómo queda; no lee ni guarda nada
 *
 * EL CONECTOR (solo administradores) es lo que usa la rutina para publicar aquí; ver lib/mcp/briefing.ts. Desplegar el código antes de lanzar el SQL 254 no estropea
 * nada: la página dice qué fichero lanzar.
 */
export const dynamic = 'force-dynamic'

const primero = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export default async function BriefingPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const profile = await getUserProfile()
  if (!profile) redirect('/auth/login')

  const esAdmin = profile.role === 'admin'
  if (!esAdmin) {
    const { data: permiso } = await supabase.from('user_app_permissions').select('can_access').eq('user_id', user.id).eq('app_id', APP_BRIEFING).maybeSingle()
    if (!permiso?.can_access) redirect('/dashboard')
  }

  const service = createServiceClient()
  const hoy = diaDeMadrid(Date.now())
  const yo = profile.full_name?.trim() || profile.email || null
  const quiereEjemplo = primero(searchParams.ejemplo) === '1'
  const pedido = primero(searchParams.dia)
  const diaPedido = esDia(pedido) ? pedido : null

  let migracion = true
  let dias: DiaConBriefing[] = []
  let guardado: BriefingGuardado | null = null
  let marcas: Record<string, MarcaDeResuelto> = {}
  let conector: EstadoDelConector | null = null
  let volverAlUltimo = false

  try {
    migracion = await migracionLanzada(service)
    if (migracion) {
      dias = await diasConBriefing(service)
      guardado = await leerBriefing(service, diaPedido)
      // Un día que no existe (una dirección vieja, un error al escribirla) no deja en blanco: vuelve al último
      if (!guardado && diaPedido) volverAlUltimo = true
      else {
        if (guardado) marcas = await marcasDelDia(service, guardado.dia)
        if (esAdmin) conector = await estadoDelConector(service)
      }
    }
  } catch (error) {
    // Un fallo de la base que no es «falta la migración» tiene que llegar a error.tsx, no esconderse como «sin briefing»
    console.error('[briefing] no se ha podido leer la pantalla', { mensaje: error instanceof Error ? error.message : 'desconocido' })
    throw new Error('No se ha podido leer el briefing. Recarga la página.')
  }
  if (volverAlUltimo) redirect('/dashboard/briefing')

  if (quiereEjemplo) {
    const ejemplo = normalizarBriefing(BRIEFING_DE_EJEMPLO)
    if (ejemplo.ok) {
      // Con la fecha de hoy, para que se vea como se verá de verdad
      const ahora = new Date().toISOString()
      guardado = { dia: hoy, briefing: { ...ejemplo.briefing, fecha_label: etiquetaDelDia(hoy) }, publicadoAt: ahora, actualizadoAt: ahora }
      dias = []
      marcas = {}
    }
  }

  const esElUltimo = diaPedido === null || (dias.length > 0 && guardado?.dia === dias[0].dia)

  return (
    <div className="space-y-3 pb-10">
      <div>
        <h1 className="mb-0.5 text-[22px] font-semibold leading-tight tracking-[-0.012em] text-[var(--ls-t1)]">Briefing</h1>
        <p className="text-[13px] text-[var(--ls-t3)]">
          El resumen de la mañana: qué hay que revisar hoy, cómo va el equipo comercial, las cuentas, las tareas de clientes y el correo. Lo publica Claude cada día laborable.
        </p>
      </div>
      <PanelBriefing
        guardado={guardado}
        dias={dias}
        marcas={marcas}
        hoy={hoy}
        esElUltimo={esElUltimo}
        esEjemplo={quiereEjemplo && guardado !== null}
        migracion={migracion}
        esAdmin={esAdmin}
        yo={yo}
        conector={conector}
      />
    </div>
  )
}
