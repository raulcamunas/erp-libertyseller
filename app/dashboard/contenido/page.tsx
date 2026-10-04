import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect } from 'next/navigation'
import { CalendarioContenido } from '@/components/contenido/CalendarioContenido'
import type { ContenidoPieza, EncargoResuelto } from '@/lib/types/contenido'

export const dynamic = 'force-dynamic'

export default async function ContenidoPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const profile = await getUserProfile()
  if (!profile) redirect('/auth/login')

  // DESDE HACE SESENTA DÍAS, no todo.
  //
  // El calendario no tiene volumen —nueve encargos por semana, unos quinientos al
  // año— pero traerlo entero crece sin techo y nadie navega dos años atrás. Con
  // sesenta días se cubre el mes pasado completo, que es lo que se mira para saber
  // si el plan se cumplió, y hacia delante no hay límite porque lo que se programa
  // es futuro.
  const desde = new Date()
  desde.setDate(desde.getDate() - 60)
  const desdeISO = desde.toISOString().slice(0, 10)

  const [encargosRes, piezasRes, perfilesRes] = await Promise.all([
    supabase
      .from('contenido_calendario')
      .select(
        `id, fecha, pieza_id, responsable_id, estado, publicado_at, nota, creado_at,
         pieza:contenido_piezas (*),
         responsable:profiles!contenido_calendario_responsable_id_fkey (id, full_name, email)`,
      )
      .gte('fecha', desdeISO)
      .order('fecha'),
    supabase.from('contenido_piezas').select('*').order('creado_at', { ascending: false }),
    supabase.from('profiles').select('id, full_name, email, role').order('full_name'),
  ])

  // SI FALLA, FALLA.
  //
  // Un calendario al que le falta la mitad de las filas no se distingue de uno en
  // el que esa semana no había nada programado, y lo que pasa entonces es que
  // nadie publica el jueves. Mejor la pantalla de error, que al menos se ve.
  const error = encargosRes.error ?? piezasRes.error ?? perfilesRes.error
  if (error) throw new Error(`No se pudo cargar el calendario de contenido: ${error.message}`)

  return (
    <CalendarioContenido
      encargos={(encargosRes.data ?? []) as unknown as EncargoResuelto[]}
      piezas={(piezasRes.data ?? []) as ContenidoPieza[]}
      perfiles={perfilesRes.data ?? []}
      usuarioId={profile.id}
      puedeGestionarPiezas={profile.role === 'admin' || profile.role === 'partner'}
    />
  )
}
