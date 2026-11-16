'use client'

import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download } from 'lucide-react'
import { Boton, Segmentado, TACTIL } from '@/components/ui-ls'
import type { RemesaDePanel } from '@/lib/fba/datos'
import { matrizDeVentas, serieDeLinea, serieDeRemesa, ultimosDias } from '@/lib/fba/analisis'
import { AreaPorDia, ColumnasPorDia, descargarCsv, TablaDeDatos, TarjetaGrafico, VIZ, dm, dmy } from '../comun/graficos'
import { Clave, cx, Tarjeta } from '../comun/ui'
import { entero, fecha } from '../formato'
import { cuentasDeEnvio } from './reglas'

/**
 * VENTAS POR DÍA: DE TODA LA REMESA Y DE CADA PRODUCTO.
 *
 * Los filtros van en UNA fila encima de lo que filtran —producto y periodo— y
 * valen para las dos tarjetas de abajo: el gráfico y el mapa de calor cuentan lo
 * mismo, o los números no coincidirían entre sí.
 *
 * El reparto por días apunta TODO lo que sale del lote. Si el envío tiene retiradas o mermas, aquí se llaman
 * «salidas» (las cifras de arriba sí separan las ventas); si no, son ventas sin más.
 *
 * El tooltip del mapa de calor es `fixed`: va en un portal (un `transform` de .pagina-de-ruta lo descolocaba).
 */

