'use client'

/**
 * «LO QUE HACEMOS CADA SEMANA»: el bloque de las dos páginas públicas del informe (vendedores de Amazon y tiendas sin Amazon) que enseña
 * el trabajo de verdad de la agencia: precios dinámicos, auditoría de catálogo, SEO y PPC medidos cada semana y seguimiento del BSR.
 *
 * Es autónomo: su CSS va dentro (prefijo `ps-`) y no depende de ninguna de las dos páginas, que tienen estilos distintos. Se pinta cuando entra en
 * pantalla (IntersectionObserver). Los dibujos son ILUSTRACIONES de cómo se mide (sin ejes ni cifras inventadas); las cifras que salen en las
 * etiquetas son las REALES del informe y solo aparecen si existen. Nada aquí promete un resultado.
 */
import { useEffect, useRef, type ReactNode } from 'react'

export type DatosPrograma = {
  /** Su Buy Box (% del tiempo, 90 días), si es vendedor de Amazon */
  buyBox?: number | null
  /** Productos que hay en su web y los que ya vende en Amazon (tiendas sin Amazon) */
  catalogo?: { web: number; vendiendo: number } | null
  /** Títulos revisados y los que se salen de la norma de Amazon (vendedores de Amazon) */
  seo?: { revisados: number; fuera: number } | null
  /** Productos suyos que hemos revisado en Amazon (vendedores de Amazon) */
  productos?: number | null
  /** Su mejor ficha ahora mismo (vendedores de Amazon) */
  bsr?: { ranking: number; categoria: string | null } | null
  /** Para las tiendas sin Amazon: el precio mediano del producto que más se vende de lo suyo */
  precioMercado?: number | null
}

