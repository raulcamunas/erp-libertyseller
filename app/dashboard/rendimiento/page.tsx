import { AlertTriangle } from 'lucide-react'
import { redirect } from 'next/navigation'
import { PanelRendimiento } from '@/components/rendimiento/PanelRendimiento'
import { CAMPOS_DEL_VINCULO, type Miembro, type VinculoVisible } from '@/components/rendimiento/tipos'
import { puedeVerEquipoComercial } from '@/lib/equipo-comercial/acceso'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { hoyMadrid } from '@/lib/rendimiento/dia'
import { UUID } from '@/lib/amazon/api'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { createClient } from '@/lib/supabase/server'

/**
 * MI RENDIMIENTO.
 *
 * Cada comercial entra y ve SU panel: llamadas hechas, WhatsApp, correos, respuestas y citas del día, y el
 * calendario de sus llamadas con las grabaciones. Quien supervisa al equipo (admin, partner o el permiso suelto
 * 'equipo-comercial') puede cambiar de persona con `?comercial=<id>`.
 *
 * ESTO SOLO DECIDE QUÉ SE PINTA. Quien recorta de verdad son las políticas RLS de las tablas rinkel_* y de las
 * que se leen para las cifras (cold_lead_notes, appointments): la pantalla no filtra por comercial, así que
 * pedir el panel de otra persona sin supervisar devuelve vacío, no sus datos. El id de la URL solo se acepta si
 * es de alguien del equipo que esta persona puede ver; cualquier otro valor se ignora.
 */
export const dynamic = 'force-dynamic'

const nombreDe = (p: { full_name: string | null; email: string | null }) => p.full_name?.trim() || p.email || 'Sin nombre'

export default async function RendimientoPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const profile = await getUserProfile()
  if (!profile) redirect('/auth/login')

  const puedeSupervisar = await puedeVerEquipoComercial(profile.role, user.id)

  // El equipo que se puede elegir. Quien no supervisa solo se ve a sí mismo
  const yo = { id: user.id, nombre: nombreDe(profile) }
  const personas = new Map<string, { id: string; nombre: string }>([[yo.id, yo]])
  const comerciales = new Set<string>()
  if (puedeSupervisar) {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .eq('is_comercial', true)
      .order('full_name', { ascending: true })
    for (const p of (data ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>) {
      comerciales.add(p.id)
      if (!personas.has(p.id)) personas.set(p.id, { id: p.id, nombre: nombreDe(p) })
    }
  }

  // Los vínculos con Rinkel visibles para esta sesión: el suyo, o los de todo el equipo si supervisa
  const { data: vinculosBrutos, error: errorVinculos } = await supabase.from('rinkel_vinculos').select(CAMPOS_DEL_VINCULO)
  const faltaMigracion = Boolean(errorVinculos) && isMissingSchema(errorVinculos)
  if (errorVinculos && !faltaMigracion) {
    // Un fallo de la base que no es «falta la migración» tiene que llegar a error.tsx, no esconderse como «sin Rinkel»
    console.error('Rendimiento: no se han podido leer los vínculos de Rinkel', errorVinculos)
    throw new Error('No se ha podido leer el estado de Rinkel. Recarga la página.')
  }
  const vinculos = new Map(((vinculosBrutos ?? []) as VinculoVisible[]).map((v) => [v.user_id, v]))

  // Quién se enseña: el de la URL si esta persona lo puede ver, y si no, ella misma
  const pedido = Array.isArray(searchParams.comercial) ? searchParams.comercial[0] : searchParams.comercial
  const elegida = puedeSupervisar && pedido && UUID.test(pedido) && personas.has(pedido) ? personas.get(pedido)! : yo

  const equipo: Miembro[] = puedeSupervisar
    ? [...personas.values()].map((p) => ({ id: p.id, nombre: p.nombre, vinculado: vinculos.has(p.id), comercial: comerciales.has(p.id) }))
    : []

  return (
    <div className="space-y-4 pb-10">
      <div>
        <h1 className="heading-medium text-white mb-1">Mi rendimiento</h1>
        <p className="text-white/50 text-sm">
          Lo que has hecho cada día: llamadas, mensajes, correos, respuestas y citas. Las llamadas y sus grabaciones se leen de tu Rinkel.
        </p>
      </div>

      {faltaMigracion ? (
        <div className="rounded-2xl border border-amber-400/30 bg-amber-400/[0.06] p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-300 shrink-0 mt-0.5" />
          <div className="text-[13px] text-white/75 leading-relaxed">
            <p className="font-semibold text-white mb-1">Falta preparar la base de datos</p>
            <p>
              Hay que lanzar la migración <span className="font-mono text-white/90">234_rendimiento_rinkel.sql</span> en el editor SQL de Supabase. Hasta
              entonces este panel no puede guardar ni leer llamadas.
            </p>
          </div>
        </div>
      ) : (
        <PanelRendimiento
          key={elegida.id}
          usuario={elegida}
          yo={yo.id}
          equipo={equipo}
          puedeSupervisar={puedeSupervisar}
          hoy={hoyMadrid()}
          vinculoInicial={vinculos.get(elegida.id) ?? null}
          // Quien no supervisa solo está aquí si es comercial; quien supervisa puede ser un administrador que no llama
          esComercial={!puedeSupervisar || comerciales.has(user.id)}
          // Solo un administrador pone o quita la clave de Rinkel de otra persona (la ruta lo vuelve a comprobar)
          puedeGestionar={profile.role === 'admin'}
        />
      )}
    </div>
  )
}
