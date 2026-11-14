'use client'

/**
 * La página pública del informe de una TIENDA ONLINE QUE NO VENDE EN AMAZON (lib/analisis-sin-amazon). De tú, como el de Amazon,
 * y con su misma cara: fondo #080808, naranja #FF6600, Inter muy gruesa y paneles con forma de ventana.
 *
 * El orden empuja a una conversación: el gancho (su marca ya se vende sin él, o no está) → la prueba (fichas, quién las vende,
 * comprobado por CIF) → lo que se vende de lo suyo y lo que le llegaría por venta → cómo lo haríamos → marcas que ya trabajan con
 * nosotros → hablar con su comercial. Todas las cifras salen del informe; aquí no se calcula nada que no esté en él salvo sumas.
 */
import type { ReactNode } from 'react'
import type { InformeSinAmazon, MercadoSinAmazon, ProductoMini } from '@/lib/analisis-sin-amazon/construir'
import { cuentaDeMercado, depurar } from '@/lib/analisis-sin-amazon/calidad'
import { CLIENTES, type ContactoComercial } from './InformeAnalisis'
import { ProgramaSemanal } from './ProgramaSemanal'

const N = '#FF6600'

const ent = (n: number) => Math.round(n).toLocaleString('es-ES')
const eur = (n: number) => n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const eur0 = (n: number) => Math.round(n).toLocaleString('es-ES') + ' €'
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const fecha = (iso: string) => {
  const [a, m, d] = iso.split('-').map(Number)
  return `${d} de ${MESES[(m ?? 1) - 1]} de ${a}`
}
const enumerar = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`)

const CSS = `
.sa{--n:#FF6600;--n2:#FF8A3D;--t2:rgba(255,255,255,.66);background:#080808;color:#fff;font-family:var(--font-inter),Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased;min-height:100vh;overflow-x:clip}
.sa a{color:inherit;text-decoration:none}
.sa-cab{position:sticky;top:0;z-index:20;background:rgba(8,8,8,.72);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border-bottom:1px solid rgba(255,255,255,.06)}
.sa-cab>div{max-width:1130px;margin:auto;height:64px;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 24px}
.sa-cab img{height:22px;width:auto}
.sa-bt{background:#fff;color:#000!important;font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.02em;padding:10px 16px;border-radius:2px;white-space:nowrap}
.sa-sec{position:relative;padding:96px 24px;border-top:1px solid rgba(255,255,255,.05);overflow:hidden}
.sa-sec.alt{background:#0d0d0d}
.sa-in{max-width:1130px;margin:auto;position:relative}
.sa-ret{position:absolute;inset:0;pointer-events:none;background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);background-size:56px 56px;-webkit-mask-image:radial-gradient(ellipse 70% 60% at 50% 0%,#000 25%,transparent 75%);mask-image:radial-gradient(ellipse 70% 60% at 50% 0%,#000 25%,transparent 75%)}
.sa-halo{position:absolute;border-radius:50%;filter:blur(110px);background:rgba(255,102,0,.16);pointer-events:none;animation:sa-flotar 16s ease-in-out infinite}
@keyframes sa-flotar{0%,100%{transform:translate3d(0,0,0) scale(1)}50%{transform:translate3d(40px,-30px,0) scale(1.12)}}
@keyframes sa-girar{to{transform:translate(-50%,-50%) rotate(360deg)}}
@keyframes sa-latido{0%,100%{opacity:.45;transform:scale(1)}50%{opacity:1;transform:scale(1.35)}}
@keyframes sa-subir{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
.sa-anim{animation:sa-subir .7s cubic-bezier(.2,.7,.2,1) both}
.sa-hero{display:grid;grid-template-columns:minmax(0,1.08fr) minmax(0,1fr);gap:48px;align-items:center}
.sa-hero>*,.sa-dos>*,.sa-col>*,.sa-mcab>*{min-width:0}
.sa-ven{min-width:0;max-width:100%}
.sa-etq{display:flex;align-items:center;gap:8px;color:var(--n);font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.14em}
.sa-etq i{width:6px;height:6px;border-radius:50%;background:var(--n);box-shadow:0 0 10px var(--n);animation:sa-latido 2.4s ease-in-out infinite}
.sa h1{font-size:58px;line-height:1.02;letter-spacing:-.045em;font-weight:800;margin:20px 0 0}
.sa h2{font-size:44px;line-height:1.06;letter-spacing:-.035em;font-weight:800;margin:12px 0 0;max-width:900px}
.sa h3{font-size:28px;letter-spacing:-.03em;font-weight:800;margin:6px 0 0}
.sa-deg{background:linear-gradient(90deg,var(--n),var(--n2));-webkit-background-clip:text;background-clip:text;color:transparent}
.sa h1 .sa-deg{display:block;margin-top:4px}
.sa-par{color:var(--t2);font-size:16px;line-height:1.65;max-width:640px;margin:16px 0 0}
.sa-par b{color:#fff}
.sa-par.chico{font-size:14.5px;margin-top:8px}
.sa-meta{margin-top:20px;color:rgba(255,255,255,.55);font-size:14px;font-weight:500}
.sa-ctas{display:flex;flex-wrap:wrap;gap:10px;margin-top:30px}
.sa-cta{display:inline-flex;gap:8px;align-items:center;background:var(--n);padding:14px 24px;border-radius:12px;font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:.06em;box-shadow:0 10px 30px rgba(255,102,0,.35);transition:transform .2s}
.sa-cta:hover{transform:translateY(-2px)}
.sa-cta.sec{background:transparent;border:1px solid rgba(255,255,255,.16);box-shadow:none}
.sa-ven{border-radius:16px;box-shadow:0 30px 70px rgba(0,0,0,.55)}
.sa-ven>div{border-radius:16px;overflow:hidden;background:#111;border:1px solid rgba(255,255,255,.08)}
.sa-ven.brillo{padding:1px;position:relative;overflow:hidden;background:rgba(255,255,255,.08);box-shadow:0 30px 90px rgba(0,0,0,.6),0 0 60px rgba(255,102,0,.12)}
.sa-ven.brillo:before{content:"";position:absolute;left:50%;top:50%;width:160%;aspect-ratio:1;transform:translate(-50%,-50%);background:conic-gradient(from 0deg,transparent 0deg,var(--n) 40deg,transparent 90deg);animation:sa-girar 6s linear infinite}
.sa-ven.brillo>div{position:relative;border:none}
.sa-vbar{display:flex;gap:12px;align-items:center;padding:11px 14px;background:rgba(255,255,255,.03);border-bottom:1px solid rgba(255,255,255,.06)}
.sa-pts{display:flex;gap:6px}.sa-pts i{width:10px;height:10px;border-radius:50%;opacity:.55}
.sa-vt{font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:rgba(255,255,255,.55);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sa-vc{padding:14px}
.sa-clave{display:grid;grid-template-columns:96px minmax(0,1fr);gap:12px;align-items:center;border-radius:10px;padding:12px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);margin-top:8px}
.sa-clave:first-child{margin-top:0}
.sa-clave b{font-size:24px;font-weight:800;letter-spacing:-.03em;color:var(--n2)}
.sa-clave strong{display:block;font-size:13.5px;font-weight:700}
.sa-clave span{display:block;font-size:12px;color:rgba(255,255,255,.55);margin-top:2px;line-height:1.45}
.sa-datos{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.sa-dato{border-radius:10px;padding:11px 12px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06)}
.sa-dato b{display:block;font-size:21px;font-weight:800;letter-spacing:-.02em}
.sa-dato span{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:rgba(255,255,255,.45)}
.sa-dato.n b{color:var(--n2)}
.sa-prod{display:grid;grid-template-columns:22px 52px minmax(0,1fr) auto;gap:12px;align-items:center;padding:9px 6px;border-bottom:1px solid rgba(255,255,255,.05);transition:background .2s}
.sa-prod:hover{background:rgba(255,255,255,.04)}
.sa-prod:last-child{border-bottom:none}
.sa-prod .num{font-size:12px;font-weight:800;color:rgba(255,255,255,.35);text-align:center}
.sa-prod img,.sa-prod .sin{width:52px;height:52px;object-fit:contain;background:#fff;border-radius:8px}
.sa-pt b{display:block;font-size:12.5px;font-weight:600;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.sa-pt small,.sa-pc small{display:block;margin-top:3px;font-size:11px;color:rgba(255,255,255,.5)}
.sa-pt em{font-style:normal;color:var(--n2);font-weight:600}
.sa-pt em.nadie{color:#F87171}
.sa-pc{text-align:right;white-space:nowrap}.sa-pc b{font-size:14px}.sa-pc small{color:var(--n2);font-weight:600}
.sa-vend{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;margin-top:20px}
.sa-vend>div{border-radius:14px;padding:16px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08)}
.sa-vend b{display:block;font-size:16px;font-weight:800}
.sa-vend span{display:block;font-size:12.5px;color:rgba(255,255,255,.55);margin-top:4px;line-height:1.5}
.sa-pas{display:inline-block;font-size:10.5px;font-weight:700;text-transform:uppercase;padding:3px 8px;border-radius:6px;color:var(--n);background:rgba(255,102,0,.1);border:1px solid rgba(255,102,0,.3);margin-top:10px}
.sa-mer{margin-top:72px}.sa-mer:first-of-type{margin-top:40px}
.sa-mcab{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;margin-bottom:20px;flex-wrap:wrap}
.sa-mcab .sa-datos{min-width:360px}
.sa-mnum{font-size:12px;font-weight:800;color:var(--n);letter-spacing:.1em}
.sa-dos{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:20px;align-items:start}
.sa-col{display:grid;gap:20px}
.sa-suyo small{font-size:10.5px;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.45);font-weight:700}
.sa-suyo b{display:block;margin-top:4px;font-size:14px;line-height:1.35}
.sa-precio{font-size:30px;font-weight:800;letter-spacing:-.03em;margin-top:6px}
.sa-comp{margin:10px 0 8px;font-size:12.5px;color:var(--t2);line-height:1.5}
.sa-comp b{color:#fff}
.sa-barra{height:7px;border-radius:9px;background:rgba(255,255,255,.06);overflow:hidden;margin-bottom:10px}
.sa-barra div{height:100%;border-radius:9px;background:linear-gradient(90deg,var(--n),var(--n2));box-shadow:0 0 18px rgba(255,102,0,.45)}
.sa-cuenta{margin-top:14px;border-top:1px solid rgba(255,255,255,.07);padding-top:10px}
.sa-cuenta div{display:flex;justify-content:space-between;gap:10px;font-size:13px;padding:5px 0;color:var(--t2)}
.sa-cuenta b{color:#fff;font-variant-numeric:tabular-nums;white-space:nowrap}
.sa-cuenta .tot{border-top:1px solid rgba(255,255,255,.1);margin-top:4px;padding-top:9px}
.sa-cuenta .tot span{color:#fff;font-weight:700}.sa-cuenta .tot b{color:var(--n2);font-size:16px}
.sa-nota{font-size:11px;color:rgba(255,255,255,.4);margin:8px 0 0;line-height:1.5}
.sa-marca{display:flex;justify-content:space-between;gap:10px;font-size:13px;margin:6px 0}
.sa-marca b{color:rgba(255,255,255,.7);font-weight:600;white-space:nowrap}
.sa-pasos{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-top:36px}
.sa-paso{border-radius:16px;padding:22px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07)}
.sa-paso i{font-style:normal;font-size:12px;font-weight:800;color:var(--n);letter-spacing:.1em}
.sa-paso b{display:block;font-size:17px;margin:8px 0 6px}
.sa-paso p{margin:0;font-size:14px;line-height:1.6;color:var(--t2)}
.sa-clientes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:40px auto 0;max-width:960px}
.sa-cli{border-radius:20px;padding:20px;background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.08)}
.sa-cli .logo{height:76px;display:flex;align-items:center;justify-content:center}
.sa-cli img{max-height:58px;max-width:85%;object-fit:contain;opacity:.7;filter:grayscale(1);transition:all .4s}
.sa-cli:hover img{opacity:1;filter:none}
.sa-cli small{display:block;margin-top:10px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--n)}
.sa-cli b{display:block;margin-top:4px;font-size:14px;font-weight:600;line-height:1.35}
.sa-cli span{display:block;margin-top:2px;font-size:12px;color:rgba(255,255,255,.45)}
.sa-fin{text-align:center}.sa-fin h2{margin:12px auto 0}.sa-fin .sa-par{margin:16px auto 0}.sa-fin .sa-etq,.sa-fin .sa-ctas{justify-content:center}
.sa-pie{padding:28px 24px;text-align:center;font-size:12px;line-height:1.6;color:rgba(255,255,255,.35);border-top:1px solid rgba(255,255,255,.05)}
@media(max-width:900px){
  .sa-hero,.sa-dos{grid-template-columns:minmax(0,1fr)}
  .sa-pasos{grid-template-columns:repeat(2,minmax(0,1fr))}
  .sa-clientes{grid-template-columns:repeat(2,minmax(0,1fr))}
  .sa h1{overflow-wrap:anywhere}
  .sa-vt{white-space:normal}
  .sa h1{font-size:40px}.sa h2{font-size:31px}
  .sa-sec{padding:64px 16px}
  .sa-cab>div{padding:0 16px}
  .sa-mcab .sa-datos{min-width:0;width:100%}
}
@media(max-width:560px){.sa-pasos{grid-template-columns:minmax(0,1fr)}.sa-clave{grid-template-columns:76px minmax(0,1fr)}.sa-clave b{font-size:20px}.sa-prod{grid-template-columns:18px 44px minmax(0,1fr) auto;gap:8px}.sa-prod img,.sa-prod .sin{width:44px;height:44px}.sa-datos{gap:6px}.sa-dato{padding:9px 8px}.sa-dato b{font-size:17px}}
@media(prefers-reduced-motion:reduce){.sa *{animation:none!important}}
`

function Ventana({ titulo, children, brillo }: { titulo: string; children: ReactNode; brillo?: boolean }) {
  return (
    <div className={`sa-ven${brillo ? ' brillo' : ''}`}>
      <div>
        <div className="sa-vbar">
          <span className="sa-pts">
            <i style={{ background: '#FF5F57' }} />
            <i style={{ background: '#FEBC2E' }} />
            <i style={{ background: '#28C840' }} />
          </span>
          <span className="sa-vt">{titulo}</span>
        </div>
        <div className="sa-vc">{children}</div>
      </div>
    </div>
  )
}

const Etiqueta = ({ children }: { children: ReactNode }) => (
  <div className="sa-etq">
    <i />
    {children}
  </div>
)

const Dato = ({ valor, rotulo, naranja }: { valor: string; rotulo: string; naranja?: boolean }) => (
  <div className={`sa-dato${naranja ? ' n' : ''}`}>
    <b>{valor}</b>
    <span>{rotulo}</span>
  </div>
)

const Barra = ({ pct }: { pct: number }) => (
  <div className="sa-barra">
    <div style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
  </div>
)

function Producto({ p, i, verVendedor }: { p: ProductoMini; i: number; verVendedor?: boolean }) {
  return (
    <a className="sa-prod" href={`https://www.amazon.es/dp/${p.asin}`} target="_blank" rel="noopener noreferrer">
      <span className="num">{i + 1}</span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {p.imagen ? <img src={p.imagen} alt="" loading="lazy" /> : <span className="sin" />}
      <span className="sa-pt">
        <b>{p.titulo}</b>
        <small>
          {p.marca ?? 'Sin marca'}
          {p.estrellas ? ` · ${String(p.estrellas).replace('.', ',')} ★ (${ent(p.resenas)})` : ''}
          {verVendedor && (p.vende ? <> · la vende <em>{p.vende}</em></> : <> · <em className="nadie">nadie la vende ahora</em></>)}
        </small>
      </span>
      <span className="sa-pc">
        <b>{p.precio ? eur(p.precio) : '—'}</b>
        <small>{p.ventasMes ? `+${ent(p.ventasMes)} uds/mes` : 'menos de 50/mes'}</small>
      </span>
    </a>
  )
}

function Mercado({ m, i }: { m: MercadoSinAmazon; i: number }) {
  const suyo = m.suyo?.precio ?? 0
  // La cuenta y sus límites están en lib/analisis-sin-amazon/calidad.ts: solo se compara su precio con el mercado si son de la misma gama, y con precios
  // bajos o márgenes nulos no se calcula lo que queda (la logística de Amazon es una tarifa fija y se comía el producto: −2,94 € en un snack de 0,90 €)
  const c = cuentaDeMercado(m)
  const { base, iva, comision, tasaDigital, llega } = c
  const pct = c.pct
  const gamaAlta = !!(c.comparable && m.precioMediano && suyo > m.precioMediano * 1.5)
  const caros = m.productos.filter((p) => (p.precio ?? 0) >= suyo * 0.5).length
  return (
    <div className="sa-mer">
      <div className="sa-mcab">
        <div>
          <div className="sa-mnum">{String(i + 1).padStart(2, '0')}</div>
          <h3>{m.nombre}</h3>
          <p className="sa-par chico">
            {m.origen === 'marca' ? 'Lo que más se vende en la categoría de Amazon.es donde está tu producto, sin contar tu marca.' : `Lo que se compra en Amazon.es de lo que tú vendes${m.categoria ? ` (categoría «${m.categoria}»)` : ''}.`}{' '}
            {m.modo === 'ventas' ? 'Ordenado por ventas al mes.' : 'Es un nicho: casi nadie llega a las 50 ventas al mes que Amazon publica, así que manda el ranking.'}
          </p>
        </div>
        <div className="sa-datos">
          {m.modo === 'ventas' ? <Dato valor={`+${ent(m.ventasMes)}`} rotulo={`uds/mes · top ${m.productos.length}`} naranja /> : <Dato valor={ent(m.productos.length)} rotulo="fichas que mandan" />}
          <Dato valor={m.precioMediano ? eur0(m.precioMediano) : '—'} rotulo="precio mediano" />
          <Dato valor={m.resenasMediana !== null ? ent(m.resenasMediana) : '—'} rotulo="reseñas medianas" />
        </div>
      </div>
      <div className="sa-dos">
        <Ventana titulo={`${m.categoria ?? m.nombre} · los más vendidos`}>
          {m.productos.map((p, j) => (
            <Producto key={p.asin} p={p} i={j} />
          ))}
        </Ventana>
        <div className="sa-col">
          <Ventana titulo={m.suyo ? 'Tu producto frente a Amazon' : 'Lo que te llegaría por venta'}>
            {m.suyo && (
              <div className="sa-suyo">
                <small>{m.suyo.deAmazon ? 'Tu producto en Amazon hoy (lo vende otra tienda)' : 'En tu web'}</small>
                <b>{m.suyo.titulo}</b>
                <div className="sa-precio">{eur(m.suyo.precio)}</div>
              </div>
            )}
            {pct !== null && m.precioMediano && (
              <>
                <div className="sa-comp">
                  {pct === 0 ? 'El mismo precio que la mediana de Amazon.' : `${Math.abs(pct)} % ${pct > 0 ? 'por encima' : 'por debajo'} de la mediana de Amazon (${eur(m.precioMediano)}).`}
                </div>
                <Barra pct={(suyo / Math.max(suyo, m.precioMediano * 1.6)) * 100} />
              </>
            )}
            {gamaAlta && (
              <div className="sa-comp">
                {caros ? (
                  <>
                    Es gama alta, y en Amazon también se compra caro: <b>{caros} de los {m.productos.length}</b> más vendidos pasan de {eur0(suyo * 0.5)}.
                  </>
                ) : (
                  'Los más vendidos son bastante más baratos: tu producto iría a la gama alta de la categoría.'
                )}
              </div>
            )}
            {c.comparable === false && m.precioMediano && (
              <div className="sa-comp">
                Tu producto ({eur(suyo)}) es de otra gama que lo que más se vende aquí (mediana de {eur(m.precioMediano)}): no lo comparamos.
              </div>
            )}
            {c.sinCuenta === 'precio-bajo' && (
              <p className="sa-nota">
                A este precio, la logística de Amazon ({eur(c.logistica)} por unidad) pesa demasiado frente al producto: aquí el margen se juega en packs y lotes, no en la unidad suelta.
              </p>
            )}
            {c.sinCuenta === null && llega !== null && (
              <>
                <div className="sa-cuenta">
                  <div>
                    <span>Precio de venta con IVA{c.usaSuyo ? '' : ' (mediana en Amazon)'}</span>
                    <b>{eur(base)}</b>
                  </div>
                  <div>
                    <span>IVA (21 %)</span>
                    <b>− {eur(iva)}</b>
                  </div>
                  <div>
                    <span>Comisión de Amazon ({String(Math.round((m.comisionPct ?? 0) * 10) / 10).replace('.', ',')} % del precio con IVA)</span>
                    <b>− {eur(comision)}</b>
                  </div>
                  <div>
                    <span>Tasa digital que repercute Amazon (3 % de la comisión)</span>
                    <b>− {eur(tasaDigital)}</b>
                  </div>
                  <div>
                    <span>Preparación y envío con Prime (FBA, por unidad)</span>
                    <b>− {eur(c.logistica)}</b>
                  </div>
                  <div className="tot">
                    <span>Te quedan, sin IVA</span>
                    <b>{eur(llega ?? 0)}</b>
                  </div>
                </div>
                <p className="sa-nota">
                  Con las comisiones que Amazon aplica hoy a productos como el tuyo y el IVA general (en alimentación y libros es menor). De aquí salen todavía el coste del producto, la publicidad, el envío
                  de tu mercancía al almacén de Amazon, el almacenamiento mensual y las devoluciones. El IVA de las comisiones de Amazon no se cuenta: como empresa lo recuperas.
                </p>
              </>
            )}
          </Ventana>
          {m.modo === 'ventas' && m.marcas.length > 0 && (
            <Ventana titulo="Quién se lleva esas ventas">
              {m.marcas.map((x) => (
                <div key={x.marca}>
                  <div className="sa-marca">
                    <span>{x.marca}</span>
                    <b>{x.ventasMes ? `${ent(x.ventasMes)} uds/mes` : `${x.fichas} ${x.fichas === 1 ? 'ficha' : 'fichas'}`}</b>
                  </div>
                  <Barra pct={m.ventasMes ? (x.ventasMes / m.ventasMes) * 100 : 0} />
                </div>
              ))}
            </Ventana>
          )}
        </div>
      </div>
    </div>
  )
}

export function InformeSinAmazon({ informe, contacto }: { informe: InformeSinAmazon; contacto: ContactoComercial | null }) {
  // Sin los mercados dudosos (accesorios, categorías que no son lo suyo) y con los textos rehechos con los que quedan
  const inf = depurar(informe)
  const nombreComercial = contacto?.nombre ?? 'Liberty Seller'
  const wa = contacto?.whatsapp
    ? `https://wa.me/${contacto.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(`Hola ${nombreComercial}, he visto el análisis de ${inf.vendedor.nombre} en Amazon y me gustaría hablarlo.`)}`
    : null
  const tel = contacto?.telefono ? (/\+?\d[\d\s]{7,}/.exec(contacto.telefono)?.[0] ?? '').replace(/[^\d+]/g, '') : ''
  const cta = wa ?? (tel ? `tel:${tel}` : 'https://libertyseller.com')
  const revendida = inf.caso === 'revendida'
  const m = inf.marca
  const principal = [...inf.mercados].sort((a, b) => b.ventasMes - a.ventasMes || (a.resenasMediana ?? 1e9) - (b.resenasMediana ?? 1e9))[0] ?? null
  const huecoEnLaMarca = revendida && m.sinVendedor > 0

  return (
    <div className="sa">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <header className="sa-cab">
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logos/logo.png" alt="Liberty Seller" />
          <a className="sa-bt" href={cta} target={wa ? '_blank' : undefined} rel="noopener noreferrer">
            {wa ? `Escribir a ${nombreComercial}` : 'Hablar con nosotros'}
          </a>
        </div>
      </header>

      {/* ---------- portada ---------- */}
      <section className="sa-sec" style={{ borderTop: 'none' }}>
        <div className="sa-ret" />
        <div className="sa-halo" style={{ left: -160, top: -160, width: 560, height: 560 }} />
        <div className="sa-in sa-hero">
          <div className="sa-anim">
            <Etiqueta>Análisis preparado para {inf.vendedor.nombre}</Etiqueta>
            <h1>
              {inf.titular[0]}
              <span className="sa-deg">{inf.titular[1]}</span>
            </h1>
            <div className="sa-meta">
              {inf.vendedor.nombre} · {inf.vendedor.web.replace(/^https?:\/\//, '')}
              {inf.catalogo.productos ? ` · ${ent(inf.catalogo.productos)} productos en tu web` : ''}
            </div>
            <p className="sa-par">{inf.resumen}</p>
            <div className="sa-ctas">
              <a className="sa-cta" href={revendida ? '#marca' : '#mercado'}>
                Ver lo que hemos encontrado ↓
              </a>
              <a className="sa-cta sec" href={cta} target={wa ? '_blank' : undefined} rel="noopener noreferrer">
                Hablar con {nombreComercial}
              </a>
            </div>
          </div>
          <div className="sa-anim" style={{ animationDelay: '.15s' }}>
            <Ventana brillo titulo={`Lo que hemos visto · Amazon.es · ${fecha(inf.fecha)}`}>
              {inf.claves.map((c) => (
                <div className="sa-clave" key={c.titulo}>
                  <b>{c.cifra}</b>
                  <div>
                    <strong>{c.titulo}</strong>
                    <span>{c.detalle}</span>
                  </div>
                </div>
              ))}
            </Ventana>
          </div>
        </div>
      </section>

      {/* ---------- su marca ---------- */}
      <section className="sa-sec alt" id="marca">
        <div className="sa-ret" />
        <div className="sa-in">
          <Etiqueta>Tu marca en Amazon hoy</Etiqueta>
          {revendida ? (
            <>
              <h2>
                {m.nombre} ya está en Amazon. <span className="sa-deg">Y no la vendes tú.</span>
              </h2>
              <p className="sa-par">
                Hemos buscado tu marca en Amazon.es y aparecen <b>{ent(m.modelos)} {m.modelos === 1 ? 'ficha' : 'fichas'}</b>. Quien gana la venta de cada una es quien cobra,
                quien pone el precio y quien atiende a tu cliente.
                {m.vendedores.length > 0 && (
                  <>
                    {' '}
                    Hoy {m.vendedores.length === 1 ? 'es' : 'son'} {enumerar(m.vendedores.slice(0, 3).map((v) => v.nombre))}
                    {m.comprobadoPor ? `: lo hemos comprobado con su ${m.comprobadoPor === 'CIF' ? 'CIF' : 'razón social'}, y no eres tú.` : ', no tú.'}
                  </>
                )}
                {huecoEnLaMarca && (
                  <>
                    {' '}
                    Y de las {m.revisadas} que hemos revisado, <b>{m.sinVendedor === 1 ? 'una no tiene ahora mismo a nadie vendiéndola' : `${m.sinVendedor} no tienen ahora mismo a nadie vendiéndolas`}</b>: quien busca ese producto en Amazon no lo puede comprar.
                  </>
                )}
              </p>
              <div className="sa-datos" style={{ margin: '28px 0 20px', maxWidth: 640 }}>
                <Dato valor={ent(m.modelos)} rotulo="fichas de tu marca" naranja />
                <Dato valor={ent(m.vendedores.length)} rotulo={m.vendedores.length === 1 ? 'tienda la vende' : 'tiendas la venden'} />
                <Dato valor={huecoEnLaMarca ? `${m.sinVendedor} de ${m.revisadas}` : m.ventasMes ? `+${ent(m.ventasMes)}` : '—'} rotulo={huecoEnLaMarca ? 'sin nadie que las venda' : 'uds/mes que venden otros'} />
              </div>
              <Ventana titulo={`${m.nombre} en Amazon.es · ${ent(m.modelos)} fichas`}>
                {m.fichas.map((p, i) => (
                  <Producto key={p.asin + i} p={p} i={i} verVendedor />
                ))}
              </Ventana>
              {m.vendedores.length > 0 && (
                <div className="sa-vend">
                  {m.vendedores.slice(0, 6).map((v) => (
                    <div key={v.nombre}>
                      <b>{v.nombre}</b>
                      <span>
                        {[v.empresa, [v.ciudad, v.pais].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
                        {v.marcas ? <><br />Vende {v.marcas >= 10 ? 'más de 10 marcas' : `${v.marcas} ${v.marcas === 1 ? 'marca' : 'marcas'}`}{v.productos ? ` y ${ent(v.productos)} productos` : ''}</> : null}
                      </span>
                      <span className="sa-pas">Vende tu marca</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <h2>
                Quien busca {m.nombre} en Amazon <span className="sa-deg">no te encuentra.</span>
              </h2>
              <p className="sa-par">
                Hemos buscado tu marca en Amazon.es y no hay ninguna ficha con su nombre. El sitio está libre para que lo ocupes tú, con tu ficha, tus fotos y tu precio. Mientras
                tanto, quien te busca allí acaba comprando otra marca
                {principal?.marcas.length ? <>: hoy, sobre todo {enumerar(principal.marcas.slice(0, 3).map((x) => x.marca))}</> : ''}.
              </p>
            </>
          )}
        </div>
      </section>

      {/* ---------- lo que se vende ---------- */}
      {inf.mercados.length > 0 && (
        <section className="sa-sec" id="mercado">
          <div className="sa-halo" style={{ right: -140, top: 200, width: 440, height: 440, background: 'rgba(255,102,0,.08)' }} />
          <div className="sa-in">
            <Etiqueta>Lo que se vende de lo tuyo</Etiqueta>
            <h2>
              Tus productos, <span className="sa-deg">en el mayor escaparate de España.</span>
            </h2>
            <p className="sa-par">
              {inf.mercados[0]?.origen === 'marca'
                ? `Hemos mirado ${inf.mercados.length === 1 ? 'la categoría de Amazon.es donde está' : `las ${inf.mercados.length} categorías de Amazon.es donde está`} tu catálogo: quién vende más, a qué precio y con cuántas reseñas.`
                : `Hemos tomado lo que más pesa en tu web y hemos mirado qué compran en Amazon.es quienes lo buscan: cuánto se vende, a qué precio, con cuántas reseñas y quién se lleva las ventas.`}{' '}
              Las unidades son las que Amazon enseña como «comprados el mes pasado».
            </p>
            {inf.mercados.map((x, i) => (
              <Mercado key={x.nombre + i} m={x} i={i} />
            ))}
          </div>
        </section>
      )}

      {/* ---------- cómo lo haríamos ---------- */}
      <section className="sa-sec alt">
        <div className="sa-ret" />
        <div className="sa-in">
          <Etiqueta>Cómo lo haríamos contigo</Etiqueta>
          <h2>
            No hace falta subir todo el catálogo.{' '}
            <span className="sa-deg">{principal ? `Empezaríamos por ${principal.nombre.toLowerCase()}.` : 'Empezaríamos por lo que más se vende.'}</span>
          </h2>
          <p className="sa-par">
            {revendida
              ? 'Lo primero es recuperar lo que ya es tuyo: tus fichas. Después, ponerlas a vender con tu precio y tu stock, y crecer desde ahí.'
              : 'Pocas fichas, bien hechas, en lo que más se vende. Tu web sigue siendo tuya: Amazon es un canal más, con millones de compradores que ya están buscando lo que vendes.'}
          </p>
          <ProgramaSemanal
            contexto="sin-amazon"
            datos={{
              catalogo: inf.catalogo.productos ? { web: inf.catalogo.productos, vendiendo: 0 } : null,
              precioMercado: principal?.precioMediano ?? null,
            }}
          />
        </div>
      </section>

      {/* ---------- clientes ---------- */}
      <section className="sa-sec">
        <div className="sa-in" style={{ textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <Etiqueta>Casos</Etiqueta>
          </div>
          <h2 style={{ margin: '12px auto 0' }}>Marcas que ya trabajan con nosotros</h2>
          <div className="sa-clientes">
            {CLIENTES.filter((c) => c.logo).map((c) => (
              <div className="sa-cli" key={c.nombre}>
                <div className="logo">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={c.logo} alt={c.nombre} loading="lazy" />
                </div>
                <small>{c.tag}</small>
                <b>{c.cifra}</b>
                <span>{c.nombre}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- siguiente paso ---------- */}
      <section className="sa-sec alt sa-fin">
        <div className="sa-halo" style={{ left: '30%', top: -120, width: 500, height: 400 }} />
        <div className="sa-in">
          <Etiqueta>Siguiente paso</Etiqueta>
          <h2>¿Lo vemos juntos en 20 minutos?</h2>
          <p className="sa-par">
            {nombreComercial}, de Liberty Seller, te explica estos datos con tu catálogo delante. Sin compromiso: si no vemos recorrido, te lo diremos.
          </p>
          <div className="sa-ctas">
            {wa && (
              <a className="sa-cta" href={wa} target="_blank" rel="noopener noreferrer">
                Escribir por WhatsApp
              </a>
            )}
            {tel && (
              <a className={`sa-cta${wa ? ' sec' : ''}`} href={`tel:${tel}`}>
                Llamar a {nombreComercial}
              </a>
            )}
            {!wa && !tel && (
              <a className="sa-cta" href="https://libertyseller.com" target="_blank" rel="noopener noreferrer">
                Hablar con nosotros
              </a>
            )}
          </div>
        </div>
      </section>

      <footer className="sa-pie">
        Liberty Seller · Datos públicos de Amazon.es y de {inf.vendedor.web.replace(/^https?:\/\//, '')} del {fecha(inf.fecha)}.
        <br />
        Las ventas son las que Amazon publica; los productos sin esa cifra venden menos de 50 unidades al mes. No tenemos acceso a ninguna cuenta de Amazon.
      </footer>
    </div>
  )
}