const CSS = `
.ps{--n:#FF6600;--n2:#FF8A3D;--t2:rgba(255,255,255,.66);margin-top:56px;text-align:left}
.ps *{box-sizing:border-box}
.ps-cab{max-width:760px}
.ps-et{display:flex;align-items:center;gap:8px;color:var(--n);font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.14em}
.ps-et i{width:6px;height:6px;border-radius:50%;background:var(--n);box-shadow:0 0 10px var(--n);animation:ps-latido 2.4s ease-in-out infinite}
.ps h3{font-size:36px;line-height:1.08;letter-spacing:-.035em;font-weight:800;margin:12px 0 0;color:#fff}
.ps h3 span{background:linear-gradient(90deg,var(--n),var(--n2));-webkit-background-clip:text;background-clip:text;color:transparent}
.ps-sub{color:var(--t2);font-size:15.5px;line-height:1.6;margin:14px 0 0;max-width:640px}
.ps-rej{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:30px}
.ps-tx{min-width:0}
@media(min-width:1000px){.ps-car{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.25fr);column-gap:20px;align-items:center}.ps-vis{margin:0}}
.ps-car{position:relative;border-radius:20px;padding:20px 20px 18px;background:linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,.015));border:1px solid rgba(255,255,255,.09);overflow:hidden;transition:border-color .3s,transform .3s}
.ps-car:hover{border-color:rgba(255,102,0,.45);transform:translateY(-3px)}
.ps-car:before{content:"";position:absolute;left:0;right:0;top:0;height:1px;background:linear-gradient(90deg,transparent,rgba(255,102,0,.8),transparent);opacity:0;transition:opacity .4s}
.ps-car:hover:before{opacity:1}
.ps-top{display:flex;align-items:center;justify-content:space-between;gap:10px}
.ps-num{font-size:11px;font-weight:800;letter-spacing:.14em;color:var(--n)}
.ps-viv{display:inline-flex;align-items:center;gap:6px;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.5)}
.ps-viv i{width:6px;height:6px;border-radius:50%;background:#4ADE80;box-shadow:0 0 8px #4ADE80;animation:ps-latido 2s ease-in-out infinite}
.ps-car h4{font-size:20px;font-weight:700;letter-spacing:-.02em;margin:8px 0 0;color:#fff}
.ps-car p{margin:6px 0 0;font-size:13.5px;line-height:1.55;color:var(--t2)}
.ps-vis{margin:14px 0 0;border-radius:12px;background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.06);padding:8px 8px 4px}
.ps-vis svg{display:block;width:100%;height:auto;overflow:visible}
.ps-vis text{font-family:inherit;font-size:9px;font-weight:700;letter-spacing:.06em;fill:rgba(255,255,255,.42);text-transform:uppercase}
.ps-vis .or{fill:var(--n2)}
.ps-dato{display:inline-flex;align-items:baseline;gap:7px;margin-top:10px;padding:7px 11px;border-radius:9px;background:rgba(255,102,0,.09);border:1px solid rgba(255,102,0,.28);font-size:12.5px;color:rgba(255,255,255,.8)}
.ps-dato b{white-space:nowrap;font-size:15px;font-weight:800;color:var(--n2);font-variant-numeric:tabular-nums}
.ps-pie{margin:16px 0 0;font-size:11.5px;line-height:1.55;color:rgba(255,255,255,.38)}
.ps-base{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
.ps-base span{font-size:12px;font-weight:600;padding:7px 12px;border-radius:99px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);color:rgba(255,255,255,.75)}
.ps-base em{font-style:normal;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.4);align-self:center;margin-right:2px}

/* dibujos: arrancan escondidos y se pintan al entrar en pantalla */
.ps-l{stroke-dasharray:1;stroke-dashoffset:1;transition:stroke-dashoffset 1.8s cubic-bezier(.3,.6,.2,1) var(--d,0s)}
.ps-on .ps-l{stroke-dashoffset:0}
.ps-b{transform-box:fill-box;transform-origin:50% 100%;transform:scaleY(0);transition:transform .9s cubic-bezier(.2,.8,.2,1) var(--d,0s)}
.ps-on .ps-b{transform:scaleY(1)}
.ps-p{opacity:0;transform:scale(.4);transform-box:fill-box;transform-origin:center;transition:opacity .5s var(--d,0s),transform .5s var(--d,0s)}
.ps-on .ps-p{opacity:1;transform:none}
.ps-fade{opacity:0;transition:opacity .8s var(--d,0s)}
.ps-on .ps-fade{opacity:1}
.ps-cel{fill:rgba(255,255,255,.05);stroke:rgba(255,255,255,.14);stroke-width:1;transition:fill .5s var(--d,0s),stroke .5s var(--d,0s)}
.ps-on .ps-cel.v{fill:rgba(255,102,0,.85);stroke:var(--n2)}
.ps-cel.o{animation:none}
.ps-on .ps-cel.o{animation:ps-oportunidad 2.4s ease-in-out var(--d,1s) infinite}
.ps-pulso{animation:ps-halo 2.4s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
@keyframes ps-latido{0%,100%{opacity:.5;transform:scale(1)}50%{opacity:1;transform:scale(1.3)}}
@keyframes ps-halo{0%,100%{opacity:.5;transform:scale(1)}50%{opacity:0;transform:scale(2.6)}}
@keyframes ps-oportunidad{0%,100%{fill:rgba(255,102,0,.08);stroke:rgba(255,102,0,.5)}50%{fill:rgba(255,102,0,.55);stroke:#FF8A3D}}
@media(max-width:820px){
  .ps h3{font-size:28px}
  .ps-rej{grid-template-columns:minmax(0,1fr)}
}
@media(prefers-reduced-motion:reduce){
  .ps *{animation:none!important;transition:none!important}
  .ps-l{stroke-dashoffset:0}.ps-b{transform:none}.ps-p,.ps-fade{opacity:1;transform:none}.ps-cel.v{fill:rgba(255,102,0,.85);stroke:var(--n2)}
}
`

const ent = (n: number) => Math.round(n).toLocaleString('es-ES')

