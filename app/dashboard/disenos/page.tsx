import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { ComparadorBoard } from '@/components/disenos/ComparadorBoard'

/**
 * /dashboard/disenos — SOLO ADMIN.
 *
 * La app donde se eligen las propuestas de rediseño del ERP. No cambia nada del
 * ERP: monta cuatro maquetas —las tres propuestas más «como está hoy»— sobre las
 * tres pantallas del diagnóstico, para poder saltar de una a otra y decidir.
 *
 * POR QUÉ SOLO ADMIN, y son dos motivos, no uno:
 *
 *   1. Es una pantalla de DECISIÓN y la decisión la toman los socios. Enseñarle
 *      al equipo tres ERP posibles antes de que haya uno elegido es sembrar tres
 *      expectativas y luego defraudar dos.
 *   2. Dentro hay NOMBRES REALES de cuentas y clientes de la agencia —Shoplamp,
 *      Creative Toys, DIRU, Keslem, Cobo Family, Ocio Global, Yo By Yolanda,
 *      Zapaterías Basoco…— con cifras, estados y notas INVENTADOS. Son reales a
 *      propósito: con relleno no se puede mirar una tabla y decir si se trabaja
 *      mejor o peor con ella. Pero eso significa que aquí dentro sí hay algo que
 *      no debe salir del círculo que ya lo conoce.
 *
 * Está cerrada en tres sitios, y hay que tocarlos los tres si eso cambia:
 *   1. middleware.ts, que evita el viaje.
 *   2. Este redirect, que es el que manda de verdad porque corre en el servidor.
 *   3. El filtro de lib/config/apps.ts, replicado en app/dashboard/page.tsx y en
 *      components/layout/AppSidebar.tsx, para que no salga en la rejilla ni en
 *      el menú de quien no puede entrar.
 *
 * No lleva políticas RLS como amazon-api o empleados por un motivo distinto y
 * más estrecho: no consulta ninguna tabla. Los nombres están escritos en los
 * ficheros de maqueta, así que lo que los protege es este control de rol, no la
 * base de datos.
 */

// No hay datos que cachear —la pantalla es estática salvo por el perfil de quien
// entra—, pero el chequeo de rol tiene que correr en cada petición.
export const dynamic = 'force-dynamic'

export default async function DisenosPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const profile = await getUserProfile()
  if (!profile) redirect('/auth/login')
  if (profile.role !== 'admin') redirect('/dashboard')

  return <ComparadorBoard />
}
