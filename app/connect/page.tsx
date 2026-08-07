import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { handleAppstoreEntry, type QueryParams } from '@/lib/amazon/oauth'
import { PaginaPublica } from '@/components/amazon/PaginaPublica'

/**
 * /connect — LA ENTRADA DESDE EL APPSTORE DE SELLER CENTRAL. RUTA PÚBLICA.
 *
 * Es la «OAuth Login URI» que está registrada en el portal de desarrollador de
 * Amazon. Aquí llega el CLIENTE, sin sesión en el ERP, después de pulsar
 * «Autorizar» dentro de su Seller Central; Amazon nos manda su
 * `amazon_callback_uri`, su `amazon_state` y su `selling_partner_id`, y espera
 * que le devolvamos al vendedor a esa dirección con nuestro `state` añadido.
 *
 * TRES COSAS QUE HACEN QUE ESTO TENGA QUE SER UNA RUTA DE PRIMER NIVEL:
 *   - Está excluida del salto al login en middleware.ts. Antes contestaba un
 *     307 hacia /auth/login, que para el cliente es el flujo roto sin más.
 *   - NO puede colgar de /dashboard: app/dashboard/layout.tsx exige perfil y
 *     redirige a /auth/login antes de que se pinte nada.
 *   - La dirección está registrada en el portal de Amazon y no se puede cambiar
 *     sin volver a pasar por allí.
 *
 * La lógica está entera en lib/amazon/oauth.ts. Aquí solo se decide si se
 * redirige o se pinta.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Conectar tu cuenta de Amazon · Liberty Seller',
  // Esta página no tiene nada que hacer en un buscador y además lleva
  // parámetros de un flujo de autorización en la URL.
  robots: { index: false, follow: false },
}

export default async function ConnectPage({
  searchParams,
}: {
  searchParams: QueryParams
}) {
  const resultado = await handleAppstoreEntry(searchParams)

  // redirect() lanza por dentro, así que va fuera de cualquier try/catch.
  if (resultado.kind === 'redirect') redirect(resultado.url)

  return (
    <PaginaPublica tono={resultado.kind === 'error' ? 'error' : 'info'} title={resultado.title}>
      <p>{resultado.message}</p>
      {resultado.kind === 'error' && resultado.detail && (
        <p className="text-white/40 text-[12px]">{resultado.detail}</p>
      )}
    </PaginaPublica>
  )
}