/** 1 · Precio dinámico: el precio escalonado dentro de la banda de margen, siempre por debajo del rival cuando se puede */
function DibujoPrecios() {
  return (
    <svg viewBox="0 0 320 128" role="img" aria-label="Ilustración: el precio se ajusta dentro de la banda de margen y por debajo del de la competencia">
      <rect x="8" y="30" width="304" height="62" rx="6" fill="rgba(255,102,0,.07)" />
      <line x1="8" y1="30" x2="312" y2="30" stroke="rgba(255,102,0,.35)" strokeDasharray="3 4" />
      <line x1="8" y1="92" x2="312" y2="92" stroke="rgba(255,102,0,.35)" strokeDasharray="3 4" />
      <text x="12" y="25">tu precio máximo</text>
      <text x="12" y="106">tu margen mínimo</text>
      <path className="ps-l" pathLength={1} d="M8,62 C44,34 74,84 118,60 S196,36 226,66 S286,82 312,50" fill="none" stroke="rgba(255,255,255,.4)" strokeWidth="1.6" strokeDasharray="1" style={{ ['--d' as string]: '.1s' }} />
      <path className="ps-l" pathLength={1} d="M8,72 H58 V60 H108 V74 H158 V56 H208 V68 H258 V50 H312" fill="none" stroke="#FF6600" strokeWidth="2.6" strokeLinejoin="round" style={{ ['--d' as string]: '.35s', filter: 'drop-shadow(0 0 6px rgba(255,102,0,.6))' }} />
      {[
        [58, 60],
        [158, 56],
        [258, 50],
      ].map(([x, y], i) => (
        <g key={x} className="ps-p" style={{ ['--d' as string]: `${1.4 + i * 0.25}s` }}>
          <circle cx={x} cy={y} r="9" fill="#FF6600" className="ps-pulso" opacity=".5" />
          <circle cx={x} cy={y} r="4" fill="#fff" />
        </g>
      ))}
      <text x="316" y="46" textAnchor="end" className="or">Buy Box</text>
      <g className="ps-fade" style={{ ['--d' as string]: '1.2s' }}>
        <circle cx="14" cy="118" r="3" fill="#FF6600" />
        <text x="22" y="121">tu precio</text>
        <circle cx="92" cy="118" r="3" fill="rgba(255,255,255,.45)" />
        <text x="100" y="121">competencia</text>
      </g>
    </svg>
  )
}

/** 2 · Auditoría de catálogo: una parrilla con lo que ya se vende y lo que está sin vender (las oportunidades parpadean) */
function DibujoCatalogo({ vendiendoPct }: { vendiendoPct: number }) {
  const COLS = 10
  const FILAS = 4
  const total = COLS * FILAS
  const vivas = Math.round(total * vendiendoPct)
  // las oportunidades son las primeras celdas apagadas, repartidas
  const oportunidades = new Set<number>()
  for (let i = vivas, c = 0; i < total && c < 6; i += 5, c++) oportunidades.add(i)
  return (
    <svg viewBox="0 0 320 128" role="img" aria-label="Ilustración: el catálogo con lo que se vende y lo que está sin vender">
      {Array.from({ length: total }, (_, i) => {
        const x = 8 + (i % COLS) * 31
        const y = 6 + Math.floor(i / COLS) * 25
        const viva = i < vivas
        const op = oportunidades.has(i)
        return <rect key={i} className={`ps-cel${viva ? ' v' : ''}${op ? ' o' : ''}`} x={x} y={y} width="25" height="19" rx="4" style={{ ['--d' as string]: `${viva ? i * 0.035 : 1.2 + (i % 7) * 0.2}s` }} />
      })}
      <g className="ps-fade" style={{ ['--d' as string]: '1.1s' }}>
        <rect x="8" y="109" width="9" height="9" rx="2" fill="rgba(255,102,0,.85)" />
        <text x="22" y="117">ya se vende</text>
        <rect x="100" y="109" width="9" height="9" rx="2" fill="rgba(255,102,0,.25)" stroke="#FF8A3D" />
        <text x="114" y="117">oportunidad sin vender</text>
      </g>
    </svg>
  )
}

