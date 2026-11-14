'use client'

/**
 * «LO QUE HACEMOS CADA SEMANA»: el bloque de las dos páginas públicas del informe (vendedores de Amazon y tiendas sin Amazon) que enseña
 * el trabajo de verdad de la agencia: precios dinámicos, auditoría de catálogo, SEO y PPC medidos cada semana y seguimiento del BSR.
 *
 * Es autónomo: su CSS va dentro (prefijo `ps-`) y no depende de ninguna de las dos páginas, que tienen estilos distintos. Los dibujos VIVEN en bucle
 * (un punto que recorre el precio, un radar que barre el catálogo, barras y líneas que se repiten, un aviso cuando cae el ranking) y la tira de arriba
 * corre sola. Se pausa lo que no se ve y todo se apaga con «reducir movimiento».
 *
 * Los dibujos son ILUSTRACIONES de cómo se mide (sin ejes ni cifras inventadas); las cifras de las etiquetas con borde naranja son las REALES del
 * informe y solo aparecen si existen. Nada aquí promete un resultado.
 */
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'

export type DatosPrograma = {
  /** Su Buy Box (% del tiempo, 90 días), si es vendedor de Amazon */
  buyBox?: number | null
  /** Productos que hay en su web y los que ya vende en Amazon (tiendas sin Amazon) */
  catalogo?: { web: number; vendiendo: number } | null
  /** Productos suyos que hemos revisado en Amazon (vendedores de Amazon) */
  productos?: number | null
  /** Títulos revisados y los que se salen de la norma de Amazon (vendedores de Amazon) */
  seo?: { revisados: number; fuera: number } | null
  /** Su mejor ficha ahora mismo (vendedores de Amazon) */
  bsr?: { ranking: number; categoria: string | null } | null
  /** Para las tiendas sin Amazon: el precio mediano del producto que más se vende de lo suyo */
  precioMercado?: number | null
}

