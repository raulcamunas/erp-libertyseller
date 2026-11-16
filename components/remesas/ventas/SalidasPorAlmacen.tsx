'use client'

import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, LabelList, Tooltip, XAxis, YAxis } from 'recharts'
import { descargarCsv, DURACION_ANIMACION, EJE, Grafico, TablaDeDatos, TarjetaGrafico, tooltipDe, useAnimarGraficos, VIZ } from '../comun/graficos'
import { decimal, entero } from '../formato'
import { nombreCsv, salidasConNombre, textoPeriodo, type RespuestaVentas } from './useVentas'

/**
 * SALIDAS POR ALMACÉN DE AMAZON (PAÍS) — spec remesas-pro §6.3 y §11 D36.
 *
 * Antes se llamaba «Ventas por país», y engañaba: la columna Country del libro mayor es el país del ALMACÉN de Amazon
 * desde el que sale el pedido, no el del comprador (con paneuropeo, un pedido de Alemania puede salir de España y al
 * revés). Barras horizontales, una por país, con sus unidades y su %. Tabla gemela y CSV.
 *
 *   <SalidasPorAlmacen ventas clienteNombre />
 */
export function SalidasPorAlmacen({ ventas, clienteNombre }: { ventas: RespuestaVentas; clienteNombre: string }) {
  const filas = useMemo(() => salidasConNombre(ventas), [ventas])
  const animar = useAnimarGraficos(filas.length)
  const alto = Math.max(120, filas.length * 36 + 28)
  const Contenido = useMemo(
    () =>
      tooltipDe([{ key: 'unidades', nombre: 'unidades salieron de este país', color: VIZ.vendidas, formato: (v) => `${entero(v)} ud` }], (l) => String(l)),
    []
  )
  const ancho = Math.min(120, Math.max(64, ...filas.map((f) => f.nombre.length * 7 + 8)))

  const bajar = () =>
    descargarCsv(
      nombreCsv(clienteNombre, ventas, 'almacen'),
      ['País del almacén', 'Código', 'Unidades', '% de las salidas'],
      filas.map((f) => [f.nombre, f.pais, f.unidades, String(f.pct).replace('.', ',')])
    )

  const unSolo = filas.length === 1 ? filas[0] : null

  return (
    <TarjetaGrafico
      titulo="Salidas por almacén de Amazon (país)"
      ayuda="Es el país del almacén, no el del comprador"
      onCsv={filas.length > 0 ? bajar : undefined}
      tabla={
        filas.length > 0 ? (
          <TablaDeDatos
            alto={alto}
            columnas={[
              { clave: 'nombre', titulo: 'País del almacén' },
              { clave: 'unidades', titulo: 'Unidades', numero: true, formato: (v) => entero(Number(v)) },
              { clave: 'pct', titulo: '%', numero: true, formato: (v) => `${decimal(Number(v), 1)} %` },
            ]}
            filas={filas}
          />
        ) : undefined
      }
      grafico={
        <div className="min-w-0">
          <Grafico
            alto={alto}
            etiqueta={`Unidades que salieron de cada almacén de Amazon por país, ${textoPeriodo(ventas.dias)}`}
            vacio={filas.length === 0}
            textoVacio="Sin país del almacén en este periodo"
            descripcionVacio="El libro de Amazon no trae el país de las salidas, o no hubo ventas."
          >
            <BarChart data={filas} layout="vertical" margin={{ top: 2, right: 72, left: 0, bottom: 0 }} barCategoryGap="26%">
              <CartesianGrid stroke={EJE.rejilla} horizontal={false} />
              <XAxis type="number" hide allowDecimals={false} />
              <YAxis type="category" dataKey="nombre" tick={EJE.tick} axisLine={{ stroke: EJE.linea }} tickLine={false} width={ancho} />
              <Tooltip content={<Contenido />} cursor={{ fill: 'var(--ls-sup3)', opacity: 0.6 }} isAnimationActive={false} />
              <Bar dataKey="unidades" fill={VIZ.vendidas} radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={animar} animationDuration={DURACION_ANIMACION}>
                <LabelList
                  dataKey="unidades"
                  position="right"
                  className="tabular-nums"
                  fill="var(--ls-t2)"
                  fontSize={11.5}
                  formatter={(v: number) => {
                    const f = filas.find((x) => x.unidades === v)
                    return f ? `${entero(v)} · ${decimal(f.pct, 1)} %` : entero(v)
                  }}
                />
              </Bar>
            </BarChart>
          </Grafico>
          {unSolo && (
            <p className="mt-2 text-[12px] leading-[1.5] text-[var(--ls-t3)]">
              Todo sale de almacenes de {unSolo.nombre}.
            </p>
          )}
        </div>
      }
    />
  )
}
