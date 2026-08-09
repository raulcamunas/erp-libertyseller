import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { loadAmazonData } from '@/lib/amazon/data'
import { loadPerfiles } from '@/lib/stock-sync/perfiles'
import { hasTokenKey } from '@/lib/amazon/crypto'
import { humanMessageOf } from '@/lib/amazon/errors'
import { appIsDraft, lwaConfig } from '@/lib/amazon/lwa'
import { Carcasa } from '@/components/amazon-api/Carcasa'
import { PARAM_PESTANA, pestanaDesdeUrl } from '@/components/amazon-api/pestanas'

/**
 * /dashboard/amazon-api — LAS TRIPAS. SOLO ADMIN.
 *
 * Ocho pestañas sobre una sola idea: aquí se configura con qué va a trabajar la
 * agencia en la cuenta de cada cliente, y aquí se ve toda la información que
 * guardamos de sus productos y sus cuentas. El TRABAJO sobre esa cuenta
 * —sincronizar el stock, vigilar la Buy Box, decidir un FBM→FBA— es el otro
 * módulo: Growth Partner, en /dashboard/growth.
 *
 * Aquí dentro vive ahora lo que antes era el módulo «Plataforma Amazon», en la
 * pestaña Ingesta. Aquella dirección redirige.
 *
 *
 * ============ POR QUÉ SOLO ADMIN ============
 *
 * Desde este módulo se cambian precios y stock en las tiendas de los CLIENTES de
 * la agencia, y aquí se guardan las llaves de acceso a esas tiendas. El listón es
 * el mismo que en Control empleados: ni employees ni partners.
 *
 * Está cerrado en cuatro sitios, y solo el último manda de verdad:
 *   1. middleware.ts, que evita el viaje.
 *   2. APPS_SOLO_ADMIN en lib/config/apps.ts, que lo quita de la rejilla de
 *      /dashboard y del menú lateral de una vez (antes eran cuatro `if` escritos
 *      a mano en dos ficheros).
 *   3. El redirect de esta misma función, que corre en el servidor.
 *   4. Las políticas RLS de la migración 118. `authenticated` no tiene NINGÚN
 *      permiso sobre amazon_connections —ni SELECT—, así que la tabla de los
 *      tokens no se puede leer desde el navegador ni siendo admin. Todo lo que
 *      se pinta aquí viene del servidor, con service_role y una lista de columnas
 *      explícita que no incluye el token.
 */

export const dynamic = 'force-dynamic'

/** Lo que hay que pegar en el editor SQL de Supabase para que esto funcione */
const MIGRATIONS = [
  {
    file: '118_amazon_api.sql',
    what: 'clientes, conexiones, espejo del catálogo y registro de cambios',
  },
  {
    file: '119_amazon_api_fixes.sql',
    what: 'el vendedor con el que se abre cada autorización y el aviso de catálogo incompleto',
  },
]

function PendingMigrations() {
  return (
    <div className="max-w-2xl">
      <h1 className="heading-medium text-white mb-1">Amazon API</h1>
      <p className="text-white/50 text-sm mb-5">
        El módulo está desplegado pero sus tablas todavía no existen en la base de datos.
      </p>

      <div className="rounded-xl border border-yellow-500/30 bg-yellow-400/[0.09] p-5">
        <p className="text-white/80 text-sm mb-4">
          Abre el editor SQL de Supabase y pega este fichero de{' '}
          <code className="text-white/60">supabase/migrations/</code>:
        </p>

        <ol className="space-y-2 mb-4">
          {MIGRATIONS.map((m, i) => (
            <li key={m.file} className="flex gap-3 text-sm">
              <span className="text-yellow-400/70 tabular-nums">{i + 1}.</span>
              <span className="min-w-0">
                <code className="text-yellow-200">{m.file}</code>
                <span className="text-white/45"> — {m.what}</span>
              </span>
            </li>
          ))}
        </ol>

        <p className="text-white/45 text-xs leading-relaxed">
          Se ejecutan enteros en una transacción cada uno: si algo falla, no se queda a medias. Los
          dos son idempotentes, así que se pueden lanzar aunque uno ya estuviera aplicado. El resto
          del ERP funciona con normalidad mientras tanto.
        </p>
      </div>
    </div>
  )
}