export function TabVentas({ remesa, hoy }: { remesa: RemesaDePanel; hoy: string }) {
  const [sku, setSku] = useState<string>('todos')
  const [dias, setDias] = useState(14)

  const linea = sku === 'todos' ? null : (remesa.lineas.find((l) => l.sku === sku) ?? null)
  const serie = useMemo(() => (linea ? serieDeLinea(linea, remesa.cuentaDesde, hoy) : serieDeRemesa(remesa, hoy)), [linea, remesa, hoy])
  const datos = useMemo(() => serie.slice(-Math.max(dias, 1)), [serie, dias])
  const total = datos.reduce((s, d) => s + d.vendidas, 0)

  const columnas = useMemo(() => ultimosDias(hoy, remesa.cuentaDesde, dias), [hoy, remesa.cuentaDesde, dias])
  const matriz = useMemo(() => matrizDeVentas(remesa.lineas, columnas), [remesa.lineas, columnas])
  const salidas = (linea ? (linea.retiradas ?? 0) + (linea.mermas ?? 0) : cuentasDeEnvio(remesa).retiradasYMermas) > 0
  const palabra = salidas ? 'Salidas' : 'Vendidas'

  return (
    <div className="space-y-4">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <label className="flex min-w-0 max-w-full items-center gap-2 text-[12px] text-[var(--ls-t4)]">
          Producto
          <select
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            className={cx(
              'h-9 min-w-0 max-w-[min(320px,70vw)] rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 pr-7 text-[13px] text-[var(--ls-t1)] outline-none focus:border-[var(--ls-acc-graf)]',
              TACTIL
            )}
            aria-label="Producto"
          >
            <option value="todos">Todo el envío ({remesa.lineas.length})</option>
            {remesa.lineas.map((l) => (
              <option key={l.sku} value={l.sku}>
                {l.sku}
                {l.variante ? ` · ${l.variante}` : ''}
              </option>
            ))}
          </select>
        </label>
        <Segmentado
          valor={dias}
          onCambio={setDias}
          etiqueta="Periodo"
          tamano="sm"
          opciones={[
            { id: 7, texto: '7 d' },
            { id: 14, texto: '14 d' },
            { id: 30, texto: '30 d' },
            { id: 60, texto: '60 d' },
          ]}
        />
        <span className="text-[12.5px] text-[var(--ls-t3)]">
          <b className="font-semibold text-[var(--ls-t1)]">{entero(total)}</b> unidades {salidas ? 'salieron' : 'vendidas'} en {datos.length} días ·{' '}
          {linea ? (linea.nombre ?? linea.sku) : 'todo el envío'}
        </span>
      </div>

      <TarjetaGrafico
        titulo={`${palabra === 'Salidas' ? 'Salidas' : 'Ventas'} ${linea ? 'de este producto' : 'del envío'}`}
        ayuda={`Arriba, lo ${salidas ? 'que salió' : 'vendido'} cada día; abajo, lo acumulado desde que llegó`}
        leyenda={
          <>
            <Clave color={VIZ.vendidas}>{salidas ? 'Salidas ese día (ventas, retiradas y mermas)' : 'Vendidas ese día'}</Clave>
            <Clave color={VIZ.recibidas}>Acumuladas</Clave>
          </>
        }
        onCsv={() =>
          descargarCsv(`ventas-${linea?.sku ?? 'remesa'}-${remesa.referenciaEnvio ?? remesa.id.slice(0, 8)}.csv`, ['Día', palabra, 'Acumuladas'], datos.map((d) => [d.fecha, d.vendidas, d.acumuladas]))
        }
        grafico={
          datos.length === 0 ? (
            <p className="py-10 text-center text-[12px] text-[var(--ls-t4)]">Todavía no hay días que enseñar.</p>
          ) : (
            <div>
              <ColumnasPorDia datos={datos} clave="vendidas" nombre={palabra} color={VIZ.vendidas} alto={130} ejeX={false} syncId="ventas-dias" />
              <AreaPorDia datos={datos} clave="acumuladas" nombre="Acumuladas" color={VIZ.recibidas} alto={130} syncId="ventas-dias" />
            </div>
          )
        }
        tabla={
          <TablaDeDatos
            columnas={[
              { clave: 'fecha', titulo: 'Día', formato: (v) => dmy(String(v)) },
              { clave: 'vendidas', titulo: palabra, numero: true },
              { clave: 'acumuladas', titulo: 'Acumuladas', numero: true },
            ]}
            filas={[...datos].reverse()}
          />
        }
      />

      <MapaDeCalor
        columnas={columnas}
        filas={matriz}
        onElegir={setSku}
        onCsv={() =>
          descargarCsv(`ventas-por-producto-${remesa.referenciaEnvio ?? remesa.id.slice(0, 8)}.csv`, ['SKU', 'Producto', 'Variante', ...columnas.map(dm), 'Total'], matriz.map((f) => [f.sku, f.nombre, f.variante, ...f.valores, f.total]))
        }
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Mapa de calor: producto × día                                       */
/* ------------------------------------------------------------------ */

interface FilaMapa {
  sku: string
  nombre: string | null
  variante: string | null
  valores: number[]
  total: number
}

/**
 * Una rampa de UN solo tono —el azul de «vendidas»— que va de la superficie al
 * color pleno. Se mezcla con la superficie de la tarjeta, así que sigue sola al
 * tema claro y al oscuro y la luminosidad es monótona por construcción.
 * Los ceros no llevan color: un hueco es un cero, no un dato.
 */
function colorDeCelda(v: number, max: number): { fondo?: string; texto: string } {
  if (v <= 0) return { texto: 'var(--ls-t4)' }
  const p = Math.round(16 + 78 * (v / max))
  return {
    fondo: `color-mix(in oklab, var(--viz-1) ${p}%, var(--ls-sup))`,
    texto: p >= 58 ? '#ffffff' : 'var(--ls-t1)',
  }
}

function MapaDeCalor({
  columnas,
  filas,
  onElegir,
  onCsv,
}: {
  columnas: string[]
  filas: FilaMapa[]
  onElegir: (sku: string) => void
  onCsv: () => void
}) {
  const max = Math.max(1, ...filas.flatMap((f) => f.valores))
  const [tip, setTip] = useState<{ x: number; y: number; texto: string } | null>(null)

  return (
    <Tarjeta
      titulo="Producto por producto"
      ayuda="Cada celda son las unidades que salieron ese día; cuanto más azul, más. Pulsa un producto para verlo solo"
      derecha={
        <Boton tamano="sm" icono={Download} onClick={onCsv} title="Descargar los datos en CSV">
          CSV
        </Boton>
      }
      cuerpo={false}
    >
      <div className="relative">
        <div className="max-h-[420px] overflow-auto">
          <table className="border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-30 h-[26px] min-w-[120px] border-b border-r lg:min-w-[230px] border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-2 text-left text-[11px] font-semibold text-[var(--ls-t4)]">
                  Producto
                </th>
                {columnas.map((d) => (
                  <th key={d} className="sticky top-0 z-20 h-[26px] min-w-[30px] border-b border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-[2px] text-center text-[10.5px] font-medium text-[var(--ls-t4)]">
                    {dm(d)}
                  </th>
                ))}
                <th className="sticky top-0 z-20 h-[26px] min-w-[48px] border-b border-l border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-2 text-right text-[11px] font-semibold text-[var(--ls-t4)]">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.sku} className="group">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 h-[28px] max-w-[130px] cursor-pointer truncate lg:max-w-[260px] border-b border-r border-[var(--ls-linea)] bg-[var(--ls-sup)] px-2 text-left text-[12px] font-normal text-[var(--ls-t2)] group-hover:bg-[var(--ls-sup3)]"
                    title={`${f.nombre ?? f.sku} — pulsa para ver solo este producto`}
                    onClick={() => onElegir(f.sku)}
                  >
                    <span className="font-mono text-[11px] text-[var(--ls-t3)]">{f.sku}</span>
                    {f.variante && <span className="ml-2">{f.variante}</span>}
                  </th>
                  {f.valores.map((v, i) => {
                    const c = colorDeCelda(v, max)
                    return (
                      <td
                        key={columnas[i]}
                        className="h-[28px] border-b border-[var(--ls-linea)] p-[1px] text-center"
                        onPointerMove={(e) =>
                          setTip({ x: e.clientX, y: e.clientY, texto: `${f.sku} · ${fecha(columnas[i])}: ${v} ${v === 1 ? 'unidad' : 'unidades'}` })
                        }
                        onPointerLeave={() => setTip(null)}
                      >
                        <div
                          className="flex h-full min-h-[24px] items-center justify-center rounded-[3px] text-[11px] tabular-nums"
                          style={{ background: c.fondo, color: c.texto }}
                        >
                          {v === 0 ? '·' : v}
                        </div>
                      </td>
                    )
                  })}
                  <td className="h-[28px] border-b border-l border-[var(--ls-linea)] px-2 text-right text-[12px] font-semibold tabular-nums text-[var(--ls-t1)]">
                    {f.total}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {tip &&
          typeof document !== 'undefined' &&
          createPortal(
            <div
              className="pointer-events-none fixed z-[70] rounded-[8px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-2 py-[5px] text-[12px] text-[var(--ls-t1)] shadow-[var(--ls-sombra-2)]"
              style={{ left: Math.min(tip.x + 12, window.innerWidth - 240), top: tip.y + 14 }}
            >
              {tip.texto}
            </div>,
            document.body
          )}
      </div>
      {/* La escala: de cero al máximo del periodo */}
      <div className="flex items-center gap-2 border-t border-[var(--ls-linea)] px-3 py-[7px] text-[11px] text-[var(--ls-t4)]">
        <span>0</span>
        <span
          className="h-[8px] w-[120px] rounded-[3px]"
          style={{ background: 'linear-gradient(90deg, color-mix(in oklab, var(--viz-1) 16%, var(--ls-sup)), var(--viz-1))' }}
        />
        <span>{max} unidades en un día</span>
      </div>
    </Tarjeta>
  )
}
