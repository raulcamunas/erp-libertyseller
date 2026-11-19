'use client'

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, ChevronDown, ChevronRight, Download, Loader2, LogOut, Search } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  buyBox,
  conversion,
  diasDe,
  diasEntre,
  fechaCorta,
  finDeMes,
  matriz,
  mesesEntre,
  nombreDeMes,
  periodoDeComparacion,
  porJuego,
  precioMedio,
  semanaIso,
  semanasDisponibles,
  sumarDias,
  sumarTodas,
  veces,
  type Cifras,
  type Comparacion,
} from '@/lib/trafico/calculo'
import type { DatosDelPanel } from '@/lib/trafico/servidor'
import { decimal, dinero, entero, pct, puntos, variacion } from './formato'
import { descargarExcel } from './excel'

/**
 * LA PÁGINA DE TRÁFICO Y CONVERSIÓN DEL CLIENTE: lo mismo que el Excel «Tráfico y conversión por juego», pero con el periodo y la comparación que elija quien la mira,
 * y al día (se lee de Amazon cada día). Colores sueltos de la marca (no las variables del ERP), como el panel de tareas del cliente: no vive dentro del tema oscuro.
 */

const C = { negro: '#141414', negro2: '#0E0E0E', naranja: '#F26212', naranja2: '#FF8A3D', crema: '#EDE6DC', gris: '#5E5852', gris2: '#B8AE9F', linea: '#E5E1DB', suave: '#F7F5F2', naranjaFondo: '#FEF3EC', anterior: '#9C9289' }
const hoyEnEspana = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())

type TipoDePeriodo = 'semana' | 'mes' | 'ultimos' | 'fechas'

const TEXTO_COMPARACION: Record<Comparacion, string> = { anterior: 'el periodo anterior', 'mes-anterior': 'el mes anterior', 'anio-anterior': 'el mismo periodo de hace un año' }

function textoDePeriodo(desde: string, hasta: string): string {
  const s = semanaIso(desde)
  if (s.lunes === desde && s.domingo === hasta) return `W${s.semana} · del ${fechaCorta(desde)} al ${fechaCorta(hasta)} de ${desde.slice(0, 4)}`
  if (desde.endsWith('-01') && hasta === finDeMes(desde.slice(0, 7))) return nombreDeMes(desde.slice(0, 7))
  return `del ${fechaCorta(desde)}${desde.slice(0, 4) !== hasta.slice(0, 4) ? ` de ${desde.slice(0, 4)}` : ''} al ${fechaCorta(hasta)} de ${hasta.slice(0, 4)}`
}

/* ------------------------------------------------------------------ */
/* Piezas                                                              */
/* ------------------------------------------------------------------ */

function Seccion({ n, kicker, titulo, children, nota }: { n: string; kicker: string; titulo: string; children: React.ReactNode; nota?: string }) {
  return (
    <section className="mt-10">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#5E5852]"><span className="text-[#F26212]">{n}</span> · {kicker}</p>
      <h2 className="mt-1 text-[20px] font-semibold leading-tight text-[#141414]" style={{ fontFamily: 'var(--font-sora), system-ui' }}>{titulo}</h2>
      <div className="mt-1 h-[3px] w-12 rounded bg-[#F26212]" />
      <div className="mt-4">{children}</div>
      {nota && <p className="mt-2 text-[12px] leading-relaxed text-[#8C857C]">{nota}</p>}
    </section>
  )
}

function Kpi({ etiqueta, valor, antes, cambio, malo, destacado }: { etiqueta: string; valor: string; antes?: string | null; cambio?: string | null; malo?: boolean; destacado?: boolean }) {
  return (
    <div className={`rounded-2xl px-4 py-3.5 ${destacado ? 'bg-[#0E0E0E]' : 'border border-[#E5E1DB] bg-[#FFFFFF]'}`}>
      <p className={`text-[10.5px] font-semibold uppercase tracking-[0.14em] ${destacado ? 'text-[#B8AE9F]' : 'text-[#8C857C]'}`}>{etiqueta}</p>
      <p className={`mt-1 text-[24px] font-semibold tabular-nums leading-tight ${destacado ? 'text-[#F26212]' : 'text-[#141414]'}`} style={{ fontFamily: 'var(--font-sora), system-ui' }}>{valor}</p>
      {(antes || cambio) && (
        <p className={`mt-1 text-[12px] ${destacado ? 'text-[#EDE6DC]' : 'text-[#5E5852]'}`}>
          {cambio && <span className={`mr-1.5 font-semibold ${malo ? 'text-[#C0432E]' : destacado ? 'text-[#FF8A3D]' : 'text-[#141414]'}`}>{cambio}</span>}
          {antes && <span>antes {antes}</span>}
        </p>
      )}
    </div>
  )
}

const empiezaPorMenos = (t: string | null | undefined) => Boolean(t && (t.startsWith('−') || t.startsWith('-')))

/* ------------------------------------------------------------------ */
/* La entrada con clave                                                */
/* ------------------------------------------------------------------ */