/**
 * Qué falta por configurar en el servidor, si falta algo.
 *
 * Devuelve NOMBRES de variables y para qué sirve cada una, nunca su valor: este
 * texto acaba en una pantalla y, de ahí, en una captura de un chat.
 */
function configError(): string | null {
  const partes: string[] = []
  try {
    lwaConfig()
  } catch (error) {
    partes.push(humanMessageOf(error))
  }
  if (!hasTokenKey()) {
    partes.push(
      'Falta configurar AMAZON_TOKEN_KEY en el servidor (la clave con la que se cifran las llaves de acceso a las tiendas; se genera con «openssl rand -base64 32»).'
    )
  }
  return partes.length > 0 ? partes.join(' ') : null
}

export default async function AmazonApiPage({
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

  // Aquí se guardan las llaves de las tiendas de los clientes y desde aquí se
  // les cambia el precio: solo admin, ni siquiera los socios.
  if (profile.role !== 'admin') redirect('/dashboard')

  const data = await loadAmazonData()

  // La migración se lanza a mano en el editor SQL de Supabase, así que el
  // código puede llegar desplegado antes que ella. Se explica en vez de
  // reventar con una pantalla negra y un número de digest.
  if (data.missingTables) return <PendingMigrations />

  /**
   * Los orígenes se cargan aparte y NO cortan la pantalla: sin ellos el catálogo
   * y los envíos a mano funcionan igual, y lo único que falta es la pestaña
   * Origen, que lo explica por su cuenta. Cortar aquí dejaría sin módulo a quien
   * solo quiere mirar precios.
   *
   * Y EL try/catch NO SOBRA. loadPerfiles solo atrapa por su cuenta el caso «la
   * tabla no existe»; cualquier otro fallo de esas cuatro consultas —un permiso,
   * un timeout de PostgREST— se propagaba y se llevaba por delante la pantalla
   * entera, incluidos el catálogo y la edición a mano, que no tocan ninguna de
   * estas tablas. Un problema en lo nuevo no puede romper lo que ya funcionaba.
   */
  const perfiles = await loadPerfiles().catch((error) => {
    console.error('No se han podido cargar los orígenes de fichero:', error)
    return null
  })

  /**
   * La pestaña sale de la URL y se valida AQUÍ, en el servidor.
   *
   * Un `?p=` inventado, un enlace mal copiado o una dirección vieja caen en la
   * pestaña por defecto, que es una pantalla útil. Nunca en blanco.
   */
  const bruto = searchParams[PARAM_PESTANA]
  const pestanaInicial = pestanaDesdeUrl(Array.isArray(bruto) ? bruto[0] : bruto)

  return (
    // El alto fijo con scroll interno es el patrón de las pantallas con tabla
    // del ERP. El `min-w-0` es el eslabón de esta pantalla en la cadena que
    // mantiene el scroll horizontal DENTRO de la tabla: sin él, siete columnas
    // arrastran la página de lado y se llevan la barra lateral por delante.
    <div className="flex flex-col h-[calc(100dvh-8rem)] lg:h-[calc(100vh-4rem)] min-w-0">
      {/* El <h1> y las pestañas van DENTRO de la carcasa, en la misma fila, y la
          explicación del módulo detrás del botón de información. Aquí ya no hay
          entradilla: el párrafo que vivía encima de los controles es justo lo
          que se ha pedido quitar de en medio de la pantalla. */}
      <Carcasa
        initialData={data}
        perfiles={perfiles}
        configError={configError()}
        appDraft={appIsDraft()}
        pestanaInicial={pestanaInicial}
      />
    </div>
  )
}
