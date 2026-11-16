'use client'

import { useMemo } from 'react'
import { descargarCsv, GraficoVentasCompuesto, TablaDeDatos, TarjetaGrafico } from '../comun/graficos'
import { dinero, entero, fechaCorta } from '../formato'
import { csvDiario, datosDelGrafico, mejorPunto, nombreCsv, textoHasta, textoPeriodo, type RespuestaVentas } from './useVentas'

/**
 * EL GRÁFICO DE VENTAS DEL CLIENTE (spec remesas-pro §6.3).
 *
 * `GraficoVentasCompuesto` (comun, ya dentro de `Grafico`): barras de unidades por día, línea de € a precio actual con
 * media de 7 días (eje derecho) y la línea discontinua del periodo anterior SOLO si el libro lo cubre entero (D36).
 * Con 365 días, por semanas. El título y el pie del eje dicen hasta qué día está leído («hasta el 6 nov»): si el libro va
 * atrasado, el periodo acaba ahí y no hoy. Tiene su tabla gemela y su CSV.
 *
 *   <GraficoVentasDiarias ventas hoy clienteNombre />
 */
export function GraficoVentasDiarias({ ventas, hoy, clienteNombre }: { ventas: RespuestaVentas; hoy: string; clienteNombre: string }) {
  const g = useMemo(() => datosDelGrafico(ventas), [ventas])
  const hasta = textoHasta(ventas, hoy)
  const mejor = useMemo(() => mejorPunto(g.datos), [g.datos])
  const moneda = ventas.moneda

  const titulo = `Ventas de los ${textoPeriodo(ventas.dias)}, ${hasta}`
  const ayuda = g.porSemana
    ? `Unidades por semana (lunes) y € a precio actual de Amazon${ventas.anteriorCompleto ? '' : ' · el libro no llega tan atrás para comparar'}`
    : `Unidades por día y € a precio actual de Amazon (media de 7 días)${ventas.anteriorCompleto ? ' · discontinua: periodo anterior' : ' · el libro no llega tan atrás para comparar'}`

  const bajar = () => {
    const { cabecera, filas } = csvDiario(ventas)
    descargarCsv(nombreCsv(clienteNombre, ventas, 'dias'), cabecera, filas)
  }

  const filasTabla = useMemo(
    () =>
      [...g.datos].reverse().map((d) => ({
        fecha: g.porSemana ? `Semana del ${fechaCorta(d.fecha, hoy)}` : fechaCorta(d.fecha, hoy),
        unidades: d.unidades,
        euros: d.euros,
      })),
    [g.datos, g.porSemana, hoy]
  )

  return (
    <TarjetaGrafico
      titulo={titulo}
      ayuda={ayuda}
      onCsv={bajar}
      tabla={
        <TablaDeDatos
          alto={280}
          columnas={[
            { clave: 'fecha', titulo: g.porSemana ? 'Semana' : 'Día' },
            { clave: 'unidades', titulo: 'Unidades', numero: true, formato: (v) => entero(Number(v)) },
            { clave: 'euros', titulo: `Ventas (${moneda})`, numero: true, formato: (v) => (v === null || v === undefined ? '—' : dinero(Number(v), moneda)) },
          ]}
          filas={filasTabla}
        />
      }
      grafico={
        <div className="min-w-0">
          <GraficoVentasCompuesto
            datos={g.datos}
            anterior={g.anterior}
            moneda={moneda}
            porSemana={g.porSemana}
            etiqueta={`${g.porSemana ? 'Unidades vendidas por semana' : 'Unidades vendidas por día'}, ${textoPeriodo(ventas.dias)}, ${hasta}`}
          />
          {/* Pie del eje: de qué día a qué día (el último es el último leído del libro, no necesariamente hoy) */}
          <div className="mt-1 flex min-w-0 items-center justify-between gap-2 pl-[34px] text-[11px] text-[var(--ls-t4)]">
            <span className="truncate">desde el {fechaCorta(ventas.desde, hoy)}</span>
            <span className="truncate font-medium text-[var(--ls-t3)]">{hasta} →</span>
          </div>
          {mejor && (
            <p className="mt-2 text-[12px] leading-[1.5] text-[var(--ls-t3)]">
              {g.porSemana ? 'Mejor semana' : 'Mejor día'}:{' '}
              <span className="font-medium text-[var(--ls-t2)]">
                {g.porSemana ? `la del ${fechaCorta(mejor.fecha, hoy)}` : `el ${fechaCorta(mejor.fecha, hoy)}`}
              </span>{' '}
              con {entero(mejor.unidades)} ud{mejor.euros !== null ? ` (${dinero(mejor.euros, moneda)})` : ''}.
            </p>
          )}
        </div>
      }
    />
  )
}