export function EntrarConClave({ token, titulo, alEntrar, etiqueta = 'Tráfico y conversión' }: { token: string; titulo: string; alEntrar: () => void; etiqueta?: string }) {
  const [clave, setClave] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const enviar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!clave.trim()) return
    setEnviando(true)
    setError(null)
    try {
      const r = await fetch(`/api/trafico/${token}/entrar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clave }) })
      const j = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) throw new Error(j.error ?? 'No se ha podido entrar.')
      alEntrar()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se ha podido entrar.')
    } finally {
      setEnviando(false)
    }
  }
  return (
    <div className="flex min-h-screen flex-col bg-[#F7F5F2]">
      <Cabecera titulo={titulo} etiqueta={etiqueta} />
      <main className="mx-auto w-full max-w-[420px] flex-1 px-5 py-12">
        <form onSubmit={enviar} className="rounded-2xl border border-[#E5E1DB] bg-[#FFFFFF] p-6">
          <h2 className="text-[18px] font-semibold text-[#141414]" style={{ fontFamily: 'var(--font-sora), system-ui' }}>Introduce la clave</h2>
          <p className="mt-1 text-[13.5px] text-[#5E5852]">Te la ha dado Liberty Seller junto con este enlace.</p>
          <input type="password" autoFocus autoComplete="current-password" value={clave} onChange={(e) => setClave(e.target.value)} aria-label="Clave" className="mt-4 h-11 w-full rounded-xl border border-[#E5E1DB] bg-[#F7F5F2] px-3 text-[15px] text-[#141414] outline-none focus:border-[#F26212]" />
          {error && <p className="mt-2 flex items-center gap-1.5 text-[13px] text-[#C0432E]" role="alert"><AlertCircle className="h-4 w-4" /> {error}</p>}
          <button type="submit" disabled={enviando || !clave.trim()} className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#F26212] text-[15px] font-semibold text-white disabled:opacity-50">
            {enviando && <Loader2 className="h-4 w-4 animate-spin" />} Entrar
          </button>
        </form>
      </main>
    </div>
  )
}

export function Cabecera({ titulo, subtitulo, derecha, etiqueta = 'Tráfico y conversión' }: { titulo: string; subtitulo?: string; derecha?: React.ReactNode; etiqueta?: string }) {
  return (
    <header className="bg-[#0E0E0E]">
      <div className="h-[5px] bg-[#F26212]" />
      <div className="mx-auto max-w-[1240px] px-5 pb-7 pt-5 sm:px-8">
        <div className="flex items-center justify-between gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logos/logo.png" alt="Liberty Seller" className="h-[26px] w-auto" />
          <div className="flex items-center gap-3">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.2em] text-[#F26212]">{etiqueta}</span>
            {derecha}
          </div>
        </div>
        <h1 className="mt-6 text-[27px] leading-[1.15] text-[#FFFFFF] sm:text-[34px]" style={{ fontFamily: 'var(--font-sora), system-ui', fontWeight: 600 }}>{titulo}</h1>
        {subtitulo && <p className="mt-2 text-[14px] text-[#EDE6DC]">{subtitulo}</p>}
      </div>
    </header>
  )
}

/* ------------------------------------------------------------------ */
/* La página                                                           */
/* ------------------------------------------------------------------ */

export function PanelTrafico({ token, titulo, autenticado }: { token: string; titulo: string; autenticado: boolean }) {
  const [dentro, setDentro] = useState(autenticado)
  const alSalir = useCallback(() => setDentro(false), [])
  if (!dentro) return <EntrarConClave token={token} titulo={titulo} alEntrar={() => setDentro(true)} />
  return <Panel token={token} titulo={titulo} alSalir={alSalir} />
}

function ultimaSemanaCompleta(ayer: string): { desde: string; hasta: string } {
  const s = semanaIso(ayer)
  return s.domingo === ayer ? { desde: s.lunes, hasta: s.domingo } : { desde: sumarDias(s.lunes, -7), hasta: sumarDias(s.lunes, -1) }
}

function Panel({ token, titulo, alSalir }: { token: string; titulo: string; alSalir: () => void }) {
  const ayer = sumarDias(hoyEnEspana(), -1)
  const [tipo, setTipo] = useState<TipoDePeriodo>('semana')
  const [periodo, setPeriodo] = useState(() => ultimaSemanaCompleta(ayer))
  const [comparacion, setComparacion] = useState<Comparacion>('anterior')
  const [datos, setDatos] = useState<DatosDelPanel | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [abiertos, setAbiertos] = useState<ReadonlySet<string>>(new Set())
  const [buscar, setBuscar] = useState('')
  const [orden, setOrden] = useState<{ por: 'sesiones' | 'unidades' | 'ventas' | 'conversion' | 'buybox' | 'juego'; desc: boolean }>({ por: 'sesiones', desc: true })
  const [vistaMes, setVistaMes] = useState<'unidades' | 'sesiones' | 'conversion'>('unidades')
  const [descargando, setDescargando] = useState(false)

  const comp = useMemo(() => periodoDeComparacion(periodo.desde, periodo.hasta, comparacion), [periodo, comparacion])

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const q = new URLSearchParams({ desde: periodo.desde, hasta: periodo.hasta, compDesde: comp.desde, compHasta: comp.hasta })
      const r = await fetch(`/api/trafico/${token}/datos?${q}`, { cache: 'no-store' })
      if (r.status === 401) return alSalir()
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'No se han podido leer los datos.')
      setDatos(j as DatosDelPanel)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se han podido leer los datos.')
    } finally {
      setCargando(false)
    }
  }, [token, periodo, comp, alSalir])
  useEffect(() => void cargar(), [cargar])

  const salir = async () => {
    await fetch(`/api/trafico/${token}/entrar`, { method: 'DELETE' }).catch(() => undefined)
    alSalir()
  }

  const primerDia = datos?.primerDia ?? sumarDias(ayer, -60)
  const ultimoDia = datos?.ultimoDia ?? ayer
  const semanas = useMemo(() => semanasDisponibles(primerDia, ultimoDia), [primerDia, ultimoDia])
  const meses = useMemo(() => mesesEntre(primerDia, ultimoDia).reverse(), [primerDia, ultimoDia])

  /* ---- cálculos ---- */
  const calc = useMemo(() => {
    if (!datos) return null
    const p = datos.periodo
    const nP = diasEntre(p.desde, p.hasta)
    const tP = sumarTodas(p.total)
    const tC = datos.comparacion ? sumarTodas(datos.comparacion.total) : null
    const nC = datos.comparacion ? diasEntre(datos.comparacion.desde, datos.comparacion.hasta) : 1
    const juegos = porJuego(p.total, datos.juegos)
    const compJuego = new Map((datos.comparacion ? porJuego(datos.comparacion.total, datos.juegos) : []).map((j) => [j.juego, j.cifras]))
    const diario = matriz(p.dias, datos.juegos)
    const mensual = matriz(datos.meses, datos.juegos)
    return { p, nP, tP, tC, nC, juegos, compJuego, diario, mensual }
  }, [datos])

  if (error && !datos) {
    return (
      <div className="min-h-screen bg-[#F7F5F2]">
        <Cabecera titulo={titulo} />
        <p className="mx-auto mt-12 flex max-w-[600px] items-center gap-2 px-5 text-[14px] text-[#C0432E]" role="alert"><AlertCircle className="h-4 w-4" /> {error} <button type="button" onClick={() => void cargar()} className="underline">Reintentar</button></p>
      </div>
    )
  }

  const textoP = textoDePeriodo(periodo.desde, periodo.hasta)
  const textoC = textoDePeriodo(comp.desde, comp.hasta)
  const provisional = datos && periodo.hasta >= datos.provisionalDesde
  const media = calc ? conversion(calc.tP) : null

  const juegosVisibles = (() => {
    if (!calc) return []
    const q = buscar.trim().toLowerCase()
    const lista = calc.juegos.filter((j) => !q || j.juego.toLowerCase().includes(q) || j.asins.some((a) => a.asin.toLowerCase().includes(q) || (a.producto ?? '').toLowerCase().includes(q)))
    const v = (j: (typeof lista)[number]): number | string =>
      orden.por === 'juego' ? j.juego.toLowerCase() : orden.por === 'conversion' ? (conversion(j.cifras) ?? -1) : orden.por === 'buybox' ? (buyBox(j.cifras) ?? -1) : j.cifras[orden.por]
    return [...lista].sort((a, b) => {
      const x = v(a)
      const y = v(b)
      return (x < y ? -1 : x > y ? 1 : 0) * (orden.desc ? -1 : 1)
    })
  })()
  const ordenar = (por: typeof orden.por) => setOrden((o) => (o.por === por ? { por, desc: !o.desc } : { por, desc: por !== 'juego' }))
  const Th = ({ por, children, izquierda }: { por?: typeof orden.por; children: React.ReactNode; izquierda?: boolean }) => (
    <th onClick={por ? () => ordenar(por) : undefined} className={`whitespace-nowrap border-b border-[#E5E1DB] bg-[#F7F5F2] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#5E5852] ${izquierda ? 'text-left' : 'text-right'} ${por ? 'cursor-pointer select-none hover:text-[#141414]' : ''}`}>
      {children}
      {por && orden.por === por ? (orden.desc ? ' ↓' : ' ↑') : ''}
    </th>
  )
  const tdBase = 'border-b border-[#EFEBE5] px-3 py-2 tabular-nums text-[13px] text-[#141414]'
  const td = `${tdBase} text-right`

  /* ---- datos de los gráficos ---- */
  const graficoDias = calc ? diasDe(calc.p.desde, calc.p.hasta).map((d) => { const c = calc.diario.total.get(d); return { dia: fechaCorta(d), Navegador: c?.navegador ?? 0, 'App móvil': c?.app ?? 0, Unidades: c?.unidades ?? 0, provisional: datos ? d >= datos.provisionalDesde : false } }) : []
  const mesesHist = datos && datos.meses.length ? mesesEntre(`${[...datos.meses].map((f) => f.clave).sort()[0]}-01`, `${ultimoDia.slice(0, 7)}-01`) : []
  const diasDelMes = (mes: string) => (mes === ultimoDia.slice(0, 7) ? Number(ultimoDia.slice(8, 10)) : Number(finDeMes(mes).slice(8, 10)))
  const graficoMeses = calc ? mesesHist.map((m) => { const c = calc.mensual.total.get(m); return { mes: nombreDeMes(m), 'Sesiones al día': c ? Math.round(c.sesiones / diasDelMes(m)) : 0, Conversión: c && c.sesiones > 0 ? Number(((c.unidades / c.sesiones) * 100).toFixed(2)) : null } }) : []
  const graficoJuegos = calc ? calc.juegos.slice(0, 20).map((j) => ({ juego: j.juego.length > 34 ? `${j.juego.slice(0, 33)}…` : j.juego, Conversión: Number(((conversion(j.cifras) ?? 0) * 100).toFixed(2)), arriba: (conversion(j.cifras) ?? 0) > (media ?? 0) })) : []

  /* ---- mes a mes (como el apartado 02 del Excel) ---- */
  const mesDelPeriodo = periodo.desde.slice(0, 7)
  const dosMeses = mesesHist.filter((m) => m < mesDelPeriodo).slice(-2)
  const columnasMes: Array<{ titulo: string; c: Cifras | null; dias: number }> = calc
    ? [
        ...dosMeses.map((m) => ({ titulo: nombreDeMes(m), c: calc.mensual.total.get(m) ?? null, dias: diasDelMes(m) })),
        ...(calc.tC ? [{ titulo: `Comparación (${textoC})`, c: calc.tC, dias: calc.nC }] : []),
        { titulo: textoP, c: calc.tP, dias: calc.nP },
      ]
    : []
  const filasMes: Array<{ m: string; v: (c: Cifras, d: number) => number | null; f: (n: number | null) => string; relativo?: 'veces' | 'puntos' }> = [
    { m: 'Días del periodo', v: (_c, d) => d, f: entero },
    { m: 'Sesiones', v: (c) => c.sesiones, f: entero },
    { m: 'Sesiones al día', v: (c, d) => c.sesiones / d, f: (n) => decimal(n, 0), relativo: 'veces' },
    { m: 'Unidades', v: (c) => c.unidades, f: entero },
    { m: 'Unidades al día', v: (c, d) => c.unidades / d, f: (n) => decimal(n, 1), relativo: 'veces' },
    { m: 'Conversión', v: (c) => conversion(c), f: (n) => pct(n), relativo: 'puntos' },
    { m: 'Ventas encargadas', v: (c) => c.ventas, f: (n) => dinero(n, datos?.moneda) },
    { m: 'Ventas al día', v: (c, d) => c.ventas / d, f: (n) => dinero(n, datos?.moneda), relativo: 'veces' },
    { m: 'Precio medio por unidad', v: (c) => precioMedio(c), f: (n) => dinero(n, datos?.moneda), relativo: 'veces' },
    { m: 'Buy Box medio', v: (c) => buyBox(c), f: (n) => pct(n, 1), relativo: 'puntos' },
  ]

  return (
    <div className="min-h-screen bg-[#F7F5F2] text-[#141414]">
      <Cabecera
        titulo={datos?.titulo ?? titulo}
        subtitulo={`${textoP}${datos?.ultimoDia ? ` · datos de Seller Central hasta el ${fechaCorta(datos.ultimoDia)} · se actualiza cada día` : ''}`}
        derecha={<button type="button" onClick={() => void salir()} title="Salir" className="rounded-lg p-1.5 text-[#B8AE9F] hover:text-white"><LogOut className="h-4 w-4" /></button>}
      />

      {/* ---- periodo y comparación ---- */}
      <div className="z-20 border-b sm:sticky sm:top-0 border-[#E5E1DB] bg-[#FFFFFF]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 sm:px-8">
          <div className="inline-flex rounded-xl border border-[#E5E1DB] bg-[#F7F5F2] p-0.5" role="radiogroup" aria-label="Tipo de periodo">
            {(['semana', 'mes', 'ultimos', 'fechas'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={tipo === t}
                onClick={() => {
                  setTipo(t)
                  if (t === 'semana') {
                    setPeriodo(ultimaSemanaCompleta(ayer))
                    setComparacion('anterior')
                  }
                  if (t === 'mes') {
                    setPeriodo({ desde: `${ultimoDia.slice(0, 7)}-01`, hasta: ultimoDia })
                    setComparacion('mes-anterior')
                  }
                  if (t === 'ultimos') setPeriodo({ desde: sumarDias(ultimoDia, -29), hasta: ultimoDia })
                }}
                className={`h-8 rounded-[10px] px-3 text-[13px] font-medium ${tipo === t ? 'bg-[#141414] text-white' : 'text-[#5E5852] hover:text-[#141414]'}`}
              >
                {t === 'semana' ? 'Semana' : t === 'mes' ? 'Mes' : t === 'ultimos' ? 'Últimos días' : 'Fechas'}
              </button>
            ))}
          </div>
          {tipo === 'semana' && (
            <select aria-label="Semana" value={`${periodo.desde}|${periodo.hasta}`} onChange={(e) => { const [desde, hasta] = e.target.value.split('|'); setPeriodo({ desde, hasta }) }} className="h-9 rounded-xl border border-[#E5E1DB] bg-white px-2 text-[13px]">
              {semanas.map((s) => <option key={s.id} value={`${s.desde}|${s.hasta}`}>{s.texto}{s.hasta > ultimoDia ? ' (en curso)' : ''}</option>)}
              {!semanas.some((s) => s.desde === periodo.desde) && <option value={`${periodo.desde}|${periodo.hasta}`}>{textoP}</option>}
            </select>
          )}
          {tipo === 'mes' && (
            <select aria-label="Mes" value={periodo.desde.slice(0, 7)} onChange={(e) => { const m = e.target.value; setPeriodo({ desde: `${m}-01`, hasta: finDeMes(m) < ultimoDia ? finDeMes(m) : ultimoDia }) }} className="h-9 rounded-xl border border-[#E5E1DB] bg-white px-2 text-[13px]">
              {meses.map((m) => <option key={m} value={m}>{nombreDeMes(m)}{m === ultimoDia.slice(0, 7) ? ' (en curso)' : ''}</option>)}
            </select>
          )}
          {tipo === 'ultimos' && (
            <select aria-label="Últimos días" value={diasEntre(periodo.desde, periodo.hasta)} onChange={(e) => setPeriodo({ desde: sumarDias(ultimoDia, -(Number(e.target.value) - 1)), hasta: ultimoDia })} className="h-9 rounded-xl border border-[#E5E1DB] bg-white px-2 text-[13px]">
              {[7, 14, 30, 60, 90].map((n) => <option key={n} value={n}>Últimos {n} días</option>)}
            </select>
          )}
          {tipo === 'fechas' && (
            <span className="flex items-center gap-1.5 text-[13px] text-[#5E5852]">
              <input type="date" aria-label="Desde" value={periodo.desde} min={primerDia} max={periodo.hasta} onChange={(e) => e.target.value && setPeriodo((p) => ({ ...p, desde: e.target.value }))} className="h-9 rounded-xl border border-[#E5E1DB] bg-white px-2" />
              –
              <input type="date" aria-label="Hasta" value={periodo.hasta} min={periodo.desde} max={ultimoDia} onChange={(e) => e.target.value && setPeriodo((p) => ({ ...p, hasta: e.target.value }))} className="h-9 rounded-xl border border-[#E5E1DB] bg-white px-2" />
            </span>
          )}
          <label className="flex items-center gap-2 text-[13px] text-[#5E5852]">
            Comparar con
            <select value={comparacion} onChange={(e) => setComparacion(e.target.value as Comparacion)} className="h-9 rounded-xl border border-[#E5E1DB] bg-white px-2 text-[13px] text-[#141414]">
              <option value="anterior">el periodo anterior</option>
              <option value="mes-anterior">el mes anterior</option>
              <option value="anio-anterior">hace un año</option>
            </select>
          </label>
          {cargando && <Loader2 className="h-4 w-4 animate-spin text-[#F26212]" aria-label="Cargando" />}
          <button
            type="button"
            disabled={!datos || descargando}
            onClick={async () => {
              if (!datos) return
              setDescargando(true)
              try {
                await descargarExcel(datos, textoP, textoC)
              } finally {
                setDescargando(false)
              }
            }}
            className="ml-auto inline-flex h-9 items-center gap-2 rounded-xl bg-[#F26212] px-3.5 text-[13px] font-semibold text-white disabled:opacity-50"
          >
            {descargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Descargar Excel
          </button>
        </div>
      </div>

      <main className="mx-auto max-w-[1240px] px-5 pb-16 sm:px-8">
        {datos && datos.diasPorLeer > 3 && (
          <p className="mt-6 rounded-xl border border-[#F26212]/30 bg-[#FEF3EC] px-4 py-2.5 text-[13px] text-[#141414]">Estamos cargando el histórico de Seller Central: faltan {entero(datos.diasPorLeer)} días por traer. Los periodos más antiguos se irán completando solos en las próximas horas.</p>
        )}
        {provisional && (
          <p className="mt-6 rounded-xl border border-[#E5E1DB] bg-[#FFFFFF] px-4 py-2.5 text-[13px] text-[#5E5852]">Los últimos días son provisionales: Amazon da las ventas al día siguiente, pero las sesiones tardan uno o dos días más (el último día puede salir aún sin sesiones). Se completan solas.</p>
        )}
        {error && <p className="mt-4 text-[13px] text-[#C0432E]" role="alert">{error}</p>}
        {!calc ? (
          <div className="mt-16 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-[#F26212]" /></div>
        ) : (
          <>
            <Seccion n="01" kicker="El periodo en cifras" titulo={textoP} nota={calc.tC ? `Comparado con ${TEXTO_COMPARACION[comparacion]} (${textoC}). Las cifras «al día» dividen entre los días de cada periodo; el Buy Box medio está ponderado por visitas.` : undefined}>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Kpi destacado etiqueta="Sesiones" valor={entero(calc.tP.sesiones)} antes={calc.tC ? entero(calc.tC.sesiones) : null} />
                <Kpi etiqueta="Unidades" valor={entero(calc.tP.unidades)} antes={calc.tC ? entero(calc.tC.unidades) : null} />
                <Kpi etiqueta="Conversión" valor={pct(conversion(calc.tP))} antes={calc.tC ? pct(conversion(calc.tC)) : null} cambio={calc.tC ? puntos(conversion(calc.tP), conversion(calc.tC)) : null} malo={empiezaPorMenos(calc.tC ? puntos(conversion(calc.tP), conversion(calc.tC)) : null)} />
                <Kpi etiqueta="Ventas encargadas" valor={dinero(calc.tP.ventas, datos?.moneda)} antes={calc.tC ? dinero(calc.tC.ventas, datos?.moneda) : null} />
                <Kpi etiqueta="Sesiones al día" valor={decimal(calc.tP.sesiones / calc.nP, 0)} antes={calc.tC ? decimal(calc.tC.sesiones / calc.nC, 0) : null} cambio={calc.tC ? veces(calc.tP.sesiones / calc.nP, calc.tC.sesiones / calc.nC) : null} malo={empiezaPorMenos(calc.tC ? veces(calc.tP.sesiones / calc.nP, calc.tC.sesiones / calc.nC) : null)} />
                <Kpi etiqueta="Unidades al día" valor={decimal(calc.tP.unidades / calc.nP, 1)} antes={calc.tC ? decimal(calc.tC.unidades / calc.nC, 1) : null} cambio={calc.tC ? variacion(calc.tP.unidades / calc.nP, calc.tC.unidades / calc.nC) : null} malo={empiezaPorMenos(calc.tC ? variacion(calc.tP.unidades / calc.nP, calc.tC.unidades / calc.nC) : null)} />
                <Kpi etiqueta="Precio medio por unidad" valor={dinero(precioMedio(calc.tP), datos?.moneda)} antes={calc.tC ? dinero(precioMedio(calc.tC), datos?.moneda) : null} />
                <Kpi etiqueta="Buy Box medio" valor={pct(buyBox(calc.tP), 1)} antes={calc.tC ? pct(buyBox(calc.tC), 1) : null} cambio={calc.tC ? puntos(buyBox(calc.tP), buyBox(calc.tC)) : null} malo={empiezaPorMenos(calc.tC ? puntos(buyBox(calc.tP), buyBox(calc.tC)) : null)} />
              </div>
            </Seccion>

            <Seccion n="02" kicker="Mes a mes" titulo="Los meses anteriores, la comparación y el periodo">
              <div className="overflow-x-auto rounded-2xl border border-[#E5E1DB] bg-white">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <Th izquierda>Métrica</Th>
                      {columnasMes.map((c) => <Th key={c.titulo}>{c.titulo}</Th>)}
                      {calc.tC && <Th>Periodo vs. comparación</Th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filasMes.map((f) => {
                      const actual = f.v(calc.tP, calc.nP)
                      const antes = calc.tC ? f.v(calc.tC, calc.nC) : null
                      const rel = !calc.tC || !f.relativo ? '—' : f.relativo === 'puntos' ? (puntos(actual, antes) ?? '—') : (variacion(actual, antes) ?? '—')
                      return (
                        <tr key={f.m}>
                          <td className={`${tdBase} text-left font-medium`}>{f.m}</td>
                          {columnasMes.map((c) => <td key={c.titulo} className={td}>{c.c ? f.f(f.v(c.c, c.dias)) : '—'}</td>)}
                          {calc.tC && <td className={`${td} font-semibold ${empiezaPorMenos(rel) ? 'text-[#C0432E]' : ''}`}>{rel}</td>}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Seccion>

            <Seccion n="03" kicker="Evolución" titulo="Sesiones al día y conversión, mes a mes" nota={`El mes en curso cuenta hasta el ${fechaCorta(ultimoDia)}.`}>
              <div className="h-[300px] rounded-2xl border border-[#E5E1DB] bg-white p-3">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={graficoMeses} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={C.linea} vertical={false} />
                    <XAxis dataKey="mes" tick={{ fontSize: 11, fill: C.gris }} />
                    <YAxis yAxisId="s" tick={{ fontSize: 11, fill: C.gris }} />
                    <YAxis yAxisId="c" orientation="right" tick={{ fontSize: 11, fill: C.gris }} unit=" %" />
                    <Tooltip formatter={(v: number, n: string) => (n === 'Conversión' ? `${decimal(v, 2)} %` : entero(v))} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar yAxisId="s" dataKey="Sesiones al día" fill={C.naranja} radius={[4, 4, 0, 0]} />
                    <Line yAxisId="c" dataKey="Conversión" stroke={C.negro} strokeWidth={2} dot={{ r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Seccion>

            <Seccion n="04" kicker="Conversión por juego" titulo={`Los ${Math.min(20, calc.juegos.length)} juegos con más sesiones, frente a la media de la tienda`} nota={`La línea es la conversión media de la tienda en el periodo (${pct(media)}). En naranja, los juegos por encima de la media.`}>
              <div className="rounded-2xl border border-[#E5E1DB] bg-white p-3" style={{ height: Math.max(220, graficoJuegos.length * 26 + 40) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={graficoJuegos} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
                    <CartesianGrid stroke={C.linea} horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: C.gris }} unit=" %" />
                    <YAxis type="category" dataKey="juego" width={210} tick={{ fontSize: 11.5, fill: C.negro }} />
                    <Tooltip formatter={(v: number) => `${decimal(v, 2)} %`} />
                    {media != null && <ReferenceLine x={Number((media * 100).toFixed(2))} stroke={C.negro} strokeDasharray="4 3" />}
                    <Bar dataKey="Conversión" radius={[0, 4, 4, 0]}>
                      {graficoJuegos.map((g) => <Cell key={g.juego} fill={g.arriba ? C.naranja : C.anterior} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Seccion>

            <Seccion n="05" kicker="Día a día" titulo={`Sesiones y unidades, ${textoP}`} nota="Sesiones de navegador y de la app móvil apiladas; la línea son las unidades encargadas cada día.">
              <div className="h-[300px] rounded-2xl border border-[#E5E1DB] bg-white p-3">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={graficoDias} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={C.linea} vertical={false} />
                    <XAxis dataKey="dia" tick={{ fontSize: 11, fill: C.gris }} />
                    <YAxis yAxisId="s" tick={{ fontSize: 11, fill: C.gris }} />
                    <YAxis yAxisId="u" orientation="right" tick={{ fontSize: 11, fill: C.gris }} />
                    <Tooltip formatter={(v: number) => entero(v)} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar yAxisId="s" dataKey="Navegador" stackId="s" fill={C.naranja} />
                    <Bar yAxisId="s" dataKey="App móvil" stackId="s" fill={C.gris2} radius={[4, 4, 0, 0]} />
                    <Line yAxisId="u" dataKey="Unidades" stroke={C.negro} strokeWidth={2} dot={{ r: 2.5 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Seccion>

            <Seccion
              n="06"
              kicker="Por juego"
              titulo="Tráfico y conversión por juego"
              nota={`* Suma las ediciones en otros idiomas y las variantes de color del juego (pulsa la fila para ver cada ASIN). En negrita, la conversión superior a la media de la tienda; en naranja, la Buy Box por debajo del 90 %. «×» indica cuántas veces se multiplican las sesiones al día frente a ${TEXTO_COMPARACION[comparacion]}.`}
            >
              <label className="relative mb-3 block w-full max-w-[320px]">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#8C857C]" />
                <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar un juego o un ASIN" aria-label="Buscar un juego o un ASIN" className="h-9 w-full rounded-xl border border-[#E5E1DB] bg-white pl-9 pr-3 text-[13px] outline-none focus:border-[#F26212]" />
              </label>
              <div className="overflow-x-auto rounded-2xl border border-[#E5E1DB] bg-white">
                <table className="w-full min-w-[900px] border-collapse">
                  <thead>
                    <tr>
                      <Th por="juego" izquierda>Juego</Th>
                      <Th por="sesiones">Sesiones</Th>
                      <Th>Sesiones al día</Th>
                      <Th>Vs. comparación (al día)</Th>
                      <Th por="unidades">Unidades</Th>
                      <Th por="ventas">Ventas</Th>
                      <Th por="conversion">Conversión</Th>
                      <Th>Conv. comparación</Th>
                      <Th por="buybox">Buy Box</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {juegosVisibles.map((j) => {
                      const c = calc.compJuego.get(j.juego)
                      const abierto = abiertos.has(j.juego)
                      const conv = conversion(j.cifras)
                      const bb = buyBox(j.cifras)
                      return (
                        <Fragment key={j.juego}>
                          <tr className="cursor-pointer hover:bg-[#FEF3EC]" onClick={() => setAbiertos((s) => { const n = new Set(s); if (n.has(j.juego)) n.delete(j.juego); else n.add(j.juego); return n })}>
                            <td className={`${tdBase} text-left font-medium`}>
                              <span className="inline-flex items-center gap-1.5">{abierto ? <ChevronDown className="h-3.5 w-3.5 text-[#8C857C]" /> : <ChevronRight className="h-3.5 w-3.5 text-[#8C857C]" />}{j.juego}{j.varios ? ' *' : ''}</span>
                            </td>
                            <td className={td}>{entero(j.cifras.sesiones)}</td>
                            <td className={td}>{decimal(j.cifras.sesiones / calc.nP, 1)}</td>
                            <td className={td}>{c ? (veces(j.cifras.sesiones / calc.nP, c.sesiones / calc.nC) ?? '—') : '—'}</td>
                            <td className={td}>{entero(j.cifras.unidades)}</td>
                            <td className={td}>{dinero(j.cifras.ventas, datos?.moneda)}</td>
                            <td className={`${td} ${conv != null && media != null && conv > media ? 'font-bold' : ''}`}>{pct(conv)}</td>
                            <td className={`${td} text-[#5E5852]`}>{c ? pct(conversion(c)) : '—'}</td>
                            <td className={`${td} ${bb != null && bb < 0.9 ? 'font-semibold text-[#F26212]' : ''}`}>{pct(bb, 1)}</td>
                          </tr>
                          {abierto &&
                            j.asins.map((a) => (
                              <tr key={a.asin} className="bg-[#F7F5F2]">
                                <td className={`${tdBase} pl-9 text-left text-[12.5px]`}>
                                  <span className="font-mono text-[12px] text-[#5E5852]">{a.asin}</span>
                                  {a.producto && <span className="ml-2 text-[#5E5852]">{a.producto.length > 80 ? `${a.producto.slice(0, 79)}…` : a.producto}</span>}
                                </td>
                                <td className={td}>{entero(a.cifras.sesiones)}</td>
                                <td className={td}>{decimal(a.cifras.sesiones / calc.nP, 1)}</td>
                                <td className={td} />
                                <td className={td}>{entero(a.cifras.unidades)}</td>
                                <td className={td}>{dinero(a.cifras.ventas, datos?.moneda)}</td>
                                <td className={td}>{pct(conversion(a.cifras))}</td>
                                <td className={td} />
                                <td className={`${td} ${(buyBox(a.cifras) ?? 1) < 0.9 ? 'text-[#F26212]' : ''}`}>{pct(buyBox(a.cifras), 1)}</td>
                              </tr>
                            ))}
                        </Fragment>
                      )
                    })}
                    <tr className="bg-[#0E0E0E]">
                      <td className={`${tdBase} border-0 text-left font-semibold text-white`}>Total tienda</td>
                      <td className={`${td} border-0 font-semibold text-white`}>{entero(calc.tP.sesiones)}</td>
                      <td className={`${td} border-0 text-white`}>{decimal(calc.tP.sesiones / calc.nP, 1)}</td>
                      <td className={`${td} border-0 font-semibold text-[#FF8A3D]`}>{calc.tC ? (veces(calc.tP.sesiones / calc.nP, calc.tC.sesiones / calc.nC) ?? '—') : '—'}</td>
                      <td className={`${td} border-0 font-semibold text-white`}>{entero(calc.tP.unidades)}</td>
                      <td className={`${td} border-0 font-semibold text-white`}>{dinero(calc.tP.ventas, datos?.moneda)}</td>
                      <td className={`${td} border-0 font-semibold text-[#FF8A3D]`}>{pct(media)}</td>
                      <td className={`${td} border-0 text-[#B8AE9F]`}>{calc.tC ? pct(conversion(calc.tC)) : '—'}</td>
                      <td className={`${td} border-0 text-white`}>{pct(buyBox(calc.tP), 1)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Seccion>

            <Seccion n="07" kicker="Por día" titulo="Unidades por día y juego" nota="Celda vacía = sin unidades ese día. Cuanto más intenso el color, más unidades.">
              <MatrizDeDias calc={calc} />
            </Seccion>

            <Seccion n="08" kicker="Por mes" titulo="Unidades, sesiones al día y conversión por juego y mes" nota={`Sesiones al día = sesiones del mes ÷ días del mes. Conversión = unidades ÷ sesiones. El mes en curso cuenta hasta el ${fechaCorta(ultimoDia)}.`}>
              <div className="mb-3 inline-flex rounded-xl border border-[#E5E1DB] bg-white p-0.5" role="radiogroup" aria-label="Qué cifra por mes">
                {(['unidades', 'sesiones', 'conversion'] as const).map((v) => (
                  <button key={v} type="button" role="radio" aria-checked={vistaMes === v} onClick={() => setVistaMes(v)} className={`h-8 rounded-[10px] px-3 text-[13px] font-medium ${vistaMes === v ? 'bg-[#141414] text-white' : 'text-[#5E5852] hover:text-[#141414]'}`}>
                    {v === 'unidades' ? 'Unidades' : v === 'sesiones' ? 'Sesiones al día' : 'Conversión'}
                  </button>
                ))}
              </div>
              <MatrizDeMeses calc={calc} meses={mesesHist} diasDelMes={diasDelMes} vista={vistaMes} />
            </Seccion>

            <p className="mt-12 border-t border-[#E5E1DB] pt-4 text-[12px] leading-relaxed text-[#8C857C]">
              Datos del informe de Ventas y tráfico de Seller Central, por ASIN y día. Conversión = unidades encargadas ÷ sesiones. Buy Box medio ponderado por visitas. Los juegos agrupan las ediciones
              en otros idiomas y las variantes de color. Los tres últimos días son provisionales. Preparado por Liberty Seller.
            </p>
          </>
        )}
      </main>
    </div>
  )
}

type Calc = NonNullable<ReturnType<typeof calcularParaTipos>>
// Solo para sacar el tipo de lo que calcula el panel
function calcularParaTipos(d: DatosDelPanel) {
  const p = d.periodo
  return { p, nP: 1, tP: sumarTodas(p.total), tC: null as Cifras | null, nC: 1, juegos: porJuego(p.total, d.juegos), compJuego: new Map<string, Cifras>(), diario: matriz(p.dias, d.juegos), mensual: matriz(d.meses, d.juegos) }
}

function MatrizDeDias({ calc }: { calc: Calc }) {
  const dias = diasDe(calc.p.desde, calc.p.hasta).slice(-62)
  const max = Math.max(1, ...calc.juegos.flatMap((j) => dias.map((d) => calc.diario.porJuego.get(j.juego)?.get(d)?.unidades ?? 0)))
  const celda = 'border-b border-r border-[#EFEBE5] px-1.5 py-1 text-center tabular-nums text-[12px]'
  return (
    <div className="overflow-x-auto rounded-2xl border border-[#E5E1DB] bg-white">
      <table className="border-collapse">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 min-w-[220px] border-b border-[#E5E1DB] bg-[#F7F5F2] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-[#5E5852]">Juego</th>
            {dias.map((d) => <th key={d} className="min-w-[44px] border-b border-[#E5E1DB] bg-[#F7F5F2] px-1 py-2 text-center text-[10.5px] font-semibold text-[#5E5852]">{fechaCorta(d)}</th>)}
          </tr>
        </thead>
        <tbody>
          <tr className="bg-[#0E0E0E] text-white">
            <td className="sticky left-0 z-10 bg-[#0E0E0E] px-3 py-1.5 text-[13px] font-semibold">Total tienda</td>
            {dias.map((d) => <td key={d} className={`${celda} border-[#2A2A2A] font-semibold`}>{calc.diario.total.get(d)?.unidades || ''}</td>)}
          </tr>
          {calc.juegos.map((j) => (
            <tr key={j.juego}>
              <td className="sticky left-0 z-10 border-b border-[#EFEBE5] bg-white px-3 py-1.5 text-[12.5px]">{j.juego}{j.varios ? ' *' : ''}</td>
              {dias.map((d) => {
                const u = calc.diario.porJuego.get(j.juego)?.get(d)?.unidades ?? 0
                return <td key={d} className={celda} style={u ? { background: `rgba(242, 98, 18, ${0.1 + 0.6 * (u / max)})`, color: u / max > 0.6 ? '#fff' : '#141414' } : undefined}>{u || ''}</td>
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function MatrizDeMeses({ calc, meses, diasDelMes, vista }: { calc: Calc; meses: string[]; diasDelMes: (m: string) => number; vista: 'unidades' | 'sesiones' | 'conversion' }) {
  const valor = (c: Cifras | undefined, m: string): string => {
    if (!c) return ''
    if (vista === 'unidades') return c.unidades ? entero(c.unidades) : ''
    if (vista === 'sesiones') return c.sesiones ? decimal(c.sesiones / diasDelMes(m), 1) : ''
    return c.sesiones ? pct(conversion(c)) : ''
  }
  const juegos = [...calc.mensual.porJuego.entries()]
    .map(([juego, m]) => ({ juego, total: sumarTodas([...m.values()]) }))
    .sort((a, b) => b.total.unidades - a.total.unidades || b.total.sesiones - a.total.sesiones)
  const celda = 'border-b border-[#EFEBE5] px-2.5 py-1.5 text-right tabular-nums text-[12.5px]'
  return (
    <div className="overflow-x-auto rounded-2xl border border-[#E5E1DB] bg-white">
      <table className="border-collapse">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 min-w-[240px] border-b border-[#E5E1DB] bg-[#F7F5F2] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-[#5E5852]">Juego</th>
            {meses.map((m) => <th key={m} className="min-w-[78px] border-b border-[#E5E1DB] bg-[#F7F5F2] px-2 py-2 text-right text-[11px] font-semibold text-[#5E5852]">{nombreDeMes(m)}</th>)}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="sticky left-0 z-10 border-b border-[#EFEBE5] bg-white px-3 py-1.5 text-[12px] text-[#8C857C]">Días del periodo</td>
            {meses.map((m) => <td key={m} className={`${celda} text-[#8C857C]`}>{diasDelMes(m)}</td>)}
          </tr>
          <tr className="bg-[#0E0E0E] text-white">
            <td className="sticky left-0 z-10 bg-[#0E0E0E] px-3 py-1.5 text-[13px] font-semibold">Total tienda</td>
            {meses.map((m) => <td key={m} className={`${celda} border-[#2A2A2A] font-semibold`}>{valor(calc.mensual.total.get(m), m)}</td>)}
          </tr>
          {juegos.map((j) => (
            <tr key={j.juego}>
              <td className="sticky left-0 z-10 border-b border-[#EFEBE5] bg-white px-3 py-1.5 text-[12.5px]">{j.juego}</td>
              {meses.map((m) => <td key={m} className={celda}>{valor(calc.mensual.porJuego.get(j.juego)?.get(m), m)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
