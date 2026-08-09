'use client'

import { useEffect, useRef, useState } from 'react'
import { COLOR_ESTADO, TEXTO, TIPO, type TonoEstado } from '@/lib/estilo/denso'

/**
 * UNA SERIE TEMPORAL, DIBUJADA A MANO EN SVG.
 *
 *
 * ============ POR QUÉ NO SE USA RECHARTS, QUE YA ESTÁ EN EL REPOSITORIO ============
 *
 * Por tres cosas que estas dos series necesitan y que una librería de gráficos
 * generalista pone difíciles:
 *
 *   1. EL EJE DEL RANKING VA AL REVÉS. En el BSR, un número MÁS BAJO es mejor:
 *      el puesto 400 está por encima del 90.000. Un gráfico con el eje normal
 *      cuenta lo contrario de lo que pasa, y esa es exactamente la clase de
 *      error que nadie corrige porque el gráfico «se ve bien».
 *
 *   2. LOS HUECOS TIENEN QUE VERSE COMO HUECOS. Si una noche no se leyó el
 *      inventario, la línea se corta. Unir los dos extremos dibuja una
 *      interpolación que nadie observó, y en una pantalla desde la que se decide
 *      una reposición eso es inventarse un dato. Los `null` parten la línea.
 *
 *   3. LOS COLORES SALEN DE denso.ts. Los de recharts hay que pasárselos a mano
 *      igual, y encima trae su propio tamaño de tipografía y sus propios
 *      márgenes, que es justo lo que la estética nueva viene a unificar.
 *
 * Son ciento cincuenta líneas de SVG contra una dependencia con su tema aparte.
 *
 *
 * ============ EL ANCHO SE MIDE, NO SE ESCALA ============
 *
 * Se lee el ancho real del contenedor con un ResizeObserver y se dibuja a ese
 * tamaño en píxeles. La alternativa fácil —viewBox fijo y `width: 100%`— estira
 * el dibujo: los círculos salen ovalados y el grosor de la línea cambia según el
 * ancho de la pantalla.
 */

export interface Punto {
  /** Instante de la observación, en milisegundos */
  t: number
  /** null = no se observó. Parte la línea, no se interpola */
  v: number | null
  /** Lo que se enseña al pasar por encima. Si falta, se compone con el valor */
  nota?: string
}

const ALTO = 120
const MARGEN = { arriba: 10, abajo: 16, izquierda: 46, derecha: 8 }

export function Serie({
  puntos,
  desde,
  hasta,
  tono = 'cian',
  /** true = número más bajo, más arriba. Es el caso del ranking de ventas */
  invertido = false,
  formato = (v: number) => v.toLocaleString('es-ES'),
  etiqueta,
}: {
  puntos: Punto[]
  desde: number
  hasta: number
  tono?: TonoEstado
  invertido?: boolean
  formato?: (v: number) => string
  etiqueta?: string
}) {
  const caja = useRef<HTMLDivElement>(null)
  const [ancho, setAncho] = useState(0)

  useEffect(() => {
    const nodo = caja.current
    if (!nodo) return
    const observador = new ResizeObserver((entradas) => {
      setAncho(Math.max(0, Math.floor(entradas[0].contentRect.width)))
    })
    observador.observe(nodo)
    setAncho(nodo.getBoundingClientRect().width)
    return () => observador.disconnect()
  }, [])

  const conValor = puntos.filter((p) => p.v !== null) as Array<Punto & { v: number }>

  return (
    <div ref={caja} className="w-full min-w-0">
      {ancho > 0 &&
        (conValor.length === 0 ? (
          <p className={`${TIPO.s} ${TEXTO.t4} py-4 text-center`}>
            Todavía no hay ninguna observación en esta ventana.
          </p>
        ) : (
          <Dibujo
            ancho={ancho}
            puntos={puntos}
            conValor={conValor}
            desde={desde}
            hasta={hasta}
            tono={tono}
            invertido={invertido}
            formato={formato}
            etiqueta={etiqueta}
          />
        ))}
    </div>
  )
}

