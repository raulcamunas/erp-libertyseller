'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowRight, CheckCircle2, Info, PackageX } from 'lucide-react'
import { Boton, Segmentado } from '@/components/ui-ls'
import { COLOR_ESTADO, type TonoEstado } from '@/lib/estilo/denso'
import type { RemesaDePanel } from '@/lib/fba/datos'
import type { DiaSerie, FilaProducto, ResumenRitmo } from '@/lib/fba/analisis'
import { AreaPorDia, ColumnasPorDia, descargarCsv, TablaDeDatos, TarjetaGrafico, VIZ, dmy } from '../comun/graficos'
import { Clave, Medidor, Tarjeta } from '../comun/ui'
import { entero, fecha } from '../formato'
import type { IdPestana } from './PestanasEnvio'
import { cuentasDeEnvio } from './reglas'

/**
 * RESUMEN: CÓMO VA EL ENVÍO DE UN VISTAZO.
 *
 * Tres cosas, de la más a la menos importante:
 *   1. del envío a la venta: cuánto de lo que llegó se ha VENDIDO, cuánto se retiró o se perdió (aparte: no son ventas)
 *      y cuánto queda;
 *   2. lo que hay que mirar: los avisos, cada uno con su salto a la pestaña;
 *   3. el día a día, en DOS gráficos pequeños con el cursor sincronizado —salidas de cada día arriba, stock que queda
 *      abajo— y no en uno con dos escalas.
 */

interface Alerta {
  tono: TonoEstado
  icono: ReactNode
  texto: string
  irA?: IdPestana
}

const plural = (n: number, uno: string, varios: string) => `${entero(n)} ${n === 1 ? uno : varios}`

