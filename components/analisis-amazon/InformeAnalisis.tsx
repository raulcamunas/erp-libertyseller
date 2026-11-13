'use client'

/**
 * La página pública del análisis de una cuenta de Amazon.
 *
 * Solo pinta: los datos llegan ya calculados por `construirAnalisis`
 * (lib/analisis-amazon/construir.ts). Estilo de libertyseller.com (fondo casi
 * negro, naranja #FF6600, Inter muy gruesa y apretada, paneles con forma de
 * ventana de aplicación) con movimiento: retícula y halos que flotan, foco que
 * sigue al ratón en la portada, apariciones al hacer scroll, cifras que cuentan
 * y barras que se rellenan. Con «reducir movimiento» activado se ve todo quieto.
 *
 * El orden es el de una conversación de venta: lo que ya hace bien, dónde se
 * escapa la venta y cuánto, el detalle, por dónde empezaríamos y la llamada.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  ArrowDown,
  ArrowRight,
  BadgeCheck,
  Boxes,
  CalendarDays,
  ChartLine,
  ChevronDown,
  Check,
  Eye,
  Globe2,
  LineChart,
  Lock,
  PackageCheck,
  Phone,
  Search,
  ShieldCheck,
  Sparkles,
  Store,
  Users,
} from 'lucide-react'
import type {
  Area,
  InformeAnalisis as Informe,
  Oportunidad,
  PaisAnalisis,
  ProductoAnalisis,
} from '@/lib/analisis-amazon/construir'
import { UMBRALES } from '@/lib/analisis-amazon/construir'

/* ------------------------------------------------------------------ */
/* Paleta de libertyseller.com                                          */
/* ------------------------------------------------------------------ */

const N = '#FF6600'
const N2 = '#FF8A3D'
const FONDO = '#080808'
const FONDO2 = '#0B0B0C'
const VENTANA = '#0E1013'
const TEXTO2 = '#A0A0B0'
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'

const PASTILLA = {
  bien: { color: '#4ADE80', bg: 'rgba(74,222,128,0.10)', borde: 'rgba(74,222,128,0.25)' },
  aviso: { color: '#FBBF24', bg: 'rgba(251,191,36,0.10)', borde: 'rgba(251,191,36,0.25)' },
  mal: { color: '#F87171', bg: 'rgba(248,113,113,0.10)', borde: 'rgba(248,113,113,0.25)' },
  naranja: { color: N, bg: 'rgba(255,102,0,0.10)', borde: 'rgba(255,102,0,0.35)' },
  gris: { color: 'rgba(255,255,255,0.55)', bg: 'rgba(255,255,255,0.04)', borde: 'rgba(255,255,255,0.10)' },
} as const
type Tono = keyof typeof PASTILLA

const AREA: Record<Area, string> = {
  stock: 'Stock',
  buybox: 'Buy Box',
  competencia: 'Competencia',
  reputacion: 'Reputación',
  resenas: 'Reseñas',
  fichas: 'Fichas',
  logistica: 'Logística',
  expansion: 'Expansión',
}

const BANDERA: Record<PaisAnalisis['codigo'], string> = { es: '🇪🇸', fr: '🇫🇷', it: '🇮🇹', de: '🇩🇪', uk: '🇬🇧' }

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

function fechaLarga(iso: string | null): string {
  if (!iso) return '—'
  const [a, m, d] = iso.split('-').map(Number)
  return `${d} de ${MESES[m - 1]} de ${a}`
}
function fechaCorta(iso: string | null): string {
  if (!iso) return '—'
  const [a, m, d] = iso.split('-').map(Number)
  return `${d} ${MES_CORTO[m - 1]} ${a}`
}
function mesAnio(iso: string | null): string {
  if (!iso) return '—'
  const [a, m] = iso.split('-').map(Number)
  return `${MESES[m - 1]} de ${a}`
}

const eur = (n: number | null) =>
  n === null ? '—' : n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: n >= 100 ? 0 : 2 })
/** Miles con punto también en números de 4 cifras («1.583»), que es-ES deja sin separar. */
const miles = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
const entero = (n: number | null) => (n === null ? '—' : miles(n))
/** «+300/mes» con el dato de Amazon «comprados el mes pasado»; «—» si Amazon no lo enseña. */
const comprasMes = (n: number | null) => (n ? `+${miles(n)}/mes` : '—')
const decimal = (n: number | null) => (n === null ? '—' : n.toFixed(1).replace('.', ','))

/* ------------------------------------------------------------------ */
/* Movimiento                                                           */
/* ------------------------------------------------------------------ */

const CSS = `
@keyframes ls-flotar { 0%,100% { transform: translate3d(0,0,0) scale(1) } 50% { transform: translate3d(40px,-30px,0) scale(1.12) } }
@keyframes ls-flotar2 { 0%,100% { transform: translate3d(0,0,0) scale(1) } 50% { transform: translate3d(-50px,30px,0) scale(0.92) } }
@keyframes ls-girar { to { transform: rotate(360deg) } }
@keyframes ls-cinta { to { transform: translateX(-50%) } }
@keyframes ls-latido { 0%,100% { opacity: .45; transform: scale(1) } 50% { opacity: 1; transform: scale(1.35) } }
@keyframes ls-brillo { 0% { transform: translateX(-120%) skewX(-20deg) } 60%,100% { transform: translateX(260%) skewX(-20deg) } }
@keyframes ls-bajar { 0%,100% { transform: translateY(0) } 50% { transform: translateY(5px) } }
.ls-reticula {
  background-image: linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px);
  background-size: 56px 56px;
  -webkit-mask-image: radial-gradient(ellipse 70% 60% at 50% 0%, #000 25%, transparent 75%);
          mask-image: radial-gradient(ellipse 70% 60% at 50% 0%, #000 25%, transparent 75%);
}
.ls-grano {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.55'/%3E%3C/svg%3E");
  opacity: .05; mix-blend-mode: overlay;
}
.ls-tarjeta { transition: transform .35s cubic-bezier(.2,.7,.2,1), border-color .35s, background-color .35s; }
.ls-tarjeta:hover { transform: translateY(-4px); border-color: rgba(255,102,0,0.45) !important; background-color: rgba(255,255,255,0.035) !important; }
.ls-boton { position: relative; overflow: hidden; }
.ls-boton::after { content: ''; position: absolute; inset: 0; width: 40%; background: linear-gradient(90deg, transparent, rgba(255,255,255,.35), transparent); animation: ls-brillo 3.6s ease-in-out infinite; }
.ls-texto-degradado { background: linear-gradient(92deg, #fff 0%, #FFB27A 45%, ${N} 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
@media (prefers-reduced-motion: reduce) {
  .ls-anim, .ls-boton::after { animation: none !important; }
  .ls-tarjeta, .ls-tarjeta:hover { transition: none; transform: none; }
}
`

function useReducido(): boolean {
  const [r, setR] = useState(false)
  useEffect(() => {
    const m = window.matchMedia('(prefers-reduced-motion: reduce)')
    setR(m.matches)
    const f = () => setR(m.matches)
    m.addEventListener('change', f)
    return () => m.removeEventListener('change', f)
  }, [])
  return r
}

/** true la primera vez que el elemento entra en pantalla (y ya no vuelve a false). */
function useVisto<T extends Element>(margen = '0px 0px -12% 0px') {
  const ref = useRef<T | null>(null)
  const [visto, setVisto] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || visto) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisto(true)
      return
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setVisto(true)
          io.disconnect()
        }
      },
      { rootMargin: margen },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [margen, visto])
  return { ref, visto }
}

/** Aparece subiendo y enfocándose al entrar en pantalla. */
function Revelar({ children, retraso = 0, className = '', style }: { children: ReactNode; retraso?: number; className?: string; style?: CSSProperties }) {
  const { ref, visto } = useVisto<HTMLDivElement>()
  const reducido = useReducido()
  const ver = visto || reducido
  return (
    <div
      ref={ref}
      className={className}
      style={{
        ...style,
        opacity: ver ? 1 : 0,
        transform: ver ? 'none' : 'translate3d(0,28px,0)',
        filter: ver ? 'none' : 'blur(6px)',
        transition: reducido ? undefined : `opacity .9s cubic-bezier(.2,.7,.2,1) ${retraso}ms, transform .9s cubic-bezier(.2,.7,.2,1) ${retraso}ms, filter .9s ${retraso}ms`,
      }}
    >
      {children}
    </div>
  )
}

/** Cuenta desde 0 hasta la cifra del texto («79 %», «2 de 5», «#7.199») al verse. */
function Contador({ texto, className, style }: { texto: string; className?: string; style?: CSSProperties }) {
  const { ref, visto } = useVisto<HTMLSpanElement>()
  const reducido = useReducido()
  const m = /^(\D*?)(\d[\d.]*(?:,\d+)?)(.*)$/.exec(texto)
  const [valor, setValor] = useState<string>(m && !reducido ? `${m[1]}0${m[3]}` : texto)

  useEffect(() => {
    if (!m || reducido) {
      setValor(texto)
      return
    }
    if (!visto) return
    const decimales = m[2].includes(',') ? m[2].split(',')[1].length : 0
    const objetivo = Number.parseFloat(m[2].replace(/\./g, '').replace(',', '.'))
    const conMiles = m[2].includes('.')
    let raf = 0
    const t0 = performance.now()
    const paso = (t: number) => {
      const k = Math.min(1, (t - t0) / 1300)
      const v = objetivo * (1 - Math.pow(1 - k, 3))
      const s = decimales
        ? v.toFixed(decimales).replace('.', ',')
        : conMiles
          ? miles(v)
          : String(Math.round(v))
      setValor(`${m[1]}${s}${m[3]}`)
      if (k < 1) raf = requestAnimationFrame(paso)
    }
    raf = requestAnimationFrame(paso)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visto, reducido, texto])

  return (
    <span ref={ref} className={className} style={style}>
      {valor}
    </span>
  )
}