const CSS = `
.ps{--n:#FF6600;--n2:#FF8A3D;--t2:rgba(255,255,255,.66);position:relative;margin-top:56px;text-align:left}
.ps *{box-sizing:border-box}
.ps-cab,.ps-tira,.ps-rej,.ps-base,.ps-pie{position:relative;z-index:1}
.ps-orbe{position:absolute;border-radius:50%;filter:blur(100px);pointer-events:none;z-index:0;animation:ps-flota 14s ease-in-out infinite}
.ps-cab{max-width:760px}
.ps-et{display:flex;align-items:center;gap:8px;color:var(--n);font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.14em}
.ps-et i{width:6px;height:6px;border-radius:50%;background:var(--n);box-shadow:0 0 10px var(--n);animation:ps-latido 2.4s ease-in-out infinite}
.ps h3{font-size:36px;line-height:1.08;letter-spacing:-.035em;font-weight:800;margin:12px 0 0;color:#fff}
.ps h3 span{background:linear-gradient(90deg,#FF6600,#FFB27A,#FF6600,#FFB27A,#FF6600);background-size:250% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:ps-brillo 6s linear infinite}
.ps-sub{color:var(--t2);font-size:15.5px;line-height:1.6;margin:14px 0 0;max-width:640px}

/* tira de actividad que corre sola */
.ps-tira{margin-top:26px;overflow:hidden;border-radius:12px;background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.07);-webkit-mask-image:linear-gradient(90deg,transparent,#000 7%,#000 93%,transparent);mask-image:linear-gradient(90deg,transparent,#000 7%,#000 93%,transparent)}
.ps-tira>div{display:flex;gap:10px;width:max-content;padding:10px 0;animation:ps-tira 46s linear infinite}
.ps-tira:hover>div{animation-play-state:paused}
.ps-ev{display:inline-flex;align-items:center;gap:8px;white-space:nowrap;font-size:12.5px;font-weight:600;color:rgba(255,255,255,.78);padding:6px 12px;border-radius:99px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07)}
.ps-ev i{width:7px;height:7px;border-radius:50%;background:var(--c,#FF6600);box-shadow:0 0 9px var(--c,#FF6600)}
.ps-ev small{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.4)}

.ps-rej{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:16px}
.ps-tx{min-width:0;position:relative;z-index:1}
.ps-car{position:relative;border-radius:20px;padding:20px 20px 18px;background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.015));border:1px solid rgba(255,255,255,.09);overflow:hidden;transition:border-color .3s,transform .3s,box-shadow .3s}
.ps-car:hover{border-color:rgba(255,102,0,.5);transform:translateY(-3px);box-shadow:0 24px 60px rgba(0,0,0,.45),0 0 40px rgba(255,102,0,.08)}
.ps-car:before{content:"";position:absolute;left:0;right:0;top:0;height:1px;background:linear-gradient(90deg,transparent,rgba(255,102,0,.9),transparent);opacity:0;transition:opacity .4s}
.ps-car:hover:before{opacity:1}
.ps-car:after{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(380px circle at var(--mx,50%) var(--my,0%),rgba(255,102,0,.14),transparent 62%);opacity:0;transition:opacity .35s}
.ps-car:hover:after{opacity:1}
@media(min-width:1000px){.ps-car{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.25fr);column-gap:20px;align-items:center}}
.ps-top{display:flex;align-items:center;justify-content:space-between;gap:10px}
.ps-num{font-size:11px;font-weight:800;letter-spacing:.14em;color:var(--n)}
.ps-viv{display:inline-flex;align-items:center;gap:6px;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.5)}
.ps-viv i{width:6px;height:6px;border-radius:50%;background:#4ADE80;box-shadow:0 0 8px #4ADE80;animation:ps-latido 2s ease-in-out infinite}
.ps-car h4{font-size:20px;font-weight:700;letter-spacing:-.02em;margin:8px 0 0;color:#fff}
.ps-car p{margin:6px 0 0;font-size:13.5px;line-height:1.55;color:var(--t2)}
.ps-vis{position:relative;margin:14px 0 0;border-radius:14px;background:radial-gradient(120% 120% at 50% 0%,rgba(255,102,0,.07),rgba(0,0,0,.4) 60%);border:1px solid rgba(255,255,255,.07);padding:8px 8px 4px;z-index:1}
@media(min-width:1000px){.ps-vis{margin:0}}
.ps-vis svg{display:block;width:100%;height:auto;overflow:visible}
.ps-vis text{font-family:inherit;font-size:9px;font-weight:700;letter-spacing:.06em;fill:rgba(255,255,255,.42);text-transform:uppercase}
.ps-vis .or{fill:var(--n2)}
.ps-demo{position:absolute;right:10px;top:8px;font-size:8.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.3)}
.ps-dato{display:inline-flex;align-items:baseline;gap:7px;margin-top:10px;padding:7px 11px;border-radius:9px;background:rgba(255,102,0,.09);border:1px solid rgba(255,102,0,.3);font-size:12.5px;color:rgba(255,255,255,.8);box-shadow:0 0 24px rgba(255,102,0,.08)}
.ps-dato b{white-space:nowrap;font-size:15px;font-weight:800;color:var(--n2);font-variant-numeric:tabular-nums}
.ps-pie{margin:16px 0 0;font-size:11.5px;line-height:1.55;color:rgba(255,255,255,.38)}
.ps-base{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
.ps-base span{font-size:12px;font-weight:600;padding:7px 12px;border-radius:99px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);color:rgba(255,255,255,.75);transition:border-color .25s,color .25s}
.ps-base span:hover{border-color:rgba(255,102,0,.5);color:#fff}
.ps-base em{font-style:normal;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.4);align-self:center;margin-right:2px}

/* dibujos */
.ps-cel{fill:rgba(255,255,255,.05);stroke:rgba(255,255,255,.14);stroke-width:1}
.ps-cel.v{fill:rgba(255,102,0,.85);stroke:#FF8A3D}
.ps-cel.e{animation:ps-escaneo 4.2s ease-in-out var(--d,0s) infinite}
.ps-cel.o{animation:ps-oportunidad 2.2s ease-in-out var(--d,0s) infinite}
.ps-ping{transform-box:fill-box;transform-origin:center;fill:none;stroke:#FF8A3D;stroke-width:1.4;animation:ps-ping 2.2s ease-out var(--d,0s) infinite;opacity:0}
.ps-haz{animation:ps-haz 4.2s ease-in-out infinite}
.ps-cometa{stroke-dasharray:9 91;animation:ps-cometa 7s linear infinite}
.ps-barra{transform-box:fill-box;transform-origin:50% 100%;animation:ps-barra 7.5s cubic-bezier(.2,.8,.2,1) var(--d,0s) infinite both}
.ps-linea{stroke-dasharray:1;animation:ps-linea 7.5s ease-in-out .5s infinite both}
.ps-chapa{animation:ps-chapa 7.5s ease-in-out infinite both}
.ps-pulso{animation:ps-halo 2.4s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
.ps-aviso{animation:ps-aviso 7s ease-in-out infinite both}

@keyframes ps-latido{0%,100%{opacity:.5;transform:scale(1)}50%{opacity:1;transform:scale(1.3)}}
@keyframes ps-halo{0%,100%{opacity:.55;transform:scale(1)}50%{opacity:0;transform:scale(2.6)}}
@keyframes ps-flota{0%,100%{transform:translate3d(0,0,0) scale(1)}50%{transform:translate3d(40px,-30px,0) scale(1.15)}}
@keyframes ps-brillo{to{background-position:-250% 0}}
@keyframes ps-tira{to{transform:translateX(-50%)}}
@keyframes ps-cometa{from{stroke-dashoffset:9}to{stroke-dashoffset:-91}}
@keyframes ps-haz{0%{transform:translateX(-50px);opacity:0}8%{opacity:1}62%{opacity:1}72%,100%{transform:translateX(335px);opacity:0}}
@keyframes ps-escaneo{0%,6%,24%,100%{fill:rgba(255,255,255,.05);stroke:rgba(255,255,255,.14)}12%{fill:rgba(255,102,0,.3);stroke:#FF8A3D}}
@keyframes ps-oportunidad{0%,100%{fill:rgba(255,102,0,.1);stroke:rgba(255,102,0,.55)}50%{fill:rgba(255,102,0,.6);stroke:#FF8A3D}}
@keyframes ps-ping{0%{opacity:.9;transform:scale(.6)}100%{opacity:0;transform:scale(2.4)}}
@keyframes ps-barra{0%{transform:scaleY(0);opacity:1}14%{transform:scaleY(1)}86%{transform:scaleY(1);opacity:1}100%{transform:scaleY(1);opacity:0}}
@keyframes ps-linea{0%{stroke-dashoffset:1;opacity:1}46%{stroke-dashoffset:0}86%{stroke-dashoffset:0;opacity:1}100%{stroke-dashoffset:0;opacity:0}}
@keyframes ps-chapa{0%,44%{opacity:0;transform:translateY(6px)}56%,86%{opacity:1;transform:none}100%{opacity:0}}
@keyframes ps-aviso{0%,46%{opacity:0;transform:translateY(5px) scale(.9)}54%,66%{opacity:1;transform:none}74%,100%{opacity:0}}
@media(max-width:820px){
  .ps h3{font-size:28px}
  .ps-rej{grid-template-columns:minmax(0,1fr)}
}
@media(prefers-reduced-motion:reduce){
  .ps *{animation:none!important;transition:none!important}
  .ps-linea{stroke-dasharray:none}
  .ps-chapa,.ps-aviso{opacity:1}
}
`

