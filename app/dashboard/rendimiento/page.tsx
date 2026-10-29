import { AlertTriangle } from 'lucide-react'
import { redirect } from 'next/navigation'
import { PanelRendimiento } from '@/components/rendimiento/PanelRendimiento'
import { CAMPOS_DEL_VINCULO, type Miembro, type VinculoVisible } from '@/components/rendimiento/tipos'
import { puedeVerEquipoComercial } from '@/lib/equipo-comercial/acceso'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { hoyMadrid } from '@/lib/rendimiento/dia'
import { leerEquipoMedido } from '@/lib/rendimiento/equipo'
import { periodoDeTexto } from '@/lib/rendimiento/periodos'
import { UUID } from '@/lib/amazon/api'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { createClient } from '@/lib/supabase/server'

/**
 * MI RENDIMIENTO.
 *
 * Cada comercial entra y ve SU panel: llamadas hechas, WhatsApp, correos, respuestas y citas de un día, una semana
 * o un mes, comparado con el periodo anterior, y el calendario de sus llamadas con las grabaciones. Quien supervisa
 * al equipo (admin, partner o el permiso suelto 'equipo-comercial') aterriza en «Todo el equipo» y puede mirar a
 * cualquier persona.
 *
 * LA DIRECCIÓN GUARDA QUIÉN Y CUÁNDO:  ?comercial=<id>&p=semana&f=2026-10-19  (sin nada: el equipo, hoy). El panel la
 * va actualizando al moverse, así que recargar o compartir enseña lo mismo.
 *
 * ESTO SOLO DECIDE QUÉ SE PINTA. Quien recorta de verdad son las políticas RLS de las tablas rinkel_* y de las
 * que se leen para las cifras (cold_lead_notes, appointments): la pantalla no filtra por comercial, así que
 * pedir el panel de otra persona sin supervisar devuelve vacío, no sus datos. El id de la URL solo se acepta si
 * es de alguien del equipo que esta persona puede ver; cualquier otro valor se ignora.
 *
 * EL PANEL NECESITA LAS MIGRACIONES 234 (Rinkel) Y 235 (la función rendimiento_resumen_diario). Si falta una, la
 * página lo dice con el nombre del fichero que hay que lanzar en vez de enseñar un panel vacío; desplegar el código
 * antes que el SQL no estropea nada.
 */
export const dynamic = 'force-dynamic'

const nombreDe = (p: { full_name: string | null; email: string | null }) => p.full_name?.trim() || p.email || 'Sin nombre'
const primero = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

function Aviso({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-[10px] border border-l-2 border-[var(--ls-linea)] border-l-[var(--ls-e-ambar)] bg-[var(--ls-sup)] p-4">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--ls-e-ambar)]" />
      <div className="text-[13px] leading-relaxed text-[var(--ls-t2)]">
        <p className="mb-1 font-semibold text-[var(--ls-t1)]">{titulo}</p>
        <p>{children}</p>
      </div>
    </div>
  )
}

