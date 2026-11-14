'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Boxes,
  CircleAlert,
  Eye,
  Info,
  Lock,
  Megaphone,
  PackageCheck,
  PackageOpen,
  SearchCheck,
  ShieldCheck,
  Siren,
  Sparkles,
  Truck,
  TriangleAlert,
  Wallet,
} from 'lucide-react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { ACCIONES } from '@/lib/cumplimiento/acciones'
import { ROTULO_NIVEL } from '@/lib/cumplimiento/tipos'
import type { Tarea as TareaSeo } from '@/lib/seo/tareas'
import type { ResumenPpc } from '@/lib/cuentas/resumen'
import { FASES_ABIERTAS, type FaseAbierta, type RemesaAbierta, type SeveridadFba } from '@/lib/cuentas/remesas-tipos'
import {
  BarraDeProgreso,
  Boton,
  EstadoVacio,
  FilaDeKpis,
  Insignia,
  Kpi,
  TablaAdaptable,
  Tarjeta,
  VIZ,
  colorDeAcento,
  formatoPorcentaje,
  haceCuanto,
  mezcla,
  type Columna,
} from '@/components/ui-ls'
import { cn } from '@/lib/utils'
import { acosDe, ENLACE_ALERTAS_FBA, enlaceDe, enlaceRemesas, sumaPpc, type CuentaEnLista } from './tipos'
import { bandera, diaCorto, dinero, entero, paisDeMarketplace, porcentaje } from './formato'
import { Nota } from './piezas'

/**
 * LAS PESTAÑAS DE ÁREA DEL PANEL DE UNA CUENTA: Marketing, SEO, Cumplimiento y Remesas.
 * SOLO LECTURA: enseñan lo que el ERP ya tiene guardado y cada una lleva a su app completa con el cliente ya elegido. Si algo no existe en la
 * base (migración sin lanzar, cuenta sin conectar), la pestaña lo dice con un estado vacío y no falla.
 */

/** La cabecera de botones a la app completa, igual en todas las pestañas */
function Atajos({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>
}

function IrA({ href, children, principal }: { href: string; children: React.ReactNode; principal?: boolean }) {
  return (
    <Boton asChild variante={principal ? 'primario' : 'secundario'} tamano="sm" iconoDerecha={ArrowUpRight}>
      <Link href={href}>{children}</Link>
    </Boton>
  )
}

/* ------------------------------------------------------------------ */
/* Marketing                                                           */
/* ------------------------------------------------------------------ */

const MODO: Record<ResumenPpc['modo'], { texto: string; tono: 'gris' | 'azul' | 'violeta' | 'verde' }> = {
  apagado: { texto: 'Motor apagado', tono: 'gris' },
  sugiere: { texto: 'Solo sugiere', tono: 'azul' },
  aprueba: { texto: 'Aprueba', tono: 'violeta' },
  autopiloto: { texto: 'Piloto automático', tono: 'verde' },
}

const TIPOS_DE_PROPUESTA: Array<[keyof ResumenPpc['porTipo'], string]> = [
  ['negativizar', 'negativas'],
  ['promover', 'a exacta'],
  ['subir-puja', 'subir puja'],
  ['bajar-puja', 'bajar puja'],
  ['pausar', 'pausar'],
  ['presupuesto', 'presupuesto'],
  ['error', 'con error'],
]

export function PestanaMarketing({ c }: { c: CuentaEnLista }) {
  const s = sumaPpc(c.ppc.cuentas)
  const monedas = new Set(c.ppc.cuentas.map((x) => x.moneda ?? 'EUR'))
  const moneda = c.ppc.cuentas[0]?.moneda ?? 'EUR'
  const mezclaMonedas = monedas.size > 1
  const serie = useMemo(() => {
    const porFecha = new Map<string, { fecha: string; gasto: number; ventas: number }>()
    for (const x of c.ppc.cuentas)
      for (const d of x.serie ?? []) {
        const v = porFecha.get(d.fecha) ?? { fecha: d.fecha, gasto: 0, ventas: 0 }
        v.gasto += d.gasto
        v.ventas += d.ventas
        porFecha.set(d.fecha, v)
      }
    return [...porFecha.values()].sort((a, b) => a.fecha.localeCompare(b.fecha))
  }, [c.ppc.cuentas])
  const ultimos7 = serie.slice(-7)
  const acos = acosDe(s)
  const acosAnt = acosDe({ gasto: s.gastoAnt, ventas: s.ventasAnt })
  const tacos = s.conTotales && s.totales > 0 ? s.gasto / s.totales : null
  const fmt = (n: number) => dinero(n, moneda)

  const atajos = (
    <Atajos>
      <IrA principal href={enlaceDe('ppc-propuestas', c)}>
        Propuestas del motor
      </IrA>
      <IrA href={enlaceDe('ppc-ficha', c)}>Ficha de cuenta</IrA>
    </Atajos>
  )

  if (c.ppc.error) return <Nota tono="rojo">{c.ppc.error}</Nota>
  if (c.ppc.cuentas.length === 0)
    return (
      <Tarjeta>
        <EstadoVacio
          icono={Megaphone}
          acento="marketing"
          titulo="Sin Amazon Ads conectado"
          descripcion="Este cliente no tiene ninguna cuenta de publicidad conectada. La conecta un administrador en Amazon API › Publicidad; en cuanto la tenga, aquí salen el gasto, el ACoS y lo que propone el motor."
          accion={{ texto: 'Abrir Marketing', href: enlaceDe('ppc-hoy', c) }}
        />
      </Tarjeta>
    )

  return (
    <div className="flex flex-col gap-4">
      {atajos}
      {mezclaMonedas && <Nota tono="azul">Tiene cuentas en varias monedas: las cifras de arriba suman importes en {[...monedas].join(' y ')}. Mira cada país abajo.</Nota>}
      <FilaDeKpis minimo={170}>
        <Kpi indice={0} etiqueta="Gasto · 7 días" icono={Wallet} acento="marketing" valor={s.gasto} formato={fmt} anterior={s.gastoAnt} mejor="neutro" serie={ultimos7.map((d) => d.gasto)} />
        <Kpi indice={1} etiqueta="Ventas de publicidad" acento="marketing" valor={s.ventas} formato={fmt} anterior={s.ventasAnt} mejor="sube" serie={ultimos7.map((d) => d.ventas)} />
        <Kpi indice={2} etiqueta="ACoS" acento="marketing" valor={acos} formato={(n) => formatoPorcentaje(n)} anterior={acosAnt} mejor="baja" />
        <Kpi indice={3} etiqueta="TACoS" acento="marketing" valor={tacos} formato={(n) => formatoPorcentaje(n)} nota={tacos == null ? 'Sin ventas totales de Seller Central' : 'Gasto sobre todas las ventas'} />
        <Kpi indice={4} etiqueta="Propuestas por revisar" icono={PackageCheck} acento="cuentas" valor={s.pendientes} nota={s.recuperable >= 1 ? `${fmt(s.recuperable)} que no venden` : 'Nada que tirar'} />
      </FilaDeKpis>

      {serie.some((d) => d.gasto > 0 || d.ventas > 0) && (
        <Tarjeta titulo="Gasto y ventas de publicidad · 14 días" subtitulo="Por día, todas sus cuentas juntas" icono={Megaphone} acento="marketing" indice={5} acciones={<Leyenda />}>
          <GraficoGastoVentas serie={serie} moneda={moneda} />
        </Tarjeta>
      )}

      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))' }}>
        {c.ppc.cuentas.map((x, i) => (
          <PaisPpc key={x.perfilId} x={x} c={c} indice={6 + i} />
        ))}
      </div>
    </div>
  )
}

