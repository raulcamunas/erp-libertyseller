'use client'

import { AvisosDeCuenta } from './AvisosDeCuenta'
import { useMemo, useState } from 'react'
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CircleAlert, TrendingDown } from 'lucide-react'
import { AVISO, BOTON, COLOR_ESTADO, TEXTO, TIPO, TITULO } from '@/lib/estilo/denso'
import { diasDelRango, gastanSinVender, porCampana, repartoPorTipo, serieDiaria, tipoDeCampana, totalesDe } from '@/lib/ads/rendimiento-calculo'
import { agruparPorProducto } from '@/lib/ads/productos-agrupar'
import { COLOR_DE_TIPO, Kpi, SelectorDePeriodo, type Dias, CAJA as TARJETA } from './piezas'
import { diaCorto, dinero, decimal, entero, porcentaje } from './formato'
import { useRendimiento } from './useRendimiento'
import { useProductosConocidos } from './useProductosConocidos'

type Serie = 'gasto' | 'ventas' | 'acos'
const SERIES: Array<{ id: Serie; nombre: string; color: string }> = [
  { id: 'gasto', nombre: 'Gasto', color: COLOR_ESTADO.azul },
  { id: 'ventas', nombre: 'Ventas', color: COLOR_ESTADO.verde },
  { id: 'acos', nombre: 'ACoS', color: COLOR_ESTADO.ambar },
]

/**
 * EL RESUMEN DE LA CUENTA: las cifras del periodo con su variación frente al anterior, la evolución diaria, cómo se reparte el gasto por tipo de campaña y lo que conviene mirar primero. Todo sale
 * del informe diario de campañas de Amazon (ventas y pedidos a 7 días, como la consola) y de las campañas en vivo.
 */