export default async function RendimientoPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const profile = await getUserProfile()
  if (!profile) redirect('/auth/login')

  const puedeSupervisar = await puedeVerEquipoComercial(profile.role, user.id)
  const hoy = hoyMadrid()

  // El equipo que se puede elegir. Quien no supervisa solo se ve a sí mismo
  const yo = { id: user.id, nombre: nombreDe(profile) }
  const personas = new Map<string, { id: string; nombre: string }>([[yo.id, yo]])
  const comerciales = new Set<string>()
  if (puedeSupervisar) {
    // Los comerciales y los managers comerciales (lib/rendimiento/equipo.ts): un manager también llama, tiene su Rinkel y se mide en la misma tabla
    const { data } = await leerEquipoMedido(supabase)
    for (const p of data ?? []) {
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
  const vinculosVisibles = (vinculosBrutos ?? []) as VinculoVisible[]
  const vinculos = new Map(vinculosVisibles.map((v) => [v.user_id, v]))

  // ¿Está lanzada la migración 235? Se pregunta por el día de hoy: cuesta una fila. Solo «no existe la función» cuenta como
  // falta de migración; otro fallo se apunta en el registro y el panel lo dirá con su propio aviso al leer las cifras
  let faltaResumen = false
  if (!faltaMigracion) {
    const { error: errorResumen } = await supabase.rpc('rendimiento_resumen_diario', { p_desde: hoy, p_hasta: hoy })
    if (errorResumen) {
      if (isMissingSchema(errorResumen)) faltaResumen = true
      else console.error('Rendimiento: el resumen diario ha fallado', errorResumen)
    }
  }

  const pedido = primero(searchParams.comercial)
  const pedidoValido = puedeSupervisar && pedido && UUID.test(pedido) && personas.has(pedido) ? pedido : null

  const equipo: Miembro[] = puedeSupervisar
    ? [...personas.values()].map((p) => ({ id: p.id, nombre: p.nombre, vinculado: vinculos.has(p.id), comercial: comerciales.has(p.id) }))
    : []

  // Quien no supervisa solo está aquí si es del equipo que se mide (comercial o manager); quien supervisa puede ser un administrador que no llama
  const esComercial = !puedeSupervisar || comerciales.has(user.id)
  // Solo un administrador pone o quita la clave de Rinkel de otra persona (la ruta lo vuelve a comprobar)
  const puedeGestionar = profile.role === 'admin'
  // El botón «Actividad del equipo» (al lado del informe semanal) solo lo ve quien puede abrir esa pantalla: un administrador o quien
  // tenga la casilla «Actividad del equipo» (app 'actividad'). La pantalla y sus rutas lo vuelven a comprobar
  let puedeVerActividad = profile.role === 'admin'
  if (!puedeVerActividad) {
    const { data: permisoActividad } = await supabase.from('user_app_permissions').select('can_access').eq('user_id', user.id).eq('app_id', 'actividad').maybeSingle()
    puedeVerActividad = permisoActividad?.can_access === true
  }
  // El botón «Configuración de la IA» (lo que escriben la IA en el correo y en WhatsApp y qué versión convierte más): un administrador o quien tenga la casilla
  // suelta «Configuración de la IA» ('config-correos'). La pantalla y sus rutas lo vuelven a comprobar
  let puedeConfigurarCorreos = profile.role === 'admin'
  if (!puedeConfigurarCorreos && profile.role !== 'partner') {
    const { data: permisoCorreos } = await supabase.from('user_app_permissions').select('can_access').eq('user_id', user.id).eq('app_id', 'config-correos').maybeSingle()
    puedeConfigurarCorreos = permisoCorreos?.can_access === true
  }

  return (
    <div className="space-y-3 pb-10">
      <div>
        <h1 className="mb-0.5 text-[22px] font-semibold leading-tight tracking-[-0.012em] text-[var(--ls-t1)]">{puedeSupervisar ? 'Rendimiento' : 'Mi rendimiento'}</h1>
        <p className="text-[13px] text-[var(--ls-t3)]">
          {puedeSupervisar
            ? 'Cómo va el equipo y cada persona: llamadas, conversaciones, respuestas y citas, comparado con el periodo anterior. Las llamadas y sus grabaciones se leen del Rinkel de cada uno.'
            : 'Lo que has hecho: llamadas, mensajes, correos, respuestas y citas, y cómo van frente a antes. Las llamadas y sus grabaciones se leen de tu Rinkel.'}
        </p>
      </div>

      {faltaMigracion ? (
        <Aviso titulo="Falta preparar la base de datos">
          Hay que lanzar la migración <span className="font-mono text-[var(--ls-t1)]">234_rendimiento_rinkel.sql</span> en el editor SQL de Supabase. Hasta entonces este panel no
          puede guardar ni leer llamadas.
        </Aviso>
      ) : faltaResumen ? (
        <Aviso titulo="Falta lanzar una migración para ver las cifras">
          Hay que lanzar <span className="font-mono text-[var(--ls-t1)]">235_rendimiento_resumen_diario.sql</span> en el editor SQL de Supabase.
        </Aviso>
      ) : (
        <PanelRendimiento
          yo={yo}
          equipo={equipo}
          puedeSupervisar={puedeSupervisar}
          puedeGestionar={puedeGestionar}
          puedeVerActividad={puedeVerActividad}
          puedeConfigurarCorreos={puedeConfigurarCorreos}
          esComercial={esComercial}
          hoy={hoy}
          vinculosIniciales={vinculosVisibles}
          personaInicial={pedidoValido}
          periodoInicial={periodoDeTexto(primero(searchParams.p), primero(searchParams.f), hoy)}
        />
      )}
    </div>
  )
}
