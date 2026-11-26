'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, Bot, ChevronRight, FileText, FlaskConical, History, KeyRound, Minus, Search, Sparkles, Tag, TriangleAlert, Type } from 'lucide-react'
import { ImagenDeProducto } from '@/components/productos/ImagenDeProducto'
import type { ComentarioSeo } from '@/lib/seo/comentarios-servidor'
import { BotonDeComentarios, cuandoFue, Hilo, ProveedorDeComentarios, useComentadosPorHilo } from './HiloDeComentarios'
import { Avatar, Boton, EstadoVacio, Insignia } from '@/components/ui-ls'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import type { EdicionGuardada } from '@/lib/seo/edicion-servidor'
import type { EventoSeo, TipoDeEvento } from '@/lib/seo/registro-servidor'
import { resultadoDelCambio, type EstadoResultado, type ResultadoDelCambio } from '@/lib/seo/resultado-cambio'
import type { DatosSeo } from './useCuentaSeo'
import { useDelProducto } from './useDelProducto'
import { useHistorial } from './useHistorial'
import { decisionesDe, fichaDe, nombreDe, SELECT_PEQUENO, TiraDeCifrasSeo } from './comun'
import { APLICADAS, ESTILO_RESULTADO, fechaDe, NOMBRE_CAMPO } from './ResultadoDeCambios'

/**
 * SEO TEST · PESTAÑA «CAMBIOS» (decisión de Raúl, 26 nov 2026: «aquí se cambió algo y este es el impacto que ha tenido desde ese cambio» + «un log de quién ha hecho qué»).
 *
 *   1. La línea de la cuenta: compras propias por semana de todos los productos seguidos, con un punto en cada cambio de ficha aplicado (color = resultado).
 *   2. Una tarjeta por cambio: la cuota que decide semana a semana (8 antes, todas después), la media de antes y la de DESDE el cambio, el veredicto 3+3
 *      de lib/seo/resultado-cambio.ts y lo que ensucia la comparación.
 *   3. El resultado por persona (quién envió cada cambio y cómo salió).
 *   4. El registro: quién hizo qué y cuándo (lib/seo/registro-servidor.ts), con el avatar de cada persona, la foto del producto y un hilo de comentarios en cada acción
 *      y en cada tarjeta de cambio (migración 342, HiloDeComentarios.tsx). Los comentarios son lo único que se escribe desde esta pestaña.
 * Las cifras son de Brand Analytics (semanas cerradas), con la misma cesta de búsquedas antes y después.
 */

interface DatosDeCambios {
  ediciones: EdicionGuardada[]
  registro: EventoSeo[]
  sinMigracion: boolean
  comentarios?: ComentarioSeo[]
  sinComentarios?: boolean
  yo?: string
}

interface Cambio {
  e: EdicionGuardada
  r: ResultadoDelCambio
  nombre: string
}