const ent = (n: number) => Math.round(n).toLocaleString('es-ES')

/** Un número que sube hasta su valor real la primera vez que se ve */
function Num({ n, prefix = '' }: { n: number; prefix?: string }) {
  const ref = useRef<HTMLElement | null>(null)
  const [v, setV] = useState(n)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    let raf = 0
    const io = new IntersectionObserver(
      (es) => {
        if (!es[0]?.isIntersecting) return
        io.disconnect()
        const t0 = performance.now()
        const tick = (t: number) => {
          const k = Math.min(1, Math.max(0, (t - t0) / 1400))
          setV(Math.round(n * (1 - Math.pow(1 - k, 3))))
          if (k < 1) raf = requestAnimationFrame(tick)
        }
        setV(0)
        raf = requestAnimationFrame(tick)
      },
      { threshold: 0.6 },
    )
    io.observe(el)
    return () => {
      io.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [n])
  return (
    <b ref={ref}>
      {prefix}
      {ent(v)}
    </b>
  )
}

const STEPS = 'M8,72 H58 V60 H108 V74 H158 V56 H208 V68 H258 V50 H312'
const BSR = 'M8,100 C34,98 52,88 76,90 S112,96 132,78 S164,70 178,84 S206,62 232,52 S280,36 312,22'

