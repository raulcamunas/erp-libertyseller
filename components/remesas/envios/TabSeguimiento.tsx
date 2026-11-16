'use client'

import { useMemo } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts'
import { CheckCircle2, CircleDot, Download, PackageCheck, PackageX, ShoppingCart, Truck } from 'lucide-react'
import { Boton, LineaDeTiempo, TablaAdaptable, type Columna, type Hito } from '@/components/ui-ls'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import type { RemesaDePanel } from '@/lib/fba/datos'
import { ESTADO_INBOUND_TEXTO } from '@/lib/fba/inbound-estados'
import { PLAZO_RECLAMACION_DIAS } from '@/lib/fba/trabajo-plan'
import { estaEnlazada } from '@/lib/fba/vista'
import { descargarCsv, EJE, Grafico, TablaDeDatos, TarjetaGrafico, VIZ, tooltipDe } from '../comun/graficos'
import { Clave, Tarjeta } from '../comun/ui'
import { diasEntre, entero, fecha } from '../formato'
import { cuentasDeEnvio, faltantesAlCerrar } from './reglas'

/**
 * SEGUIMIENTO: EL HISTORIAL DEL ENVÍO Y LO QUE NO HA LLEGADO.
 *
 *   · el historial: cada vez que el ERP vio cambiar el estado o llegar unidades (LineaDeTiempo del kit, lo último arriba);
 *   · las unidades recibidas a lo largo del tiempo, contra lo enviado;
 *   · lo que no ha llegado, SKU a SKU, listo para reclamarlo a Amazon. Si Amazon lo CERRÓ corto («Cerrado con
 *     faltantes», D18), cuántos días quedan para reclamar desde que se vio el cierre (plazo de 60 días).
 *
 * Las horas son las de cuándo se VIO el cambio —el ERP mira el envío cada hora—, no las de Seller Central, que Amazon no
 * da por API.
 */

const hora = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })

interface Faltante {
  sku: string
  nombre: string | null
  variante: string | null
  enviadas: number
  recibidas: number
  faltan: number
}

