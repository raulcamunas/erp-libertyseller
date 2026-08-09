'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle, RotateCw } from 'lucide-react'

/**
 * LA PANTALLA DE «ESTO SE HA ROTO», PARA LOS TREINTA MÓDULOS.
 *
 * Hasta ahora no había NINGUNA en toda la aplicación: ni error.tsx, ni
 * global-error.tsx. Por eso un fallo de servidor salía en negro absoluto, sin
 * una línea que dijera qué había pasado —solo un número de digest en producción,
 * que es justo lo que app/dashboard/amazon-api/page.tsx dedica un comentario
 * entero a decir que se quería evitar—.
 *
 * Un fichero cubre todo /dashboard porque Next busca el error.tsx más cercano
 * hacia arriba. Si algún módulo quiere el suyo propio, lo pone en su carpeta y
 * este deja de aplicarle.
 *
 *
 * ============ QUÉ SE ENSEÑA Y QUÉ NO ============
 *
 * El DIGEST sí: es lo único que permite encontrar el error de verdad en los
 * registros del servidor, y sin él la única forma de saber qué pasó es
 * reproducirlo.
 *
 * El MENSAJE de la excepción, solo en desarrollo. En producción Next ya lo
 * sustituye por un texto genérico a propósito, porque un mensaje de error puede
 * llevar dentro una consulta, un identificador de cliente o el nombre de una
 * tabla. Aquí no se le da la vuelta a esa decisión: aquí hay datos de tiendas
 * ajenas.
 *
 * Y NO se ofrece «reintentar» como si siempre fuera a arreglarlo: hay fallos
 * —una migración sin lanzar, por ejemplo— donde reintentar no puede funcionar y
 * decir lo contrario gasta la credibilidad de los avisos que sí importan.
 */
export default function ErrorDashboard({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // A la consola del servidor/navegador, que es donde se mira cuando alguien
    // avisa de que «no carga».
    console.error('Fallo en un módulo del ERP:', error)
  }, [error])

  const enDesarrollo = process.env.NODE_ENV === 'development'

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-[560px] rounded-lg border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-5">
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 shrink-0 text-[var(--ls-e-rojo)]" />
          <h1 className="text-[15px] font-semibold text-[var(--ls-t1)]">
            Esta pantalla no ha podido cargarse
          </h1>
        </div>

        <p className="mb-3 text-[13px] leading-relaxed text-[var(--ls-t3)]">
          El fallo es del servidor, no de lo que estabas haciendo: no se ha guardado nada a medias.
          Si al volver a intentarlo sigue igual, pasa el código de abajo, que es lo que permite
          encontrarlo en los registros.
        </p>

        {error.digest && (
          <p className="mb-3 text-[12px] text-[var(--ls-t3)]">
            Código del fallo:{' '}
            <code className="rounded bg-[var(--ls-sup2)] px-1.5 py-0.5 font-mono text-[12px] text-[var(--ls-t2)]">
              {error.digest}
            </code>
          </p>
        )}

        {enDesarrollo && error.message && (
          <pre className="mb-3 max-h-[180px] overflow-auto rounded bg-[var(--ls-sup2)] p-2 font-mono text-[11px] leading-relaxed text-[var(--ls-t2)]">
            {error.message}
          </pre>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={reset}
            className="inline-flex h-7 items-center gap-1.5 rounded border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2.5 text-[12px] text-[var(--ls-t1)] transition-colors hover:bg-[var(--ls-sup3)]"
          >
            <RotateCw className="h-3.5 w-3.5" />
            Volver a intentarlo
          </button>
          <Link
            href="/dashboard"
            className="inline-flex h-7 items-center rounded border border-[var(--ls-linea)] px-2.5 text-[12px] text-[var(--ls-t2)] transition-colors hover:bg-[var(--ls-sup2)]"
          >
            Ir al escritorio
          </Link>
        </div>
      </div>
    </div>
  )
}