/** 1 · Precio dinámico: un punto recorre el precio escalonado (con estela) y gana la Buy Box cuando compensa */
function DibujoPrecios({ calma }: { calma: boolean }) {
  return (
    <svg viewBox="0 0 320 128" role="img" aria-label="Ilustración: el precio se ajusta solo dentro de la banda de margen y gana la Buy Box">
      <defs>
        <linearGradient id="psp-b" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FF6600" stopOpacity=".2" />
          <stop offset="1" stopColor="#FF6600" stopOpacity=".03" />
        </linearGradient>
        <filter id="psp-g" x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur stdDeviation="2.6" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {[20, 50, 80, 110].map((y) => <line key={y} x1="8" y1={y} x2="312" y2={y} stroke="rgba(255,255,255,.05)" />)}
      <rect x="8" y="30" width="304" height="62" rx="6" fill="url(#psp-b)" />
      <line x1="8" y1="30" x2="312" y2="30" stroke="rgba(255,102,0,.4)" strokeDasharray="3 4" />
      <line x1="8" y1="92" x2="312" y2="92" stroke="rgba(255,102,0,.4)" strokeDasharray="3 4" />
      <text x="12" y="24">tu precio máximo</text>
      <text x="12" y="106">tu margen mínimo</text>
      <path d="M8,62 C44,34 74,84 118,60 S196,36 226,66 S286,82 312,50" fill="none" stroke="rgba(255,255,255,.38)" strokeWidth="1.5" />
      <path d={STEPS} fill="none" stroke="#FF6600" strokeOpacity=".55" strokeWidth="2.2" strokeLinejoin="round" />
      <path className="ps-cometa" pathLength={100} d={STEPS} fill="none" stroke="#FFB27A" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" filter="url(#psp-g)" />
      {calma ? (
        <circle cx="312" cy="50" r="4.5" fill="#fff" />
      ) : (
        <g>
          <circle r="11" fill="#FF6600" className="ps-pulso" opacity=".5" />
          <circle r="4.6" fill="#fff" />
          <g>
            <rect x="9" y="-26" width="62" height="16" rx="5" fill="rgba(74,222,128,.14)" stroke="rgba(74,222,128,.7)" />
            <text x="40" y="-15" textAnchor="middle" style={{ fill: '#4ADE80' }}>buy box ✓</text>
            <animate attributeName="opacity" dur="7s" repeatCount="indefinite" values="0;0;1;1;0;0;1;1;0;0;1;1;0" keyTimes="0;.08;.14;.28;.34;.42;.48;.62;.68;.76;.82;.95;1" />
          </g>
          <animateMotion dur="7s" repeatCount="indefinite" path={STEPS} />
        </g>
      )}
      <circle cx="14" cy="119" r="3" fill="#FF6600" />
      <text x="22" y="122">tu precio</text>
      <circle cx="92" cy="119" r="3" fill="rgba(255,255,255,.45)" />
      <text x="100" y="122">competencia</text>
    </svg>
  )
}

/** 2 · Auditoría de catálogo: un radar barre la parrilla; lo que está sin vender parpadea y lanza un aviso */
function DibujoCatalogo({ vendiendoPct }: { vendiendoPct: number }) {
  const COLS = 10
  const FILAS = 4
  const total = COLS * FILAS
  const vivas = Math.round(total * vendiendoPct)
  const oportunidades = new Set<number>()
  for (let i = vivas + 2, c = 0; i < total && c < 6; i += 6, c++) oportunidades.add(i)
  return (
    <svg viewBox="0 0 320 128" role="img" aria-label="Ilustración: un radar recorre el catálogo y marca lo que está sin vender">
      <defs>
        <clipPath id="psc-c"><rect x="0" y="0" width="320" height="108" /></clipPath>
        <linearGradient id="psc-h" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#FF6600" stopOpacity="0" />
          <stop offset="1" stopColor="#FF8A3D" stopOpacity=".55" />
        </linearGradient>
      </defs>
      {Array.from({ length: total }, (_, i) => {
        const col = i % COLS
        const x = 8 + col * 31
        const y = 6 + Math.floor(i / COLS) * 25
        const viva = i < vivas
        const op = oportunidades.has(i)
        const cls = `ps-cel${viva ? ' v' : op ? ' o' : ' e'}`
        return (
          <g key={i}>
            <rect className={cls} x={x} y={y} width="25" height="19" rx="4" style={{ ['--d' as string]: `${op ? (i % 5) * 0.3 : col * 0.28}s` } as CSSProperties} />
            {op && <rect className="ps-ping" x={x} y={y} width="25" height="19" rx="4" style={{ ['--d' as string]: `${(i % 5) * 0.3}s` } as CSSProperties} />}
          </g>
        )
      })}
      <g clipPath="url(#psc-c)"><rect className="ps-haz" x="0" y="0" width="42" height="108" fill="url(#psc-h)" /></g>
      <rect x="8" y="109" width="9" height="9" rx="2" fill="rgba(255,102,0,.85)" />
      <text x="22" y="117">ya se vende</text>
      <rect x="100" y="109" width="9" height="9" rx="2" fill="rgba(255,102,0,.25)" stroke="#FF8A3D" />
      <text x="114" y="117">oportunidad sin vender</text>
    </svg>
  )
}

/** 3 · SEO y PPC cada semana: el gasto por venta baja y las palabras suben, en bucle */
function DibujoSeoPpc({ calma }: { calma: boolean }) {
  const barras = [78, 72, 68, 58, 54, 46, 42, 36]
  const RANK = 'M27,78 C60,76 80,70 101,66 S150,54 175,46 S235,30 285,16'
  return (
    <svg viewBox="0 0 320 128" role="img" aria-label="Ilustración: el gasto en publicidad por venta baja y las palabras clave suben, semana a semana">
      <defs>
        <linearGradient id="psg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FF8A3D" />
          <stop offset="1" stopColor="#FF6600" stopOpacity=".4" />
        </linearGradient>
        <filter id="pss-g" x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur stdDeviation="2.2" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <line x1="8" y1="96" x2="312" y2="96" stroke="rgba(255,255,255,.12)" />
      {barras.map((h, i) => (
        <rect key={i} className="ps-barra" x={16 + i * 37} y={96 - h} width="22" height={h} rx="4" fill="url(#psg)" style={{ ['--d' as string]: `${i * 0.12}s` } as CSSProperties} />
      ))}
      <path className="ps-linea" pathLength={1} d={RANK} fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" filter="url(#pss-g)" />
      {!calma && (
        <g>
          <circle r="9" fill="#fff" className="ps-pulso" opacity=".4" />
          <circle r="3.8" fill="#fff" />
          <animateMotion dur="7.5s" repeatCount="indefinite" path={RANK} keyPoints="0;1;1" keyTimes="0;.46;1" calcMode="linear" />
        </g>
      )}
      {barras.map((_, i) => (
        <text key={i} x={27 + i * 37} y="109" textAnchor="middle">S{i + 1}</text>
      ))}
      <g className="ps-chapa">
        <rect x="236" y="62" width="70" height="15" rx="5" fill="rgba(74,222,128,.14)" stroke="rgba(74,222,128,.7)" />
        <text x="271" y="72.5" textAnchor="middle" style={{ fill: '#4ADE80' }}>acos ↓ · palabras ↑</text>
      </g>
      <rect x="8" y="116" width="9" height="7" rx="2" fill="#FF6600" />
      <text x="22" y="122">gasto por venta (ACOS)</text>
      <circle cx="170" cy="119.5" r="3" fill="#fff" />
      <text x="178" y="122">posición de tus palabras</text>
    </svg>
  )
}

/** 4 · BSR: un punto recorre el ranking cada día; cuando cae, salta el aviso */
function DibujoBsr({ calma }: { calma: boolean }) {
  return (
    <svg viewBox="0 0 320 128" role="img" aria-label="Ilustración: el ranking de un producto vigilado cada día, con un aviso cuando cae">
      <defs>
        <linearGradient id="psa" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FF6600" stopOpacity=".4" />
          <stop offset="1" stopColor="#FF6600" stopOpacity="0" />
        </linearGradient>
        <filter id="psb-g" x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur stdDeviation="2.6" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {[30, 62, 94].map((y) => <line key={y} x1="8" y1={y} x2="312" y2={y} stroke="rgba(255,255,255,.06)" />)}
      <path d={`${BSR} V112 H8 Z`} fill="url(#psa)" />
      <path d={BSR} fill="none" stroke="#FF6600" strokeOpacity=".6" strokeWidth="2.2" strokeLinecap="round" />
      <path className="ps-cometa" pathLength={100} d={BSR} fill="none" stroke="#FFB27A" strokeWidth="3.4" strokeLinecap="round" filter="url(#psb-g)" />
      <circle cx="178" cy="84" r="8" fill="none" stroke="#F87171" strokeWidth="1.5" opacity=".7" />
      <g className="ps-aviso">
        <rect x="124" y="96" width="108" height="17" rx="6" fill="rgba(248,113,113,.15)" stroke="rgba(248,113,113,.65)" />
        <text x="178" y="108" textAnchor="middle" style={{ fill: '#F87171' }}>aviso: el ranking cae</text>
      </g>
      {calma ? (
        <circle cx="312" cy="22" r="4.5" fill="#fff" />
      ) : (
        <g>
          <circle r="11" fill="#FF6600" className="ps-pulso" opacity=".5" />
          <circle r="4.6" fill="#fff" />
          <animateMotion dur="7s" repeatCount="indefinite" path={BSR} />
        </g>
      )}
      <text x="12" y="24">mejor ranking ↑</text>
    </svg>
  )
}

const EVENTOS: { c: string; t: string; k: string }[] = [
  { c: '#FF6600', k: 'precio', t: 'Precio ajustado dentro del margen' },
  { c: '#4ADE80', k: 'buy box', t: 'Buy Box recuperada' },
  { c: '#FFB27A', k: 'catálogo', t: 'Producto sin vender detectado' },
  { c: '#FF6600', k: 'seo', t: 'Palabra nueva entra en el top 10' },
  { c: '#F87171', k: 'ppc', t: 'Campaña pausada: gasta y no vende' },
  { c: '#4ADE80', k: 'ranking', t: 'Un producto sube en su categoría' },
  { c: '#FFB27A', k: 'informe', t: 'Informe del lunes enviado' },
  { c: '#FF6600', k: 'stock', t: 'Aviso: stock bajo antes de agotarse' },
]

function Tarjeta({ num, ritmo, titulo, texto, dibujo, children }: { num: string; ritmo: string; titulo: string; texto: string; dibujo: ReactNode; children?: ReactNode }) {
  // Foco de luz que sigue al ratón dentro de la tarjeta
  const seguir = (e: PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`)
    e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`)
  }
  return (
    <article className="ps-car" onPointerMove={seguir}>
      <div className="ps-tx">
        <div className="ps-top">
          <span className="ps-num">{num}</span>
          <span className="ps-viv"><i />{ritmo}</span>
        </div>
        <h4>{titulo}</h4>
        <p>{texto}</p>
        {children}
      </div>
      <div className="ps-vis">
        <span className="ps-demo">ejemplo</span>
        {dibujo}
      </div>
    </article>
  )
}

export function ProgramaSemanal({ datos, contexto }: { datos?: DatosPrograma; contexto: 'amazon' | 'sin-amazon' }) {
  const [calma, setCalma] = useState(false)
  useEffect(() => {
    setCalma(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  }, [])

  const d = datos ?? {}
  const cat = d.catalogo
  const vendiendoPct = cat && cat.web > 0 ? Math.min(1, cat.vendiendo / cat.web) : contexto === 'sin-amazon' ? 0 : 0.35
  const sinVender = cat ? Math.max(0, cat.web - cat.vendiendo) : null
  const tira = [...EVENTOS, ...EVENTOS]

  return (
    <div className="ps">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div aria-hidden className="ps-orbe" style={{ left: -120, top: 40, width: 380, height: 380, background: 'rgba(255,102,0,.13)' }} />
      <div aria-hidden className="ps-orbe" style={{ right: -140, bottom: 60, width: 420, height: 420, background: 'rgba(255,138,61,.09)', animationDelay: '-6s' }} />

      <div className="ps-cab">
        <div className="ps-et"><i />Lo que hacemos cada semana</div>
        <h3>
          Tu cuenta, vigilada cada día. <span>Mejorada cada semana.</span>
        </h3>
        <p className="ps-sub">No es un informe y adiós: es un sistema que mide, ajusta y te cuenta qué ha movido.</p>
      </div>

      <div className="ps-tira" aria-label="Ejemplos de lo que ocurre en una cuenta cada semana">
        <div>
          {tira.map((e, i) => (
            <span className="ps-ev" key={i} style={{ ['--c' as string]: e.c } as CSSProperties}>
              <i />
              {e.t}
              <small>{e.k}</small>
            </span>
          ))}
        </div>
      </div>

      <div className="ps-rej">
        <Tarjeta num="01 · PRECIOS" ritmo="cada día" titulo="Precios dinámicos" dibujo={<DibujoPrecios calma={calma} />}
          texto="Tu precio se mueve solo dentro del margen que fijas: gana la Buy Box cuando compensa y no regala ni un euro cuando no.">
          {typeof d.buyBox === 'number' ? (
            <div className="ps-dato"><Num n={d.buyBox} /><span> % del tiempo con la Buy Box hoy</span></div>
          ) : typeof d.precioMercado === 'number' && d.precioMercado > 0 ? (
            <div className="ps-dato"><b>{d.precioMercado.toLocaleString('es-ES', { maximumFractionDigits: 2 })} €</b> precio mediano hoy en lo tuyo</div>
          ) : null}
        </Tarjeta>

        <Tarjeta num="02 · CATÁLOGO" ritmo="cada mes" titulo="Auditoría de catálogo" dibujo={<DibujoCatalogo vendiendoPct={vendiendoPct} />}
          texto="Cruzamos todo lo que vendes con lo que Amazon demanda y señalamos lo que tienes sin poner a la venta y por dónde lanzarlo primero.">
          {cat && cat.web > 0 ? (
            <div className="ps-dato"><Num n={sinVender ?? cat.web} /><span> {sinVender === 1 ? 'producto de tu web sin vender' : 'productos de tu web sin vender'} en Amazon</span></div>
          ) : typeof d.productos === 'number' && d.productos > 0 ? (
            <div className="ps-dato"><Num n={d.productos} /><span> {d.productos === 1 ? 'producto tuyo revisado' : 'productos tuyos revisados'} en Amazon</span></div>
          ) : null}
        </Tarjeta>

        <Tarjeta num="03 · SEO Y PPC" ritmo="cada lunes" titulo="SEO y publicidad, medidos cada semana" dibujo={<DibujoSeoPpc calma={calma} />}
          texto="Cada lunes sabes qué palabras suben, cuánto gasta cada campaña por venta y qué hemos cambiado en tus fichas para conseguirlo.">
          {d.seo && d.seo.revisados > 0 ? (
            <div className="ps-dato"><Num n={d.seo.fuera} /><span> de {d.seo.revisados} títulos se salen de la norma de Amazon</span></div>
          ) : null}
        </Tarjeta>

        <Tarjeta num="04 · RANKING" ritmo="cada día" titulo="Seguimiento del BSR" dibujo={<DibujoBsr calma={calma} />}
          texto="Vigilamos el ranking de cada producto todos los días. Si cae, lo sabemos antes de que se note en las ventas, y sabemos por qué.">
          {d.bsr ? (
            <div className="ps-dato"><Num n={d.bsr.ranking} prefix="#" /><span> tu mejor ficha{d.bsr.categoria ? ` en ${d.bsr.categoria}` : ''}</span></div>
          ) : null}
        </Tarjeta>
      </div>

      <div className="ps-base">
        <em>Y la base</em>
        <span>Registro de Marca</span>
        <span>Fichas y contenido A+</span>
        <span>Logística FBA</span>
        <span>Expansión europea</span>
      </div>
      <p className="ps-pie">Los dibujos y la tira de arriba ilustran cómo trabajamos; las cifras con borde naranja son las de este análisis.</p>
    </div>
  )
}