export function PestanaResumen({ perfilId, moneda, irA }: { perfilId: string; moneda: string | null; irA: (pestana: string) => void }) {
  const [dias, setDias] = useState<Dias>(14)
  const [series, setSeries] = useState<ReadonlySet<Serie>>(new Set<Serie>(['gasto', 'ventas']))
  const { campanas, informe, actualizar } = useRendimiento(perfilId, dias)
  const conocidos = useProductosConocidos(perfilId)
  const cargando = informe.fase === 'cargando'
  const datos = informe.fase === 'listo' ? informe.datos : null

  const calculo = useMemo(() => {
    if (!datos) return null
    const dActual = diasDelRango(datos.periodos.actual.desde, datos.periodos.actual.hasta)
    const dAnterior = diasDelRango(datos.periodos.anterior.desde, datos.periodos.anterior.hasta)
    const t = totalesDe(datos.actual)
    const a = totalesDe(datos.anterior)
    const sa = serieDiaria(datos.actual, dActual)
    const sb = serieDiaria(datos.anterior, dAnterior)
    const camps = porCampana(datos.actual)
    return { t, a, sa, sb, camps, reparto: repartoPorTipo(camps), sinVender: gastanSinVender(camps, 5).slice(0, 5), top: camps.slice(0, 5) }
  }, [datos])

  const productos = useMemo(() => (calculo ? agruparPorProducto(calculo.camps, new Map([...conocidos].map(([asin, p]) => [asin, p.resumen]))) : null), [calculo, conocidos])

  const viva = campanas.fase === 'listo' ? campanas.datos : null
  const activas = viva?.filter((c) => c.estado === 'ENABLED') ?? []
  const presupuestoActivo = activas.reduce((s, c) => s + (c.presupuesto ?? 0), 0)

  const kpis = calculo
    ? [
        { etiqueta: 'Gasto', valor: dinero(calculo.t.gasto, moneda), a: calculo.t.gasto, b: calculo.a.gasto, mejor: 'neutro' as const, serie: calculo.sa.map((p) => p.gasto), color: COLOR_ESTADO.azul },
        { etiqueta: 'Ventas', valor: dinero(calculo.t.ventas, moneda), a: calculo.t.ventas, b: calculo.a.ventas, mejor: 'sube' as const, serie: calculo.sa.map((p) => p.ventas), color: COLOR_ESTADO.verde },
        { etiqueta: 'ACoS', valor: porcentaje(calculo.t.acos), a: calculo.t.acos, b: calculo.a.acos, mejor: 'baja' as const, serie: calculo.sa.map((p) => p.acos ?? 0), color: COLOR_ESTADO.ambar },
        { etiqueta: 'ROAS', valor: calculo.t.roas == null ? '—' : decimal(calculo.t.roas), a: calculo.t.roas, b: calculo.a.roas, mejor: 'sube' as const, serie: calculo.sa.map((p) => (p.gasto > 0 ? p.ventas / p.gasto : 0)), color: COLOR_ESTADO.verde },
        { etiqueta: 'Pedidos', valor: entero(calculo.t.pedidos), a: calculo.t.pedidos, b: calculo.a.pedidos, mejor: 'sube' as const, serie: calculo.sa.map((p) => p.pedidos), color: COLOR_ESTADO.violeta },
        { etiqueta: 'Clics', valor: entero(calculo.t.clics), a: calculo.t.clics, b: calculo.a.clics, mejor: 'neutro' as const, serie: calculo.sa.map((p) => p.clics), color: COLOR_ESTADO.cian },
        { etiqueta: 'CPC medio', valor: dinero(calculo.t.cpc, moneda), a: calculo.t.cpc, b: calculo.a.cpc, mejor: 'baja' as const, serie: calculo.sa.map((p) => (p.clics > 0 ? p.gasto / p.clics : 0)), color: COLOR_ESTADO.azul },
        { etiqueta: 'Conversión (pedidos ÷ clics)', valor: porcentaje(calculo.t.cvr), a: calculo.t.cvr, b: calculo.a.cvr, mejor: 'sube' as const, serie: calculo.sa.map((p) => (p.clics > 0 ? p.pedidos / p.clics : 0)), color: COLOR_ESTADO.verde },
      ]
    : null

  const datosGrafica = calculo?.sa.map((p) => ({ dia: diaCorto(p.fecha), gasto: Number(p.gasto.toFixed(2)), ventas: Number(p.ventas.toFixed(2)), acos: p.acos == null ? null : Number((p.acos * 100).toFixed(1)) }))

  return (
    <div className="flex max-w-[1280px] flex-col gap-3 pb-8">
      <AvisosDeCuenta perfilId={perfilId} verCampana={() => irA('campanas')} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SelectorDePeriodo dias={dias} cambiar={setDias} en={informe.fase === 'listo' ? informe.en : undefined} actualizar={actualizar} cargando={cargando || Boolean(datos?.sincronizando)} />
        {datos && (
          <span className={`${TIPO.xs} ${TEXTO.t4}`}>
            {diaCorto(datos.periodos.actual.desde)} – {diaCorto(datos.periodos.actual.hasta)} frente a {diaCorto(datos.periodos.anterior.desde)} – {diaCorto(datos.periodos.anterior.hasta)}
          </span>
        )}
      </div>

      {informe.fase === 'error' && (
        <div className={`${AVISO.base} ${AVISO.conTono}`} style={{ borderLeftColor: COLOR_ESTADO.rojo }}>
          <CircleAlert className={AVISO.icono} />
          <span>
            <span className={AVISO.fuerte}>No se han podido leer las cifras.</span> {informe.mensaje}
          </span>
        </div>
      )}
      {informe.fase === 'cargando' && informe.nota && <p className={`${TIPO.s} ${TEXTO.t3}`}>{informe.nota}</p>}
      {datos?.sincronizando && <p className={`${TIPO.s} ${TEXTO.t3}`}>Pidiendo datos nuevos a Amazon… lo que ves es lo último guardado y se actualizará solo.</p>}
      {datos?.aviso && (
        <div className={`${AVISO.base} ${AVISO.conTono}`} style={{ borderLeftColor: COLOR_ESTADO.ambar }}>
          <CircleAlert className={AVISO.icono} />
          <span>
            <span className={AVISO.fuerte}>La última lectura de Amazon ha fallado.</span> Se ven los datos de antes. {datos.aviso}
          </span>
        </div>
      )}

      {/* ------- las cifras ------- */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {(kpis ?? Array.from({ length: 8 }, () => null)).map((k, i) => (
          <Kpi key={i} etiqueta={k?.etiqueta ?? ['Gasto', 'Ventas', 'ACoS', 'ROAS', 'Pedidos', 'Clics', 'CPC medio', 'Conversión'][i]} valor={k?.valor ?? ''} actual={k?.a ?? null} anterior={k?.b ?? null} mejor={k?.mejor ?? 'neutro'} serie={k?.serie ?? []} color={k?.color ?? COLOR_ESTADO.gris} cargando={!k} />
        ))}
      </div>

      {/* ------- la evolución ------- */}
      <section className={TARJETA.base}>
        <header className={`${TARJETA.cabecera} justify-between`}>
          <h2 className={TITULO.seccion}>Evolución diaria</h2>
          <div className="flex items-center gap-[4px]">
            {SERIES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSeries((prev) => { const n = new Set(prev); if (n.has(s.id)) { if (n.size > 1) n.delete(s.id) } else n.add(s.id); return n })}
                aria-pressed={series.has(s.id)}
                className={`inline-flex h-[28px] items-center gap-[6px] rounded-[8px] px-[9px] text-[12px] font-medium transition-colors hover:bg-[var(--ls-sup2)] ${series.has(s.id) ? 'text-[var(--ls-t1)]' : 'text-[var(--ls-t4)]'}`}
                title={series.has(s.id) ? `Ocultar ${s.nombre.toLowerCase()}` : `Mostrar ${s.nombre.toLowerCase()}`}
              >
                <span className="h-[8px] w-[8px] rounded-full border-2" style={series.has(s.id) ? { background: s.color, borderColor: s.color } : { borderColor: s.color }} />
                {s.nombre}
              </button>
            ))}
          </div>
        </header>
        <div className="h-[290px] px-2 pb-2 pt-3">
          {!datosGrafica ? (
            <div className="h-full w-full animate-pulse rounded bg-[var(--ls-sup2)]" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={datosGrafica} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--ls-linea)" vertical={false} />
                <XAxis dataKey="dia" tick={{ fontSize: 11, fill: 'var(--ls-t4)' }} tickLine={false} axisLine={{ stroke: 'var(--ls-linea2)' }} interval="preserveStartEnd" minTickGap={18} />
                <YAxis yAxisId="l" tick={{ fontSize: 11, fill: 'var(--ls-t4)' }} tickLine={false} axisLine={false} width={46} tickFormatter={(v) => `${Math.round(v)}`} />
                {series.has('acos') && <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11, fill: 'var(--ls-t4)' }} tickLine={false} axisLine={false} width={40} tickFormatter={(v) => `${v} %`} />}
                <Tooltip
                  cursor={{ fill: 'var(--ls-sup2)' }}
                  contentStyle={{ background: 'var(--ls-sup)', border: '1px solid var(--ls-linea2)', borderRadius: 6, fontSize: 12, color: 'var(--ls-t1)' }}
                  labelStyle={{ color: 'var(--ls-t3)' }}
                  formatter={(v: number, nombre: string) => [nombre === 'ACoS' ? (v == null ? '—' : `${decimal(v, 1)} %`) : dinero(v, moneda), nombre]}
                />
                {series.has('gasto') && <Bar yAxisId="l" dataKey="gasto" name="Gasto" fill={COLOR_ESTADO.azul} fillOpacity={0.55} radius={[3, 3, 0, 0]} maxBarSize={26} />}
                {series.has('ventas') && <Line yAxisId="l" dataKey="ventas" name="Ventas" type="monotone" stroke={COLOR_ESTADO.verde} strokeWidth={2} dot={false} activeDot={{ r: 3 }} />}
                {series.has('acos') && <Line yAxisId="r" dataKey="acos" name="ACoS" type="monotone" stroke={COLOR_ESTADO.ambar} strokeWidth={2} strokeDasharray="4 3" dot={false} connectNulls activeDot={{ r: 3 }} />}
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      {/* ------- por producto (agrupado por el ASIN de cada campaña) ------- */}
      <section className={TARJETA.base}>
        <header className={`${TARJETA.cabecera} justify-between`}>
          <h2 className={TITULO.seccion}>Rendimiento por producto</h2>
          <button type="button" onClick={() => irA('campanas')} className={`${BOTON.base} ${BOTON.secundario}`}>Ver las campañas de cada uno</button>
        </header>
        <div className="overflow-x-auto">
          {!productos ? (
            <div className="m-3 h-[110px] animate-pulse rounded bg-[var(--ls-sup2)]" />
          ) : productos.length === 0 ? (
            <p className={`${TARJETA.cuerpo} ${TIPO.s} ${TEXTO.t3}`}>No hay campañas con gasto en este periodo.</p>
          ) : (
            <table className="w-full min-w-[640px] border-separate border-spacing-0 text-[12.5px]">
              <thead>
                <tr className={`${TIPO.xs} ${TEXTO.t4}`}>
                  <th className="px-3 py-[6px] text-left font-semibold">Producto</th>
                  <th className="px-3 py-[6px] text-right font-semibold">Gasto</th>
                  <th className="w-[120px] px-3 py-[6px] text-left font-semibold">Reparto</th>
                  <th className="px-3 py-[6px] text-right font-semibold">Ventas</th>
                  <th className="px-3 py-[6px] text-right font-semibold">ACoS</th>
                  <th className="px-3 py-[6px] text-right font-semibold">Pedidos</th>
                </tr>
              </thead>
              <tbody>
                {productos.slice(0, 8).map((g) => {
                  // Se compara con el ACoS objetivo que fijó una persona y, si no hay, con el equilibrio
                  const conocido = g.asin ? conocidos.get(g.asin) : undefined
                  const eq = conocido?.objetivo ?? conocido?.equilibrio ?? null
                  const etiquetaRef = conocido?.objetivo != null ? 'objetivo' : 'equilibrio'
                  const color = eq !== null && g.totales.acos !== null ? (g.totales.acos <= eq ? COLOR_ESTADO.verde : COLOR_ESTADO.rojo) : undefined
                  const totalGasto = calculo?.t.gasto || 1
                  return (
                    <tr key={g.clave} className="cursor-pointer hover:[&>td]:bg-[var(--ls-sup2)]" onClick={() => irA('campanas')}>
                      <td className="border-t border-[var(--ls-linea)] px-3 py-[7px]">
                        <div className={`${TEXTO.t1} max-w-[340px] truncate font-medium`} title={g.titulo}>{g.titulo}</div>
                        <div className={`${TIPO.xs} ${TEXTO.t4}`}>{g.asin ?? 'Sin ASIN en el nombre'} · {g.campanas.length} {g.campanas.length === 1 ? 'campaña' : 'campañas'}</div>
                      </td>
                      <td className="border-t border-[var(--ls-linea)] px-3 py-[7px] text-right tabular-nums text-[var(--ls-t1)]">{dinero(g.totales.gasto, moneda)}</td>
                      <td className="border-t border-[var(--ls-linea)] px-3 py-[7px]">
                        <div className="h-[5px] overflow-hidden rounded-full bg-[var(--ls-sup2)]">
                          <div className="h-full rounded-full" style={{ width: `${(g.totales.gasto / totalGasto) * 100}%`, background: COLOR_ESTADO.azul }} />
                        </div>
                        <div className={`${TIPO.xs} ${TEXTO.t4} mt-[2px] tabular-nums`}>{porcentaje(g.totales.gasto / totalGasto, 0)}</div>
                      </td>
                      <td className="border-t border-[var(--ls-linea)] px-3 py-[7px] text-right tabular-nums text-[var(--ls-t1)]">{dinero(g.totales.ventas, moneda)}</td>
                      <td className="border-t border-[var(--ls-linea)] px-3 py-[7px] text-right tabular-nums" title={eq !== null ? `ACoS ${etiquetaRef}: ${porcentaje(eq)}` : 'Fija su ACoS objetivo en «Productos»'}>
                        <span style={color ? { color } : undefined} className={color ? undefined : TEXTO.t1}>{porcentaje(g.totales.acos)}</span>
                        {eq !== null && <div className={`${TIPO.xs} ${TEXTO.t4}`}>{etiquetaRef} {porcentaje(eq, 0)}</div>}
                      </td>
                      <td className="border-t border-[var(--ls-linea)] px-3 py-[7px] text-right tabular-nums text-[var(--ls-t1)]">{entero(g.totales.pedidos)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* ------- reparto por tipo ------- */}
        <section className={TARJETA.base}>
          <header className={TARJETA.cabecera}>
            <h2 className={TITULO.seccion}>Gasto por tipo de campaña</h2>
          </header>
          <div className={`${TARJETA.cuerpo} flex flex-col gap-[10px]`}>
            {!calculo ? (
              <div className="h-[120px] animate-pulse rounded bg-[var(--ls-sup2)]" />
            ) : calculo.reparto.length === 0 ? (
              <p className={`${TIPO.s} ${TEXTO.t3}`}>No hay gasto en este periodo.</p>
            ) : (
              <>
                <div className="flex h-[10px] w-full overflow-hidden rounded-full bg-[var(--ls-sup2)]">
                  {calculo.reparto.map((r) => (
                    <div key={r.tipo} style={{ width: `${r.parte * 100}%`, background: COLOR_DE_TIPO[r.tipo] ?? COLOR_ESTADO.gris }} title={`${r.tipo}: ${porcentaje(r.parte, 0)}`} />
                  ))}
                </div>
                {calculo.reparto.map((r) => (
                  <div key={r.tipo} className="flex items-center gap-2">
                    <span className="h-[8px] w-[8px] shrink-0 rounded-full" style={{ background: COLOR_DE_TIPO[r.tipo] ?? COLOR_ESTADO.gris }} />
                    <div className="min-w-0 flex-1">
                      <div className={`${TIPO.s} ${TEXTO.t1}`}>{r.tipo === 'Otras' ? 'Sin nomenclatura del SOP' : r.tipo}</div>
                      <div className={`${TIPO.xs} ${TEXTO.t4}`}>
                        {r.campanas} {r.campanas === 1 ? 'campaña' : 'campañas'} · ACoS {r.ventas > 0 ? porcentaje(r.gasto / r.ventas) : '—'}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`${TIPO.s} ${TEXTO.t1} tabular-nums`}>{dinero(r.gasto, moneda)}</div>
                      <div className={`${TIPO.xs} ${TEXTO.t4} tabular-nums`}>{porcentaje(r.parte, 0)}</div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </section>

        {/* ------- lo que más gasta y lo que gasta sin vender ------- */}
        <section className={TARJETA.base}>
          <header className={`${TARJETA.cabecera} justify-between`}>
            <h2 className={TITULO.seccion}>Dónde se va el dinero</h2>
            <button type="button" onClick={() => irA('campanas')} className={`${BOTON.base} ${BOTON.secundario}`}>Ver todas las campañas</button>
          </header>
          <div className={`${TARJETA.cuerpo} flex flex-col gap-3`}>
            {!calculo ? (
              <div className="h-[120px] animate-pulse rounded bg-[var(--ls-sup2)]" />
            ) : (
              <>
                <div className="flex flex-col gap-[7px]">
                  <div className={TITULO.rotulo}>Las que más gastan</div>
                  {calculo.top.length === 0 && <p className={`${TIPO.s} ${TEXTO.t3}`}>Sin gasto en este periodo.</p>}
                  {calculo.top.map((c) => (
                    <div key={c.campaignId} className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <div className={`${TIPO.s} ${TEXTO.t1} truncate`} title={c.nombre}>{c.nombre}</div>
                        <div className="mt-[3px] h-[4px] overflow-hidden rounded-full bg-[var(--ls-sup2)]">
                          <div className="h-full rounded-full" style={{ width: `${(c.gasto / (calculo.top[0].gasto || 1)) * 100}%`, background: COLOR_DE_TIPO[tipoDeCampana(c.nombre)] ?? COLOR_ESTADO.gris }} />
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`${TIPO.s} ${TEXTO.t1} tabular-nums`}>{dinero(c.gasto, moneda)}</div>
                        <div className={`${TIPO.xs} ${TEXTO.t4} tabular-nums`}>ACoS {porcentaje(c.acos)}</div>
                      </div>
                    </div>
                  ))}
                </div>
                {calculo.sinVender.length > 0 && (
                  <div className="flex flex-col gap-[7px] border-t border-[var(--ls-linea)] pt-3">
                    <div className="flex items-center gap-[5px] text-[11px] font-semibold" style={{ color: COLOR_ESTADO.rojo }}>
                      <TrendingDown className="h-3 w-3" /> Gastan y no han vendido nada
                    </div>
                    {calculo.sinVender.map((c) => (
                      <div key={c.campaignId} className="flex items-center gap-2">
                        <div className={`${TIPO.s} ${TEXTO.t2} min-w-0 flex-1 truncate`} title={c.nombre}>{c.nombre}</div>
                        <div className={`${TIPO.xs} ${TEXTO.t4} tabular-nums`}>{entero(c.clics)} clics</div>
                        <div className={`${TIPO.s} tabular-nums`} style={{ color: COLOR_ESTADO.rojo }}>{dinero(c.gasto, moneda)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      </div>

      {/* ------- el estado de la cuenta ------- */}
      <section className={TARJETA.base}>
        <header className={TARJETA.cabecera}>
          <h2 className={TITULO.seccion}>Estado de la cuenta</h2>
        </header>
        <div className={`${TARJETA.cuerpo} grid gap-3 sm:grid-cols-2 lg:grid-cols-4`}>
          {campanas.fase === 'cargando' && <p className={`${TIPO.s} ${TEXTO.t3} sm:col-span-4`}>Leyendo las campañas de Amazon…</p>}
          {campanas.fase === 'error' && <p className={`${TIPO.s} sm:col-span-4`} style={{ color: COLOR_ESTADO.rojo }}>{campanas.mensaje}</p>}
          {viva && (
            <>
              <Dato etiqueta="Campañas activas" valor={entero(activas.length)} nota={`${entero(viva.filter((c) => c.estado === 'PAUSED').length)} pausadas · ${entero(viva.filter((c) => c.estado === 'ARCHIVED').length)} archivadas`} />
              <Dato etiqueta="Presupuesto diario activo" valor={dinero(presupuestoActivo, moneda)} nota="Suma de las campañas activas" />
              <Dato
                etiqueta="Gasto medio diario"
                valor={calculo ? dinero(calculo.t.gasto / dias, moneda) : '—'}
                nota={calculo && presupuestoActivo > 0 ? `${porcentaje(calculo.t.gasto / dias / presupuestoActivo, 0)} del presupuesto activo` : 'Del periodo elegido'}
              />
              <Dato etiqueta="Campañas con la nomenclatura del SOP" valor={`${entero(viva.filter((c) => tipoDeCampana(c.nombre) !== 'Otras').length)} de ${entero(viva.length)}`} nota="El resto lo ignora el motor automático" />
            </>
          )}
        </div>
      </section>
    </div>
  )
}

function Dato({ etiqueta, valor, nota }: { etiqueta: string; valor: string; nota: string }) {
  return (
    <div className="min-w-0">
      <div className={`${TIPO.s} ${TEXTO.t3}`}>{etiqueta}</div>
      <div className="text-[19px] font-semibold tabular-nums tracking-[-0.015em] text-[var(--ls-t1)]">{valor}</div>
      <div className={`${TIPO.xs} ${TEXTO.t4}`}>{nota}</div>
    </div>
  )
}
