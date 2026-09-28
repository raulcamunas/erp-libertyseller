import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect } from 'next/navigation'
import { ColdCallingBoard } from '@/components/cold-calling/ColdCallingBoard'
import { ColdLead } from '@/lib/types/cold-leads'
import { CalendarPerson } from '@/lib/types/appointments'

export default async function ColdCallingPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const profile = await getUserProfile()
  if (!profile) redirect('/auth/login')

  const isAdmin = profile.role === 'admin' || profile.role === 'partner'

  // RLS ya limita a cada comercial su cartera; los admins reciben todo.
  //
  // Hay que pedirlo por tramos: Supabase corta cualquier consulta a 1.000
  // filas por defecto (ajuste max-rows de PostgREST) y un .limit() mayor
  // no lo salta, porque el tope lo aplica el servidor. Con casi 4.000
  // leads, sin esto solo llegaban los 1.000 primeros.
  //
  // AVISO PARA LA SIGUIENTE TANDA: con los 2.000 de la lista nueva esto son
  // ~6.000 filas y seis peticiones, y sigue aguantando. Las 21.320 tiendas que
  // quedan en el Excel NO caben así: serían 27 peticiones y un array de 27.000
  // filas enviado entero al cliente, donde el board hace useMemo sobre todo él.
  // Antes de importar el resto hay que filtrar por tipo_lead y por comercial EN
  // EL SERVIDOR y paginar de verdad; no es una mejora posterior.
  const CHUNK = 1000
  const leads: ColdLead[] = []
  for (let from = 0; ; from += CHUNK) {
    const { data, error } = await supabase
      .from('cold_leads')
      // Solo lo que se pinta en la lista y lo que se usa para buscar y
      // filtrar. Los campos largos — directivos, dirección, registro
      // mercantil, URL del seller — son de la ficha, y con casi 4.000 leads
      // pesaban más que todo lo demás junto en la carga inicial. Se piden
      // al abrir el lead.
      .select(`
        id, store_name, company, revenue_monthly, phone, email,
        province, category, seller_url,
        tipo_lead, vende_en_amazon, nivel, ventas_estimadas_usd,
        ciudad, tipo_empresa, web,
        assigned_to, status, follow_up, next_call_date,
        last_contacted_at, call_attempts, source_list,
        created_at, updated_at
      `)
      // ESTE ORDEN SOLO DECIDE EN QUÉ TRAMO VIENE CADA FILA, no lo que se ve:
      // el bucle se trae la tabla entera y el orden de pantalla lo pone
      // ColdCallingBoard. Se deja determinista —con `id` al final— porque un
      // orden con empates hace que una misma fila aparezca en dos tramos y
      // otra en ninguno.
      //
      // El segundo criterio es para las tiendas online, que traen
      // `revenue_monthly` nulo (su cifra está en ventas_estimadas_usd): sin él
      // las 2.000 llegan en un orden cualquiera. Quién va primero en pantalla
      // lo resuelve pesoOrden() en el board, que no mezcla las dos monedas
      // para nada más que para colocar la fila.
      .order('revenue_monthly', { ascending: false, nullsFirst: false })
      .order('ventas_estimadas_usd', { ascending: false, nullsFirst: false })
      .order('id', { ascending: true })
      .range(from, from + CHUNK - 1)

    if (error) {
      console.error('Error cargando leads de cold calling:', error)
      break
    }
    if (!data || data.length === 0) break
    leads.push(...(data as unknown as ColdLead[]))
    if (data.length < CHUNK) break
  }

  const { data: team } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, calendar_color')
    .eq('is_comercial', true)
    .order('full_name', { ascending: true })

  return (
    <div className="flex flex-col h-[calc(100dvh-8rem)] lg:h-[calc(100vh-4rem)] min-w-0">
      <div className="mb-3 flex-shrink-0">
        <h1 className="heading-medium text-white mb-1">Cold Calling</h1>
        <p className="text-white/50 text-sm">
          Tu cartera: vendedores que ya están en Amazon y tiendas online a las
          que hay que meter. Estado de cada uno, historial de llamadas y todo lo
          que necesitas para la siguiente.
        </p>
      </div>

      <div className="flex-1 min-h-0 min-w-0">
        <ColdCallingBoard
          initialLeads={leads}
          team={(team as CalendarPerson[]) || []}
          currentUser={profile}
          isAdmin={isAdmin}
        />
      </div>
    </div>
  )
}
