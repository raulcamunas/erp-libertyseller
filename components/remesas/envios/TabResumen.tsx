'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowRight, CheckCircle2, Info, PackageX } from 'lucide-react'
import { BOTON, COLOR_ESTADO, TIPO, type TonoEstado } from '@/lib/estilo/denso'
import type { RemesaDePanel } from '@/lib/fba/datos'
import type { DiaSerie, FilaProducto, ResumenRitmo } from '@/lib/fba/analisis'
import { AreaPorDia, ColumnasPorDia, descargarCsv, TablaDeDatos, TarjetaGrafico, VIZ, dmy } from '../comun/graficos'
import { Clave, cx, Medidor, Segmentado, Tarjeta } from '../comun/ui'
import { fecha } from '../formato'
import type { IdPestana } from './PestanasEnvio'

/**
 * RESUMEN: CÓMO VA EL ENVÍO DE UN VISTAZO.
 *
 * Tres cosas, de la más a la menos importante:
 *   1. del envío a la venta: cuánto de lo que llegó se ha vendido y cuánto queda;
 *   2. lo que hay que mirar: los avisos, cada uno con su salto a la pestaña;
 *   3. el día a día, en DOS gráficos pequeños con el cursor sincronizado —ventas
 *      de cada día arriba, stock que queda abajo— y no en uno con dos escalas.
 */

