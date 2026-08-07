import type { Metadata } from 'next'
import { handleCallback, type QueryParams } from '@/lib/amazon/oauth'
import { Dato, PaginaPublica } from '@/components/amazon/PaginaPublica'

/**
 * /callback — LA VUELTA DE AMAZON. RUTA PÚBLICA.
 *
 * Es la «Redirect URI» registrada en el portal de desarrollador. Aquí aterriza
 * el CLIENTE justo después de dar su consentimiento en Seller Central, con tres
 * parámetros: `state`, `selling_partner_id` y `spapi_oauth_code`.
 *
 * LO QUE PASA AQUÍ, EN ORDEN, Y POR QUÉ ESE ORDEN:
 *
 *   1. Se comprueba el `state`: que exista, que sea el nuestro, que no haya
 *      caducado y que no se haya usado ya — y se quema en el acto. Si algo no
 *      cuadra, se corta y no se canjea nada. Es la única defensa que hay: si se
 *      aceptara un callback sin validar, alguien podría hacer que el ERP se
 *      guardara la llave de OTRA tienda dentro de la ficha de un cliente
 *      nuestro, y a partir de ahí los cambios de precio saldrían hacia donde no
 *      deben.
 *   2. Solo después se canjea el código por el refresh token, EN EL SERVIDOR y
 *      dentro de esta misma petición: el código de Amazon caduca en unos cinco
 *      minutos y no cabe ni una cola ni un trabajo diferido.
 *   3. El token se guarda cifrado. Nunca baja al navegador, ni siquiera aquí.
 *
 * Y lo que ve el cliente es una página en español, no un JSON: para él esto no
 * es una llamada de API, es el momento en el que ha conectado su tienda con
 * nosotros. Todo eso vive en lib/amazon/oauth.ts.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Cuenta de Amazon conectada · Liberty Seller',
  robots: { index: false, follow: false },
}

export default async function CallbackPage({
  searchParams,
}: {
  searchParams: QueryParams
}) {
  const resultado = await handleCallback(searchParams)

  if (resultado.kind === 'ok') {
    return (
      <PaginaPublica tono="ok" title="Tu cuenta de Amazon ya está conectada">
        <p>
          Gracias. A partir de ahora el equipo de Liberty Seller puede consultar tu catálogo y
          mantener al día tus precios y tu stock desde nuestro sistema, sin que tengas que subir
          ficheros a mano.
        </p>

        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3.5 space-y-2 my-4">
          <Dato label="Tienda" value={resultado.storeName} />
          <Dato label="Región" value={resultado.regionLabel} />
          {resultado.marketplaces.length > 0 && (
            <Dato label="Países" value={resultado.marketplaces.join(', ')} />
          )}
        </div>

        {resultado.warning && <p className="text-yellow-300">{resultado.warning}</p>}

        <p className="text-white/45">
          Puedes retirarnos el acceso cuando quieras desde tu Seller Central, en la sección de
          aplicaciones y servicios. Ya puedes cerrar esta ventana.
        </p>
      </PaginaPublica>
    )
  }

  return (
    <PaginaPublica tono={resultado.kind === 'error' ? 'error' : 'info'} title={resultado.title}>
      <p>{resultado.message}</p>
      {resultado.kind === 'error' && resultado.detail && (
        <p className="text-white/40 text-[12px]">{resultado.detail}</p>
      )}
    </PaginaPublica>
  )
}
