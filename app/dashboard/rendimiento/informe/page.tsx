import { AlertTriangle, ArrowLeft } from 'lucide-react'
import { redirect } from 'next/navigation'
import { InformeSemanal } from '@/components/rendimiento/informe/InformeSemanal'
import type { Miembro } from '@/components/rendimiento/tipos'
import { puedeVerEquipoComercial } from '@/lib/equipo-comercial/acceso'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { hoyMadrid } from '@/lib/rendimiento/dia'
import { lunesDeTexto } from '@/lib/rendimiento/informe'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { createClient } from '@/lib/supabase/server'

/**
 * EL INFORME SEMANAL DEL EQUIPO COMERCIAL.
 *
 * Una página a pantalla completa con la semana entera de todos los comerciales —cifras, día a día, horarios, citas y
 * lo que contestaron los clientes— para revisarla en la reunión del lunes. Por defecto, la última semana completa.
 *
 * SOLO PARA QUIEN SUPERVISA al equipo (admin, partner o el permiso suelto 'equipo-comercial'): quien no, vuelve al
 * panel de siempre, que le enseña lo suyo. Esto solo decide si se pinta; quien recorta de verdad son las políticas
 * RLS de las tablas que se leen (rinkel_llamadas, cold_lead_notes, appointments y la función del resumen diario).
 *
 * LA DIRECCIÓN GUARDA LA SEMANA:  ?semana=2026-10-19  (cualquier día de ella vale; el informe la va actualizando).
 */
export const dynamic = 'force-dynamic'

const nombreDe = (p: { full_name: string | null; email: string | null }) => p.full_name?.trim() || p.email || 'Sin nombre'
const primero = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

function Aviso({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-amber-400/30 bg-amber-400/[0.06] p-4 flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-300 shrink-0 mt-0.5" />
        <div className="text-[13px] text-white/75 leading-relaxed">
          <p className="font-semibold text-white mb-1">{titulo}</p>
          <p>{children}</p>
        </div>
      </div>
      <a href="/dashboard/rendimiento" className="inline-flex items-center gap-1.5 text-[13px] text-white/60 hover:text-white transition-colors">
        <ArrowLeft className="h-4 w-4" /> Volver a Rendimiento
      </a>
    </div>
  )
}

export default async function InformeSemanalPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const profile = await getUserProfile()
  if (!profile) redirect('/auth/login')

  if (!(await puedeVerEquipoComercial(profile.role, user.id))) redirect('/dashboard/rendimiento')

  const hoy = hoyMadrid()

  const { data: comerciales, error: errorComerciales } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .eq('is_comercial', true)
    .order('full_name', { ascending: true })
  if (errorComerciales) {
    console.error('Informe semanal: no se ha podido leer el equipo comercial', errorComerciales)
    throw new Error('No se ha podido leer el equipo comercial. Recarga la página.')
  }

  // Quién tiene Rinkel vinculado: sin eso sus llamadas no cuentan y el informe lo dice
  const { data: vinculos, error: errorVinculos } = await supabase.from('rinkel_vinculos').select('user_id')
  if (errorVinculos && isMissingSchema(errorVinculos)) {
    return (
      <Aviso titulo="Falta preparar la base de datos">
        Hay que lanzar <span className="font-mono text-white/90">234_rendimiento_rinkel.sql</span> en el editor SQL de Supabase.
      </Aviso>
    )
  }
  if (errorVinculos) {
    console.error('Informe semanal: no se han podido leer los vínculos de Rinkel', errorVinculos)
    throw new Error('No se ha podido leer el estado de Rinkel. Recarga la página.')
  }
  const conRinkel = new Set(((vinculos ?? []) as Array<{ user_id: string }>).map((v) => v.user_id))

  // ¿Está lanzada la migración 235? Sin la función del resumen diario no hay informe
  const { error: errorResumen } = await supabase.rpc('rendimiento_resumen_diario', { p_desde: hoy, p_hasta: hoy })
  if (errorResumen) {
    if (isMissingSchema(errorResumen)) {
      return (
        <Aviso titulo="Falta lanzar una migración para ver el informe semanal">
          Hay que lanzar <span className="font-mono text-white/90">235_rendimiento_resumen_diario.sql</span> en el editor SQL de Supabase.
        </Aviso>
      )
    }
    console.error('Informe semanal: el resumen diario ha fallado', errorResumen)
    throw new Error('No se han podido leer las cifras. Recarga la página.')
  }

  const equipo: Miembro[] = ((comerciales ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map((p) => ({
    id: p.id,
    nombre: nombreDe(p),
    vinculado: conRinkel.has(p.id),
    comercial: true,
  }))

  return <InformeSemanal equipo={equipo} hoy={hoy} lunesInicial={lunesDeTexto(primero(searchParams.semana), hoy)} />
}