/** 3 · SEO y PPC medidos cada semana: ACOS que baja (barras) y posición de las palabras que sube (línea) */
function DibujoSeoPpc() {
  const barras = [78, 72, 68, 58, 54, 46, 42, 36]
  return (
    <svg viewBox="0 0 320 128" role="img" aria-label="Ilustración: el gasto en publicidad por venta baja y las palabras clave suben, semana a semana">
      <line x1="8" y1="96" x2="312" y2="96" stroke="rgba(255,255,255,.12)" />
      {barras.map((h, i) => (
        <rect key={i} className="ps-b" x={16 + i * 37} y={96 - h} width="22" height={h} rx="4" fill="url(#psg)" style={{ ['--d' as string]: `${i * 0.1}s` }} />
      ))}
      <defs>
        <linearGradient id="psg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FF8A3D" />
          <stop offset="1" stopColor="#FF6600" stopOpacity=".45" />
        </linearGradient>
      </defs>
      <path className="ps-l" pathLength={1} d="M27,78 C60,76 80,70 101,66 S150,54 175,46 S235,30 285,16" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" style={{ ['--d' as string]: '.6s', filter: 'drop-shadow(0 0 5px rgba(255,255,255,.5))' }} />
      <g className="ps-p" style={{ ['--d' as string]: '2.2s' }}>
        <circle cx="285" cy="16" r="9" fill="#fff" className="ps-pulso" opacity=".4" />
        <circle cx="285" cy="16" r="3.8" fill="#fff" />
      </g>
      {barras.map((_, i) => (
        <text key={i} x={27 + i * 37} y="109" textAnchor="middle">
          S{i + 1}
        </text>
      ))}
      <g className="ps-fade" style={{ ['--d' as string]: '1.2s' }}>
        <rect x="8" y="116" width="9" height="7" rx="2" fill="#FF6600" />
        <text x="22" y="122">gasto por venta (ACOS)</text>
        <circle cx="170" cy="119.5" r="3" fill="#fff" />
        <text x="178" y="122">posición de tus palabras</text>
      </g>
    </svg>
  )
}

/** 4 · BSR: la línea del ranking cada día, con el aviso cuando cae */
function DibujoBsr() {
  return (
    <svg viewBox="0 0 320 128" role="img" aria-label="Ilustración: el ranking de un producto vigilado cada día, con un aviso cuando cae">
      <defs>
        <linearGradient id="psa" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FF6600" stopOpacity=".38" />
          <stop offset="1" stopColor="#FF6600" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[30, 62, 94].map((y) => (
        <line key={y} x1="8" y1={y} x2="312" y2={y} stroke="rgba(255,255,255,.07)" />
      ))}
      <path className="ps-fade" style={{ ['--d' as string]: '1s' }} d="M8,100 C34,98 52,88 76,90 S112,96 132,78 S164,70 178,84 S206,62 232,52 S280,36 312,22 V112 H8 Z" fill="url(#psa)" />
      <path className="ps-l" pathLength={1} d="M8,100 C34,98 52,88 76,90 S112,96 132,78 S164,70 178,84 S206,62 232,52 S280,36 312,22" fill="none" stroke="#FF6600" strokeWidth="2.6" strokeLinecap="round" style={{ ['--d' as string]: '.2s', filter: 'drop-shadow(0 0 6px rgba(255,102,0,.6))' }} />
      {/* la caída que dispara el aviso */}
      <g className="ps-p" style={{ ['--d' as string]: '1.1s' }}>
        <circle cx="178" cy="84" r="8" fill="none" stroke="#F87171" strokeWidth="1.6" />
        <circle cx="178" cy="84" r="3" fill="#F87171" />
      </g>
      <g className="ps-fade" style={{ ['--d' as string]: '1.4s' }}>
        <rect x="132" y="102" width="92" height="16" rx="5" fill="rgba(248,113,113,.14)" stroke="rgba(248,113,113,.5)" />
        <text x="178" y="113" textAnchor="middle" fill="#F87171" style={{ fill: '#F87171' }}>aviso: el ranking cae</text>
      </g>
      <g className="ps-p" style={{ ['--d' as string]: '2s' }}>
        <circle cx="312" cy="22" r="10" fill="#FF6600" className="ps-pulso" opacity=".5" />
        <circle cx="312" cy="22" r="4" fill="#fff" />
      </g>
      <text x="12" y="24">mejor ranking ↑</text>
    </svg>
  )
}

function Tarjeta({ num, ritmo, titulo, texto, dibujo, children }: { num: string; ritmo: string; titulo: string; texto: string; dibujo: ReactNode; children?: ReactNode }) {
  return (
    <article className="ps-car">
      <div className="ps-tx">
        <div className="ps-top">
          <span className="ps-num">{num}</span>
          <span className="ps-viv"><i />{ritmo}</span>
        </div>
        <h4>{titulo}</h4>
        <p>{texto}</p>
        {children}
      </div>
      <div className="ps-vis">{dibujo}</div>
    </article>
  )
}