const SEMANAS = 30
const p1 = (x: number | null | undefined) => (x == null ? '—' : `${(x * 100).toLocaleString('es-ES', { maximumFractionDigits: 1, minimumFractionDigits: x < 0.1 ? 1 : 0 })} %`)
const n0 = (x: number | null | undefined) => (x == null ? '—' : Math.round(x).toLocaleString('es-ES'))
const pct = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(Math.round(x * 100))} %`
const fCorta = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const fLarga = (d: string) => new Date(d).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
const colorDe = (estado: EstadoResultado) => (ESTILO_RESULTADO[estado].color === 'var(--ls-t4)' ? 'var(--ls-t3)' : ESTILO_RESULTADO[estado].color)
const ERP = 'El ERP'

export function PestanaSeoCambios({ cuentaId, datos, verFicha }: { cuentaId: string; datos: DatosSeo; verFicha: (asin: string) => void }) {
  const cambios = useDelProducto<DatosDeCambios>(`/api/seo/cambios?cuenta=${encodeURIComponent(cuentaId)}`)
  const aplicadas = useMemo(() => (cambios.datos?.ediciones ?? []).filter((e) => APLICADAS.has(e.estado) && e.antes), [cambios.datos])
  const historial = useHistorial(aplicadas.length > 0 ? cuentaId : null, { semanas: SEMANAS })
  const decisiones = useMemo(() => decisionesDe(datos), [datos])
  const [persona, setPersona] = useState('')
  const [asin, setAsin] = useState('')
  const [comentarios, setComentarios] = useState<ComentarioSeo[]>([])
  useEffect(() => setComentarios(cambios.datos?.comentarios ?? []), [cambios.datos])
  const mkt = cuentaId.split('~')[1] ?? null
  const hoy = new Date().toISOString().slice(0, 10)

  const nombreDeAsin = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of datos.productos) m.set(p.asin, nombreDe(p, fichaDe(datos, p.asin)))
    return (a: string | null) => (a ? (m.get(a) ?? a) : null)
  }, [datos])

  const todos: Cambio[] = useMemo(() => {
    if (aplicadas.length === 0 || historial.filas.length === 0) return []
    return aplicadas.map((e) => ({
      e,
      nombre: nombreDeAsin(e.asin) ?? e.asin,
      r: resultadoDelCambio({
        asin: e.asin,
        fecha: fechaDe(e),
        antes: e.antes,
        despues: e.despues,
        filas: historial.filas,
        precio: datos.precios?.[e.asin] ?? null,
        decisiones,
        sinVentas: historial.sinVentas?.[e.asin] ?? null,
        gastoSemanal: historial.gastoSemanal ? historial.gastoSemanal.filter((g) => g.asin === e.asin) : null,
        otrosCambios: aplicadas.filter((x) => x.asin === e.asin).map(fechaDe),
        hoy,
      }),
    }))
  }, [aplicadas, historial.filas, historial.sinVentas, historial.gastoSemanal, datos.precios, decisiones, nombreDeAsin, hoy])

  const registro = useMemo(() => cambios.datos?.registro ?? [], [cambios.datos])
  const personas = useMemo(() => [...new Set([...registro.map((x) => x.quien), ...aplicadas.map((e) => e.enviadoPor)].filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, 'es')), [registro, aplicadas])
  const asinsConCambios = useMemo(() => [...new Set(aplicadas.map((e) => e.asin))], [aplicadas])

  const visibles = todos.filter((c) => (!persona || c.e.enviadoPor === persona) && (!asin || c.e.asin === asin))
  const eventos = registro.filter((x) => (!persona || x.quien === persona) && (!asin || x.asin === asin))

  if (cambios.error) return <EstadoVacio icono={TriangleAlert} titulo="No se han podido cargar los cambios" descripcion={cambios.error} accion={{ texto: 'Reintentar', onClick: () => void cambios.recargar() }} acento="seo" />
  if (!cambios.datos)
    return <p className="text-[13px] text-[var(--ls-t4)]">Cargando los cambios de la cuenta…</p>
  if (cambios.datos.sinMigracion) return <EstadoVacio icono={History} titulo="Falta la migración 312" descripcion="Sin la tabla de ediciones de ficha no hay cambios que enseñar." acento="seo" />

  const cuenta = (estado: EstadoResultado[]) => visibles.filter((c) => estado.includes(c.r.estado)).length

  return (
    <ProveedorDeComentarios cuentaId={cuentaId} yo={cambios.datos.yo ?? null} sinTabla={!!cambios.datos.sinComentarios} comentarios={comentarios} setComentarios={setComentarios}>
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Persona" value={persona} onChange={(e) => setPersona(e.target.value)} className={SELECT_PEQUENO}>
          <option value="">Todo el equipo</option>
          {personas.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select aria-label="Producto" value={asin} onChange={(e) => setAsin(e.target.value)} className={`${SELECT_PEQUENO} max-w-[320px]`}>
          <option value="">Todos los productos</option>
          {[...new Set([...asinsConCambios, ...datos.productos.map((p) => p.asin)])].map((a) => (
            <option key={a} value={a}>
              {nombreDeAsin(a)?.slice(0, 60)} · {a}
            </option>
          ))}
        </select>
        <span className="text-[11.5px] text-[var(--ls-t4)]">Brand Analytics por semanas cerradas · misma cesta de búsquedas antes y después de cada cambio</span>
      </div>

      {aplicadas.length === 0 ? (
        <EstadoVacio icono={FlaskConical} titulo="Todavía no hay cambios de ficha aplicados en esta cuenta" descripcion="Cuando se envíe un cambio desde la pestaña Ficha y Amazon lo aplique, aparecerá aquí con su impacto semana a semana." acento="seo" compacto />
      ) : (
        <>
          <TiraDeCifrasSeo
            cifras={[
              { etiqueta: 'Cambios aplicados', valor: String(visibles.length || (historial.cargando ? '…' : 0)), nota: 'en los últimos 6 meses' },
              { etiqueta: 'Mejoran', valor: String(cuenta(['mejora'])), color: COLOR_ESTADO.verde, nota: '+10 % o más' },
              { etiqueta: 'Empeoran', valor: String(cuenta(['empeora'])), color: COLOR_ESTADO.rojo, nota: '−10 % o más' },
              { etiqueta: 'Sin efecto / no atribuible', valor: String(cuenta(['igual', 'no-atribuible', 'pocos-datos'])), nota: 'se mueve poco o algo lo ensucia' },
              { etiqueta: 'En marcha', valor: String(cuenta(['esperando', 'provisional'])), color: COLOR_ESTADO.azul, nota: 'menos de 21 días' },
            ]}
          />

          {historial.error && <p className="text-[12.5px]" style={{ color: COLOR_ESTADO.rojo }}>{historial.error}</p>}
          {historial.cargando && todos.length === 0 && <p className="text-[12.5px] text-[var(--ls-t4)]">Cargando las semanas de Brand Analytics…</p>}

          {todos.length > 0 && <LineaDeLaCuenta filas={historial.filas} cambios={visibles} asin={asin || null} />}

          {visibles.length > 1 && !persona && <PorPersona cambios={visibles} />}

          <div className="flex flex-col gap-3">
            {visibles
              .slice()
              .sort((a, b) => b.r.fechaCambio.localeCompare(a.r.fechaCambio))
              .map((c) => (
                <TarjetaDeCambio key={c.e.id} c={c} verFicha={verFicha} mkt={mkt} />
              ))}
            {todos.length > 0 && visibles.length === 0 && <p className="text-[12.5px] text-[var(--ls-t4)]">Ningún cambio aplicado con estos filtros.</p>}
          </div>
        </>
      )}

      <Registro eventos={eventos} nombreDeAsin={nombreDeAsin} mkt={mkt} verFicha={verFicha} persona={persona} setPersona={setPersona} />
    </div>
    </ProveedorDeComentarios>
  )
}

/* ------------------------------------------------------------------ */
/* 1 · La línea de la cuenta con los cambios marcados                  */
/* ------------------------------------------------------------------ */

function LineaDeLaCuenta({ filas, cambios, asin }: { filas: ReturnType<typeof useHistorial>['filas']; cambios: Cambio[]; asin: string | null }) {
  const serie = useMemo(() => {
    const porSemana = new Map<string, { hasta: string; compras: number }>()
    const vistas = new Set<string>()
    for (const f of filas) {
      if (f.periodo !== 'WEEK' || (asin && f.asin !== asin)) continue
      const k = `${f.asin}|${f.desde}|${f.consulta.toLowerCase()}`
      if (vistas.has(k)) continue
      vistas.add(k)
      const x = porSemana.get(f.desde) ?? { hasta: f.hasta, compras: 0 }
      x.compras += f.comprasAsin ?? 0
      porSemana.set(f.desde, x)
    }
    return [...porSemana.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([desde, v]) => ({ desde, ...v }))
  }, [filas, asin])
  if (serie.length < 2) return null

  const W = 960
  const H = 220
  const izq = 44
  const der = 16
  const arriba = 34
  const abajo = 28
  const max = Math.max(...serie.map((s) => s.compras), 1)
  const t0 = Date.parse(`${serie[0].desde}T00:00:00Z`)
  const t1 = Date.parse(`${serie[serie.length - 1].hasta}T00:00:00Z`)
  const x = (d: string) => izq + ((Date.parse(`${d.slice(0, 10)}T00:00:00Z`) - t0) / Math.max(t1 - t0, 1)) * (W - izq - der)
  const xMedio = (s: { desde: string; hasta: string }) => (x(s.desde) + x(s.hasta)) / 2
  const y = (v: number) => arriba + (1 - v / max) * (H - arriba - abajo)
  const linea = serie.map((s, i) => `${i ? 'L' : 'M'} ${xMedio(s).toFixed(1)} ${y(s.compras).toFixed(1)}`).join(' ')
  const area = `${linea} L ${xMedio(serie[serie.length - 1]).toFixed(1)} ${H - abajo} L ${xMedio(serie[0]).toFixed(1)} ${H - abajo} Z`
  const enRango = cambios.filter((c) => c.r.fechaCambio >= serie[0].desde && c.r.fechaCambio <= serie[serie.length - 1].hasta)
  const marcas = [0, 0.5, 1].map((f) => Math.round(max * f))
  const etiquetas = serie.filter((_, i) => i % Math.ceil(serie.length / 8) === 0)

  return (
    <div className="rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <History className="h-[15px] w-[15px] text-[var(--ls-t3)]" />
        <span className="text-[14px] font-semibold text-[var(--ls-t1)]">{asin ? 'Compras propias del producto' : 'Compras propias de la cuenta'} por semana</span>
        <span className="text-[11.5px] text-[var(--ls-t4)]">cada punto es un cambio de ficha aplicado · pasa el ratón o pulsa para ir a su tarjeta</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-auto w-full" role="img" aria-label="Compras propias por semana con los cambios de ficha marcados">
        {marcas.map((m) => (
          <g key={m}>
            <line x1={izq} x2={W - der} y1={y(m)} y2={y(m)} stroke="var(--ls-linea)" strokeWidth={1} />
            <text x={izq - 8} y={y(m) + 4} textAnchor="end" fontSize={11} fill="var(--ls-t4)">
              {m.toLocaleString('es-ES')}
            </text>
          </g>
        ))}
        <path d={area} fill={COLOR_ESTADO.azul} opacity={0.1} />
        <path d={linea} fill="none" stroke={COLOR_ESTADO.azul} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {etiquetas.map((s) => (
          <text key={s.desde} x={xMedio(s)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--ls-t4)">
            {fCorta(s.desde)}
          </text>
        ))}
        {enRango.map((c, i) => {
          const cx = x(c.r.fechaCambio)
          const color = colorDe(c.r.estado)
          return (
            <a key={c.e.id} href={`#cambio-${c.e.id}`} aria-label={`Cambio del ${fCorta(c.r.fechaCambio)} en ${c.nombre}: ${ESTILO_RESULTADO[c.r.estado].texto}`}>
              <title>{`${fCorta(c.r.fechaCambio)} · ${c.nombre}\n${c.e.campos.map((k) => NOMBRE_CAMPO[k] ?? k).join(', ')}${c.e.enviadoPor ? ` · ${c.e.enviadoPor}` : ''}\n${ESTILO_RESULTADO[c.r.estado].texto}${c.r.variacionDesde != null ? ` · ${pct(c.r.variacionDesde)} desde el cambio` : ''}`}</title>
              <line x1={cx} x2={cx} y1={arriba - 6} y2={H - abajo} stroke={color} strokeWidth={1.5} strokeDasharray="4 4" opacity={0.8} />
              <circle cx={cx} cy={arriba - 14} r={9} fill={color} stroke="var(--ls-sup)" strokeWidth={2.5} />
              <text x={cx} y={arriba - 10} textAnchor="middle" fontSize={10} fontWeight={700} fill="var(--ls-sup)">
                {i + 1}
              </text>
            </a>
          )
        })}
      </svg>
      <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-[var(--ls-t4)]">
        {(['mejora', 'empeora', 'igual', 'provisional', 'no-atribuible'] as EstadoResultado[]).map((e) => (
          <span key={e} className="inline-flex items-center gap-1">
            <span className="inline-block h-[9px] w-[9px] rounded-full" style={{ background: colorDe(e) }} />
            {ESTILO_RESULTADO[e].texto}
          </span>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 2 · La tarjeta de cada cambio                                       */
/* ------------------------------------------------------------------ */

function TarjetaDeCambio({ c, verFicha, mkt }: { c: Cambio; verFicha: (asin: string) => void; mkt: string | null }) {
  const { e, r } = c
  const [hiloAbierto, setHiloAbierto] = useState(false)
  const est = ESTILO_RESULTADO[r.estado]
  const color = colorDe(r.estado)
  const medidaTxt = r.medida === 'compras' ? 'cuota de compras' : r.medida === 'impresiones' ? 'cuota de impresiones' : null
  const semanasDesde = r.desdeElCambio.semanas
  const desdeVal = r.medida === 'compras' ? r.desdeElCambio.cuotaCompras : r.desdeElCambio.cuotaImpresiones
  const antesVal = r.medida === 'compras' ? r.antes.cuotaCompras : r.antes.cuotaImpresiones
  const Flecha = r.variacionDesde == null ? Minus : r.variacionDesde >= 0.1 ? ArrowUpRight : r.variacionDesde <= -0.1 ? ArrowDownRight : Minus
  const colorDesde = r.variacionDesde == null ? 'var(--ls-t3)' : r.variacionDesde >= 0.1 ? COLOR_ESTADO.verde : r.variacionDesde <= -0.1 ? COLOR_ESTADO.rojo : 'var(--ls-t2)'

  return (
    <div id={`cambio-${e.id}`} className="scroll-mt-4 rounded-[14px] border bg-[var(--ls-sup)] p-4" style={{ borderColor: `color-mix(in srgb, ${color} 35%, var(--ls-linea))` }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <button type="button" onClick={() => verFicha(e.asin)} className="shrink-0 rounded-[12px] bg-white p-[3px] ring-1 ring-[var(--ls-linea)]" title="Ver la ficha">
            <ImagenDeProducto asin={e.asin} mkt={mkt} lado={58} redondeo={10} titulo={c.nombre} />
          </button>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-[6px] px-[8px] py-[2px] text-[12px] font-semibold" style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>
              {est.texto}
            </span>
            <span className="truncate text-[14px] font-semibold text-[var(--ls-t1)]" title={c.nombre}>
              {c.nombre.length > 70 ? `${c.nombre.slice(0, 70)}…` : c.nombre}
            </span>
            <span className="text-[11.5px] tabular-nums text-[var(--ls-t4)]">{e.asin}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-[var(--ls-t3)]">
            <span>Cambio del {fCorta(r.fechaCambio)}</span>
            <span>·</span>
            <span>{e.campos.map((k) => NOMBRE_CAMPO[k] ?? k).join(', ')}</span>
            {e.enviadoPor && (
              <span className="inline-flex items-center gap-1">
                · <Avatar nombre={e.enviadoPor} tamano={18} /> {e.enviadoPor}
              </span>
            )}
            {e.origen === 'ia' && (
              <Insignia tono="violeta" tamano="sm">
                IA
              </Insignia>
            )}
            {e.estado === 'parcial' && (
              <Insignia tono="ambar" tamano="sm">
                Aplicado en parte
              </Insignia>
            )}
          </div>
        </div>
        </div>
        <Boton variante="secundario" icono={FileText} onClick={() => verFicha(e.asin)}>
          Ver la ficha
        </Boton>
      </div>

      {r.antes.semanas > 0 ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <GraficaDelCambio r={r} color={color} />
          <div className="flex flex-col gap-3">
            <div className="rounded-[12px] bg-[var(--ls-sup2)] p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ls-t4)]">Desde el cambio{semanasDesde ? ` · ${semanasDesde} ${semanasDesde === 1 ? 'semana' : 'semanas'}` : ''}</div>
              {r.variacionDesde != null ? (
                <div className="mt-1 flex items-center gap-1 text-[28px] font-semibold leading-none tracking-[-0.02em] tabular-nums" style={{ color: colorDesde }}>
                  <Flecha className="h-[24px] w-[24px]" />
                  {pct(r.variacionDesde)}
                </div>
              ) : (
                <div className="mt-1 text-[16px] font-semibold text-[var(--ls-t3)]">{semanasDesde ? 'Sin datos suficientes' : 'Aún sin semanas cerradas'}</div>
              )}
              {medidaTxt && (
                <div className="mt-1 text-[12px] text-[var(--ls-t3)]">
                  {medidaTxt}: {p1(antesVal)} → <span className="font-semibold text-[var(--ls-t1)]">{p1(desdeVal)}</span>
                </div>
              )}
            </div>
            <div className="grid grid-cols-[auto_1fr_1fr] gap-x-3 gap-y-1 text-[12px]">
              <span />
              <span className="text-[10.5px] font-semibold uppercase tracking-wide text-[var(--ls-t4)]">3 sem. antes</span>
              <span className="text-[10.5px] font-semibold uppercase tracking-wide text-[var(--ls-t4)]">Desde el cambio</span>
              <Fila etiqueta="Impresiones" a={p1(r.antes.cuotaImpresiones)} d={semanasDesde ? p1(r.desdeElCambio.cuotaImpresiones) : '…'} />
              <Fila etiqueta="Clics" a={p1(r.antes.cuotaClics)} d={semanasDesde ? p1(r.desdeElCambio.cuotaClics) : '…'} />
              <Fila etiqueta="Compras" a={p1(r.antes.cuotaCompras)} d={semanasDesde ? p1(r.desdeElCambio.cuotaCompras) : '…'} />
              <Fila etiqueta="Compras / semana" a={n0(r.antes.comprasSemana)} d={semanasDesde ? n0(r.desdeElCambio.comprasSemana) : '…'} />
              {r.antes.gastoSemana != null && <Fila etiqueta="Publicidad €/sem" a={n0(r.antes.gastoSemana)} d={semanasDesde ? n0(r.desdeElCambio.gastoSemana) : '…'} />}
            </div>
          </div>
        </div>
      ) : null}

      <p className="mt-3 text-[12.5px] leading-[1.5] text-[var(--ls-t2)]">
        <span className="font-semibold text-[var(--ls-t1)]">Veredicto 3 + 3 semanas: </span>
        {r.resumen}
      </p>
      {r.avisos.map((a) => (
        <div key={a} className="mt-1 flex items-start gap-2 text-[12px] leading-[1.45]" style={{ color: COLOR_ESTADO.ambar }}>
          <TriangleAlert className="mt-[2px] h-[13px] w-[13px] shrink-0" /> {a}
        </div>
      ))}
      {r.tocadas.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {r.tocadas.slice(0, 8).map((t) => (
            <span key={t.consulta} className="rounded-[6px] px-[7px] py-[2px] text-[11.5px]" style={{ color: t.cambio === 'entra' ? COLOR_ESTADO.verde : COLOR_ESTADO.rojo, background: `color-mix(in srgb, ${t.cambio === 'entra' ? COLOR_ESTADO.verde : COLOR_ESTADO.rojo} 10%, transparent)` }}>
              {t.cambio === 'entra' ? '+' : '−'} {t.consulta}
            </span>
          ))}
          {r.tocadas.length > 8 && <span className="text-[11.5px] text-[var(--ls-t4)]">y {r.tocadas.length - 8} más</span>}
        </div>
      )}
      <div className="mt-3 border-t border-[var(--ls-linea)] pt-3">
        <BotonDeComentarios hilo={`cambio:${e.id}`} abierto={hiloAbierto} onClick={() => setHiloAbierto((x) => !x)} />
        {hiloAbierto && (
          <div className="mt-2">
            <Hilo hilo={`cambio:${e.id}`} asin={e.asin} autoFoco />
          </div>
        )}
      </div>
    </div>
  )
}

/** La cuota que decide por semana: gris antes, la semana del cambio marcada, color después; la media de antes y la de desde el cambio en raya */
function GraficaDelCambio({ r, color }: { r: ResultadoDelCambio; color: string }) {
  const valor = (p: ResultadoDelCambio['serieLarga'][number]) => (r.medida === 'compras' ? p.cuotaCompras : p.cuotaImpresiones)
  const puntos = r.serieLarga.map((p) => ({ ...p, v: valor(p) }))
  const conValor = puntos.filter((p) => p.v != null)
  if (conValor.length < 2) return <div className="flex items-center justify-center rounded-[12px] bg-[var(--ls-sup2)] p-6 text-[12.5px] text-[var(--ls-t4)]">Todavía no hay semanas suficientes para dibujar la evolución.</div>

  const W = 560
  const H = 190
  const izq = 46
  const der = 12
  const arriba = 22
  const abajo = 26
  const max = Math.max(...conValor.map((p) => p.v as number)) * 1.15 || 0.01
  const n = puntos.length
  const x = (i: number) => izq + (n === 1 ? 0 : (i / (n - 1)) * (W - izq - der))
  const y = (v: number) => arriba + (1 - v / max) * (H - arriba - abajo)
  const iCambio = puntos.findIndex((p) => p.lado === 'cambio')
  const iPrimeroDespues = puntos.findIndex((p) => p.lado === 'despues')
  const xCambio = iCambio >= 0 ? x(iCambio) : iPrimeroDespues > 0 ? (x(iPrimeroDespues - 1) + x(iPrimeroDespues)) / 2 : null
  const tramo = (lado: 'antes' | 'despues') => {
    const idx = puntos.map((p, i) => ({ p, i })).filter(({ p }) => p.v != null && (p.lado === lado || (lado === 'despues' && p.lado === 'cambio') || (lado === 'antes' && p.lado === 'cambio')))
    return idx.map(({ p, i }, k) => `${k ? 'L' : 'M'} ${x(i).toFixed(1)} ${y(p.v as number).toFixed(1)}`).join(' ')
  }
  const antesVal = r.medida === 'compras' ? r.antes.cuotaCompras : r.antes.cuotaImpresiones
  const desdeVal = r.medida === 'compras' ? r.desdeElCambio.cuotaCompras : r.desdeElCambio.cuotaImpresiones
  const iAntes = puntos.map((p, i) => (p.lado === 'antes' ? i : -1)).filter((i) => i >= 0)
  const iDespues = puntos.map((p, i) => (p.lado === 'despues' ? i : -1)).filter((i) => i >= 0)
  const etiquetas = puntos.map((p, i) => ({ p, i })).filter(({ i }) => i % Math.ceil(n / 7) === 0 || i === iCambio)

  return (
    <div className="rounded-[12px] bg-[var(--ls-sup2)] p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ls-t4)]">{r.medida === 'compras' ? 'Cuota de compras' : 'Cuota de impresiones'} por semana · mismas búsquedas</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 h-auto w-full" role="img" aria-label="Evolución semanal antes y después del cambio">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={izq} x2={W - der} y1={y(max * f)} y2={y(max * f)} stroke="var(--ls-linea)" strokeWidth={1} />
            <text x={izq - 6} y={y(max * f) + 4} textAnchor="end" fontSize={10.5} fill="var(--ls-t4)">
              {p1(max * f)}
            </text>
          </g>
        ))}
        {xCambio != null && <rect x={xCambio} y={arriba} width={W - der - xCambio} height={H - arriba - abajo} fill={color} opacity={0.07} />}
        {antesVal != null && iAntes.length > 0 && (
          <line x1={x(iAntes[Math.max(0, iAntes.length - 3)])} x2={xCambio ?? x(iAntes[iAntes.length - 1])} y1={y(antesVal)} y2={y(antesVal)} stroke="var(--ls-t3)" strokeWidth={1.5} strokeDasharray="5 4" />
        )}
        {desdeVal != null && iDespues.length > 0 && xCambio != null && (
          <>
            <line x1={xCambio} x2={x(iDespues[iDespues.length - 1])} y1={y(desdeVal)} y2={y(desdeVal)} stroke={color} strokeWidth={1.5} strokeDasharray="5 4" />
            <text x={x(iDespues[iDespues.length - 1])} y={y(desdeVal) - 6} textAnchor="end" fontSize={11} fontWeight={600} fill={color}>
              media {p1(desdeVal)}
            </text>
          </>
        )}
        <path d={tramo('antes')} fill="none" stroke="var(--ls-t4)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        <path d={tramo('despues')} fill="none" stroke={color} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
        {puntos.map((p, i) =>
          p.v == null ? null : (
            <circle key={p.desde} cx={x(i)} cy={y(p.v)} r={p.lado === 'cambio' ? 5 : 3.5} fill={p.lado === 'antes' ? 'var(--ls-t4)' : p.lado === 'cambio' ? COLOR_ESTADO.ambar : color}>
              <title>{`Semana del ${fCorta(p.desde)}: ${p1(p.v)}${p.lado === 'cambio' ? ' (semana del cambio, no cuenta)' : ''}`}</title>
            </circle>
          ),
        )}
        {xCambio != null && (
          <>
            <line x1={xCambio} x2={xCambio} y1={arriba - 8} y2={H - abajo} stroke={COLOR_ESTADO.ambar} strokeWidth={2} />
            <text x={xCambio + 5} y={arriba - 10 + 8} fontSize={11} fontWeight={700} fill={COLOR_ESTADO.ambar}>
              Cambio {fCorta(r.fechaCambio)}
            </text>
          </>
        )}
        {etiquetas.map(({ p, i }) => (
          <text key={p.desde} x={x(i)} y={H - 8} textAnchor={i === n - 1 ? 'end' : i === 0 ? 'start' : 'middle'} fontSize={10.5} fill="var(--ls-t4)">
            {fCorta(p.desde)}
          </text>
        ))}
      </svg>
      <div className="mt-1 flex flex-wrap gap-3 text-[10.5px] text-[var(--ls-t4)]">
        <span>Gris: antes</span>
        <span style={{ color }}>Color: después</span>
        <span>Rayas: media de 3 semanas antes y media desde el cambio</span>
      </div>
    </div>
  )
}