/** Barra que se rellena al verse. */
function Barra({ pct, alto = 7 }: { pct: number; alto?: number }) {
  const { ref, visto } = useVisto<HTMLDivElement>()
  return (
    <div ref={ref} className="overflow-hidden rounded-full" style={{ height: alto, background: 'rgba(255,255,255,0.06)' }}>
      <div
        className="h-full rounded-full"
        style={{
          width: visto ? `${Math.max(pct, 2)}%` : '0%',
          background: `linear-gradient(90deg, ${N}, ${N2})`,
          boxShadow: `0 0 18px rgba(255,102,0,0.45)`,
          transition: 'width 1.4s cubic-bezier(.2,.7,.2,1) .15s',
        }}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Piezas                                                               */
/* ------------------------------------------------------------------ */

function Etiqueta({ children, centro }: { children: ReactNode; centro?: boolean }) {
  return (
    <div className={`flex items-center gap-2 text-[11.5px] font-bold uppercase tracking-[0.14em] ${centro ? 'justify-center' : ''}`} style={{ color: N }}>
      <span className="ls-anim h-1.5 w-1.5 rounded-full" style={{ background: N, animation: 'ls-latido 2.4s ease-in-out infinite' }} />
      {children}
    </div>
  )
}

function H2({ children, centro }: { children: ReactNode; centro?: boolean }) {
  return (
    <h2 className={`mt-3 text-[32px] font-extrabold leading-[1.06] tracking-[-0.035em] text-white sm:text-[46px] ${centro ? 'text-center' : ''}`}>{children}</h2>
  )
}

function Parrafo({ children, centro }: { children: ReactNode; centro?: boolean }) {
  return (
    <p className={`mt-4 text-[16px] leading-[1.65] ${centro ? 'mx-auto max-w-[660px] text-center' : 'max-w-[560px]'}`} style={{ color: TEXTO2 }}>
      {children}
    </p>
  )
}

function Vineta({ fuerte, children }: { fuerte: string; children?: ReactNode }) {
  return (
    <li className="flex gap-3 text-[14.5px] leading-relaxed" style={{ color: TEXTO2 }}>
      <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: N, boxShadow: `0 0 10px ${N}` }} />
      <span>
        <b className="font-semibold text-white">{fuerte}</b> {children}
      </span>
    </li>
  )
}

function Chip({ icono, children }: { icono?: ReactNode; children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-semibold text-white backdrop-blur-md"
      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)' }}
    >
      {icono && <span style={{ color: N }}>{icono}</span>}
      {children}
    </span>
  )
}

function Pastilla({ tono, children }: { tono: Tono; children: ReactNode }) {
  const t = PASTILLA[tono]
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-md px-2 py-[3px] text-[10.5px] font-bold uppercase tracking-[0.06em]"
      style={{ color: t.color, background: t.bg, border: `1px solid ${t.borde}` }}
    >
      {children}
    </span>
  )
}

/** Panel con forma de ventana de aplicación; con `brillo`, un borde de luz que gira. */
function Ventana({ titulo, children, className = '', brillo }: { titulo: string; children: ReactNode; className?: string; brillo?: boolean }) {
  const cuerpo = (
    <div className="relative overflow-hidden rounded-2xl" style={{ background: VENTANA, border: brillo ? 'none' : '1px solid rgba(255,255,255,0.08)' }}>
      <div className="flex items-center gap-3 px-3.5 py-[11px]" style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <span className="flex gap-1.5">
          {['#FF5F57', '#FEBC2E', '#28C840'].map((c) => (
            <span key={c} className="h-2.5 w-2.5 rounded-full" style={{ background: c, opacity: 0.55 }} />
          ))}
        </span>
        <span className="truncate text-[11.5px] font-bold uppercase tracking-[0.04em]" style={{ color: 'rgba(255,255,255,0.55)' }}>
          {titulo}
        </span>
      </div>
      <div className="p-3.5">{children}</div>
    </div>
  )
  if (!brillo)
    return (
      <div className={`rounded-2xl ${className}`} style={{ boxShadow: '0 30px 70px rgba(0,0,0,0.55)' }}>
        {cuerpo}
      </div>
    )
  return (
    <div className={`relative overflow-hidden rounded-2xl p-px ${className}`} style={{ background: 'rgba(255,255,255,0.08)', boxShadow: '0 30px 90px rgba(0,0,0,0.6), 0 0 60px rgba(255,102,0,0.12)' }}>
      <div
        aria-hidden
        className="ls-anim absolute left-1/2 top-1/2 aspect-square w-[160%] -translate-x-1/2 -translate-y-1/2"
        style={{ background: `conic-gradient(from 0deg, transparent 0deg, ${N} 40deg, transparent 90deg, transparent 360deg)`, animation: 'ls-girar 6s linear infinite' }}
      />
      <div className="relative">{cuerpo}</div>
    </div>
  )
}

function Dato({ valor, rotulo, tono }: { valor: string; rotulo: string; tono?: Tono }) {
  return (
    <div className="rounded-[10px] px-3 py-[11px]" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <Contador texto={valor} className="block text-[21px] font-extrabold tracking-[-0.02em] tabular-nums" style={{ color: tono ? PASTILLA[tono].color : '#fff' }} />
      <div className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.06em]" style={{ color: 'rgba(255,255,255,0.45)' }}>
        {rotulo}
      </div>
    </div>
  )
}

function Fila({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-[10px] px-3 py-[11px] text-[12.5px] transition-colors hover:bg-white/[0.045] ${className}`}
      style={{ background: 'rgba(255,255,255,0.024)', border: '1px solid rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.85)' }}
    >
      {children}
    </div>
  )
}

function Halo({ className, fuerza = 0.16, lento }: { className: string; fuerza?: number; lento?: boolean }) {
  return (
    <div
      aria-hidden
      className={`ls-anim pointer-events-none absolute rounded-full blur-[110px] ${className}`}
      style={{ background: `rgba(255,102,0,${fuerza})`, animation: `${lento ? 'ls-flotar2 22s' : 'ls-flotar 16s'} ease-in-out infinite` }}
    />
  )
}

function Seccion({ id, children, alterna, reticula, className = '' }: { id?: string; children: ReactNode; alterna?: boolean; reticula?: boolean; className?: string }) {
  return (
    <section
      id={id}
      className={`relative scroll-mt-16 overflow-hidden px-4 py-20 sm:px-8 sm:py-28 ${className}`}
      style={{ background: alterna ? FONDO2 : FONDO, borderTop: '1px solid rgba(255,255,255,0.05)' }}
    >
      {reticula && <div aria-hidden className="ls-reticula pointer-events-none absolute inset-0" />}
      <div className="relative mx-auto max-w-[1130px]">{children}</div>
    </section>
  )
}

const tonoPrioridad = (p: Oportunidad['prioridad']): Tono => (p === 'alta' ? 'naranja' : 'gris')

/* ------------------------------------------------------------------ */
/* Producto                                                             */
/* ------------------------------------------------------------------ */

/** Abre y cierra su contenido con la altura animada. */
function Desplegable({ abierto, children }: { abierto: boolean; children: ReactNode }) {
  return (
    <div
      className="grid"
      style={{ gridTemplateRows: abierto ? '1fr' : '0fr', opacity: abierto ? 1 : 0, transition: 'grid-template-rows .7s cubic-bezier(.2,.7,.2,1), opacity .5s' }}
      aria-hidden={!abierto}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}

function avisosDe(p: ProductoAnalisis): { t: string; tono: Tono }[] {
  const a: { t: string; tono: Tono }[] = []
  if (p.alertas.stock) a.push({ t: `${p.sinStock90} % agotado`, tono: 'mal' })
  if (p.alertas.buybox) a.push({ t: `Buy Box ${p.buyBoxPropia} %`, tono: 'mal' })
  if (p.alertas.estrellas) a.push({ t: `${decimal(p.estrellas)} ★`, tono: 'mal' })
  if (p.alertas.fotos) a.push({ t: `${p.fotos} fotos`, tono: 'aviso' })
  if (p.alertas.titulo) a.push({ t: `título ${p.largoTitulo}/${UMBRALES.titulo}`, tono: 'aviso' })
  return a
}

/** Lo que ve el comprador ahora mismo: quién tiene la Buy Box y si hay stock. */
function EstadoAhora({ p }: { p: ProductoAnalisis }) {
  const bb: Record<NonNullable<ProductoAnalisis['buyBoxAhora']>, { t: string; tono: Tono }> = {
    suya: { t: 'Buy Box: tuya', tono: 'bien' },
    otro: { t: 'Buy Box: otro vendedor', tono: 'mal' },
    amazon: { t: 'Buy Box: Amazon', tono: 'mal' },
    nadie: { t: 'Sin Buy Box', tono: 'aviso' },
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {p.buyBoxAhora && <Pastilla tono={bb[p.buyBoxAhora].tono}>{bb[p.buyBoxAhora].t}</Pastilla>}
      {p.enStock !== null && <Pastilla tono={p.enStock ? 'bien' : 'mal'}>{p.enStock ? 'En stock' : 'Agotado ahora'}</Pastilla>}
    </div>
  )
}

/** El producto en vertical, para la rejilla de cinco por fila del ordenador. */
function TarjetaProducto({ p, i }: { p: ProductoAnalisis; i: number }) {
  const avisos = avisosDe(p)
  const dato = (valor: string, rotulo: string, mal?: boolean) => (
    <div className="min-w-0">
      <div className="truncate text-[13px] font-semibold tabular-nums" style={{ color: mal ? PASTILLA.mal.color : '#fff' }}>
        {valor}
      </div>
      <div className="truncate text-[9.5px] font-bold uppercase tracking-[0.06em]" style={{ color: 'rgba(255,255,255,0.40)' }}>
        {rotulo}
      </div>
    </div>
  )
  return (
    <div
      className="ls-tarjeta flex h-full flex-col overflow-hidden rounded-2xl"
      style={{ background: VENTANA, border: `1px solid ${avisos.some((a) => a.tono === 'mal') ? 'rgba(248,113,113,0.22)' : 'rgba(255,255,255,0.08)'}` }}
    >
      <div className="relative flex h-[132px] items-center justify-center bg-white p-3">
        {p.imagen && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.imagen} alt="" className="h-full w-full object-contain" loading="lazy" />
        )}
        <span className="absolute left-0 top-0 rounded-br-lg px-2 py-0.5 text-[11px] font-extrabold text-white" style={{ background: N }}>
          {i + 1}
        </span>
      </div>
      <div className="flex flex-1 flex-col p-3.5">
        <a href={p.url} target="_blank" rel="noopener noreferrer" className="line-clamp-2 min-h-[2.6em] text-[13px] font-semibold leading-[1.3] text-white hover:underline">
          {p.titulo}
        </a>
        <div className="mt-1 truncate text-[11px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
          {p.ranking !== null ? `#${entero(p.ranking)} en ${p.categoria ?? 'tu categoría'}` : <span style={{ fontFamily: MONO }}>{p.asin}</span>}
        </div>
        <div className="mt-3">
          <EstadoAhora p={p} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5">
          {dato(eur(p.precio), 'precio')}
          {dato(p.estrellas === null ? '—' : `${decimal(p.estrellas)} ★`, `${entero(p.resenas)} reseñas`, p.alertas.estrellas)}
          {dato(p.sinStock90 === null ? '—' : `${p.sinStock90} %`, 'agotado 90 d', p.alertas.stock)}
          {dato(p.buyBoxPropia === null ? '—' : `${p.buyBoxPropia} %`, 'tu Buy Box', p.alertas.buybox)}
          {dato(comprasMes(p.ventasMes), 'compras')}
          {dato(p.fba === null ? '—' : p.fba ? 'FBA' : 'Envío propio', 'logística')}
        </div>
        <div className="mt-auto flex flex-wrap gap-1.5 pt-3.5">
          {avisos.length ? avisos.map((a) => <Pastilla key={a.t} tono={a.tono}>{a.t}</Pastilla>) : <Pastilla tono="bien">Correcto</Pastilla>}
        </div>
      </div>
    </div>
  )
}