export function TabResumen({
  remesa,
  filas,
  ritmo,
  serie,
  onIrA,
}: {
  remesa: RemesaDePanel
  filas: FilaProducto[]
  ritmo: ResumenRitmo
  serie: DiaSerie[]
  onIrA: (id: IdPestana) => void
}) {
  const [dias, setDias] = useState(30)
  const datos = useMemo(() => (dias === 0 ? serie : serie.slice(-dias)), [serie, dias])

  const c = cuentasDeEnvio(remesa)
  const pctVendido = Math.round((c.vendidas / c.base) * 100)
  const conDescuadre = filas.filter((f) => f.descuadre !== null && f.descuadre !== 0).length
  const conSalidasNoVenta = c.retiradasYMermas > 0

  const alertas: Alerta[] = []
  const nl = remesa.unidadesQueNoLlegaron
  if (nl > 0)
    alertas.push({
      tono: 'ambar',
      icono: <AlertTriangle className="h-[14px] w-[14px]" />,
      texto: `${plural(nl, 'unidad enviada no figura', 'unidades enviadas no figuran')} como recibida${nl === 1 ? '' : 's'}: se ${nl === 1 ? 'puede' : 'pueden'} reclamar a Amazon.`,
      irA: 'seguimiento',
    })
  if (ritmo.encaminoDeAgotarse > 0)
    alertas.push({
      tono: 'rojo',
      icono: <AlertTriangle className="h-[14px] w-[14px]" />,
      texto: `${plural(ritmo.encaminoDeAgotarse, 'referencia se agota', 'referencias se agotan')} en menos de una semana al ritmo de este envío.`,
      irA: 'rotacion',
    })
  if (conDescuadre > 0)
    alertas.push({
      tono: 'ambar',
      icono: <Info className="h-[14px] w-[14px]" />,
      texto: `${plural(conDescuadre, 'referencia no cuadra', 'referencias no cuadran')} con el stock real de Amazon.`,
      irA: 'almacen',
    })
  if (conSalidasNoVenta)
    alertas.push({
      tono: 'magenta',
      icono: <PackageX className="h-[14px] w-[14px]" />,
      texto: `${plural(c.retiradasYMermas, 'unidad salió', 'unidades salieron')} del almacén sin venderse (${[c.retiradas > 0 ? plural(c.retiradas, 'retirada', 'retiradas') : '', c.mermas > 0 ? plural(c.mermas, 'merma', 'mermas') : ''].filter(Boolean).join(' y ')}).`,
      irA: 'referencias',
    })
  if (ritmo.sinVentas > 0)
    alertas.push({
      tono: 'gris',
      icono: <Info className="h-[14px] w-[14px]" />,
      texto: `${plural(ritmo.sinVentas, 'referencia', 'referencias')} sin ventas en los últimos 30 días.`,
      irA: 'rotacion',
    })
  if (ritmo.agotadas > 0)
    alertas.push({
      tono: 'gris',
      icono: <PackageX className="h-[14px] w-[14px]" />,
      texto: `${entero(ritmo.agotadas)} de ${plural(filas.length, 'referencia ya está agotada', 'referencias ya están agotadas')}.`,
      irA: 'almacen',
    })

  const puntos = datos.map((d) => ({ fecha: d.fecha, vendidas: d.vendidas, quedan: d.quedan, acumuladas: d.acumuladas }))
  // El reparto por días cuenta como salida todo lo que deja el lote: con retiradas o mermas, el gráfico lo dice
  const nombreSalidas = conSalidasNoVenta ? 'Salidas' : 'Vendidas'

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Tarjeta titulo="Del envío a la venta" ayuda={`Lo que ${c.sinPreguntar ? 'se envió' : 'llegó al almacén de Amazon'}: lo vendido, lo que salió sin venderse y lo que queda`}>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-[30px] font-semibold leading-none tracking-[-0.03em] text-[var(--ls-t1)] tabular-nums">{pctVendido} %</span>
            <span className="text-[13px] text-[var(--ls-t3)]">
              vendido: {entero(c.vendidas)} de {entero(c.base)} unidades {c.sinPreguntar ? 'enviadas' : 'recibidas'}
            </span>
          </div>
          <Medidor
            className="mt-3"
            alto={14}
            total={c.base}
            partes={[
              { valor: c.vendidas, color: VIZ.vendidas, titulo: 'Vendidas' },
              { valor: c.retiradasYMermas, color: 'var(--ls-e-magenta)', titulo: 'Retiradas y mermas' },
              { valor: c.quedan, color: VIZ.quedan, titulo: 'Quedan' },
            ]}
          />
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
            <Clave color={VIZ.vendidas}>
              Vendidas <b className="font-semibold text-[var(--ls-t1)]">{entero(c.vendidas)}</b>
            </Clave>
            {conSalidasNoVenta && (
              <Clave color="var(--ls-e-magenta)">
                Retiradas y mermas <b className="font-semibold text-[var(--ls-t1)]">{entero(c.retiradasYMermas)}</b>
              </Clave>
            )}
            <Clave color={VIZ.quedan}>
              Quedan <b className="font-semibold text-[var(--ls-t1)]">{entero(c.quedan)}</b>
            </Clave>
            {c.devueltas > 0 && <span className="text-[12px] text-[var(--ls-t3)]">{plural(c.devueltas, 'devuelta', 'devueltas')} (ya restadas de las vendidas)</span>}
          </div>
          {!c.sinPreguntar && c.enviadas !== c.recibidas && (
            <p className="mt-2 text-[12px] text-[var(--ls-t3)]">
              Se enviaron {entero(c.enviadas)} y Amazon ha registrado {entero(c.recibidas)}; el reparto cuenta con lo recibido.
            </p>
          )}
        </Tarjeta>

        <Tarjeta titulo="A tener en cuenta" ayuda={alertas.length === 0 ? undefined : plural(alertas.length, 'aviso', 'avisos')}>
          {alertas.length === 0 ? (
            <p className="flex items-center gap-2 text-[13px] text-[var(--ls-t2)]">
              <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: COLOR_ESTADO.verde }} aria-hidden />
              Todo en orden: llega lo que se envió, las referencias rotan y cuadran con Amazon.
            </p>
          ) : (
            <ul className="space-y-2">
              {alertas.map((a) => (
                <li key={a.texto} className="flex items-start gap-2 text-[13px] leading-[1.45] text-[var(--ls-t2)]">
                  <span className="mt-[2px] shrink-0" style={{ color: COLOR_ESTADO[a.tono] }} aria-hidden>
                    {a.icono}
                  </span>
                  <span className="min-w-0 flex-1">{a.texto}</span>
                  {a.irA && (
                    <Boton tamano="sm" variante="fantasma" soloIcono icono={ArrowRight} aria-label="Ver el detalle" title="Ver el detalle" className="-my-1 shrink-0" onClick={() => onIrA(a.irA!)} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>
      </div>

      <TarjetaGrafico
        titulo={`${conSalidasNoVenta ? 'Salidas' : 'Ventas'} y stock, día a día`}
        ayuda="Los dos gráficos comparten el eje de fechas: al pasar el ratón por uno se marca el mismo día en el otro"
        derecha={
          <Segmentado
            etiqueta="Periodo"
            tamano="sm"
            valor={dias}
            onCambio={setDias}
            opciones={[
              { id: 14, texto: '14 d' },
              { id: 30, texto: '30 d' },
              { id: 0, texto: 'Todo' },
            ]}
          />
        }
        leyenda={
          <>
            <Clave color={VIZ.vendidas}>{conSalidasNoVenta ? 'Salidas ese día (ventas, retiradas y mermas)' : 'Vendidas ese día'}</Clave>
            <Clave color={VIZ.quedan}>Quedan en el almacén</Clave>
          </>
        }
        onCsv={() =>
          descargarCsv(`ventas-y-stock-${remesa.referenciaEnvio ?? remesa.id.slice(0, 8)}.csv`, ['Día', nombreSalidas, 'Acumuladas', 'Quedan'], datos.map((d) => [d.fecha, d.vendidas, d.acumuladas, d.quedan]))
        }
        grafico={
          puntos.length === 0 ? (
            <p className="py-10 text-center text-[12.5px] text-[var(--ls-t4)]">Todavía no hay días que enseñar.</p>
          ) : (
            <div className="min-w-0">
              <p className="mb-[2px] text-[11.5px] font-medium text-[var(--ls-t4)]">Unidades {conSalidasNoVenta ? 'que salieron' : 'vendidas'} por día</p>
              <ColumnasPorDia datos={puntos} clave="vendidas" nombre={nombreSalidas} color={VIZ.vendidas} alto={118} ejeX={false} syncId="remesa-dias" />
              <p className="mb-[2px] mt-1 text-[11.5px] font-medium text-[var(--ls-t4)]">Unidades que quedan de este envío</p>
              <AreaPorDia datos={puntos} clave="quedan" nombre="Quedan" color={VIZ.quedan} alto={152} syncId="remesa-dias" paso />
            </div>
          )
        }
        tabla={
          <TablaDeDatos
            columnas={[
              { clave: 'fecha', titulo: 'Día', formato: (v) => dmy(String(v)) },
              { clave: 'vendidas', titulo: nombreSalidas, numero: true },
              { clave: 'acumuladas', titulo: 'Acumuladas', numero: true },
              { clave: 'quedan', titulo: 'Quedan', numero: true },
            ]}
            filas={[...puntos].reverse()}
          />
        }
      />
      <p className="px-1 text-[12px] leading-[1.5] text-[var(--ls-t4)]">
        Las ventas salen del libro mayor de inventario de Amazon, que se lee una vez al día: lo de hoy aparece mañana. Cuentan desde la llegada (
        {fecha(remesa.cuentaDesde)}); si dos envíos del mismo producto conviven, las ventas se reparten primero al más antiguo.
      </p>
    </div>
  )
}