function Fila({ etiqueta, a, d }: { etiqueta: string; a: string; d: string }) {
  return (
    <>
      <span className="text-[var(--ls-t3)]">{etiqueta}</span>
      <span className="tabular-nums text-[var(--ls-t2)]">{a}</span>
      <span className="tabular-nums font-semibold text-[var(--ls-t1)]">{d}</span>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* 3 · Resultado por persona                                           */
/* ------------------------------------------------------------------ */

function PorPersona({ cambios }: { cambios: Cambio[] }) {
  const filas = useMemo(() => {
    const m = new Map<string, { n: number; mejora: number; empeora: number; igual: number; marcha: number; suma: number; conVar: number }>()
    for (const c of cambios) {
      const k = c.e.enviadoPor ?? 'Sin nombre'
      const x = m.get(k) ?? { n: 0, mejora: 0, empeora: 0, igual: 0, marcha: 0, suma: 0, conVar: 0 }
      x.n++
      if (c.r.estado === 'mejora') x.mejora++
      else if (c.r.estado === 'empeora') x.empeora++
      else if (c.r.estado === 'esperando' || c.r.estado === 'provisional') x.marcha++
      else x.igual++
      if (c.r.variacionDesde != null && c.r.estado !== 'esperando') {
        x.suma += c.r.variacionDesde
        x.conVar++
      }
      m.set(k, x)
    }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n)
  }, [cambios])
  if (filas.length === 0) return null
  return (
    <div className="rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-4">
      <div className="text-[14px] font-semibold text-[var(--ls-t1)]">Resultado por persona</div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[560px] text-[12.5px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--ls-t4)]">
              <th className="py-1 pr-2 font-semibold">Quién envió el cambio</th>
              <th className="py-1 pr-2 text-right font-semibold">Cambios</th>
              <th className="py-1 pr-2 font-semibold">Resultado</th>
              <th className="py-1 text-right font-semibold">Media desde el cambio</th>
            </tr>
          </thead>
          <tbody>
            {filas.map(([nombre, x]) => {
              const media = x.conVar ? x.suma / x.conVar : null
              return (
                <tr key={nombre} className="border-t border-[var(--ls-linea)]">
                  <td className="py-2 pr-2">
                    <span className="inline-flex items-center gap-2 text-[var(--ls-t1)]">
                      <Avatar nombre={nombre} tamano={22} /> {nombre}
                    </span>
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums text-[var(--ls-t1)]">{x.n}</td>
                  <td className="py-2 pr-2">
                    <div className="flex h-[10px] w-full max-w-[220px] overflow-hidden rounded-full bg-[var(--ls-sup2)]">
                      {[
                        [x.mejora, COLOR_ESTADO.verde],
                        [x.igual, 'var(--ls-t4)'],
                        [x.empeora, COLOR_ESTADO.rojo],
                        [x.marcha, COLOR_ESTADO.azul],
                      ].map(([v, c], i) => (Number(v) > 0 ? <div key={i} style={{ width: `${(Number(v) / x.n) * 100}%`, background: String(c) }} /> : null))}
                    </div>
                    <div className="mt-1 text-[11px] text-[var(--ls-t4)]">
                      {x.mejora} mejoran · {x.empeora} empeoran · {x.igual} sin efecto · {x.marcha} en marcha
                    </div>
                  </td>
                  <td className="py-2 text-right font-semibold tabular-nums" style={{ color: media == null ? 'var(--ls-t4)' : media >= 0.1 ? COLOR_ESTADO.verde : media <= -0.1 ? COLOR_ESTADO.rojo : 'var(--ls-t2)' }}>
                    {media == null ? '—' : pct(media)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 4 · El registro: quién hizo qué                                     */
/* ------------------------------------------------------------------ */

const ICONO: Record<TipoDeEvento, typeof FileText> = { ficha: Type, verificacion: Bot, ia: Sparkles, helium: KeyRound, busqueda: Search, marca: Tag, highlights: FileText }
const TONO: Record<EventoSeo['tono'], string> = { bien: COLOR_ESTADO.verde, mal: COLOR_ESTADO.rojo, aviso: COLOR_ESTADO.ambar, neutro: 'var(--ls-t3)' }
const TIPO_TXT: Record<TipoDeEvento, string> = { ficha: 'Ficha', verificacion: 'Comprobación', ia: 'IA', helium: 'Helium 10', busqueda: 'Búsqueda', marca: 'Marca', highlights: 'Highlights' }
const POR_PAGINA = 40
type FiltroTipo = '' | 'fichas' | 'otros' | 'comentados'

function Registro({ eventos, nombreDeAsin, mkt, verFicha, persona, setPersona }: { eventos: EventoSeo[]; nombreDeAsin: (a: string | null) => string | null; mkt: string | null; verFicha: (asin: string) => void; persona: string; setPersona: (p: string) => void }) {
  const [tipo, setTipo] = useState<FiltroTipo>('')
  const [cuantos, setCuantos] = useState(POR_PAGINA)
  const [abierto, setAbierto] = useState<string | null>(null)
  const comentados = useComentadosPorHilo()
  const filtrados = eventos.filter((e) =>
    !tipo ? true : tipo === 'fichas' ? e.tipo === 'ficha' || e.tipo === 'verificacion' : tipo === 'comentados' ? (comentados.get(e.hilo) ?? 0) > 0 : e.tipo !== 'ficha' && e.tipo !== 'verificacion',
  )
  const dias = useMemo(() => {
    const m = new Map<string, EventoSeo[]>()
    for (const e of filtrados.slice(0, cuantos)) {
      const k = new Date(e.at).toLocaleDateString('sv-SE')
      m.set(k, [...(m.get(k) ?? []), e])
    }
    return [...m.entries()]
  }, [filtrados, cuantos])
  // El equipo que aparece en el registro, el que más hace primero: pulsar una cara filtra por esa persona
  const equipo = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of eventos) if (e.quien) m.set(e.quien, (m.get(e.quien) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [eventos])
  const nComentados = eventos.filter((e) => (comentados.get(e.hilo) ?? 0) > 0).length
  const hoyTxt = new Date().toLocaleDateString('sv-SE')
  const ayer = new Date()
  ayer.setDate(ayer.getDate() - 1)
  const ayerTxt = ayer.toLocaleDateString('sv-SE')

  const CHIPS: Array<[FiltroTipo, string]> = [
    ['', 'Todo'],
    ['fichas', 'Cambios de ficha'],
    ['otros', 'Búsquedas, marcas, Helium e IA'],
    ['comentados', `Con comentarios${nComentados ? ` · ${nComentados}` : ''}`],
  ]

  return (
    <div className="overflow-hidden rounded-[16px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]">
      <div className="flex flex-col gap-3 border-b border-[var(--ls-linea)] p-4" style={{ background: 'linear-gradient(180deg, color-mix(in srgb, var(--ls-mod-seo, var(--ls-acento)) 7%, transparent), transparent)' }}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-[10px]" style={{ background: 'color-mix(in srgb, var(--ls-mod-seo, var(--ls-acento)) 16%, transparent)', color: 'var(--ls-mod-seo, var(--ls-acento))' }}>
            <History className="h-[16px] w-[16px]" />
          </span>
          <div>
            <div className="text-[15px] font-semibold text-[var(--ls-t1)]">Actividad del equipo</div>
            <div className="text-[11.5px] text-[var(--ls-t4)]">Quién ha hecho qué y cuándo · últimos 6 meses · {eventos.length.toLocaleString('es-ES')} acciones · pulsa «Comentar» para dejar una nota</div>
          </div>
          {equipo.length > 0 && (
            <div className="ml-auto flex items-center gap-1">
              {equipo.slice(0, 8).map(([n, k]) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setPersona(persona === n ? '' : n)}
                  title={`${n} · ${k} acciones${persona === n ? ' (pulsa para quitar el filtro)' : ''}`}
                  className="rounded-full transition-transform hover:-translate-y-[2px]"
                  style={{ outline: persona === n ? '2px solid var(--ls-acento)' : 'none', outlineOffset: 2, opacity: persona && persona !== n ? 0.4 : 1 }}
                >
                  <Avatar nombre={n} tamano={30} />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-[6px]">
          {CHIPS.map(([v, t]) => (
            <button
              key={v || 'todo'}
              type="button"
              onClick={() => {
                setTipo(v)
                setCuantos(POR_PAGINA)
              }}
              className="h-7 rounded-full border px-3 text-[12px] transition-colors"
              style={tipo === v ? { borderColor: 'var(--ls-acento)', color: 'var(--ls-t1)', background: 'color-mix(in srgb, var(--ls-acento) 12%, transparent)' } : { borderColor: 'var(--ls-linea)', color: 'var(--ls-t3)' }}
            >
              {t}
            </button>
          ))}
          {persona && (
            <button type="button" onClick={() => setPersona('')} className="inline-flex h-7 items-center gap-1 rounded-full bg-[var(--ls-sup2)] px-3 text-[12px] text-[var(--ls-t2)]">
              <Avatar nombre={persona} tamano={16} /> {persona} ✕
            </button>
          )}
        </div>
      </div>

      {filtrados.length === 0 ? (
        <p className="p-4 text-[12.5px] text-[var(--ls-t4)]">No hay acciones registradas con estos filtros.</p>
      ) : (
        <div className="flex flex-col gap-5 p-4">
          {dias.map(([dia, lista]) => (
            <section key={dia}>
              <div className="sticky top-0 z-[1] mb-2 flex items-center gap-2 bg-[var(--ls-sup)] py-1">
                <span className="text-[12px] font-semibold text-[var(--ls-t1)]">{dia === hoyTxt ? 'Hoy' : dia === ayerTxt ? 'Ayer' : fLarga(lista[0].at).replace(/^./, (l) => l.toUpperCase())}</span>
                <span className="h-px flex-1 bg-[var(--ls-linea)]" />
                <span className="text-[11px] text-[var(--ls-t4)]">
                  {lista.length} {lista.length === 1 ? 'acción' : 'acciones'}
                </span>
              </div>
              <ol className="relative ml-[17px] border-l border-[var(--ls-linea)]">
                {lista.map((e) => (
                  <EventoDelRegistro key={e.id} e={e} producto={nombreDeAsin(e.asin)} mkt={mkt} verFicha={verFicha} abierto={abierto === e.id} alternar={() => setAbierto((x) => (x === e.id ? null : e.id))} />
                ))}
              </ol>
            </section>
          ))}
          {filtrados.length > cuantos && (
            <div className="flex justify-center">
              <Boton variante="secundario" onClick={() => setCuantos((c) => c + POR_PAGINA)}>
                Ver más ({(filtrados.length - cuantos).toLocaleString('es-ES')})
              </Boton>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function EventoDelRegistro({ e, producto, mkt, verFicha, abierto, alternar }: { e: EventoSeo; producto: string | null; mkt: string | null; verFicha: (asin: string) => void; abierto: boolean; alternar: () => void }) {
  const Icono = ICONO[e.tipo]
  const tono = TONO[e.tono]
  return (
    <li className="relative pb-3 pl-6 last:pb-0">
      {/* La cara de quien lo hizo sobre la línea del día, con el icono del tipo de acción en la esquina */}
      <span className="absolute -left-[17px] top-0">
        {e.quien ? (
          <Avatar nombre={e.quien} tamano={34} className="ring-[3px] ring-[var(--ls-sup)]" />
        ) : (
          <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[var(--ls-sup3)] text-[var(--ls-t2)] ring-[3px] ring-[var(--ls-sup)]" title="Lo hizo el ERP solo">
            <Bot className="h-[16px] w-[16px]" />
          </span>
        )}
        <span className="absolute -bottom-[3px] -right-[5px] flex h-[17px] w-[17px] items-center justify-center rounded-full ring-2 ring-[var(--ls-sup)]" style={{ background: `color-mix(in srgb, ${tono} 22%, var(--ls-sup))`, color: tono }} title={TIPO_TXT[e.tipo]}>
          <Icono className="h-[10px] w-[10px]" />
        </span>
      </span>

      <div className="rounded-[12px] border border-transparent p-[10px] pt-[6px] transition-colors hover:border-[var(--ls-linea)] hover:bg-[color-mix(in_srgb,var(--ls-sup2)_55%,transparent)]" style={abierto ? { borderColor: 'var(--ls-linea)', background: 'color-mix(in srgb, var(--ls-sup2) 55%, transparent)' } : undefined}>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-[13px] font-semibold text-[var(--ls-t1)]">{e.quien ?? ERP}</span>
          <span className="text-[13px] text-[var(--ls-t2)]">{e.accion.charAt(0).toLowerCase() + e.accion.slice(1)}</span>
          <span className="ml-auto whitespace-nowrap text-[11px] tabular-nums text-[var(--ls-t4)]" title={new Date(e.at).toLocaleString('es-ES')}>
            {cuandoFue(e.at)}
          </span>
        </div>
        {e.detalle && (
          <div className="mt-[2px] text-[12px] leading-[1.45]" style={{ color: e.tono === 'neutro' ? 'var(--ls-t3)' : tono }}>
            {e.detalle}
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {e.asin && (
            <button type="button" onClick={() => verFicha(e.asin as string)} className="group/p inline-flex max-w-full items-center gap-[10px] rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] py-[5px] pl-[5px] pr-3 text-left transition-colors hover:border-[color-mix(in_srgb,var(--ls-acento)_45%,var(--ls-linea))]" title="Abrir la ficha">
              <span className="shrink-0 rounded-[8px] bg-white p-[2px]">
                <ImagenDeProducto asin={e.asin} mkt={mkt} lado={40} redondeo={6} titulo={producto ?? e.asin} />
              </span>
              <span className="min-w-0">
                <span className="block max-w-[420px] truncate text-[12px] font-medium text-[var(--ls-t1)]">{producto ?? e.asin}</span>
                <span className="block text-[10.5px] tabular-nums text-[var(--ls-t4)]">{e.asin}</span>
              </span>
              <ChevronRight className="h-[14px] w-[14px] shrink-0 text-[var(--ls-t4)] transition-transform group-hover/p:translate-x-[2px]" />
            </button>
          )}
          <span className="ml-auto">
            <BotonDeComentarios hilo={e.hilo} abierto={abierto} onClick={alternar} />
          </span>
        </div>
        {abierto && (
          <div className="mt-2">
            <Hilo hilo={e.hilo} asin={e.asin} autoFoco />
          </div>
        )}
      </div>
    </li>
  )
}