function BotonDesplegar({ abierto, onClick, children }: { abierto: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={abierto}
      className="mx-auto mt-6 flex items-center gap-2 rounded-full px-6 py-3 text-[13px] font-bold uppercase tracking-[0.06em] text-white transition-colors hover:bg-white/10"
      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.14)' }}
    >
      {children}
      <ChevronDown className="h-4 w-4 transition-transform duration-500" style={{ transform: abierto ? 'rotate(180deg)' : 'none', color: N }} />
    </button>
  )
}

/** Los productos: cinco a la vista y el resto en un desplegable (en móvil, todos dentro). */
function Catalogo({ productos }: { productos: ProductoAnalisis[] }) {
  const [abiertoPc, setAbiertoPc] = useState(false)
  const [abiertoMovil, setAbiertoMovil] = useState(false)
  const primeros = productos.slice(0, 5)
  const resto = productos.slice(5)
  const conAviso = productos.filter((p) => avisosDe(p).length).length
  return (
    <>
      {/* ordenador: cinco por fila */}
      <div className="hidden lg:block">
        <div className="grid grid-cols-5 gap-3">
          {primeros.map((p, i) => (
            <Revelar key={p.asin} retraso={i * 80} className="h-full">
              <TarjetaProducto p={p} i={i} />
            </Revelar>
          ))}
        </div>
        {resto.length > 0 && (
          <>
            <Desplegable abierto={abiertoPc}>
              <div className="grid grid-cols-5 gap-3 pt-3">
                {resto.map((p, i) => (
                  <TarjetaProducto key={p.asin} p={p} i={i + 5} />
                ))}
              </div>
            </Desplegable>
            <BotonDesplegar abierto={abiertoPc} onClick={() => setAbiertoPc((v) => !v)}>
              {abiertoPc ? 'Ver menos' : `Ver los ${resto.length} productos restantes`}
            </BotonDesplegar>
          </>
        )}
      </div>

      {/* móvil y tableta: cinco a la vista y el resto en un desplegable */}
      <div className="lg:hidden">
        <div className="space-y-2">
          {primeros.map((p, i) => (
            <FilaProducto key={p.asin} p={p} i={i} />
          ))}
        </div>
        {resto.length > 0 && (
          <>
            <Desplegable abierto={abiertoMovil}>
              <div className="space-y-2 pt-2">
                {resto.map((p, i) => (
                  <FilaProducto key={p.asin} p={p} i={i + 5} />
                ))}
              </div>
            </Desplegable>
            <BotonDesplegar abierto={abiertoMovil} onClick={() => setAbiertoMovil((v) => !v)}>
              {abiertoMovil ? 'Ver menos' : `Ver los ${resto.length} restantes`}
            </BotonDesplegar>
          </>
        )}
        {conAviso > 0 && (
          <p className="mt-3 text-center text-[12px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
            {conAviso} de {productos.length} con algún punto a revisar
          </p>
        )}
      </div>
    </>
  )
}

function FilaProducto({ p, i }: { p: ProductoAnalisis; i: number }) {
  const avisos = avisosDe(p)

  const celda = (valor: string, rotulo: string, mal?: boolean) => (
    <div>
      <div className="font-semibold tabular-nums" style={{ color: mal ? PASTILLA.mal.color : '#fff' }}>
        {valor}
      </div>
      <div className="text-[10px] font-bold uppercase tracking-[0.06em]" style={{ color: 'rgba(255,255,255,0.40)' }}>
        {rotulo}
      </div>
    </div>
  )

  return (
    <Revelar retraso={Math.min(i, 8) * 60}>
      <Fila className="grid grid-cols-[52px_1fr] items-center gap-x-4 gap-y-3 lg:grid-cols-[52px_minmax(0,2.4fr)_repeat(6,minmax(0,0.8fr))_minmax(0,1.3fr)]">
        <div className="relative h-[52px] w-[52px] overflow-hidden rounded-lg bg-white">
          {p.imagen && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.imagen} alt="" className="h-full w-full object-contain p-1" loading="lazy" />
          )}
          <span className="absolute left-0 top-0 rounded-br-md px-1.5 text-[10px] font-bold text-white" style={{ background: N }}>
            {i + 1}
          </span>
        </div>
        <div className="min-w-0">
          <a href={p.url} target="_blank" rel="noopener noreferrer" className="line-clamp-2 text-[13.5px] font-semibold leading-snug text-white hover:underline">
            {p.titulo}
          </a>
          <div className="mt-1 truncate text-[11.5px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
            <span style={{ fontFamily: MONO }}>{p.asin}</span>
            {p.ranking !== null && <> · #{entero(p.ranking)} en {p.categoria ?? 'tu categoría'}</>}
          </div>
          <div className="mt-2">
            <EstadoAhora p={p} />
          </div>
        </div>
        <div className="col-span-2 grid grid-cols-3 gap-3 sm:grid-cols-6 lg:col-span-6 lg:contents">
          {celda(eur(p.precio), 'precio')}
          {celda(comprasMes(p.ventasMes), 'compras')}
          {celda(p.estrellas === null ? '—' : `${decimal(p.estrellas)} ★`, `${entero(p.resenas)} reseñas`, p.alertas.estrellas)}
          {celda(p.sinStock90 === null ? '—' : `${p.sinStock90} %`, 'agotado 90 d', p.alertas.stock)}
          {celda(p.buyBoxPropia === null ? '—' : `${p.buyBoxPropia} %`, p.otrosEnBuyBox ? `Buy Box · +${p.otrosEnBuyBox}` : 'Buy Box', p.alertas.buybox)}
          {celda(p.fba === null ? '—' : p.fba ? 'FBA' : 'Propia', 'envío')}
        </div>
        <div className="col-span-2 flex flex-wrap gap-1.5 lg:col-span-1 lg:justify-end">
          {avisos.length ? avisos.map((a) => <Pastilla key={a.t} tono={a.tono}>{a.t}</Pastilla>) : <Pastilla tono="bien">Correcto</Pastilla>}
        </div>
      </Fila>
    </Revelar>
  )
}

/* ------------------------------------------------------------------ */
/* Píldora SEO: la norma de julio de 2026                               */
/* ------------------------------------------------------------------ */

const LIMITES_SEO = [
  { cifra: '75', unidad: 'caracteres', campo: 'Título', nota: 'En todas las categorías salvo libros, música y películas.' },
  { cifra: '125', unidad: 'caracteres', campo: 'Item Highlights', nota: 'El campo nuevo. Amazon lo indexa igual que el título.' },
  { cifra: '1.000', unidad: 'bytes', campo: 'Viñetas', nota: 'Sumando las cinco. Un beneficio concreto delante en cada una.' },
  { cifra: '249', unidad: 'bytes', campo: 'Backend', nota: 'Un byte de más y Amazon ignora el campo entero.' },
]

