'use client'

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { cuantasApps, fechaEnPalabras, saludoDe } from '@/lib/inicio/saludo'

/**
 * EL SALUDO DE LA PANTALLA DE INICIO: «Buenas tardes, Daniela» y debajo la fecha y cuántas aplicaciones tiene.
 *
 * La hora es la del NAVEGADOR de quien mira (el servidor no sabe en qué zona está), así que el saludo se calcula aquí, ya montado. Hasta entonces se
 * reserva el hueco con el mismo texto, invisible, para que no salte nada; y cuando llega la hora el saludo entra palabra a palabra (`inicio-palabra`,
 * con el escalón en `--d`; ver el bloque «Inicio y acceso» de app/globals.css). Lo que se le pase como hijo (el rol, que llega pintado por el servidor) va al final de la línea de la fecha.
 */
export function Saludo({ nombre, cantidad, children }: { nombre: string; cantidad: number; children?: ReactNode }) {
  const [ahora, setAhora] = useState<Date | null>(null)
  useEffect(() => {
    setAhora(new Date())
  }, [])

  const paso = (n: number) => ({ '--d': n }) as CSSProperties

  return (
    <>
      <h1 className="inicio-titulo">
        {ahora ? (
          <>
            <span className="inicio-palabra" style={paso(0)}>
              {saludoDe(ahora.getHours())}
              {nombre ? ',' : ''}
            </span>
            {nombre && (
              <>
                {' '}
                <span className="inicio-palabra inicio-acento" style={paso(1)}>
                  {nombre}
                </span>
              </>
            )}
          </>
        ) : (
          <span className="invisible" aria-hidden>
            Buenas tardes{nombre ? `, ${nombre}` : ''}
          </span>
        )}
      </h1>
      <p className="inicio-meta inicio-entra" style={paso(3)}>
        <span>{ahora ? fechaEnPalabras(ahora) : ' '}</span>
        <span className="inicio-separador" aria-hidden />
        <span>{cuantasApps(cantidad)}</span>
        {children}
      </p>
    </>
  )
}