interface Alerta {
  tono: TonoEstado
  icono: ReactNode
  texto: string
  irA?: IdPestana
}

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

  const enviadas = remesa.lineas.reduce((s, l) => s + l.enviadas, 0)
  const sinPreguntar = remesa.lineas.length > 0 && remesa.lineas.every((l) => l.recibidas === null)
  const recibidas = remesa.lineas.reduce((s, l) => s + (l.recibidas ?? 0), 0)
  const vendidas = remesa.lineas.reduce((s, l) => s + l.consumidas, 0)
  const devueltas = remesa.lineas.reduce((s, l) => s + l.devueltas, 0)
  const retiradas = remesa.lineas.reduce((s, l) => s + l.retiradas, 0)
  const mermas = remesa.lineas.reduce((s, l) => s + l.mermas, 0)
  const base = Math.max(1, sinPreguntar ? enviadas : recibidas)
  const pctVendido = Math.round((vendidas / base) * 100)
  const conDescuadre = filas.filter((f) => f.descuadre !== null && f.descuadre !== 0).length

  const alertas: Alerta[] = []
  if (remesa.unidadesQueNoLlegaron > 0)
    alertas.push({
      tono: 'ambar',
      icono: <AlertTriangle className="h-[14px] w-[14px]" />,
      texto: `${remesa.unidadesQueNoLlegaron} unidad${remesa.unidadesQueNoLlegaron === 1 ? '' : 'es'} enviada${remesa.unidadesQueNoLlegaron === 1 ? '' : 's'} no ${remesa.unidadesQueNoLlegaron === 1 ? 'figura' : 'figuran'} como recibida${remesa.unidadesQueNoLlegaron === 1 ? '' : 's'}: se ${remesa.unidadesQueNoLlegaron === 1 ? 'puede' : 'pueden'} reclamar a Amazon.`,
      irA: 'seguimiento',
    })
  if (ritmo.encaminoDeAgotarse > 0)
    alertas.push({
      tono: 'rojo',
      icono: <AlertTriangle className="h-[14px] w-[14px]" />,
      texto: `${ritmo.encaminoDeAgotarse} referencia${ritmo.encaminoDeAgotarse === 1 ? '' : 's'} se agota${ritmo.encaminoDeAgotarse === 1 ? '' : 'n'} en menos de una semana al ritmo actual.`,
      irA: 'rotacion',
    })
  if (conDescuadre > 0)
    alertas.push({
      tono: 'ambar',
      icono: <Info className="h-[14px] w-[14px]" />,
      texto: `${conDescuadre} referencia${conDescuadre === 1 ? '' : 's'} no cuadra${conDescuadre === 1 ? '' : 'n'} con el stock real de Amazon.`,
      irA: 'almacen',
    })
  if (ritmo.sinVentas > 0)
    alertas.push({
      tono: 'gris',
      icono: <Info className="h-[14px] w-[14px]" />,
      texto: `${ritmo.sinVentas} referencia${ritmo.sinVentas === 1 ? '' : 's'} sin ventas en los últimos 30 días.`,
      irA: 'rotacion',
    })
  if (ritmo.agotadas > 0)
    alertas.push({
      tono: 'gris',
      icono: <PackageX className="h-[14px] w-[14px]" />,
      texto: `${ritmo.agotadas} de ${filas.length} referencias ya están agotadas.`,
      irA: 'almacen',
    })

  const puntos = datos.map((d) => ({ fecha: d.fecha, vendidas: d.vendidas, quedan: d.quedan, acumuladas: d.acumuladas }))

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Tarjeta titulo="Del envío a la venta" ayuda="Lo que llegó al almacén de Amazon, repartido entre lo vendido y lo que queda">
          <div className="flex items-baseline gap-2">
            <span className="text-[28px] font-semibold leading-none tracking-[-0.025em] text-[var(--ls-t1)]">{pctVendido} %</span>
            <span className={cx(TIPO.m, 'text-[var(--ls-t3)]')}>
              ya vendido: {vendidas.toLocaleString('es-ES')} de {base.toLocaleString('es-ES')} unidades {sinPreguntar ? 'enviadas' : 'recibidas'}
            </span>
          </div>
          <Medidor
            className="mt-3"
            alto={14}
            total={base}
            partes={[
              { valor: vendidas, color: VIZ.vendidas, titulo: 'Vendidas' },
              { valor: remesa.quedan, color: VIZ.quedan, titulo: 'Quedan' },
            ]}
          />
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            <Clave color={VIZ.vendidas}>
              Vendidas <b className="font-semibold text-[var(--ls-t1)]">{vendidas.toLocaleString('es-ES')}</b>
            </Clave>
            <Clave color={VIZ.quedan}>
              Quedan <b className="font-semibold text-[var(--ls-t1)]">{remesa.quedan.toLocaleString('es-ES')}</b>
            </Clave>
            {devueltas > 0 && <span className="text-[11.5px] text-[var(--ls-t3)]">{devueltas} devuelta{devueltas === 1 ? '' : 's'} (ya restadas de las vendidas)</span>}
            {retiradas + mermas > 0 && (
              <span className="text-[11.5px] text-[var(--ls-t3)]" title="Salen del stock pero no son ventas: una retirada del almacén o una pérdida que Amazon apunta. Por ahora se cuentan dentro de «vendidas»">
                incluidas en las vendidas:{retiradas > 0 && <> {retiradas} retirada{retiradas === 1 ? '' : 's'} del almacén</>}
                {retiradas > 0 && mermas > 0 && ' y'}
                {mermas > 0 && <> {mermas} merma{mermas === 1 ? '' : 's'}</>}
              </span>
            )}
          </div>
          {!sinPreguntar && enviadas !== recibidas && (
            <p className="mt-2 text-[11.5px] text-[var(--ls-t3)]">
              Se enviaron {enviadas.toLocaleString('es-ES')} y Amazon ha registrado {recibidas.toLocaleString('es-ES')}; el reparto cuenta con lo recibido.
            </p>
          )}
        </Tarjeta>

        <Tarjeta titulo="A tener en cuenta" ayuda={alertas.length === 0 ? undefined : `${alertas.length} aviso${alertas.length === 1 ? '' : 's'}`}>
          {alertas.length === 0 ? (
            <p className="flex items-center gap-2 text-[12.5px] text-[var(--ls-t2)]">
              <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: COLOR_ESTADO.verde }} />
              Todo en orden: llega lo que se envió, las referencias rotan y cuadran con Amazon.
            </p>
          ) : (
            <ul className="space-y-[6px]">
              {alertas.map((a) => (
                <li key={a.texto} className="flex items-start gap-2 text-[12.5px] leading-[1.45] text-[var(--ls-t2)]">
                  <span className="mt-[2px] shrink-0" style={{ color: COLOR_ESTADO[a.tono] }}>
                    {a.icono}
                  </span>
                  <span className="flex-1">{a.texto}</span>
                  {a.irA && (
                    <button type="button" onClick={() => onIrA(a.irA!)} className={cx(BOTON.icono, 'mt-[-1px] shrink-0')} title="Ver el detalle">
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[11.5px] text-[var(--ls-t4)]">Mostrar</span>
        <Segmentado
          valor={dias}
          onCambio={setDias}
          etiqueta="Periodo"
          opciones={[
            { id: 14, texto: '14 días' },
            { id: 30, texto: '30 días' },
            { id: 0, texto: 'Todo' },
          ]}
        />
      </div>

      <TarjetaGrafico
        titulo="Ventas y stock, día a día"
        ayuda="Los dos gráficos comparten el eje de fechas: al pasar el ratón por uno se marca el mismo día en el otro"
        leyenda={
          <>
            <Clave color={VIZ.vendidas}>Vendidas ese día</Clave>
            <Clave color={VIZ.quedan}>Quedan en el almacén</Clave>
          </>
        }
        onCsv={() =>
          descargarCsv(`ventas-y-stock-${remesa.referenciaEnvio ?? remesa.id.slice(0, 8)}.csv`, ['Día', 'Vendidas', 'Acumuladas', 'Quedan'], datos.map((d) => [d.fecha, d.vendidas, d.acumuladas, d.quedan]))
        }
        grafico={
          puntos.length === 0 ? (
            <p className="py-10 text-center text-[12px] text-[var(--ls-t4)]">Todavía no hay días que enseñar.</p>
          ) : (
            <div>
              <p className="mb-[2px] text-[11px] font-semibold text-[var(--ls-t4)]">Unidades vendidas por día</p>
              <ColumnasPorDia datos={puntos} clave="vendidas" nombre="Vendidas" color={VIZ.vendidas} alto={118} ejeX={false} syncId="remesa-dias" />
              <p className="mb-[2px] mt-1 text-[11px] font-semibold text-[var(--ls-t4)]">Unidades que quedan de este envío</p>
              <AreaPorDia datos={puntos} clave="quedan" nombre="Quedan" color={VIZ.quedan} alto={152} syncId="remesa-dias" paso />
            </div>
          )
        }
        tabla={
          <TablaDeDatos
            columnas={[
              { clave: 'fecha', titulo: 'Día', formato: (v) => dmy(String(v)) },
              { clave: 'vendidas', titulo: 'Vendidas', numero: true },
              { clave: 'acumuladas', titulo: 'Acumuladas', numero: true },
              { clave: 'quedan', titulo: 'Quedan', numero: true },
            ]}
            filas={[...puntos].reverse()}
          />
        }
      />
      <p className="px-1 text-[11px] leading-[1.5] text-[var(--ls-t4)]">
        Las ventas salen del libro mayor de inventario de Amazon, que se lee una vez al día: lo de hoy aparece mañana. Cuentan desde
        la llegada ({fecha(remesa.cuentaDesde)}); si dos envíos del mismo producto conviven, las ventas se reparten primero al más antiguo.
      </p>
    </div>
  )
}