function SeccionSeo({ seo }: { seo: Informe['seo'] }) {
  const ej = seo.ejemplo
  const dentro = ej ? ej.titulo.slice(0, UMBRALES.titulo) : ''
  const fuera = ej ? ej.titulo.slice(UMBRALES.titulo) : ''
  return (
    <Seccion id="seo" reticula>
      <Halo className="-right-40 top-20 h-[420px] w-[420px]" fuerza={0.11} lento />
      <Revelar>
        <Etiqueta centro>Un regalo de nuestra parte</Etiqueta>
        <H2 centro>Amazon cambió las reglas del SEO en julio de 2026</H2>
        <Parrafo centro>
          Afecta a todos los vendedores y muchas fichas siguen con la estructura antigua. Te lo dejamos aquí, trabajes o no con nosotros: es lo primero que conviene
          revisar en cualquier catálogo.
        </Parrafo>
      </Revelar>

      <div className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {LIMITES_SEO.map((l, i) => (
          <Revelar key={l.campo} retraso={i * 100}>
            <div className="ls-tarjeta h-full rounded-[20px] p-6" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="text-[11.5px] font-bold uppercase tracking-[0.14em]" style={{ color: N }}>
                {l.campo}
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <Contador texto={l.cifra} className="text-[44px] font-extrabold leading-none tracking-[-0.045em] tabular-nums" />
                <span className="text-[13px] font-semibold" style={{ color: 'rgba(255,255,255,0.5)' }}>
                  {l.unidad}
                </span>
              </div>
              <p className="mt-3 text-[13.5px] leading-relaxed" style={{ color: TEXTO2 }}>
                {l.nota}
              </p>
            </div>
          </Revelar>
        ))}
      </div>

      <div className="mt-16 grid items-center gap-14 lg:grid-cols-2">
        <Revelar>
          <Etiqueta>Cómo están tus títulos</Etiqueta>
          {seo.revisados > 0 && (
            <H2>
              {seo.fueraDeNorma > 0 ? (
                <>
                  <span style={{ color: N }}>{seo.fueraDeNorma}</span> de {seo.revisados} títulos
                  <br />
                  pasan de {UMBRALES.titulo} caracteres
                </>
              ) : (
                <>Tus títulos ya cumplen la norma</>
              )}
            </H2>
          )}
          <Parrafo>
            {seo.fueraDeNorma > 0
              ? 'Un título fuera de norma lo reescribe la IA de Amazon a su manera, y se pierde el control de las palabras por las que se posiciona.'
              : `Tus títulos tienen de media ${seo.largoMedio ?? '—'} caracteres. El siguiente paso es aprovechar Item Highlights, que se indexa igual que el título.`}
          </Parrafo>
          <ul className="mt-7 space-y-3">
            <Vineta fuerte="Estructura:">marca + tipo de producto + atributo principal + variante.</Vineta>
            <Vineta fuerte="Sin repetir:">ninguna palabra más de dos veces.{seo.conRepeticiones ? ` ${seo.conRepeticiones === 1 ? 'Uno de tus títulos lo hace.' : `${seo.conRepeticiones} de tus títulos lo hacen.`}` : ''}</Vineta>
            <Vineta fuerte="Sin símbolos ni promociones:">
              nada de ! $ ? _ {'{ }'} ^, precios ni «oferta».{seo.conSimbolos ? ` ${seo.conSimbolos === 1 ? 'Uno de tus títulos lleva alguno.' : `${seo.conSimbolos} de tus títulos llevan alguno.`}` : ''}
            </Vineta>
            <Vineta fuerte="Lo que no cabe no se pierde:">va a Item Highlights, las viñetas y el backend, sin repetir palabras entre ellos.</Vineta>
          </ul>
        </Revelar>

        <Revelar retraso={150}>
          {ej ? (
            <Ventana titulo={`Tu título más largo · ${ej.largo} caracteres`}>
              <div className="rounded-[10px] p-4 text-[14.5px] leading-[1.7]" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <span className="text-white">{dentro}</span>
                <span className="mx-0.5 inline-block h-[1.1em] w-[2px] translate-y-[3px] rounded" style={{ background: N, boxShadow: `0 0 10px ${N}` }} />
                <span style={{ color: PASTILLA.mal.color, opacity: 0.75, textDecoration: 'line-through', textDecorationColor: 'rgba(248,113,113,0.5)' }}>{fuera}</span>
              </div>
              <div className="mt-4 px-1">
                <div className="mb-1.5 flex justify-between text-[11px] font-bold uppercase tracking-[0.06em]" style={{ color: 'rgba(255,255,255,0.45)' }}>
                  <span>Caracteres</span>
                  <span>
                    <span style={{ color: PASTILLA.mal.color }}>{ej.largo}</span> / {UMBRALES.titulo}
                  </span>
                </div>
                <div className="relative h-[7px] overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, (UMBRALES.titulo / ej.largo) * 100)}%`, background: `linear-gradient(90deg, ${N}, ${N2})` }} />
                  <div
                    className="absolute inset-y-0 rounded-r-full"
                    style={{ left: `${Math.min(100, (UMBRALES.titulo / ej.largo) * 100)}%`, right: 0, background: 'rgba(248,113,113,0.55)' }}
                  />
                </div>
              </div>
              <div className="mt-3 px-1 text-[12px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
                Lo tachado es lo que pasa de los {UMBRALES.titulo} caracteres.
              </div>
            </Ventana>
          ) : (
            <Ventana titulo="Tus títulos · norma de julio de 2026">
              <Fila className="flex items-center justify-between">
                <span>Títulos revisados</span>
                <Pastilla tono="bien">{seo.revisados} dentro de norma</Pastilla>
              </Fila>
            </Ventana>
          )}
        </Revelar>
      </div>
    </Seccion>
  )
}

/* ------------------------------------------------------------------ */
/* Competencia                                                          */
/* ------------------------------------------------------------------ */