export function ProgramaSemanal({ datos, contexto }: { datos?: DatosPrograma; contexto: 'amazon' | 'sin-amazon' }) {
  const ref = useRef<HTMLDivElement>(null)
  // Cada tarjeta se anima cuando le toca (el bloque entero es muy alto en el móvil y no cabría en un solo umbral)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const piezas = Array.from(el.querySelectorAll<HTMLElement>('.ps-car'))
    if (typeof IntersectionObserver === 'undefined') {
      piezas.forEach((p) => p.classList.add('ps-on'))
      return
    }
    const io = new IntersectionObserver(
      (es) => {
        for (const e of es) {
          if (e.isIntersecting) {
            e.target.classList.add('ps-on')
            io.unobserve(e.target)
          }
        }
      },
      { threshold: 0.2, rootMargin: '0px 0px -8% 0px' },
    )
    piezas.forEach((p) => io.observe(p))
    return () => io.disconnect()
  }, [])

  const d = datos ?? {}
  const cat = d.catalogo
  const vendiendoPct = cat && cat.web > 0 ? Math.min(1, cat.vendiendo / cat.web) : contexto === 'sin-amazon' ? 0 : 0.35
  const sinVender = cat ? Math.max(0, cat.web - cat.vendiendo) : null

  return (
    <div ref={ref} className="ps">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="ps-cab">
        <div className="ps-et">
          <i />
          Lo que hacemos cada semana
        </div>
        <h3>
          Tu cuenta, vigilada cada día. <span>Mejorada cada semana.</span>
        </h3>
        <p className="ps-sub">No es un informe y adiós: es un sistema que mide, ajusta y te cuenta qué ha movido.</p>
      </div>

      <div className="ps-rej">
        <Tarjeta num="01 · PRECIOS" ritmo="cada día" titulo="Precios dinámicos" dibujo={<DibujoPrecios />}
          texto="Tu precio se mueve solo dentro del margen que fijas: gana la Buy Box cuando compensa y no regala ni un euro cuando no.">
          {typeof d.buyBox === 'number' ? (
            <div className="ps-dato"><b>{d.buyBox} %</b> del tiempo con la Buy Box hoy</div>
          ) : typeof d.precioMercado === 'number' && d.precioMercado > 0 ? (
            <div className="ps-dato"><b>{d.precioMercado.toLocaleString('es-ES', { maximumFractionDigits: 2 })} €</b> precio mediano hoy en lo tuyo</div>
          ) : null}
        </Tarjeta>

        <Tarjeta num="02 · CATÁLOGO" ritmo="cada mes" titulo="Auditoría de catálogo" dibujo={<DibujoCatalogo vendiendoPct={vendiendoPct} />}
          texto="Cruzamos todo lo que vendes con lo que Amazon demanda y señalamos lo que tienes sin poner a la venta y por dónde lanzarlo primero.">
          {cat && cat.web > 0 ? (
            <div className="ps-dato"><b>{ent(sinVender ?? cat.web)}</b> {sinVender === 1 ? 'producto de tu web sin vender' : 'productos de tu web sin vender'} en Amazon</div>
          ) : typeof d.productos === 'number' && d.productos > 0 ? (
            <div className="ps-dato"><b>{ent(d.productos)}</b> {d.productos === 1 ? 'producto tuyo revisado' : 'productos tuyos revisados'} en Amazon</div>
          ) : null}
        </Tarjeta>

        <Tarjeta num="03 · SEO Y PPC" ritmo="cada lunes" titulo="SEO y publicidad, medidos cada semana" dibujo={<DibujoSeoPpc />}
          texto="Cada lunes sabes qué palabras suben, cuánto gasta cada campaña por venta y qué hemos cambiado en tus fichas para conseguirlo.">
          {d.seo && d.seo.revisados > 0 ? (
            <div className="ps-dato"><b>{d.seo.fuera} de {d.seo.revisados}</b> títulos se salen de la norma de Amazon</div>
          ) : null}
        </Tarjeta>

        <Tarjeta num="04 · RANKING" ritmo="cada día" titulo="Seguimiento del BSR" dibujo={<DibujoBsr />}
          texto="Vigilamos el ranking de cada producto todos los días. Si cae, lo sabemos antes de que se note en las ventas, y sabemos por qué.">
          {d.bsr ? (
            <div className="ps-dato"><b>#{ent(d.bsr.ranking)}</b> tu mejor ficha{d.bsr.categoria ? ` en ${d.bsr.categoria}` : ''}</div>
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
      <p className="ps-pie">Los dibujos ilustran cómo medimos; las cifras con borde naranja son las de este análisis.</p>
    </div>
  )
}