function Dibujo({
  ancho,
  puntos,
  conValor,
  desde,
  hasta,
  tono,
  invertido,
  formato,
  etiqueta,
}: {
  ancho: number
  puntos: Punto[]
  conValor: Array<Punto & { v: number }>
  desde: number
  hasta: number
  tono: TonoEstado
  invertido: boolean
  formato: (v: number) => string
  etiqueta?: string
}) {
  const anchoUtil = Math.max(10, ancho - MARGEN.izquierda - MARGEN.derecha)
  const altoUtil = ALTO - MARGEN.arriba - MARGEN.abajo

  const valores = conValor.map((p) => p.v)
  let min = Math.min(...valores)
  let max = Math.max(...valores)
  // Una serie plana no puede dividir por cero, y además una línea pegada al
  // borde superior se lee como «está en su máximo» cuando lo que pasa es que no
  // ha cambiado. Se le da aire.
  if (min === max) {
    const aire = Math.max(1, Math.abs(min) * 0.05)
    min -= aire
    max += aire
  }

  const ventana = Math.max(1, hasta - desde)
  const x = (t: number) => MARGEN.izquierda + ((t - desde) / ventana) * anchoUtil
  const y = (v: number) => {
    const parte = (v - min) / (max - min)
    // Invertido: el valor MÁS BAJO arriba. Es el ranking de ventas.
    const alto = invertido ? parte : 1 - parte
    return MARGEN.arriba + alto * altoUtil
  }

  // Los tramos: cada `null` corta la línea en vez de saltarlo. Ver la nota 2 de
  // la cabecera.
  const tramos: Array<Array<Punto & { v: number }>> = []
  let actual: Array<Punto & { v: number }> = []
  for (const p of puntos) {
    if (p.v === null) {
      if (actual.length > 0) tramos.push(actual)
      actual = []
    } else {
      actual.push(p as Punto & { v: number })
    }
  }
  if (actual.length > 0) tramos.push(actual)

  const color = COLOR_ESTADO[tono]

  return (
    <svg
      width={ancho}
      height={ALTO}
      role="img"
      aria-label={etiqueta ?? 'Serie temporal'}
      className="block"
    >
      {/* Rejilla: solo dos líneas. Más rayas en 120 px de alto son ruido */}
      {[0, 1].map((i) => {
        const yy = MARGEN.arriba + i * altoUtil
        return (
          <line
            key={i}
            x1={MARGEN.izquierda}
            x2={ancho - MARGEN.derecha}
            y1={yy}
            y2={yy}
            stroke="var(--ls-linea)"
            strokeWidth={1}
          />
        )
      })}

      {/* El eje, con el mejor valor arriba cuando va invertido */}
      <text x={2} y={MARGEN.arriba + 4} className="fill-[var(--ls-t4)] text-[10px]">
        {formato(invertido ? min : max)}
      </text>
      <text x={2} y={MARGEN.arriba + altoUtil + 4} className="fill-[var(--ls-t4)] text-[10px]">
        {formato(invertido ? max : min)}
      </text>

      {tramos.map((tramo, i) => (
        <polyline
          key={i}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          points={tramo.map((p) => `${x(p.t)},${y(p.v)}`).join(' ')}
        />
      ))}

      {/* Los puntos solo cuando caben. Con doscientas observaciones se comen la
          línea y no se puede señalar ninguno con el ratón de todas formas */}
      {conValor.length <= 60 &&
        conValor.map((p, i) => (
          <circle key={i} cx={x(p.t)} cy={y(p.v)} r={2} fill={color}>
            <title>
              {p.nota ?? `${formato(p.v)} · ${new Date(p.t).toLocaleString('es-ES')}`}
            </title>
          </circle>
        ))}

      {/* Un tramo de un solo punto no dibuja línea: se marca más gordo para que
          no parezca que no hay nada */}
      {conValor.length === 1 && (
        <circle cx={x(conValor[0].t)} cy={y(conValor[0].v)} r={3.5} fill={color} />
      )}

      <text x={MARGEN.izquierda} y={ALTO - 3} className="fill-[var(--ls-t4)] text-[10px]">
        {new Date(desde).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
      </text>
      <text
        x={ancho - MARGEN.derecha}
        y={ALTO - 3}
        textAnchor="end"
        className="fill-[var(--ls-t4)] text-[10px]"
      >
        {new Date(hasta).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
      </text>
    </svg>
  )
}