function SeccionCompetencia({ c }: { c: NonNullable<Informe['competencia']> }) {
  const filas = [...(c.estrella ? [{ p: c.estrella, suyo: true }] : []), ...c.rivales.map((p) => ({ p, suyo: false }))]
  const lider = c.rivales[0]
  return (
    <Seccion id="competencia" alterna>
      <Halo className="-left-40 top-1/3 h-[420px] w-[420px]" fuerza={0.1} lento />
      <Revelar>
        <Etiqueta centro>Competencia</Etiqueta>
        <H2 centro>Contra quién compites{c.categoria ? ` en ${c.categoria}` : ''}</H2>
        <Parrafo centro>
          Los productos que más venden en la categoría de tu producto estrella, y el tuyo al lado.
          {lider && c.estrella && lider.resenas && c.estrella.resenas && lider.resenas > c.estrella.resenas * 1.5
            ? ` El que lidera tiene ${Math.round(lider.resenas / Math.max(c.estrella.resenas, 1))} veces más reseñas que el tuyo.`
            : ''}
        </Parrafo>
      </Revelar>
      <Revelar className="mt-12">
        <Ventana titulo={`Ranking de ventas${c.categoria ? ` · ${c.categoria}` : ''} · Amazon.es`}>
          <div className="space-y-2">
            {filas.map(({ p, suyo }, i) => (
              <Revelar key={p.asin} retraso={i * 90}>
                <div
                  className="grid grid-cols-[48px_1fr] items-center gap-x-4 gap-y-3 rounded-[10px] px-3 py-3 text-[12.5px] sm:grid-cols-[48px_minmax(0,2.4fr)_repeat(5,minmax(0,0.9fr))]"
                  style={{
                    background: suyo ? 'rgba(255,102,0,0.08)' : 'rgba(255,255,255,0.024)',
                    border: `1px solid ${suyo ? 'rgba(255,102,0,0.4)' : 'rgba(255,255,255,0.05)'}`,
                  }}
                >
                  <div className="h-12 w-12 overflow-hidden rounded-lg bg-white">
                    {p.imagen && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.imagen} alt="" className="h-full w-full object-contain p-1" loading="lazy" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {suyo ? <Pastilla tono="naranja">Tu producto</Pastilla> : <Pastilla tono="gris">{p.marca ?? 'Competidor'}</Pastilla>}
                    </div>
                    <a href={p.url} target="_blank" rel="noopener noreferrer" className="mt-1 line-clamp-1 font-semibold text-white hover:underline">
                      {p.titulo}
                    </a>
                  </div>
                  <div className="col-span-2 grid grid-cols-5 gap-3 sm:col-span-5 sm:contents">
                    {[
                      [p.ranking ? `#${entero(p.ranking)}` : '—', 'ranking'],
                      [eur(p.precio), 'precio'],
                      [p.estrellas === null ? '—' : `${decimal(p.estrellas)} ★`, 'valoración'],
                      [entero(p.resenas), 'reseñas'],
                      [comprasMes(p.ventasMes), 'compras'],
                    ].map(([v, l]) => (
                      <div key={l}>
                        <div className="font-semibold tabular-nums text-white">{v}</div>
                        <div className="text-[10px] font-bold uppercase tracking-[0.06em]" style={{ color: 'rgba(255,255,255,0.4)' }}>
                          {l}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </Revelar>
            ))}
          </div>
        </Ventana>
      </Revelar>
    </Seccion>
  )
}

/* ------------------------------------------------------------------ */
/* Clientes (los mismos nueve de libertyseller.com)                     */
/* ------------------------------------------------------------------ */

export const CLIENTES: { nombre: string; logo?: string; tag: string; cifra: string }[] = [
  { nombre: 'Creative Toys', logo: '/logos/clientes/partner-creativetoys.png', tag: 'Creación de cuenta', cifra: 'Marca TOP en juegos de mesa' },
  { nombre: 'BSC Shoes & Fashion', logo: '/logos/clientes/partner-bsc.png', tag: 'Buy Box · Gestión 360º', cifra: 'Buy Box del 3 % al 25 %' },
  { nombre: 'Lenobotics', logo: '/logos/clientes/partner-lenobotics.png', tag: 'Buy Box · Catálogo', cifra: '+5 % de Buy Box en electrónica' },
  { nombre: 'EVO Computer', logo: '/logos/clientes/partner-evo.png', tag: 'Inventario sin explotar', cifra: 'Volcado de inventario' },
  { nombre: 'Bodegas Valhalla', logo: '/logos/clientes/partner-valhalla.png', tag: 'Creatividades · Internacional', cifra: 'Rediseño de marca y salto a Europa' },
  { nombre: 'YO by Yolanda Hernández', logo: '/logos/clientes/partner-yolanda.png', tag: 'Listings · Store · KDP', cifra: 'Listings y Store rehechos de cero' },
  { nombre: 'Montevalle', logo: '/logos/clientes/partner-montevalle.png', tag: 'Listings · Analítica', cifra: 'Catálogo creado desde cero' },
  { nombre: 'Opinas', logo: '/logos/clientes/partner-opinas.png', tag: 'Marketing · Internacional', cifra: 'Marketing de punta a punta' },
  { nombre: 'Inversiones privadas', tag: 'Marca privada · NDA', cifra: 'Márgenes del 20-30 %' },
]

function SeccionClientes() {
  return (
    <Seccion id="clientes">
      <Revelar>
        <Etiqueta centro>Casos</Etiqueta>
        <H2 centro>Marcas que ya confían en nosotros</H2>
        <Parrafo centro>Algunas de las cuentas que gestionamos y lo que hicimos en cada una.</Parrafo>
      </Revelar>
      <div className="mx-auto mt-12 grid max-w-[960px] grid-cols-2 gap-3 sm:grid-cols-3">
        {CLIENTES.map((c, i) => (
          <Revelar key={c.nombre} retraso={(i % 3) * 90}>
            <div
              className="ls-tarjeta group flex h-full flex-col rounded-[20px] p-5"
              style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <div className="flex h-[88px] items-center justify-center">
                {c.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={c.logo}
                    alt={c.nombre}
                    className="max-h-[64px] max-w-[85%] object-contain opacity-70 grayscale transition duration-500 group-hover:opacity-100 group-hover:grayscale-0"
                    loading="lazy"
                  />
                ) : (
                  <span className="flex items-center gap-2 text-[15px] font-bold" style={{ color: 'rgba(255,255,255,0.6)' }}>
                    <Lock className="h-4 w-4" style={{ color: N }} /> Bajo NDA
                  </span>
                )}
              </div>
              <div className="mt-3 text-[10.5px] font-bold uppercase tracking-[0.1em]" style={{ color: N }}>
                {c.tag}
              </div>
              <div className="mt-1 text-[14px] font-semibold leading-snug">{c.cifra}</div>
              <div className="mt-0.5 text-[12px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
                {c.nombre}
              </div>
            </div>
          </Revelar>
        ))}
      </div>
    </Seccion>
  )
}

/* ------------------------------------------------------------------ */
/* Página                                                               */
/* ------------------------------------------------------------------ */

/** El comercial que lleva el lead: a quien escribe o llama el cliente. */
export type ContactoComercial = {
  nombre: string
  /** móvil con WhatsApp, en cualquier formato («+34 644 26 86 11») */
  whatsapp?: string | null
  /** su línea de Rinkel, para «Llamar» */
  telefono?: string | null
}

function IconoWhatsapp({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.4-1.47-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.08c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.69.25-1.29.17-1.41-.07-.12-.27-.2-.57-.35M12.05 21.5h-.01a9.4 9.4 0 0 1-4.8-1.31l-.34-.2-3.57.94.95-3.48-.22-.36a9.4 9.4 0 0 1-1.44-5.02c0-5.2 4.24-9.44 9.45-9.44 2.52 0 4.89.98 6.67 2.77a9.38 9.38 0 0 1 2.76 6.68c0 5.2-4.24 9.43-9.45 9.43m8.04-17.47A11.3 11.3 0 0 0 12.05.7C5.78.7.68 5.8.68 12.06c0 2 .52 3.96 1.52 5.68L.6 23.3l5.7-1.5a11.33 11.33 0 0 0 5.75 1.46h.01c6.26 0 11.36-5.1 11.36-11.36 0-3.04-1.18-5.89-3.33-8.04" />
    </svg>
  )
}

export function InformeAnalisis({
  informe,
  contacto,
}: {
  informe: Informe
  /** el comercial que lleva el lead; sin él, los botones bajan a la sección de contacto */
  contacto?: ContactoComercial | null
}) {
  const { vendedor, cifras } = informe
  const v12 = informe.valoraciones[2]
  const negativas12 = v12.negativas ?? 0
  const alertaReputacion = (v12.numero ?? 0) >= UMBRALES.minValoraciones && negativas12 >= UMBRALES.negativas
  const top = informe.oportunidades.slice(0, 3)
  const altas = informe.oportunidades.filter((o) => o.prioridad === 'alta').length
  const marcasVisibles = informe.marcas.slice(0, 5)
  const restoMarcas = informe.marcas.slice(5)
  const fbaTexto = { si: 'Sí', no: 'No', parcial: 'En parte' }[cifras.fba]
  const telefono = contacto?.telefono ? (/\+?\d[\d\s]{7,}/.exec(contacto.telefono)?.[0] ?? '').trim() : ''
  const urlLlamar = telefono ? `tel:${telefono.replace(/[^\d+]/g, '')}` : null
  const urlWhatsapp = contacto?.whatsapp
    ? `https://wa.me/${contacto.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(
        `Hola ${contacto.nombre}, he visto el análisis de la cuenta de ${vendedor.nombre} en Amazon y me gustaría saber más.`,
      )}`
    : null
  const cta = urlWhatsapp ?? urlLlamar ?? '#contacto'
  const nombreComercial = contacto?.nombre ?? 'nuestro equipo'
  const principal = informe.marcas[0]
  const reducido = useReducido()

  /* barra de progreso y botón fijo en móvil */
  const [progreso, setProgreso] = useState(0)
  const [pasadaPortada, setPasadaPortada] = useState(false)
  useEffect(() => {
    let raf = 0
    const f = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const h = document.documentElement.scrollHeight - innerHeight
        setProgreso(h > 0 ? scrollY / h : 0)
        setPasadaPortada(scrollY > innerHeight * 0.9)
      })
    }
    f()
    addEventListener('scroll', f, { passive: true })
    addEventListener('resize', f)
    return () => {
      removeEventListener('scroll', f)
      removeEventListener('resize', f)
      cancelAnimationFrame(raf)
    }
  }, [])

  /* foco que sigue al ratón en la portada */
  const portada = useRef<HTMLElement | null>(null)
  const moverFoco = (e: React.MouseEvent) => {
    if (reducido || !portada.current) return
    const r = portada.current.getBoundingClientRect()
    portada.current.style.setProperty('--fx', `${e.clientX - r.left}px`)
    portada.current.style.setProperty('--fy', `${e.clientY - r.top}px`)
  }

  /* la cinta: lo que más pesa y lo que ya funciona, en bucle */
  const cinta = [
    ...informe.oportunidades.map((o) => ({ cifra: o.cifra, texto: o.titulo, malo: o.prioridad === 'alta' })),
    ...informe.fortalezas.map((f) => ({ cifra: f.cifra, texto: f.titulo, malo: false })),
  ]

  const titularDos =
    altas > 0
      ? `${altas === 1 ? 'Un punto te está' : `${altas} puntos te están`} costando ventas.`
      : 'Y tienes recorrido para vender más.'

  return (
    <div className="min-h-screen overflow-x-hidden text-white antialiased" style={{ background: FONDO, fontFamily: 'var(--font-inter), Inter, system-ui, sans-serif' }}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div aria-hidden className="ls-grano pointer-events-none fixed inset-0 z-[60]" />

      {/* ---------- barra ---------- */}
      <header
        className="sticky top-0 z-40"
        style={{ background: 'rgba(8,8,8,0.7)', backdropFilter: 'blur(18px) saturate(1.2)', WebkitBackdropFilter: 'blur(18px) saturate(1.2)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div className="mx-auto flex h-16 max-w-[1130px] items-center justify-between gap-4 px-4 sm:px-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logos/logo.png" alt="Liberty Seller" className="h-[22px] w-auto" />
          <nav className="hidden items-center gap-6 text-[13px] font-medium lg:flex" style={{ color: TEXTO2 }}>
            {[
              ['fortalezas', 'Lo que funciona'],
              ['claves', 'Lo que cuesta ventas'],
              ['productos', 'Productos'],
              ...(informe.puedeEditarFichas ? [['seo', 'SEO 2026']] : []),
              ['plan', 'Por dónde empezar'],
            ].map(([id, t]) => (
              <a key={id} href={`#${id}`} className="transition-colors hover:text-white">
                {t}
              </a>
            ))}
          </nav>
          <a
            href={cta}
            target={urlWhatsapp ? '_blank' : undefined}
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-[2px] bg-white px-4 py-2.5 text-[12px] font-bold uppercase tracking-[0.02em] text-black transition-opacity hover:opacity-90"
          >
            {urlWhatsapp && <IconoWhatsapp className="h-4 w-4" />}
            {urlWhatsapp ? 'Escribir por WhatsApp' : 'Contactar'}
          </a>
        </div>
        <div className="absolute inset-x-0 bottom-0 h-[2px] origin-left" style={{ transform: `scaleX(${progreso})`, background: `linear-gradient(90deg, ${N}, ${N2})`, boxShadow: `0 0 12px ${N}` }} />
      </header>

      {/* ---------- portada ---------- */}
      <section
        ref={portada}
        onMouseMove={moverFoco}
        className="relative overflow-hidden px-4 pb-16 pt-16 sm:px-8 sm:pb-24 sm:pt-24"
        style={{ ['--fx' as string]: '70%', ['--fy' as string]: '20%' } as CSSProperties}
      >
        <div aria-hidden className="ls-reticula pointer-events-none absolute inset-0" />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: 'radial-gradient(520px circle at var(--fx) var(--fy), rgba(255,102,0,0.13), transparent 60%)' }}
        />
        <Halo className="-left-40 -top-40 h-[560px] w-[560px]" fuerza={0.16} />
        <Halo className="-right-32 top-56 h-[440px] w-[440px]" fuerza={0.1} lento />
        <div className="relative mx-auto grid max-w-[1130px] items-center gap-12 lg:grid-cols-[1.08fr_1fr]">
          <div>
            <Revelar>
              <Etiqueta>Análisis preparado para {vendedor.nombre}</Etiqueta>
            </Revelar>
            <Revelar retraso={100}>
              <h1 className="mt-5 text-[40px] font-extrabold leading-[1.02] tracking-[-0.045em] sm:text-[60px]">
                Hemos revisado tu cuenta de Amazon.
                <span className="ls-texto-degradado mt-1 block">{titularDos}</span>
              </h1>
            </Revelar>
            <Revelar retraso={200}>
              <div className="mt-5 text-[14px] font-medium" style={{ color: 'rgba(255,255,255,0.55)' }}>
                {[vendedor.nombre, vendedor.empresa, vendedor.ciudad, vendedor.desde && `en Amazon desde ${mesAnio(vendedor.desde)}`].filter(Boolean).join(' · ')}
              </div>
              <p className="mt-5 max-w-[540px] text-[16.5px] leading-[1.65]" style={{ color: TEXTO2 }}>
                {informe.resumen}
              </p>
            </Revelar>
            <Revelar retraso={300}>
              <div className="mt-8 flex flex-wrap gap-3">
                <a
                  href="#claves"
                  className="ls-boton inline-flex items-center gap-2 rounded-xl px-6 py-3.5 text-[13px] font-bold uppercase tracking-[0.06em] text-white transition-transform hover:-translate-y-0.5"
                  style={{ background: N, boxShadow: '0 10px 30px rgba(255,102,0,0.35)' }}
                >
                  Ver lo que hemos encontrado <ArrowDown className="ls-anim h-4 w-4" style={{ animation: 'ls-bajar 1.8s ease-in-out infinite' }} />
                </a>
                {urlWhatsapp && (
                  <a
                    href={urlWhatsapp}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-xl px-6 py-3.5 text-[13px] font-bold uppercase tracking-[0.06em] text-white transition-colors hover:bg-white/10"
                    style={{ border: '1px solid rgba(255,255,255,0.16)' }}
                  >
                    <IconoWhatsapp className="h-4 w-4" /> Preguntar a {nombreComercial}
                  </a>
                )}
              </div>
              <div className="mt-7 flex flex-wrap gap-2.5">
                <Chip icono={<BadgeCheck className="h-4 w-4" />}>{informe.tipoTexto}</Chip>
                <Chip icono={<Boxes className="h-4 w-4" />}>{entero(cifras.productos)} productos</Chip>
                <Chip icono={<Globe2 className="h-4 w-4" />}>{cifras.mercadosActivos} de 5 mercados</Chip>
                <Chip icono={<PackageCheck className="h-4 w-4" />}>FBA: {fbaTexto.toLowerCase()}</Chip>
              </div>
            </Revelar>
          </div>

          <Revelar retraso={250}>
            <Ventana brillo titulo={`Resumen · datos del ${fechaCorta(informe.fecha)}`}>
              <div className="grid grid-cols-2 gap-2.5">
                <Dato valor={entero(cifras.productos)} rotulo="productos en España" />
                <Dato valor={cifras.buyBox === null ? '—' : `${cifras.buyBox} %`} rotulo="Buy Box en tus ofertas" />
                <Dato
                  valor={v12.positivas === null ? '—' : `${v12.positivas} %`}
                  rotulo={`positivas · 12 meses (${entero(v12.numero)})`}
                  tono={alertaReputacion ? 'mal' : undefined}
                />
                <Dato valor={`${cifras.mercadosActivos} / 5`} rotulo="mercados con ventas" />
              </div>
              <div className="mt-2.5 space-y-2">
                {top.map((o, i) => (
                  <Revelar key={o.titulo} retraso={500 + i * 120}>
                    <Fila className="flex items-center justify-between gap-3">
                      <span className="truncate">
                        <span className="font-bold text-white">{o.cifra}</span>
                        <span style={{ color: 'rgba(255,255,255,0.6)' }}> · {o.titulo}</span>
                      </span>
                      <Pastilla tono={tonoPrioridad(o.prioridad)}>{o.prioridad === 'alta' ? 'Prioridad' : 'Revisar'}</Pastilla>
                    </Fila>
                  </Revelar>
                ))}
              </div>
            </Ventana>
          </Revelar>
        </div>
      </section>

      {/* ---------- cinta ---------- */}
      {cinta.length > 0 && (
        <div className="relative overflow-hidden py-4" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', borderBottom: '1px solid rgba(255,255,255,0.06)', background: FONDO2 }}>
          <div
            className="ls-anim flex w-max gap-10 whitespace-nowrap"
            style={{ animation: `ls-cinta ${Math.max(28, cinta.length * 6)}s linear infinite` }}
          >
            {[...cinta, ...cinta].map((c, i) => (
              <span key={i} className="flex items-center gap-3 text-[13px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.malo ? N : '#4ADE80' }} />
                <span className="font-extrabold" style={{ color: c.malo ? N : '#fff' }}>
                  {c.cifra}
                </span>
                {c.texto}
              </span>
            ))}
          </div>
          <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-24" style={{ background: `linear-gradient(90deg, ${FONDO2}, transparent)` }} />
          <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-24" style={{ background: `linear-gradient(-90deg, ${FONDO2}, transparent)` }} />
        </div>
      )}

      {/* ---------- lo que ya hace bien ---------- */}
      {informe.fortalezas.length > 0 && (
        <Seccion id="fortalezas">
          <Revelar>
            <Etiqueta centro>Lo que ya funciona</Etiqueta>
            <H2 centro>Hay una buena base</H2>
            <Parrafo centro>Antes de hablar de lo que se puede mejorar, esto es lo que tu cuenta ya hace bien. Es sobre lo que se construye.</Parrafo>
          </Revelar>
          <div className={`mt-14 grid gap-3 sm:grid-cols-2 ${informe.fortalezas.length >= 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
            {informe.fortalezas.map((f, i) => (
              <Revelar key={f.titulo} retraso={i * 110}>
                <div className="ls-tarjeta h-full rounded-[20px] p-6" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <span className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.3)' }}>
                    <Check className="h-4 w-4" style={{ color: '#4ADE80' }} strokeWidth={3} />
                  </span>
                  <Contador texto={f.cifra} className="mt-5 block text-[38px] font-extrabold leading-none tracking-[-0.04em] tabular-nums" />
                  <div className="mt-3 text-[16px] font-semibold">{f.titulo}</div>
                  <p className="mt-1.5 text-[13.5px] leading-relaxed" style={{ color: TEXTO2 }}>
                    {f.detalle}
                  </p>
                </div>
              </Revelar>
            ))}
          </div>
        </Seccion>
      )}

      {/* ---------- dónde se escapa la venta ---------- */}
      {top.length > 0 && (
        <Seccion id="claves" alterna reticula>
          <Halo className="left-1/2 top-24 h-[380px] w-[680px] -translate-x-1/2" fuerza={0.09} />
          <Revelar>
            <Etiqueta centro>Lo que cuesta ventas</Etiqueta>
            <H2 centro>Dónde se te está escapando la venta</H2>
            <Parrafo centro>Ordenado por lo que más venta puede estar costando hoy. Cada punto, con la cifra que lo sostiene.</Parrafo>
          </Revelar>
          <div className="mt-14 grid gap-3 md:grid-cols-3">
            {top.map((o, i) => (
              <Revelar key={o.titulo} retraso={i * 140}>
                <article
                  className="ls-tarjeta relative h-full overflow-hidden rounded-[22px] p-7"
                  style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${o.prioridad === 'alta' ? 'rgba(255,102,0,0.3)' : 'rgba(255,255,255,0.08)'}` }}
                >
                  <div aria-hidden className="absolute -right-16 -top-16 h-40 w-40 rounded-full blur-[60px]" style={{ background: o.prioridad === 'alta' ? 'rgba(255,102,0,0.22)' : 'rgba(255,255,255,0.05)' }} />
                  <div className="relative">
                    <div className="flex items-center justify-between">
                      <span className="text-[11.5px] font-bold uppercase tracking-[0.14em]" style={{ color: N }}>
                        {String(i + 1).padStart(2, '0')} · {AREA[o.area]}
                      </span>
                      <Pastilla tono={tonoPrioridad(o.prioridad)}>{o.prioridad}</Pastilla>
                    </div>
                    <Contador texto={o.cifra} className="mt-6 block text-[56px] font-extrabold leading-none tracking-[-0.045em] tabular-nums" />
                    <h3 className="mt-4 text-[20px] font-semibold">{o.titulo}</h3>
                    {o.impacto && (
                      <div className="mt-3 rounded-lg px-3 py-2 text-[13px] font-semibold" style={{ background: 'rgba(255,102,0,0.08)', color: N2 }}>
                        {o.impacto}
                      </div>
                    )}
                    <p className="mt-3 text-[14px] leading-relaxed" style={{ color: TEXTO2 }}>
                      {o.detalle}
                    </p>
                  </div>
                </article>
              </Revelar>
            ))}
          </div>
          <Revelar className="mt-10 text-center">
            <a
              href={cta}
              target={urlWhatsapp ? '_blank' : undefined}
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-[14px] font-semibold transition-colors hover:text-white"
              style={{ color: N }}
            >
              Pregúntale a {nombreComercial} cómo lo resolveríamos <ArrowRight className="h-4 w-4" />
            </a>
          </Revelar>
        </Seccion>
      )}

      {/* ---------- perfil ---------- */}
      <Seccion id="perfil">
        <Halo className="-right-40 top-10 h-[380px] w-[380px]" fuerza={0.08} lento />
        <div className="grid items-center gap-14 lg:grid-cols-2">
          <Revelar>
            <Etiqueta>Perfil del vendedor</Etiqueta>
            <H2>{informe.tipoTexto}</H2>
            <Parrafo>{informe.tipoPorQue}</Parrafo>
            <ul className="mt-7 space-y-3">
              {principal && (
                <Vineta fuerte={`${principal.cuota} % de tu catálogo`}>
                  es de <span className="capitalize">{principal.marca.toLowerCase()}</span>
                  {informe.tipo === 'marca_propia' ? ', tu marca.' : ', la marca que más pesa.'}
                </Vineta>
              )}
              {cifras.competidoresBuyBox !== null && (
                <Vineta fuerte={`${decimal(cifras.competidoresBuyBox)} vendedores`}>compiten de media en cada una de tus fichas.</Vineta>
              )}
              <Vineta fuerte="Por qué importa:">
                {informe.tipo === 'marca_propia'
                  ? 'con marca propia la ficha es tuya; el trabajo está en que nadie te quite la Buy Box, en no quedarte sin stock y en que la ficha convierta.'
                  : 'vendiendo marcas de otros, la venta depende de ganar la Buy Box frente al resto de vendedores: precio, logística y reputación pesan más que la ficha.'}
              </Vineta>
            </ul>
          </Revelar>
          <Revelar retraso={150}>
            <Ventana titulo={`Marcas en tu catálogo · ${informe.marcas.length} ${informe.marcas.length === 1 ? 'marca' : 'marcas'}`}>
              <div className="space-y-3.5 px-1 py-1">
                {marcasVisibles.map((m) => (
                  <div key={m.marca}>
                    <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[12.5px]">
                      <span className="truncate capitalize" style={{ color: 'rgba(255,255,255,0.75)' }}>
                        {m.marca.toLowerCase()}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        <b className="font-bold text-white">{m.productos}</b>
                        <span style={{ color: 'rgba(255,255,255,0.45)' }}> prod. · {m.cuota} %</span>
                      </span>
                    </div>
                    <Barra pct={m.cuota} />
                  </div>
                ))}
              </div>
              {(restoMarcas.length > 0 || informe.marcas.some((m) => m.conAmazon)) && (
                <div className="mt-4 rounded-[10px] px-3 py-[11px] text-[12.5px]" style={{ background: 'rgba(255,102,0,0.08)', border: '1px solid rgba(255,102,0,0.25)', color: 'rgba(255,255,255,0.8)' }}>
                  {restoMarcas.length > 0 && (
                    <>
                      <b style={{ color: N }}>{restoMarcas.length} marcas más</b> con {restoMarcas.reduce((t, m) => t + m.productos, 0)} productos.{' '}
                    </>
                  )}
                  {informe.marcas.some((m) => m.conAmazon) && (
                    <>
                      Amazon vende en <b style={{ color: N }}>{informe.marcas.reduce((t, m) => t + m.conAmazon, 0)}</b> de tus productos.
                    </>
                  )}
                </div>
              )}
            </Ventana>
          </Revelar>
        </div>
      </Seccion>

      {/* ---------- mercados ---------- */}
      <Seccion id="mercados" alterna>
        <div className="grid items-center gap-14 lg:grid-cols-2">
          <Revelar className="order-2 lg:order-1">
            <Ventana titulo={`${vendedor.nombre} · presencia por país`}>
              <div className="space-y-2">
                {informe.paises.map((p, i) => (
                  <Revelar key={p.codigo} retraso={i * 90}>
                    <Fila className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2.5">
                        <span className="text-[15px] leading-none">{BANDERA[p.codigo]}</span>
                        <span className="font-medium text-white">{p.nombre}</span>
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="hidden text-[11.5px] sm:inline" style={{ color: 'rgba(255,255,255,0.45)' }}>
                          {p.presente ? `${entero(p.valoraciones)} val.${p.fba ? ' · FBA' : ''}` : ''}
                        </span>
                        {p.presente === null ? (
                          <Pastilla tono="gris">Sin consultar</Pastilla>
                        ) : p.presente ? (
                          <Pastilla tono="bien">Activo</Pastilla>
                        ) : (
                          <Pastilla tono="naranja">Por abrir</Pastilla>
                        )}
                      </span>
                    </Fila>
                  </Revelar>
                ))}
              </div>
            </Ventana>
          </Revelar>
          <Revelar className="order-1 lg:order-2">
            <Etiqueta>Internacional</Etiqueta>
            <H2>
              {cifras.mercadosActivos} de 5 mercados
              <br />
              europeos con ventas
            </H2>
            <Parrafo>
              Los mismos productos, con las mismas fichas traducidas, pueden venderse en los cinco grandes mercados europeos de Amazon. Un país cuenta como activo cuando tienes
              valoraciones de vendedor en él.
            </Parrafo>
            <ul className="mt-7 space-y-3">
              {informe.paises
                .filter((p) => p.presente === false)
                .slice(0, 3)
                .map((p) => (
                  <Vineta key={p.codigo} fuerte={p.nombre}>
                    {p.codigo === 'de' && 'pide registro EPR de envases y aparatos, y fichas en alemán.'}
                    {p.codigo === 'fr' && 'pide EPR (Triman) y las fichas en francés.'}
                    {p.codigo === 'it' && 'pide las fichas en italiano y su registro de envases.'}
                    {p.codigo === 'uk' && 'tiene IVA e importación propios desde el Brexit.'}
                    {p.codigo === 'es' && 'sin ventas registradas.'}
                  </Vineta>
                ))}
            </ul>
          </Revelar>
        </div>
      </Seccion>

      {/* ---------- productos ---------- */}
      <Seccion id="productos">
        <Halo className="left-1/2 top-0 h-[320px] w-[620px] -translate-x-1/2" fuerza={0.07} />
        <Revelar>
          <Etiqueta centro>Catálogo</Etiqueta>
          <H2 centro>Tus productos, uno a uno</H2>
          <Parrafo centro>
            Los {informe.productos.length} mejor posicionados en Amazon.es, por ranking de ventas. En rojo, lo que no llega al umbral: agotado ≥ {UMBRALES.sinStock} % del tiempo,
            Buy Box &lt; {UMBRALES.buyBox} % o menos de {decimal(UMBRALES.estrellas)} ★
            {informe.puedeEditarFichas
              ? `; en ámbar, menos de ${UMBRALES.fotos} fotos o título de más de ${UMBRALES.titulo} caracteres (la norma de Amazon desde julio de 2026).`
              : '. Arriba de cada producto, quién tiene la Buy Box ahora y si hay stock.'}
          </Parrafo>
        </Revelar>
        <div className="mt-12">
          {informe.ventas.conDato > 0 && (
            <Revelar className="mb-8 flex justify-center">
              <div className="inline-flex flex-wrap items-center justify-center gap-x-6 gap-y-2 rounded-2xl px-6 py-4" style={{ background: 'rgba(255,102,0,0.07)', border: '1px solid rgba(255,102,0,0.25)' }}>
                <span className="text-[13px] font-semibold" style={{ color: 'rgba(255,255,255,0.7)' }}>
                  Lo que venden {informe.ventas.conDato === informe.productos.length ? 'estos' : `${informe.ventas.conDato} de estos`} productos al mes
                </span>
                <span className="text-[24px] font-extrabold tracking-[-0.03em]">
                  <Contador texto={`+${miles(informe.ventas.compras)}`} /> <span className="text-[14px] font-semibold" style={{ color: 'rgba(255,255,255,0.5)' }}>compras</span>
                </span>
                {informe.ventas.importe > 0 && (
                  <span className="text-[24px] font-extrabold tracking-[-0.03em]" style={{ color: N }}>
                    ≈ <Contador texto={`${miles(informe.ventas.importe)} €`} />
                  </span>
                )}
              </div>
            </Revelar>
          )}
          <Catalogo productos={informe.productos} />
          {informe.ventas.conDato > 0 && (
            <p className="mt-6 text-center text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
              Compras: el dato «comprados el mes pasado» que Amazon enseña en cada ficha (es un mínimo, Amazon lo redondea). El importe multiplica esas compras por el precio
              actual: es una aproximación.
            </p>
          )}
        </div>
      </Seccion>

      {/* ---------- competencia ---------- */}
      {informe.competencia && informe.competencia.rivales.length > 0 && <SeccionCompetencia c={informe.competencia} />}

      {/* ---------- píldora SEO ---------- */}
      {informe.puedeEditarFichas && informe.seo.revisados > 0 && <SeccionSeo seo={informe.seo} />}

      {/* ---------- oportunidades ---------- */}
      <Seccion id="oportunidades" alterna>
        <Revelar>
          <Etiqueta centro>Oportunidades</Etiqueta>
          <H2 centro>Todo lo que señalan los datos</H2>
          <Parrafo centro>Cada punto con su cifra, el criterio con el que se ha marcado y cómo lo trabajaríamos.</Parrafo>
        </Revelar>
        <div className="mt-12 space-y-3">
          {informe.oportunidades.map((o, i) => (
            <Revelar key={o.titulo} retraso={Math.min(i, 5) * 70}>
              <article
                className="ls-tarjeta grid gap-5 rounded-[20px] p-6 sm:grid-cols-[150px_1fr] sm:p-7"
                style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${o.prioridad === 'alta' ? 'rgba(255,102,0,0.3)' : 'rgba(255,255,255,0.08)'}` }}
              >
                <div>
                  <Contador texto={o.cifra} className="block text-[36px] font-extrabold leading-none tracking-[-0.04em] tabular-nums" style={{ color: o.prioridad === 'alta' ? N : '#fff' }} />
                  <div className="mt-2 text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: 'rgba(255,255,255,0.45)' }}>
                    {AREA[o.area]}
                  </div>
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h3 className="text-[19px] font-semibold">{o.titulo}</h3>
                    <Pastilla tono={tonoPrioridad(o.prioridad)}>Prioridad {o.prioridad}</Pastilla>
                  </div>
                  <p className="mt-2 text-[14.5px] leading-relaxed" style={{ color: TEXTO2 }}>
                    {o.detalle}
                  </p>
                  {o.accion && (
                    <div className="mt-4 flex gap-2.5 rounded-xl px-4 py-3 text-[13.5px]" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                      <ArrowRight className="mt-0.5 h-4 w-4 shrink-0" style={{ color: N }} />
                      <span style={{ color: 'rgba(255,255,255,0.85)' }}>
                        <b className="font-semibold text-white">Cómo lo trabajaríamos: </b>
                        {o.accion}
                      </span>
                    </div>
                  )}
                  <div className="mt-3 text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    Criterio: {o.umbral}
                  </div>
                </div>
              </article>
            </Revelar>
          ))}
          {informe.oportunidades.length === 0 && (
            <p className="text-center" style={{ color: TEXTO2 }}>
              Con los datos públicos no aparece ningún punto por debajo de los umbrales que usamos.
            </p>
          )}
        </div>
      </Seccion>

      {/* ---------- reputación ---------- */}
      <Seccion id="reputacion">
        <div className="grid items-center gap-14 lg:grid-cols-2">
          <Revelar>
            <Etiqueta>Reputación</Etiqueta>
            <H2>{v12.positivas === null ? 'Valoraciones de vendedor' : `${v12.positivas} % positivas en 12 meses`}</H2>
            <Parrafo>
              Amazon usa la valoración de vendedor para repartir la Buy Box, y el comprador la ve antes de pagar. En rojo, los periodos con un {UMBRALES.negativas} % de negativas o
              más (con {UMBRALES.minValoraciones} valoraciones o más).
            </Parrafo>
            {informe.ultimasOpiniones.length > 0 && (
              <ul className="mt-7 space-y-3">
                <Vineta fuerte="Últimas valoraciones:">{informe.ultimasOpiniones.map((o) => `${o.estrellas}★ (${fechaCorta(o.fecha)})`).join(' · ')}</Vineta>
              </ul>
            )}
          </Revelar>
          <Revelar retraso={150}>
            <Ventana titulo="Valoraciones de vendedor · Amazon.es">
              <div className="space-y-2">
                {informe.valoraciones.map((v) => {
                  const mal = (v.numero ?? 0) >= UMBRALES.minValoraciones && (v.negativas ?? 0) >= UMBRALES.negativas
                  return (
                    <Fila key={v.periodo} className="grid grid-cols-[1fr_auto_auto] items-center gap-4">
                      <span className="font-medium text-white">{v.periodo}</span>
                      <span className="tabular-nums" style={{ color: 'rgba(255,255,255,0.55)' }}>
                        {entero(v.numero)} val.
                      </span>
                      {v.numero ? (
                        <Pastilla tono={mal ? 'mal' : (v.numero ?? 0) < UMBRALES.minValoraciones ? 'gris' : 'bien'}>
                          {v.positivas} % · {v.negativas} % neg.
                        </Pastilla>
                      ) : (
                        <Pastilla tono="gris">Sin valoraciones</Pastilla>
                      )}
                    </Fila>
                  )
                })}
              </div>
            </Ventana>
          </Revelar>
        </div>
      </Seccion>

      {/* ---------- por dónde empezaríamos ---------- */}
      {informe.plan.length > 0 && (
        <Seccion id="plan" alterna reticula>
          <Halo className="-left-32 top-1/3 h-[420px] w-[420px]" fuerza={0.1} />
          <Revelar>
            <Etiqueta centro>Por dónde empezaríamos</Etiqueta>
            <H2 centro>Primero lo que corta ventas, después crecer</H2>
            <Parrafo centro>
              El orden en que trabajaríamos esta cuenta con lo que vemos desde fuera. Con acceso a Seller Central se ajusta a tus ventas y márgenes reales.
            </Parrafo>
          </Revelar>
          <div className="relative mt-16 grid gap-4 lg:grid-cols-3">
            <div aria-hidden className="absolute left-0 right-0 top-[27px] hidden h-px lg:block" style={{ background: `linear-gradient(90deg, transparent, ${N}, transparent)` }} />
            {informe.plan.map((f, i) => (
              <Revelar key={f.cuando} retraso={i * 160}>
                <div className="relative h-full">
                  <div
                    className="relative z-10 mx-auto flex h-14 w-14 items-center justify-center rounded-full text-[18px] font-extrabold lg:mx-0"
                    style={{ background: FONDO2, border: `1px solid ${N}`, color: N, boxShadow: `0 0 30px rgba(255,102,0,0.35)` }}
                  >
                    {i + 1}
                  </div>
                  <div className="ls-tarjeta mt-6 h-[calc(100%-80px)] rounded-[20px] p-6" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <div className="text-[11.5px] font-bold uppercase tracking-[0.14em]" style={{ color: N }}>
                      {f.cuando}
                    </div>
                    <div className="mt-2 text-[20px] font-semibold leading-snug">{f.titulo}</div>
                    <ul className="mt-4 space-y-2.5">
                      {f.pasos.map((p) => (
                        <li key={p} className="flex gap-2.5 text-[13.5px] leading-relaxed" style={{ color: TEXTO2 }}>
                          <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: N }} strokeWidth={2.6} />
                          {p}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </Revelar>
            ))}
          </div>
        </Seccion>
      )}

      {/* ---------- quiénes somos ---------- */}
      <SeccionClientes />

      <Seccion id="nosotros" alterna>
        <Halo className="left-1/2 top-1/3 h-[420px] w-[720px] -translate-x-1/2" fuerza={0.1} lento />
        <Revelar>
          <Etiqueta centro>Growth partner</Etiqueta>
          <H2 centro>Quién te ha preparado esto</H2>
          <Parrafo centro>Liberty Seller es una agencia que solo trabaja Amazon. Gestionamos cuentas como la tuya, de punta a punta.</Parrafo>
          <div className="mt-8 flex flex-wrap justify-center gap-2.5">
            <Chip icono={<LineChart className="h-4 w-4" />}>7,8 M€+ facturados</Chip>
            <Chip icono={<Users className="h-4 w-4" />}>+20 marcas activas</Chip>
            <Chip icono={<BadgeCheck className="h-4 w-4" />}>Amazon Growth Partner</Chip>
          </div>
        </Revelar>
        <div className="mt-14 grid sm:grid-cols-2 lg:grid-cols-4" style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.10)' }}>
          {(
            [
              [ChartLine, 'Reducción de ACOS', 'Campañas que dejan de gastar en búsquedas sin venta y empujan las que sí venden.'],
              [Search, 'SEO y posicionamiento', 'Títulos, viñetas y palabras clave a partir de lo que de verdad busca el comprador.'],
              [Store, 'Contenido A+ y tienda', 'Fichas y tienda de marca que suben la conversión.'],
              [PackageCheck, 'Logística FBA', 'Envíos planificados para no quedarse sin stock ni pagar almacenaje de más.'],
              [ShieldCheck, 'Protección de marca', 'Registro de Marcas y control de vendedores no autorizados.'],
              [Globe2, 'Expansión europea', 'Francia, Italia, Alemania y Reino Unido con fichas traducidas y su normativa.'],
              [Sparkles, 'Buy Box', 'Precio, logística y reputación para que la venta no se la lleve otro.'],
              [CalendarDays, 'Informes', 'Cada semana sabes qué hemos tocado en tu cuenta y por qué.'],
            ] as const
          ).map(([I, t, d], i) => (
            <Revelar key={t} retraso={(i % 4) * 90}>
              <div className="group h-full px-[30px] py-10 transition-colors hover:bg-white/[0.025]" style={{ border: '1px solid rgba(255,255,255,0.05)' }}>
                <I className="h-6 w-6 transition-transform duration-300 group-hover:scale-110" style={{ color: N }} strokeWidth={2.2} />
                <div className="mt-5 text-[18px] font-semibold leading-snug">{t}</div>
                <p className="mt-2 text-[13.5px] leading-relaxed" style={{ color: TEXTO2 }}>
                  {d}
                </p>
              </div>
            </Revelar>
          ))}
        </div>
      </Seccion>

      {/* ---------- llamada ---------- */}
      <section id="contacto" className="relative overflow-hidden px-4 py-24 sm:px-8 sm:py-32" style={{ background: FONDO2, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <div aria-hidden className="ls-reticula pointer-events-none absolute inset-0" />
        <Halo className="left-1/2 top-1/2 h-[520px] w-[820px] -translate-x-1/2 -translate-y-1/2" fuerza={0.16} />
        <Revelar>
          <div
            className="relative mx-auto max-w-[860px] rounded-[28px] px-6 py-12 sm:px-14 sm:py-16"
            style={{
              background: 'rgba(255,255,255,0.025)',
              border: '1px solid rgba(255,255,255,0.10)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,255,255,0.03)',
              backdropFilter: 'blur(50px) saturate(1.2)',
              WebkitBackdropFilter: 'blur(50px) saturate(1.2)',
            }}
          >
            <div className="text-center">
              <Etiqueta centro>Siguiente paso</Etiqueta>
              <h2 className="mt-4 text-[32px] font-extrabold leading-[1.05] tracking-[-0.035em] sm:text-[44px]">
                Esto es lo que se ve desde fuera.
                <span className="ls-texto-degradado block">Lo de dentro, en una llamada.</span>
              </h2>
              <p className="mx-auto mt-5 max-w-[560px] text-[15.5px] leading-relaxed" style={{ color: TEXTO2 }}>
                Escribe o llama a {nombreComercial} y lo vemos juntos: con un acceso de solo lectura a Seller Central completamos el diagnóstico con lo que este análisis no
                puede ver. Sin compromiso: si no hay recorrido, te lo diremos.
              </p>
            </div>
            <div className="mx-auto mt-9 grid max-w-[620px] gap-2.5 sm:grid-cols-2">
              {[
                [Eye, 'Ventas y márgenes reales por producto'],
                [ChartLine, 'Publicidad: qué gasta y qué vende'],
                [ShieldCheck, 'Salud de la cuenta y avisos de Amazon'],
                [Boxes, 'Inventario parado y costes de almacenaje'],
              ].map(([I, t]) => {
                const Icono = I as typeof Eye
                return (
                  <div key={t as string} className="flex items-center gap-3 rounded-xl px-4 py-3 text-[13.5px]" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                    <Icono className="h-4 w-4 shrink-0" style={{ color: N }} />
                    {t as string}
                  </div>
                )
              })}
            </div>
            <div className="mt-10 text-center">
              {contacto && (
                <div className="mx-auto mb-6 flex w-fit items-center gap-3 rounded-full py-1.5 pl-1.5 pr-5" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)' }}>
                  <span className="flex h-10 w-10 items-center justify-center rounded-full text-[15px] font-extrabold text-white" style={{ background: `linear-gradient(135deg, ${N}, ${N2})` }}>
                    {contacto.nombre.charAt(0).toUpperCase()}
                  </span>
                  <span className="text-left">
                    <span className="block text-[14px] font-semibold text-white">{contacto.nombre}</span>
                    <span className="block text-[12px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
                      Tu contacto en Liberty Seller{telefono ? ` · ${telefono}` : ''}
                    </span>
                  </span>
                </div>
              )}
              <div className="flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
                {urlWhatsapp && (
                  <a
                    href={urlWhatsapp}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ls-boton inline-flex items-center justify-center gap-2.5 rounded-xl px-8 py-4 text-[14px] font-bold uppercase tracking-[0.06em] text-white transition-transform hover:-translate-y-0.5"
                    style={{ background: N, boxShadow: '0 12px 40px rgba(255,102,0,0.45)' }}
                  >
                    <IconoWhatsapp className="h-5 w-5" /> Más información por WhatsApp
                  </a>
                )}
                {urlLlamar && (
                  <a
                    href={urlLlamar}
                    className="inline-flex items-center justify-center gap-2.5 rounded-xl bg-white px-8 py-4 text-[14px] font-bold uppercase tracking-[0.06em] text-black transition-transform hover:-translate-y-0.5"
                  >
                    <Phone className="h-[18px] w-[18px]" /> Llamar a {nombreComercial}
                  </a>
                )}
                {!urlWhatsapp && !urlLlamar && (
                  <span className="text-[14px]" style={{ color: TEXTO2 }}>
                    Responde al correo con el que te llegó este análisis y te llamamos.
                  </span>
                )}
              </div>
              <div className="mt-5 flex items-center justify-center gap-2 text-[12px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
                <Lock className="h-3.5 w-3.5" /> Datos del {fechaLarga(informe.fecha)}. Amazon cambia cada semana.
              </div>
            </div>
          </div>
        </Revelar>
      </section>

      {/* ---------- método ---------- */}
      <footer className="px-4 pb-28 pt-12 sm:px-8 sm:pb-12" style={{ background: '#050505', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="mx-auto grid max-w-[1130px] gap-8 text-[12.5px] leading-relaxed sm:grid-cols-[auto_1fr]" style={{ color: 'rgba(255,255,255,0.45)' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logos/logo.png" alt="Liberty Seller" className="h-5 w-auto opacity-80" />
          <div>
            <div className="mb-1.5 font-semibold text-white">Cómo se ha hecho este análisis</div>
            <p>
              Con datos públicos de Amazon recogidos el {fechaLarga(informe.fecha)}: el perfil de vendedor, tu escaparate y las fichas de tus productos en Amazon.es, y tu
              perfil en Amazon.fr, .it, .de y .co.uk. La Buy Box, las roturas de stock y el ranking son de los últimos 90 días; los días sin stock y las visitas que compran a
              otro vendedor se calculan a partir de esos porcentajes. No tenemos acceso a tu Seller Central, así que no vemos ventas reales, márgenes ni publicidad.{' '}
              <a href={vendedor.url} target="_blank" rel="noopener noreferrer" className="underline hover:text-white">
                Ver tu perfil en Amazon
              </a>
              .
            </p>
          </div>
        </div>
      </footer>

      {/* ---------- botón fijo en móvil ---------- */}
      <div
        className="fixed inset-x-0 bottom-0 z-50 p-3 sm:hidden"
        style={{
          transform: pasadaPortada ? 'none' : 'translateY(120%)',
          transition: 'transform .45s cubic-bezier(.2,.7,.2,1)',
          background: 'linear-gradient(0deg, rgba(8,8,8,0.95) 60%, transparent)',
        }}
      >
        <div className="flex gap-2">
          {urlWhatsapp && (
            <a
              href={urlWhatsapp}
              target="_blank"
              rel="noopener noreferrer"
              className="ls-boton flex flex-1 items-center justify-center gap-2 rounded-xl py-3.5 text-[13px] font-bold uppercase tracking-[0.04em] text-white"
              style={{ background: N, boxShadow: '0 10px 30px rgba(255,102,0,0.4)' }}
            >
              <IconoWhatsapp className="h-4 w-4" /> WhatsApp
            </a>
          )}
          {urlLlamar && (
            <a href={urlLlamar} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-white py-3.5 text-[13px] font-bold uppercase tracking-[0.04em] text-black">
              <Phone className="h-4 w-4" /> Llamar
            </a>
          )}
          {!urlWhatsapp && !urlLlamar && (
            <a href="#contacto" className="flex flex-1 items-center justify-center gap-2 rounded-xl py-3.5 text-[13px] font-bold uppercase text-white" style={{ background: N }}>
              Contactar <ArrowRight className="h-4 w-4" />
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