function Leyenda() {
  return (
    <span className="flex items-center gap-3 text-[12px] text-[var(--ls-t3)]">
      <span className="flex items-center gap-[6px]">
        <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: VIZ[0] }} /> Ventas
      </span>
      <span className="flex items-center gap-[6px]">
        <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: VIZ[1] }} /> Gasto
      </span>
    </span>
  )
}

function GraficoGastoVentas({ serie, moneda }: { serie: Array<{ fecha: string; gasto: number; ventas: number }>; moneda: string }) {
  return (
    <div className="h-[220px] w-full" role="img" aria-label="Gasto y ventas de publicidad por día en los últimos 14 días">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={serie} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="cuentas-ventas" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={VIZ[0]} stopOpacity={0.35} />
              <stop offset="100%" stopColor={VIZ[0]} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="cuentas-gasto" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={VIZ[1]} stopOpacity={0.3} />
              <stop offset="100%" stopColor={VIZ[1]} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--ls-linea)" strokeDasharray="3 4" vertical={false} />
          <XAxis dataKey="fecha" tickFormatter={diaCorto} tick={{ fill: 'var(--ls-t4)', fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={18} />
          <YAxis tickFormatter={(v: number) => dinero(v, moneda)} tick={{ fill: 'var(--ls-t4)', fontSize: 11 }} axisLine={false} tickLine={false} width={64} />
          <Tooltip
            contentStyle={{ background: 'var(--ls-sup3)', border: '1px solid var(--ls-linea2)', borderRadius: 10, fontSize: 12, color: 'var(--ls-t1)' }}
            labelFormatter={(l) => diaCorto(String(l))}
            formatter={(v, nombre) => [dinero(Number(v), moneda, 2), nombre === 'ventas' ? 'Ventas' : 'Gasto']}
          />
          <Area type="monotone" dataKey="ventas" stroke={VIZ[0]} strokeWidth={2} fill="url(#cuentas-ventas)" dot={false} />
          <Area type="monotone" dataKey="gasto" stroke={VIZ[1]} strokeWidth={2} fill="url(#cuentas-gasto)" dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function PaisPpc({ x, c, indice }: { x: ResumenPpc; c: CuentaEnLista; indice: number }) {
  const acos = acosDe(x.ultimos)
  const acosAnt = acosDe(x.anteriores)
  const tacos = x.ventasTotales7 ? x.ultimos.gasto / x.ventasTotales7 : null
  const sinMovimiento = x.ultimos.gasto === 0 && x.anteriores.gasto === 0 && x.pendientes === 0
  const modo = MODO[x.modo]
  const href = `/dashboard/marketing-test?c=${encodeURIComponent(c.slug)}&p=${encodeURIComponent(x.perfilId)}&t=propuestas`
  return (
    <Tarjeta
      indice={indice}
      acento="marketing"
      titulo={
        <span className="flex items-center gap-2">
          <span aria-hidden>{bandera(x.pais)}</span> {x.nombre ?? x.pais}
        </span>
      }
      subtitulo={x.datosHasta ? `Datos hasta el ${diaCorto(x.datosHasta)}` : 'Sin datos guardados'}
      acciones={
        <Insignia tono={modo.tono} tamano="sm">
          {modo.texto}
        </Insignia>
      }
      pie={
        <div className="flex items-center justify-between gap-2">
          <span className="truncate">{x.pendientes > 0 ? `${entero(x.pendientes)} propuestas esperan` : x.modo === 'apagado' ? 'Enciéndelo en «Solo sugiere» para que proponga' : 'Nada pendiente'}</span>
          <Link href={href} className="inline-flex shrink-0 items-center gap-1 font-medium text-[var(--ls-t1)] hover:underline">
            Abrir <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
      }
    >
      {sinMovimiento ? (
        <p className="text-[13px] text-[var(--ls-t3)]">Sin gasto en los últimos 14 días ni nada pendiente.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[12px] border border-[var(--ls-linea)] bg-[var(--ls-linea)] sm:grid-cols-4">
            <Mini etiqueta="Gasto" valor={dinero(x.ultimos.gasto, x.moneda)} antes={x.anteriores.gasto > 0 ? `antes ${dinero(x.anteriores.gasto, x.moneda)}` : undefined} />
            <Mini etiqueta="Ventas Ads" valor={dinero(x.ultimos.ventas, x.moneda)} antes={x.anteriores.ventas > 0 ? `antes ${dinero(x.anteriores.ventas, x.moneda)}` : undefined} />
            <Mini etiqueta="ACoS" valor={porcentaje(acos)} antes={acosAnt != null ? `antes ${porcentaje(acosAnt)}` : undefined} />
            <Mini etiqueta="TACoS" valor={porcentaje(tacos)} antes={`${entero(x.ultimos.pedidos)} pedidos`} />
          </div>
          {x.pendientes > 0 && (
            <div className="flex flex-wrap gap-[6px]">
              {TIPOS_DE_PROPUESTA.filter(([t]) => x.porTipo[t]).map(([t, texto]) => (
                <Insignia key={t} tono={t === 'error' ? 'rojo' : t === 'negativizar' ? 'naranja' : 'gris'} tamano="sm">
                  {x.porTipo[t]} {texto}
                </Insignia>
              ))}
              {x.recuperable >= 1 && (
                <Insignia tono="ambar" tamano="sm">
                  {dinero(x.recuperable, x.moneda)} sin vender
                </Insignia>
              )}
            </div>
          )}
        </div>
      )}
    </Tarjeta>
  )
}

function Mini({ etiqueta, valor, antes }: { etiqueta: string; valor: string; antes?: string }) {
  return (
    <div className="min-w-0 bg-[var(--ls-sup)] px-3 py-[10px]">
      <div className="truncate text-[11px] text-[var(--ls-t4)]">{etiqueta}</div>
      <div className="truncate text-[17px] font-semibold tabular-nums tracking-[-0.02em] text-[var(--ls-t1)]">{valor}</div>
      {antes && <div className="truncate text-[11px] text-[var(--ls-t4)]">{antes}</div>}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* SEO                                                                 */
/* ------------------------------------------------------------------ */

const PESO_SEO = { grave: 0, atencion: 1, info: 2 } as const

export function PestanaSeo({ c }: { c: CuentaEnLista }) {
  const seo = c.seo
  const cuentas = seo?.cuentas ?? []
  const tareas: Array<TareaSeo & { pais: string }> = useMemo(
    () => cuentas.flatMap((x) => x.tareas.map((t) => ({ ...t, pais: x.pais }))).sort((a, b) => PESO_SEO[a.gravedad] - PESO_SEO[b.gravedad] || b.impacto - a.impacto),
    [cuentas],
  )
  const atajos = (
    <Atajos>
      <IrA principal href={enlaceDe('seo-hoy', c)}>
        Qué hacer hoy en SEO
      </IrA>
      <IrA href={enlaceDe('seo-busquedas', c)}>Búsquedas</IrA>
    </Atajos>
  )
  if (!seo) return <Nota tono="ambar">No se han leído los datos de SEO. Pulsa «Actualizar».</Nota>
  if (seo.error) return <Nota tono="rojo">{seo.error}</Nota>
  if (cuentas.length === 0)
    return (
      <Tarjeta>
        <EstadoVacio icono={SearchCheck} acento="seo" titulo="Sin cuenta de vendedor conectada" descripcion="El SEO necesita Seller Central (Brand Analytics y las fichas). La conecta un administrador en Amazon API." accion={{ texto: 'Abrir SEO', href: enlaceDe('seo-hoy', c) }} />
      </Tarjeta>
    )
  const productos = cuentas.reduce((a, x) => a + x.productos, 0)
  if (productos === 0)
    return (
      <Tarjeta>
        <EstadoVacio
          icono={SearchCheck}
          acento="seo"
          titulo="Todavía no se sigue ningún producto"
          descripcion="Añade en SEO › Productos los que se trabajan (los que tienen publicidad salen sugeridos). A partir de ahí se leen sus fichas y sus búsquedas solas."
          accion={{ texto: 'Elegir productos', href: `/dashboard/seo-test?c=${encodeURIComponent(c.slug)}&t=productos` }}
        />
      </Tarjeta>
    )

  const graves = tareas.filter((t) => t.gravedad === 'grave').length
  const vigiaLanzado = cuentas.some((x) => x.titulosCambiados !== null)
  const cambiados = cuentas.flatMap((x) => (x.titulosCambiados ?? []).map((t) => ({ ...t, pais: x.pais, cuentaId: x.cuentaId })))
  const propuestas = cuentas.reduce((a, x) => a + (x.propuestasPendientes ?? 0), 0)
  const fichas = cuentas.reduce((a, x) => a + (x.fichas ?? 0), 0)

  return (
    <div className="flex flex-col gap-4">
      {atajos}
      <FilaDeKpis minimo={170}>
        <Kpi indice={0} etiqueta="Productos seguidos" icono={SearchCheck} acento="seo" valor={productos} nota={`${entero(fichas)} fichas leídas de Amazon`} />
        <Kpi indice={1} etiqueta="Tareas urgentes" icono={CircleAlert} acento="seo" valor={graves} nota={`${entero(tareas.length)} tareas en total`} />
        <Kpi indice={2} etiqueta="Títulos cambiados · 14 d" icono={Eye} acento="seo" valor={vigiaLanzado ? cambiados.length : null} nota={vigiaLanzado ? 'Vigía de títulos' : 'Falta la migración 304'} />
        <Kpi indice={3} etiqueta="Propuestas de ficha" icono={Sparkles} acento="seo" valor={propuestas} nota="Preparadas y sin decidir" />
      </FilaDeKpis>

      {cuentas.some((x) => x.acceso === 'no') && (
        <Nota tono="ambar">
          Sin Brand Analytics en {cuentas.filter((x) => x.acceso === 'no').map((x) => `${bandera(x.pais)} ${x.pais}`).join(', ')}: a la cuenta le falta el rol o el cliente no tiene Brand Registry. Sin eso no hay datos de búsquedas.
        </Nota>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Tarjeta titulo="Qué hacer hoy" subtitulo="Lo más importante primero" icono={SearchCheck} acento="seo" indice={4} sinRelleno>
          {tareas.length === 0 ? (
            <EstadoVacio compacto icono={SearchCheck} acento="seo" titulo="Nada pendiente en SEO" descripcion="Las fichas y las búsquedas están como deben. Se vuelve a mirar cada día." />
          ) : (
            <ul className="divide-y divide-[var(--ls-linea)]">
              {tareas.slice(0, 10).map((t) => {
                const Icono = t.gravedad === 'grave' ? CircleAlert : t.gravedad === 'atencion' ? TriangleAlert : Info
                const color = t.gravedad === 'grave' ? COLOR_ESTADO.rojo : t.gravedad === 'atencion' ? COLOR_ESTADO.ambar : COLOR_ESTADO.azul
                return (
                  <li key={`${t.pais}-${t.id}`} className="flex gap-3 px-4 py-3">
                    <Icono className="mt-[2px] h-4 w-4 shrink-0" style={{ color }} aria-hidden />
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-semibold text-[var(--ls-t1)]">
                        <span aria-hidden>{bandera(t.pais)}</span> {t.titulo}
                      </div>
                      <div className="mt-[2px] text-[12.5px] leading-[1.5] text-[var(--ls-t3)]">
                        <span className="font-semibold text-[var(--ls-t2)]">Qué hacer: </span>
                        {t.accion}
                      </div>
                    </div>
                  </li>
                )
              })}
              {tareas.length > 10 && <li className="px-4 py-3 text-[12.5px] text-[var(--ls-t4)]">Y {tareas.length - 10} más en SEO.</li>}
            </ul>
          )}
        </Tarjeta>

        <Tarjeta titulo="Vigía de títulos" subtitulo="Títulos que han cambiado en 14 días" icono={Eye} acento="seo" indice={5} sinRelleno>
          {!vigiaLanzado ? (
            <EstadoVacio compacto icono={Eye} acento="seo" titulo="El vigía aún no está encendido" descripcion="Falta lanzar la migración 304 en Supabase. Sin ella no se guarda el título anterior para comparar." />
          ) : cambiados.length === 0 ? (
            <EstadoVacio compacto icono={Eye} acento="seo" titulo="Ningún título ha cambiado" descripcion="Si Amazon reescribe uno con su IA, aparecerá aquí con 14 días para aceptarlo o rechazarlo." />
          ) : (
            <ul className="divide-y divide-[var(--ls-linea)]">
              {cambiados.map((t) => (
                <li key={`${t.pais}-${t.asin}`} className="flex flex-col gap-1 px-4 py-3">
                  <div className="flex items-center gap-2 text-[12px] text-[var(--ls-t4)]">
                    <span aria-hidden>{bandera(t.pais)}</span>
                    <span className="font-mono">{t.asin}</span>
                    <span>· {haceCuanto(t.cambiadoAt)}</span>
                  </div>
                  {t.anterior && <p className="line-clamp-2 text-[12px] text-[var(--ls-t4)] line-through">{t.anterior}</p>}
                  <p className="line-clamp-2 text-[13px] text-[var(--ls-t1)]">{t.titulo ?? '—'}</p>
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Cumplimiento                                                        */
/* ------------------------------------------------------------------ */

const COLOR_NIVEL = { bloquea: COLOR_ESTADO.rojo, normativa: COLOR_ESTADO.ambar, afecta: COLOR_ESTADO.azul, menor: COLOR_ESTADO.gris } as const

export function PestanaCumplimiento({ c }: { c: CuentaEnLista }) {
  const cifras = c.cumplimiento
  const tareas = c.tareasCumplimiento?.tareas ?? []
  const href = enlaceDe('cumplimiento-hoy', c)
  if (!cifras && tareas.length === 0 && !c.tareasCumplimiento?.error)
    return (
      <Tarjeta>
        <EstadoVacio icono={ShieldCheck} acento="cumplimiento" titulo="Todavía no se ha revisado esta cuenta" descripcion="Cumplimiento revisa las fichas de Amazon de cada cuenta conectada. Ábrelo para lanzar la primera revisión." accion={{ texto: 'Abrir Cumplimiento', href }} />
      </Tarjeta>
    )
  const sanas = cifras && cifras.revisados > 0 ? Math.max(0, cifras.revisados - cifras.atencion) / cifras.revisados : null
  return (
    <div className="flex flex-col gap-4">
      <Atajos>
        <IrA principal href={href}>
          Resolver en Cumplimiento
        </IrA>
      </Atajos>
      {c.tareasCumplimiento?.error && <Nota tono="ambar">{c.tareasCumplimiento.error}</Nota>}
      {cifras && (
        <FilaDeKpis minimo={170}>
          <Kpi indice={0} etiqueta="Fichas revisadas" icono={ShieldCheck} acento="cumplimiento" valor={cifras.revisados} nota={cifras.ultimaRevision ? `Revisadas ${haceCuanto(cifras.ultimaRevision)}` : undefined} />
          <Kpi indice={1} etiqueta="Bloqueadas con stock" icono={Siren} acento="cumplimiento" valor={cifras.atencionConStock} nota={cifras.atencionConStock > 0 ? 'Ventas que se pierden hoy' : 'Nada bloquea la venta'} />
          <Kpi indice={2} etiqueta="Ocultas" acento="cumplimiento" valor={cifras.ocultos} />
          <Kpi indice={3} etiqueta="Normativa" acento="cumplimiento" valor={cifras.normativa} nota="GPSR, etiquetado, RAP…" />
        </FilaDeKpis>
      )}
      {sanas != null && cifras && (
        <Tarjeta indice={4}>
          <BarraDeProgreso valor={sanas} etiqueta="Fichas sin incidencias que pidan atención" detalle={`${entero(cifras.revisados - cifras.atencion)} de ${entero(cifras.revisados)}`} mostrarPorcentaje umbrales={{ ambar: 0.9, rojo: 0.75 }} />
        </Tarjeta>
      )}
      <Tarjeta titulo="Lo que hay que hacer" subtitulo="Las tareas de «Hoy», sin los avisos menores" icono={ShieldCheck} acento="cumplimiento" indice={5} sinRelleno>
        {tareas.length === 0 ? (
          <EstadoVacio compacto icono={ShieldCheck} acento="cumplimiento" titulo="Nada que bloquee ni normativa pendiente" descripcion="Las fichas de esta cuenta están limpias." />
        ) : (
          <ul className="divide-y divide-[var(--ls-linea)]">
            {tareas.slice(0, 12).map((t) => {
              const a = ACCIONES[t.accion]
              const color = COLOR_NIVEL[t.nivel]
              return (
                <li key={`${t.accion}-${t.nivel}`} className="relative flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3">
                  <span aria-hidden className="absolute inset-y-3 left-0 w-[3px] rounded-r-full" style={{ background: color }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13.5px] font-semibold text-[var(--ls-t1)]">{a?.titulo ?? t.accion}</span>
                      <Insignia tono={t.nivel === 'bloquea' ? 'rojo' : t.nivel === 'normativa' ? 'ambar' : 'azul'} tamano="sm">
                        {ROTULO_NIVEL[t.nivel].corto}
                      </Insignia>
                      {a?.quien === 'cliente' && (
                        <Insignia tono="violeta" tamano="sm">
                          Necesita al cliente
                        </Insignia>
                      )}
                    </div>
                    <p className="mt-[2px] line-clamp-2 text-[12.5px] text-[var(--ls-t3)]">{t.mensaje}</p>
                  </div>
                  <div className="text-right text-[12px] tabular-nums text-[var(--ls-t3)]">
                    <div className="text-[15px] font-semibold text-[var(--ls-t1)]">{entero(t.listings)}</div>
                    fichas{t.conStock > 0 ? ` · ${entero(t.conStock)} con stock` : ''}
                    {t.plazo && <div className="text-[var(--ls-t4)]">plazo {t.plazo}</div>}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Tarjeta>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Remesas                                                             */
/* ------------------------------------------------------------------ */

const FASE: Record<FaseAbierta, { texto: string; tono: 'gris' | 'ambar' | 'violeta' | 'azul' | 'cian'; ayuda: string }> = {
  borrador: { texto: 'Propuesta', tono: 'gris', ayuda: 'Borrador por aprobar' },
  aprobada: { texto: 'Aprobada', tono: 'ambar', ayuda: 'Lista para etiquetar' },
  encajando: { texto: 'Encajando', tono: 'violeta', ayuda: 'Cajas en preparación' },
  lista: { texto: 'Lista', tono: 'azul', ayuda: 'Encajada, por enviar' },
  enviada: { texto: 'Enviada', tono: 'cian', ayuda: 'De camino o recibiéndose' },
}

const SEVERIDAD: Record<SeveridadFba, { texto: string; tono: 'rojo' | 'naranja' | 'ambar' | 'gris' }> = {
  critica: { texto: 'Crítica', tono: 'rojo' },
  alta: { texto: 'Alta', tono: 'naranja' },
  media: { texto: 'Media', tono: 'ambar' },
  info: { texto: 'Info', tono: 'gris' },
}

const ESTADO_AMAZON: Record<string, string> = {
  WORKING: 'Creado',
  READY_TO_SHIP: 'Listo para enviar',
  SHIPPED: 'Enviado',
  IN_TRANSIT: 'En tránsito',
  DELIVERED: 'Entregado',
  CHECKED_IN: 'Registrado',
  RECEIVING: 'Recibiendo',
  CLOSED: 'Cerrado',
  CANCELLED: 'Cancelado',
  DELETED: 'Borrado',
  ERROR: 'Con error',
}

export function PestanaRemesas({ c }: { c: CuentaEnLista }) {
  const router = useRouter()
  const r = c.remesas
  if (!r.acceso)
    return (
      <Tarjeta>
        <EstadoVacio icono={Lock} acento="remesas" titulo="No tienes Remesas de este cliente" descripcion="Remesas a FBA tiene su propio permiso por cliente. Pídeselo a un administrador (Remesas › accesos) para ver aquí sus envíos, alertas y stock." />
      </Tarjeta>
    )
  const remesas = r.remesas ?? []
  const alertas = r.listaAlertas ?? []
  const unidades = remesas.reduce((a, x) => a + x.unidades, 0)
  const enviadas = remesas.filter((x) => x.estado === 'enviada')
  const totalAlertas = r.alertas.critica + r.alertas.alta + r.alertas.media + r.alertas.info
  const stock = r.stock ?? null

  if (r.totalRemesas === 0 && totalAlertas === 0 && !stock?.referencias)
    return (
      <Tarjeta>
        <EstadoVacio
          icono={Truck}
          acento="remesas"
          titulo="Este cliente aún no tiene envíos a FBA"
          descripcion="Cuando se prepare su primera propuesta de envío aparecerá aquí por fases, con sus alertas y su stock."
          accion={{ texto: 'Abrir Remesas', href: enlaceRemesas(c, 'propuestas') }}
          accionSecundaria={r.error ? undefined : { texto: 'Ver inventario', href: enlaceRemesas(c, 'inventario') }}
        />
      </Tarjeta>
    )

  const columnas: Columna<RemesaAbierta>[] = [
    {
      id: 'nombre',
      cabecera: 'Envío',
      movil: 'titulo',
      ordenar: (x) => x.nombre ?? x.fechaEnvio,
      celda: (x) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium text-[var(--ls-t1)]">{x.nombre ?? `Envío del ${diaCorto(x.fechaEnvio)}`}</span>
          {x.referencia && <span className="truncate font-mono text-[11.5px] text-[var(--ls-t4)]">{x.referencia}</span>}
        </span>
      ),
    },
    {
      id: 'fase',
      cabecera: 'Fase',
      movil: 'insignia',
      ordenar: (x) => FASES_ABIERTAS.indexOf(x.estado),
      celda: (x) => (
        <Insignia tono={FASE[x.estado].tono} tamano="sm">
          {FASE[x.estado].texto}
        </Insignia>
      ),
    },
    { id: 'amazon', cabecera: 'En Amazon', movil: 'dato', celda: (x) => <span className="text-[var(--ls-t3)]">{x.estadoAmazon ? (ESTADO_AMAZON[x.estadoAmazon] ?? x.estadoAmazon) : '—'}</span> },
    { id: 'fecha', cabecera: 'Sale', movil: 'subtitulo', ordenar: (x) => x.fechaEnvio, celda: (x) => <span className="tabular-nums">{diaCorto(x.fechaEnvio)}</span> },
    { id: 'pais', cabecera: 'País', movil: 'dato', celda: (x) => <span>{bandera(paisDeMarketplace(x.marketplaceId)) || '—'} {paisDeMarketplace(x.marketplaceId)}</span> },
    { id: 'unidades', cabecera: 'Unidades', alinear: 'derecha', movil: 'dato', ordenar: (x) => x.unidades, celda: (x) => <span className="tabular-nums">{entero(x.unidades)}</span> },
  ]

  return (
    <div className="flex flex-col gap-4">
      <Atajos>
        <IrA principal href={enlaceRemesas(c, 'envios')}>
          Abrir Remesas
        </IrA>
        <IrA href={enlaceRemesas(c, 'propuestas')}>Propuestas</IrA>
        <IrA href={enlaceRemesas(c, 'inventario')}>Inventario</IrA>
        <IrA href={ENLACE_ALERTAS_FBA}>Alertas FBA</IrA>
      </Atajos>
      {r.error && <Nota tono="rojo">{r.error}</Nota>}
      {r.faltaAlertas && <Nota tono="ambar">Falta lanzar la migración 267 (alertas FBA): sin ella no hay avisos de rotura de stock ni de envíos atascados.</Nota>}

      <FilaDeKpis minimo={170}>
        <Kpi indice={0} etiqueta="Envíos en curso" icono={Truck} acento="remesas" valor={r.abiertas} nota={r.ultimoEnvio ? `Último envío el ${diaCorto(r.ultimoEnvio)}` : 'Ningún envío real todavía'} />
        <Kpi indice={1} etiqueta="Unidades en curso" icono={PackageOpen} acento="remesas" valor={unidades} nota={enviadas.length ? `${entero(enviadas.reduce((a, x) => a + x.unidades, 0))} ya enviadas` : 'Ninguna enviada aún'} />
        <Kpi
          indice={2}
          etiqueta="Disponible en FBA"
          icono={Boxes}
          acento="remesas"
          valor={stock ? stock.disponible : null}
          nota={stock ? `${bandera(paisDeMarketplace(stock.marketplaceId))} ${entero(stock.referencias)} referencias${stock.mercados > 1 ? ` · ${stock.mercados} países` : ''}` : 'Sin cuenta conectada'}
        />
        <Kpi indice={3} etiqueta="Alertas abiertas" icono={AlertTriangle} acento="remesas" valor={r.faltaAlertas ? null : totalAlertas} nota={r.faltaAlertas ? 'Falta la migración 267' : `${entero(r.alertas.critica)} críticas · ${entero(r.alertas.alta)} altas`} />
      </FilaDeKpis>

      <Tarjeta titulo="Envíos por fase" subtitulo="De la propuesta a Amazon" icono={Truck} acento="remesas" indice={4}>
        <ol className="grid grid-cols-5 gap-1 sm:gap-2">
          {FASES_ABIERTAS.map((f, i) => {
            const n = r.porFase[f]
            const color = colorDeAcento('remesas')
            return (
              <li key={f} title={`${FASE[f].texto}: ${n}`} className="relative flex min-w-0 flex-col items-center gap-1 rounded-[12px] border px-1 py-3 text-center" style={{ borderColor: n > 0 ? mezcla(color, 40) : 'var(--ls-linea)', background: n > 0 ? mezcla(color, 10) : 'transparent' }}>
                <span className={cn('text-[22px] font-semibold tabular-nums leading-none', n > 0 ? 'text-[var(--ls-t1)]' : 'text-[var(--ls-t4)]')}>{n}</span>
                <span className="w-full truncate text-[11.5px] font-medium text-[var(--ls-t2)]">{FASE[f].texto}</span>
                <span className="hidden w-full truncate text-[10.5px] text-[var(--ls-t4)] sm:block">{FASE[f].ayuda}</span>
                {i < FASES_ABIERTAS.length - 1 && <ArrowRight aria-hidden className="absolute -right-[9px] top-1/2 z-[1] hidden h-3.5 w-3.5 -translate-y-1/2 text-[var(--ls-t4)] sm:block" />}
              </li>
            )
          })}
        </ol>
      </Tarjeta>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="min-w-0">
          <TablaAdaptable
            etiqueta="Envíos abiertos"
            columnas={columnas}
            filas={remesas}
            claveDe={(x) => x.id}
            porPagina={10}
            ordenInicial={{ id: 'fecha', sentido: 'desc' }}
            alPulsarFila={(x) => router.push(`/dashboard/remesas?cliente=${encodeURIComponent(c.amazonClientId)}&remesa=${encodeURIComponent(x.id)}`)}
            vacio={{ icono: PackageCheck, acento: 'remesas', titulo: 'Ningún envío abierto', descripcion: 'Todos los envíos de este cliente están cerrados.', accion: { texto: 'Preparar una propuesta', href: enlaceRemesas(c, 'propuestas') } }}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Tarjeta titulo="Alertas FBA" subtitulo="De la pasada diaria" icono={AlertTriangle} acento="remesas" sinRelleno indice={5}>
            {r.faltaAlertas ? (
              <EstadoVacio compacto icono={AlertTriangle} acento="remesas" titulo="Sin alertas todavía" descripcion="Falta lanzar la migración 267." />
            ) : alertas.length === 0 ? (
              <EstadoVacio compacto icono={PackageCheck} acento="remesas" titulo="Ninguna alerta abierta" descripcion="Ni roturas de stock, ni envíos atascados, ni descuadres." />
            ) : (
              <ul className="divide-y divide-[var(--ls-linea)]">
                {alertas.map((a) => (
                  <li key={a.id} className="flex flex-col gap-1 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Insignia tono={SEVERIDAD[a.severidad].tono} tamano="sm" vivo={a.severidad === 'critica'}>
                        {SEVERIDAD[a.severidad].texto}
                      </Insignia>
                      <span className="min-w-0 flex-1 text-[13px] font-semibold text-[var(--ls-t1)]">{a.titulo}</span>
                    </div>
                    {a.detalle && <p className="line-clamp-2 text-[12px] text-[var(--ls-t3)]">{a.detalle}</p>}
                    <span className="text-[11px] text-[var(--ls-t4)]">
                      {a.sku ? `${a.sku} · ` : ''}desde {haceCuanto(a.desde)}
                    </span>
                  </li>
                ))}
                {totalAlertas > alertas.length && (
                  <li className="px-4 py-3">
                    <Link href={ENLACE_ALERTAS_FBA} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-[var(--ls-t1)] hover:underline">
                      Ver las {entero(totalAlertas)} en Alertas FBA <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                    </Link>
                  </li>
                )}
              </ul>
            )}
          </Tarjeta>

          {stock && stock.referencias > 0 && <StockEnAmazon stock={stock} />}
        </div>
      </div>
    </div>
  )
}

function StockEnAmazon({ stock }: { stock: NonNullable<CuentaEnLista['remesas']['stock']> }) {
  const partes = [
    { id: 'disp', texto: 'Disponible', valor: stock.disponible, color: VIZ[2] },
    { id: 'camino', texto: 'De camino', valor: stock.deCamino ?? 0, color: VIZ[0] },
    { id: 'reserva', texto: 'En reserva', valor: stock.reservado ?? 0, color: VIZ[3] },
    { id: 'noapto', texto: 'No apto', valor: stock.noApto ?? 0, color: COLOR_ESTADO.rojo },
  ].filter((p) => p.id === 'disp' || stock.deCamino != null)
  const total = Math.max(1, partes.reduce((a, p) => a + p.valor, 0))
  return (
    <Tarjeta titulo="Stock en Amazon" subtitulo={`${bandera(paisDeMarketplace(stock.marketplaceId))} Según la última lectura del catálogo`} icono={Boxes} acento="remesas" indice={6}>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-[var(--ls-sup3)]" role="img" aria-label={partes.map((p) => `${p.texto}: ${entero(p.valor)}`).join(', ')}>
        {partes.map((p) => (p.valor > 0 ? <span key={p.id} className="h-full" style={{ width: `${(p.valor / total) * 100}%`, background: p.color }} /> : null))}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
        {partes.map((p) => (
          <div key={p.id} className="flex items-center gap-2 text-[12.5px]">
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color }} />
            <dt className="flex-1 truncate text-[var(--ls-t3)]">{p.texto}</dt>
            <dd className="font-semibold tabular-nums text-[var(--ls-t1)]">{entero(p.valor)}</dd>
          </div>
        ))}
      </dl>
      {stock.deCamino == null && <p className="mt-2 text-[11.5px] text-[var(--ls-t4)]">El desglose (de camino, reserva, no apto) sale cuando esté lanzada la migración 271.</p>}
    </Tarjeta>
  )
}
