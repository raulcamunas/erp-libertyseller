import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { MisVacaciones } from '@/components/vacaciones/MisVacaciones'
import { loadMyVacations, loadVacationsData, pendingRequests } from '@/lib/employees/vacations'

/**
 * MIS VACACIONES — la pantalla de cada persona.
 *
 * RUTA APARTE, Y ESA ES LA DECISIÓN IMPORTANTE
 * --------------------------------------------
 * Esto no cuelga de /dashboard/empleados. Aquella pantalla enseña el sueldo de
 * todo el equipo y está cerrada a admin en tres sitios (middleware, el guardia
 * de su página y las políticas RLS de la 111); abrirla para que alguien pueda
 * mirar sus vacaciones habría publicado la nómina entera.
 *
 * Aquí no llega ni un dato salarial: `loadMyVacations` devuelve un
 * `VacationEmployee`, que es la ficha SIN sueldo, sin escalones y sin horas, y
 * solo la de quien pregunta. No es que la pantalla decida no pintarlo: es que
 * el servidor no se lo manda.
 *
 * Quién entra: el permiso de la app `vacaciones` lo reparte la migración 116 a
 * admins y employees, y lo comprueba el mapa de middleware.ts. Un partner queda
 * fuera por el bloqueo general de partners que ya hay en middleware.
 */

export const dynamic = 'force-dynamic'

export default async function VacacionesPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const profile = await getUserProfile()
  if (!profile) redirect('/auth/login')

  const data = await loadMyVacations(user.id)

  /**
   * UN ADMIN QUE ENTRA AQUÍ NO VIENE A LO MISMO QUE EL RESTO.
   *
   * Esta app se llama «Mis vacaciones» y sale en el escritorio y en la barra
   * lateral de todo el mundo, admins incluidos. Pero Raúl y Mario no tienen
   * ficha en `employees` —la 112 solo creó las del equipo—, así que lo único
   * que veían era «tu usuario no está enlazado a ninguna ficha» y un enlace
   * presentado como «ve a enlazar tu perfil». Si había tres peticiones
   * esperando respuesta, desde aquí no se llegaba a ellas y nada lo decía.
   *
   * Solo se consulta cuando hace falta: un admin sin ficha propia.
   */
  const colaAdmin =
    profile.role === 'admin' && !data.missingTables && !data.employee
      ? pendingRequests(await loadVacationsData()).length
      : 0

  return (
    <div className="min-w-0">
      <div className="mb-4">
        <h1 className="heading-medium text-white mb-1">Mis vacaciones</h1>
        <p className="text-white/50 text-sm">
          Los días que llevas generados este año, los que ya has cogido y los que puedes pedir.
          Elige las fechas en el calendario y dirección las aprueba. El período es el año natural:
          lo que sobre se arrastra y caduca el 31 de marzo del año siguiente.
        </p>
      </div>

      {data.missingTables ? (
        <Aviso titulo="El módulo todavía no está activo">
          Las tablas de vacaciones aún no existen en la base de datos. Avisa a dirección: hay que
          lanzar la migración <code className="text-amber-200">116_vacations.sql</code> en
          Supabase.
        </Aviso>
      ) : !data.employee && profile.role === 'admin' ? (
        <Aviso titulo="Tú no tienes ficha de empleado, así que no generas vacaciones">
          Las del equipo se aprueban desde el botón <strong>Vacaciones</strong> de{' '}
          <Link href="/dashboard/empleados" className="underline underline-offset-2">
            Control empleados
          </Link>
          : ahí está la cola de peticiones, el saldo de cada persona, el historial de lo ya
          concedido y el formulario para registrar unos días a nombre de quien no tiene cuenta en
          el ERP.
          {colaAdmin > 0 && (
            <>
              {' '}
              Ahora mismo hay{' '}
              <strong>
                {colaAdmin} {colaAdmin === 1 ? 'petición esperando' : 'peticiones esperando'}
              </strong>{' '}
              respuesta.
            </>
          )}
        </Aviso>
      ) : !data.employee ? (
        <Aviso titulo="Tu usuario no está enlazado a ninguna ficha">
          Para poder llevar la cuenta de tus vacaciones, tu cuenta del ERP tiene que estar
          enlazada a tu ficha de empleado. Pídeselo a dirección: se hace desde Control empleados,
          en el campo «Perfil del ERP» de la ficha.
        </Aviso>
      ) : (
        <MisVacaciones employee={data.employee} initialData={data} />
      )}
    </div>
  )
}

function Aviso({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="max-w-2xl rounded-xl border border-amber-500/30 bg-amber-500/10 p-5">
      <p className="text-white font-medium text-sm mb-1">{titulo}</p>
      <p className="text-white/70 text-[13px] leading-relaxed">{children}</p>
    </div>
  )
}
