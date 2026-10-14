'use client'

import { useMemo } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CheckCircle2 } from 'lucide-react'
import { COLOR_ESTADO, TABLA } from '@/lib/estilo/denso'
import type { RemesaDePanel } from '@/lib/fba/datos'
import { ESTADO_INBOUND_TEXTO } from '@/lib/fba/inbound-estados'
import { estaEnlazada } from '@/lib/fba/vista'
import { descargarCsv, EJE, TablaDeDatos, TarjetaGrafico, VIZ, tooltipDe } from '../comun/graficos'
import { Clave, cx, Tarjeta } from '../comun/ui'
import { fecha } from '../formato'

/**
 * SEGUIMIENTO: EL HISTORIAL DEL ENVÍO Y LO QUE NO HA LLEGADO.
 *
 *   · el historial: cada vez que el ERP vio cambiar el estado o llegar unidades;
 *   · las unidades recibidas a lo largo del tiempo, contra lo enviado;
 *   · lo que no ha llegado, SKU a SKU, listo para reclamarlo a Amazon.
 *
 * Las horas son las de cuándo se VIO el cambio —el ERP mira el envío cada hora—,
 * no las de Seller Central, que Amazon no da por API.
 */

const hora = new Intl.DateTimeFormat('es-ES', {
  timeZone: 'Europe/Madrid',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

interface Hito {
  cuando: string
  texto: string
  detalle?: string
  bueno?: boolean
  soloDia?: boolean
}

export function TabSeguimiento({ remesa }: { remesa: RemesaDePanel }) {
  const hitos = useMemo(() => {
    const out: Hito[] = [{ cuando: `${remesa.fechaEnvio}T00:00:00`, texto: 'Fecha de envío de la remesa', soloDia: true }]
    let anterior: string | null = null
    for (const e of remesa.eventos) {
      const unidades = e.recibidas !== null && e.enviadas !== null ? `${e.recibidas} de ${e.enviadas} unidades recibidas` : undefined
      if (e.estadoAmazon !== anterior) {
        out.push({ cuando: e.vistoAt, texto: ESTADO_INBOUND_TEXTO[e.estadoAmazon ?? '']?.texto ?? e.estadoAmazon ?? 'Estado desconocido', detalle: unidades })
        anterior = e.estadoAmazon
      } else {
        out.push({ cuando: e.vistoAt, texto: 'Amazon sigue registrando unidades', detalle: unidades })
      }
    }
    if (remesa.llegadaAt) {
      out.push({
        cuando: remesa.llegadaAt,
        texto: 'Llegada al almacén confirmada',
        detalle: 'Según el libro mayor de inventario de Amazon',
        bueno: true,
        soloDia: remesa.llegadaAt.length <= 10,
      })
    }
    const primera = remesa.ventasPorDia.find((v) => v.vendidas > 0)
    if (primera) {
      const total = remesa.lineas.reduce((s, l) => s + l.consumidas, 0)
      out.push({ cuando: `${primera.fecha}T00:00:00`, texto: 'Primera venta de este envío', detalle: `${total} unidades vendidas hasta hoy`, bueno: true, soloDia: true })
    }
    return out.sort((a, b) => Date.parse(a.cuando) - Date.parse(b.cuando))
  }, [remesa])

  const puntos = remesa.eventos
    .filter((e) => e.recibidas !== null)
    .map((e) => ({ t: new Date(e.vistoAt).getTime(), recibidas: e.recibidas as number, enviadas: e.enviadas ?? 0 }))
  const enviadas = remesa.lineas.reduce((s, l) => s + l.enviadas, 0)

  const faltantes = remesa.lineas
    .filter((l) => l.recibidas !== null && l.recibidas < l.enviadas)
    .map((l) => ({ sku: l.sku, nombre: l.nombre, variante: l.variante, enviadas: l.enviadas, recibidas: l.recibidas as number, faltan: l.enviadas - (l.recibidas as number) }))
  const sinPreguntar = remesa.lineas.length > 0 && remesa.lineas.every((l) => l.recibidas === null)

  const Contenido = tooltipDe(
    [
      { key: 'recibidas', nombre: 'Recibidas', color: VIZ.recibidas },
      { key: 'enviadas', nombre: 'Enviadas', color: 'var(--ls-t4)' },
    ],
    (t) => hora.format(new Date(Number(t)))
  )

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <Tarjeta
        titulo="Historial del envío"
        ayuda={
          estaEnlazada(remesa)
            ? 'Las horas son las de cuándo se vio el cambio: el ERP mira el envío cada hora'
            : 'Sin número de envío FBA no hay historial en Amazon'
        }
      >
        <ol className="space-y-[10px]">
          {hitos.map((h, i) => (
            <li key={`${h.cuando}|${i}`} className="relative flex gap-3">
              <span className="relative flex w-[10px] shrink-0 justify-center">
                {i < hitos.length - 1 && <span className="absolute left-1/2 top-[14px] h-[calc(100%+6px)] w-px -translate-x-1/2 bg-[var(--ls-linea2)]" />}
                <span
                  className="relative z-10 mt-[5px] h-[10px] w-[10px] rounded-full border-2 border-[var(--ls-sup)]"
                  style={{ background: h.bueno ? COLOR_ESTADO.verde : 'var(--ls-acc-graf)' }}
                />
              </span>
              <div className="min-w-0 pb-[2px]">
                <p className="text-[12.5px] text-[var(--ls-t1)]">
                  {h.texto}
                  <span className="ml-2 text-[11px] tabular-nums text-[var(--ls-t4)]">
                    {h.soloDia ? fecha(h.cuando) : hora.format(new Date(h.cuando))}
                  </span>
                </p>
                {h.detalle && <p className="text-[11.5px] text-[var(--ls-t3)]">{h.detalle}</p>}
              </div>
            </li>
          ))}
        </ol>
        {remesa.eventos.length === 0 && estaEnlazada(remesa) && (
          <p className="mt-3 text-[11.5px] leading-[1.5] text-[var(--ls-t3)]">
            Todavía no se ha apuntado ningún cambio. Se mira cada hora mientras el envío siga vivo, o al pulsar «Consultar en Amazon».
          </p>
        )}
      </Tarjeta>

      <div className="space-y-3">
        {puntos.length >= 2 && (
          <TarjetaGrafico
            titulo="Unidades recibidas a lo largo del tiempo"
            ayuda="Cuántas ha ido contando Amazon, frente a las que se enviaron"
            leyenda={
              <>
                <Clave color={VIZ.recibidas}>Recibidas</Clave>
                <Clave color="var(--ls-t4)">Enviadas</Clave>
              </>
            }
            grafico={
              <div style={{ height: 210 }} className="w-full" role="img" aria-label="Unidades recibidas por Amazon a lo largo del tiempo">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={puntos} margin={{ top: 8, right: 14, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={EJE.rejilla} vertical={false} />
                    <XAxis
                      dataKey="t"
                      type="number"
                      scale="time"
                      domain={['dataMin', 'dataMax']}
                      tickFormatter={(t) => new Date(t as number).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })}
                      tick={EJE.tick}
                      axisLine={{ stroke: EJE.linea }}
                      tickLine={false}
                      height={22}
                    />
                    <YAxis tick={EJE.tick} axisLine={false} tickLine={false} allowDecimals={false} width={32} tickMargin={4} domain={[0, 'auto']} />
                    <Tooltip content={<Contenido />} cursor={{ stroke: 'var(--ls-linea2)', strokeWidth: 1 }} isAnimationActive={false} />
                    <ReferenceLine y={enviadas} stroke="var(--ls-t4)" strokeDasharray="4 4" />
                    <Line type="stepAfter" dataKey="recibidas" stroke={VIZ.recibidas} strokeWidth={2} dot={{ r: 4, fill: VIZ.recibidas, stroke: 'var(--ls-sup)', strokeWidth: 2 }} activeDot={{ r: 5, stroke: 'var(--ls-sup)', strokeWidth: 2 }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            }
            tabla={
              <TablaDeDatos
                columnas={[
                  { clave: 't', titulo: 'Visto', formato: (v) => hora.format(new Date(Number(v))) },
                  { clave: 'recibidas', titulo: 'Recibidas', numero: true },
                  { clave: 'enviadas', titulo: 'Enviadas', numero: true },
                ]}
                filas={[...puntos].reverse()}
              />
            }
          />
        )}

        <Tarjeta
          titulo="Unidades que no han llegado"
          ayuda="Lo que se envió y Amazon no ha dado por recibido: se puede reclamar"
          derecha={
            faltantes.length > 0 ? (
              <button
                type="button"
                className="inline-flex h-6 items-center rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-[9px] text-[11.5px] text-[var(--ls-t2)] hover:bg-[var(--ls-sup3)]"
                onClick={() =>
                  descargarCsv(`para-reclamar-${remesa.referenciaEnvio ?? remesa.id.slice(0, 8)}.csv`, ['Envío FBA', 'SKU', 'Producto', 'Enviadas', 'Recibidas', 'Faltan'], faltantes.map((f) => [remesa.referenciaEnvio, f.sku, f.nombre, f.enviadas, f.recibidas, f.faltan]))
                }
              >
                CSV para reclamar
              </button>
            ) : undefined
          }
          cuerpo={faltantes.length === 0}
        >
          {faltantes.length === 0 ? (
            sinPreguntar ? (
              <p className="text-[12.5px] text-[var(--ls-t3)]">Todavía no se ha consultado a Amazon qué ha recibido.</p>
            ) : (
              <p className="flex items-center gap-2 text-[12.5px] text-[var(--ls-t2)]">
                <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: COLOR_ESTADO.verde }} />
                Ha llegado todo lo que se envió.
              </p>
            )
          ) : (
            <div className="max-h-[300px] overflow-auto">
              <table className={TABLA.tabla}>
                <thead>
                  <tr>
                    <th className={TABLA.cabecera}>Producto</th>
                    <th className={cx(TABLA.cabecera, TABLA.derecha)}>Enviadas</th>
                    <th className={cx(TABLA.cabecera, TABLA.derecha)}>Recibidas</th>
                    <th className={cx(TABLA.cabecera, TABLA.derecha)}>Faltan</th>
                  </tr>
                </thead>
                <tbody>
                  {faltantes.map((f) => (
                    <tr key={f.sku} className={TABLA.fila}>
                      <td className={cx(TABLA.celda, 'max-w-[300px]')}>
                        <span className="font-mono text-[11.5px] text-[var(--ls-t3)]">{f.sku}</span>
                        {f.variante && <span className="ml-2 text-[var(--ls-t4)]">{f.variante}</span>}
                      </td>
                      <td className={cx(TABLA.celda, TABLA.numero)}>{f.enviadas}</td>
                      <td className={cx(TABLA.celda, TABLA.numero)}>{f.recibidas}</td>
                      <td className={cx(TABLA.celda, TABLA.numero, 'font-semibold')} style={{ color: COLOR_ESTADO.ambar }}>
                        {f.faltan}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Tarjeta>
      </div>
    </div>
  )
}
