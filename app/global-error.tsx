'use client'

import { useEffect } from 'react'

/**
 * EL ÚLTIMO RECURSO: CUANDO LO QUE FALLA ES EL LAYOUT RAÍZ.
 *
 * QUÉ PROBLEMA RESUELVE, reproducido con compilación de producción antes de
 * escribir esto: un error.tsx NO cubre el layout.tsx de su propio segmento.
 * Se montó un segmento con un layout que lanza y un error.tsx hermano en la
 * misma carpeta: el resultado es HTTP 500 y el error.tsx NO se pinta (en el
 * árbol RSC ese segmento aparece con `"error":"$undefined"`).
 *
 * Eso es exactamente lo que le pasa a app/dashboard/layout.tsx, que llama a
 * createClient(), auth.getUser() y getUserProfile() ANTES de pintar nada: si
 * cualquiera de las tres lanza, el app/dashboard/error.tsx que ya existe —y
 * que está bien escrito— no aparece por ningún lado.
 *
 * Lo que se veía hasta ahora en ese caso NO era una pantalla en blanco: era el
 * GlobalError por defecto de Next, que se pinta al hidratar y dice
 * «Application error: a server-side exception has occurred (see the server
 * logs for more information). Digest: 3660396334». Feo, en inglés y sin decir
 * a nadie qué hacer. Este fichero lo sustituye por lo mismo en español y con
 * el mismo criterio que app/dashboard/error.tsx.
 *
 * OJO, Y ES EL ÚNICO CAMBIO DE ESTE FICHERO QUE SE VE: el texto que lee una
 * persona SÍ cambia, pero solo en el caso en que hoy ya está todo roto. En
 * cualquier pantalla que funcione, este componente no se monta nunca.
 *
 * DOS DETALLES OBLIGADOS DE NEXT:
 *  1. global-error.tsx SUSTITUYE al layout raíz, así que tiene que traer sus
 *     propias etiquetas <html> y <body>.
 *  2. Por lo mismo, no hereda el <body className="antialiased"> ni la fuente
 *     Inter del layout. Los estilos van EN LÍNEA a propósito y no con clases
 *     de Tailwind: si lo que ha fallado impide cargar la hoja de estilos, una
 *     pantalla de error sin estilos es ilegible. Los colores son los mismos
 *     literales de app/globals.css (--ls-fondo, --ls-sup, --ls-linea, --ls-t1,
 *     --ls-t3, --ls-e-rojo) para que no desentone con el resto del ERP.
 *
 * QUÉ SE ENSEÑA Y QUÉ NO: mismo criterio que app/dashboard/error.tsx. El
 * digest siempre, porque es lo único que permite encontrar el fallo en los
 * registros. El mensaje de la excepción SOLO en desarrollo: en producción
 * puede llevar dentro una consulta, un identificador de cliente o el nombre de
 * una tabla, y aquí hay datos de tiendas ajenas.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Fallo en el layout raíz del ERP:', error)
  }, [error])

  const enDesarrollo = process.env.NODE_ENV === 'development'

  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          backgroundColor: '#0F1114',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 560,
            borderRadius: 8,
            border: '1px solid #262A31',
            backgroundColor: '#15171B',
            padding: 20,
          }}
        >
          <h1
            style={{
              margin: '0 0 12px',
              fontSize: 15,
              fontWeight: 600,
              color: '#F87171',
            }}
          >
            El ERP no ha podido arrancar esta página
          </h1>

          <p
            style={{
              margin: '0 0 12px',
              fontSize: 13,
              lineHeight: 1.6,
              color: '#A2A9B4',
            }}
          >
            El fallo es del servidor, no de lo que estabas haciendo: no se ha guardado nada a
            medias. Si al volver a intentarlo sigue igual, pasa el código de abajo, que es lo que
            permite encontrarlo en los registros.
          </p>

          {error.digest && (
            <p style={{ margin: '0 0 12px', fontSize: 12, color: '#A2A9B4' }}>
              Código del fallo:{' '}
              <code
                style={{
                  borderRadius: 4,
                  backgroundColor: '#1A1D22',
                  padding: '2px 6px',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 12,
                  color: '#CBD0D8',
                }}
              >
                {error.digest}
              </code>
            </p>
          )}

          {enDesarrollo && error.message && (
            <pre
              style={{
                margin: '0 0 12px',
                maxHeight: 180,
                overflow: 'auto',
                borderRadius: 4,
                backgroundColor: '#1A1D22',
                padding: 8,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 11,
                lineHeight: 1.6,
                color: '#CBD0D8',
                whiteSpace: 'pre-wrap',
              }}
            >
              {error.message}
            </pre>
          )}

          <button
            onClick={reset}
            style={{
              height: 28,
              borderRadius: 4,
              border: '1px solid #262A31',
              backgroundColor: '#1A1D22',
              padding: '0 10px',
              fontSize: 12,
              color: '#F4F5F7',
              cursor: 'pointer',
            }}
          >
            Volver a intentarlo
          </button>
        </div>
      </body>
    </html>
  )
}