export function TabSeguimiento({ remesa, hoy }: { remesa: RemesaDePanel; hoy?: string }) {
  const hitos = useMemo(() => {
    const out: Array<Hito & { orden: number }> = [
      { id: 'envio', titulo: 'Fecha de envío de la remesa', cuando: `${remesa.fechaEnvio}T00:00:00`, autor: fecha(remesa.fechaEnvio), icono: Truck, tono: 'azul', orden: Date.parse(`${remesa.fechaEnvio}T00:00:00`) },
    ]
    let anterior: string | null = null
    remesa.eventos.forEach((e, i) => {
      const unidades = e.recibidas !== null && e.enviadas !== null ? `${entero(e.recibidas)} de ${entero(e.enviadas)} unidades recibidas` : undefined
      const t = Date.parse(e.vistoAt)
      if (e.estadoAmazon !== anterior) {
        const cerrado = e.estadoAmazon === 'CLOSED'
        out.push({
          id: `e${i}`,
          titulo: ESTADO_INBOUND_TEXTO[e.estadoAmazon ?? '']?.texto ?? e.estadoAmazon ?? 'Estado desconocido',
          descripcion: unidades,
          cuando: e.vistoAt,
          autor: `Visto el ${hora.format(new Date(e.vistoAt))}`,
          tono: cerrado ? 'verde' : 'cian',
          icono: cerrado ? CheckCircle2 : CircleDot,
          orden: t,
        })
        anterior = e.estadoAmazon
      } else {
        out.push({ id: `e${i}`, titulo: 'Amazon sigue registrando unidades', descripcion: unidades, cuando: e.vistoAt, autor: `Visto el ${hora.format(new Date(e.vistoAt))}`, tono: 'gris', orden: t })
      }
    })
    if (remesa.llegadaAt) {
      out.push({
        id: 'llegada',
        titulo: 'Llegada al almacén confirmada',
        descripcion: 'Según el libro mayor de inventario de Amazon',
        cuando: remesa.llegadaAt.length <= 10 ? `${remesa.llegadaAt}T00:00:00` : remesa.llegadaAt,
        autor: fecha(remesa.llegadaAt),
        tono: 'verde',
        icono: PackageCheck,
        orden: Date.parse(remesa.llegadaAt.length <= 10 ? `${remesa.llegadaAt}T00:00:00` : remesa.llegadaAt),
      })
    }
    const primera = remesa.ventasPorDia.find((v) => v.vendidas > 0)
    if (primera) {
      out.push({
        id: 'venta',
        titulo: 'Primera venta de este envío',
        descripcion: `${entero(cuentasDeEnvio(remesa).vendidas)} unidades vendidas hasta hoy`,
        cuando: `${primera.fecha}T00:00:00`,
        autor: fecha(primera.fecha),
        tono: 'verde',
        icono: ShoppingCart,
        orden: Date.parse(`${primera.fecha}T00:00:00`),
      })
    }
    // Lo último arriba, como el historial de la remesa
    return out.sort((a, b) => b.orden - a.orden)
  }, [remesa])

  const puntos = remesa.eventos.filter((e) => e.recibidas !== null).map((e) => ({ t: new Date(e.vistoAt).getTime(), recibidas: e.recibidas as number, enviadas: e.enviadas ?? 0 }))
  const enviadas = remesa.lineas.reduce((s, l) => s + l.enviadas, 0)

  const faltantes: Faltante[] = remesa.lineas
    .filter((l) => l.recibidas !== null && l.recibidas < l.enviadas)
    .map((l) => ({ sku: l.sku, nombre: l.nombre, variante: l.variante, enviadas: l.enviadas, recibidas: l.recibidas as number, faltan: l.enviadas - (l.recibidas as number) }))
  const sinPreguntar = remesa.lineas.length > 0 && remesa.lineas.every((l) => l.recibidas === null)

  // Cerrado con faltantes: cuántos días quedan para reclamar, contados desde que se VIO el cierre
  const faltanAlCerrar = faltantesAlCerrar(remesa)
  const vistoCierre = remesa.eventos.find((e) => e.estadoAmazon === 'CLOSED')?.vistoAt ?? null
  const desdeCierre = faltanAlCerrar !== null && vistoCierre && hoy ? Math.max(0, diasEntre(vistoCierre.slice(0, 10), hoy)) : null
  const quedanParaReclamar = desdeCierre !== null ? PLAZO_RECLAMACION_DIAS - desdeCierre : null

  const Contenido = tooltipDe(
    [
      { key: 'recibidas', nombre: 'Recibidas', color: VIZ.recibidas, formato: (v) => `${entero(v)} ud` },
      { key: 'enviadas', nombre: 'Enviadas', color: 'var(--ls-t4)', formato: (v) => `${entero(v)} ud` },
    ],
    (t) => hora.format(new Date(Number(t)))
  )

  const columnas: Columna<Faltante>[] = [
    {
      id: 'producto',
      cabecera: 'Producto',
      celda: (f) => (
        <span className="flex min-w-0 flex-col lg:flex-row lg:items-baseline lg:gap-2">
          <span className="shrink-0 whitespace-nowrap font-mono text-[12px] text-[var(--ls-t3)]">{f.sku}</span>
          <span className="truncate font-normal text-[var(--ls-t1)]">
            {f.nombre ?? '—'}
            {f.variante && <span className="ml-2 text-[var(--ls-t4)]">{f.variante}</span>}
          </span>
        </span>
      ),
      ordenar: (f) => f.sku,
      movil: 'titulo',
    },
    { id: 'enviadas', cabecera: 'Enviadas', celda: (f) => entero(f.enviadas), ordenar: (f) => f.enviadas, alinear: 'derecha' },
    { id: 'recibidas', cabecera: 'Recibidas', celda: (f) => entero(f.recibidas), ordenar: (f) => f.recibidas, alinear: 'derecha' },
    {
      id: 'faltan',
      cabecera: 'Faltan',
      celda: (f) => (
        <b className="font-semibold" style={{ color: COLOR_ESTADO.ambar }}>
          {entero(f.faltan)}
        </b>
      ),
      ordenar: (f) => f.faltan,
      alinear: 'derecha',
    },
  ]

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <Tarjeta
        titulo="Historial del envío"
        ayuda={estaEnlazada(remesa) ? 'Las horas son las de cuándo se vio el cambio: el ERP mira el envío cada hora' : 'Sin número de envío FBA no hay historial en Amazon'}
      >
        <LineaDeTiempo eventos={hitos} maximo={40} />
        {remesa.eventos.length === 0 && estaEnlazada(remesa) && (
          <p className="mt-3 text-[12px] leading-[1.5] text-[var(--ls-t3)]">
            Todavía no se ha apuntado ningún cambio. Se mira cada hora mientras el envío siga vivo, o al pulsar «Consultar en Amazon».
          </p>
        )}
      </Tarjeta>

      <div className="min-w-0 space-y-4">
        {faltanAlCerrar !== null && (
          <div
            className="flex items-start gap-3 rounded-[14px] border px-4 py-3 text-[13px] leading-[1.5] text-[var(--ls-t1)]"
            style={{ borderColor: `color-mix(in srgb, ${COLOR_ESTADO.rojo} 35%, var(--ls-linea))`, background: `color-mix(in srgb, ${COLOR_ESTADO.rojo} 7%, var(--ls-sup))` }}
          >
            <PackageX className="mt-[2px] h-4 w-4 shrink-0" style={{ color: COLOR_ESTADO.rojo }} aria-hidden />
            <p className="min-w-0">
              <b className="font-semibold">Cerrado con faltantes: {entero(faltanAlCerrar)} no llegaron.</b>{' '}
              Amazon lo dio por cerrado con menos de lo que se mandó.{' '}
              {quedanParaReclamar !== null
                ? quedanParaReclamar >= 0
                  ? `Te quedan ${quedanParaReclamar} día${quedanParaReclamar === 1 ? '' : 's'} para reclamarlo (plazo de ${PLAZO_RECLAMACION_DIAS} desde el cierre).`
                  : `El plazo de ${PLAZO_RECLAMACION_DIAS} días para reclamar ya ha pasado.`
                : 'Comprueba en Seller Central la fecha de cierre: hay un plazo para reclamar.'}{' '}
              Descarga el CSV de abajo para la reclamación.
            </p>
          </div>
        )}

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
              <Grafico etiqueta="Unidades recibidas por Amazon a lo largo del tiempo" alto={210}>
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
                  <YAxis tick={EJE.tick} axisLine={false} tickLine={false} allowDecimals={false} width={36} tickMargin={4} domain={[0, 'auto']} />
                  <Tooltip content={<Contenido />} cursor={{ stroke: 'var(--ls-linea2)', strokeWidth: 1 }} isAnimationActive={false} />
                  <ReferenceLine y={enviadas} stroke="var(--ls-t4)" strokeDasharray="4 4" />
                  <Line
                    type="stepAfter"
                    dataKey="recibidas"
                    stroke={VIZ.recibidas}
                    strokeWidth={2}
                    dot={{ r: 4, fill: VIZ.recibidas, stroke: 'var(--ls-sup)', strokeWidth: 2 }}
                    activeDot={{ r: 5, stroke: 'var(--ls-sup)', strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </Grafico>
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
              <Boton
                tamano="sm"
                icono={Download}
                onClick={() =>
                  descargarCsv(
                    `para-reclamar-${remesa.referenciaEnvio ?? remesa.id.slice(0, 8)}.csv`,
                    ['Envío FBA', 'SKU', 'Producto', 'Enviadas', 'Recibidas', 'Faltan'],
                    faltantes.map((f) => [remesa.referenciaEnvio, f.sku, f.nombre, f.enviadas, f.recibidas, f.faltan])
                  )
                }
              >
                CSV para reclamar
              </Boton>
            ) : undefined
          }
        >
          {faltantes.length === 0 ? (
            sinPreguntar ? (
              <p className="text-[13px] text-[var(--ls-t3)]">Todavía no se ha consultado a Amazon qué ha recibido.</p>
            ) : (
              <p className="flex items-center gap-2 text-[13px] text-[var(--ls-t2)]">
                <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: COLOR_ESTADO.verde }} aria-hidden />
                Ha llegado todo lo que se envió.
              </p>
            )
          ) : (
            <TablaAdaptable etiqueta="Unidades que no han llegado" columnas={columnas} filas={faltantes} claveDe={(f) => f.sku} ordenInicial={{ id: 'faltan', sentido: 'desc' }} />
          )}
        </Tarjeta>
      </div>
    </div>
  )
}
