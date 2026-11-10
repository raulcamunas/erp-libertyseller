'use client'

import { ArrowRight, EyeOff, PackageX, ShieldAlert, Sparkles, TriangleAlert, XCircle } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { CAJA, bandera } from '@/components/marketing-test/piezas'
import { ROTULO_TEMA } from '@/lib/cumplimiento/tipos'
import { saludDe, tonoDeSalud, type CifrasDePais, type PanelDeCumplimiento } from '@/lib/cumplimiento/panel-calculo'
import { ColorDeGravedad, haceTiempo } from './comun'

type PanelOk = Extract<PanelDeCumplimiento, { ok: true }>

const cifra = (v: number) => v.toLocaleString('es-ES')
const pct = (v: number | null, d = 1) => (v == null ? '—' : `${(Math.floor(v * 10 ** (d + 2)) / 10 ** d).toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d })} %`)
const colorDeTono = (t: ReturnType<typeof tonoDeSalud>) => (t === 'gris' ? 'var(--ls-t3)' : COLOR_ESTADO[t])

/**
 * EL PANEL DE UN CLIENTE: cómo está su catálogo ante Amazon. Arriba la salud y lo que cuesta dinero hoy (con stock y con problema, ocultos); después cómo evoluciona, cuánto llevan abiertos los
 * problemas, de qué tema son y qué incidencias de Amazon se repiten más. Con «todos los países», una tabla por país del mismo cliente.
 */
export function PestanaPanel({ panel, todos, verPais, verIncidencias, verCodigo, verListings }: { panel: PanelOk; todos: boolean; verPais: (id: string) => void; verIncidencias: () => void; verCodigo: (codigo: string) => void; verListings: () => void }) {
  const c = panel.cifras
  if (c.revisados === 0)
    return (
      <div className={`${CAJA.base} max-w-[760px]`}>
        <div className={CAJA.cuerpo}>
          <p className="text-[13px] font-semibold text-[var(--ls-t1)]">Todavía no se ha revisado ningún listing aquí</p>
          <p className="mt-1 text-[12.5px] text-[var(--ls-t3)]">La revisión pasa sola cada hora, empezando por lo que tiene stock. También se puede lanzar ahora desde la pestaña «Listings».</p>
        </div>
      </div>
    )
  const salud = saludDe(c)
  const tono = tonoDeSalud(salud)

  return (
    <div className="flex max-w-[1240px] flex-col gap-3 pb-8">
      {/* ---- salud + cifras ---- */}
      <div className="grid gap-3 lg:grid-cols-[300px_minmax(0,1fr)]">
        <section className={`${CAJA.base} flex flex-col items-center justify-center gap-2 px-5 py-5`}>
          <Anillo valor={salud ?? 0} color={colorDeTono(tono)} />
          <p className="text-center text-[12.5px] leading-[1.45] text-[var(--ls-t3)]">
            <strong className="text-[var(--ls-t1)]">{cifra(c.revisados - c.atencion)}</strong> de {cifra(c.revisados)} listings revisados están sin errores ni ocultos
          </p>
          {c.total > c.revisados && (
            <div className="w-full">
              <div className="h-[5px] overflow-hidden rounded-full bg-[var(--ls-sup2)]">
                <div className="h-full rounded-full" style={{ width: `${Math.max(2, (c.revisados / c.total) * 100)}%`, background: COLOR_ESTADO.azul }} />
              </div>
              <p className="mt-1 text-center text-[11px] text-[var(--ls-t4)]">Revisado el {pct(c.revisados / c.total, 0)} del catálogo ({cifra(c.total)}): se completa solo, unos miles cada hora</p>
            </div>
          )}
          {c.ultimaRevision && <p className="text-[11px] text-[var(--ls-t4)]">Última revisión {haceTiempo(c.ultimaRevision)}</p>}
        </section>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Tarjeta icono={<PackageX />} titulo="Con stock y con problema" valor={c.atencionConStock} color={c.atencionConStock > 0 ? COLOR_ESTADO.rojo : COLOR_ESTADO.verde} nota="Lo que se está dejando de vender hoy" alPulsar={c.atencionConStock > 0 ? verListings : undefined} destacada={c.atencionConStock > 0} />
          <Tarjeta icono={<EyeOff />} titulo="Ocultos" valor={c.ocultos} color={c.ocultos > 0 ? COLOR_ESTADO.rojo : undefined} nota="Fuera de las búsquedas o de la venta" />
          <Tarjeta icono={<XCircle />} titulo="Con errores" valor={c.conErrores} color={c.conErrores > 0 ? COLOR_ESTADO.naranja : undefined} nota="Falta algo obligatorio o está mal" />
          <Tarjeta icono={<TriangleAlert />} titulo="Solo avisos" valor={c.soloAvisos} color={c.soloAvisos > 0 ? COLOR_ESTADO.ambar : undefined} nota="Recomendaciones: aún no bloquean" />
          <Tarjeta icono={<ShieldAlert />} titulo="Con algo de normativa" valor={c.normativa} color={c.normativa > 0 ? COLOR_ESTADO.violeta : undefined} nota="GPSR, RAP, certificados, etiquetado" />
          <Tarjeta icono={<Sparkles />} titulo="Problemas nuevos" valor={c.antiguedad.d7} color={c.antiguedad.d7 > 0 ? COLOR_ESTADO.cian : undefined} nota="Abiertos en los últimos 7 días" />
        </div>
      </div>

      {/* ---- evolución + antigüedad ---- */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section className={CAJA.base}>
          <header className={CAJA.cabecera}>
            <h3 className="text-[13px] font-semibold text-[var(--ls-t1)]">Evolución</h3>
            <span className="text-[11.5px] text-[var(--ls-t4)]">listings que necesitan atención, día a día</span>
          </header>
          <div className={CAJA.cuerpo}>
            {panel.diario.length < 2 ? (
              <div className="flex h-[190px] flex-col items-center justify-center gap-1 text-center">
                <p className="text-[12.5px] font-medium text-[var(--ls-t2)]">La gráfica empieza a dibujarse mañana</p>
                <p className="max-w-[360px] text-[11.5px] text-[var(--ls-t4)]">Cada día se guarda una foto de las cifras. {panel.diario.length === 1 ? 'Ya está la de hoy.' : 'La primera sale en la próxima revisión.'}</p>
              </div>
            ) : (
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={panel.diario.map((d) => ({ ...d, etiqueta: new Date(`${d.dia}T00:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' }) }))} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="g-atencion" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={COLOR_ESTADO.naranja} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={COLOR_ESTADO.naranja} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="g-ocultos" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={COLOR_ESTADO.rojo} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={COLOR_ESTADO.rojo} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--ls-linea)" vertical={false} />
                    <XAxis dataKey="etiqueta" tick={{ fontSize: 11, fill: 'var(--ls-t4)' }} tickLine={false} axisLine={{ stroke: 'var(--ls-linea2)' }} interval="preserveStartEnd" minTickGap={18} />
                    <YAxis tick={{ fontSize: 11, fill: 'var(--ls-t4)' }} tickLine={false} axisLine={false} width={44} allowDecimals={false} />
                    <Tooltip contentStyle={{ background: 'var(--ls-sup)', border: '1px solid var(--ls-linea2)', borderRadius: 8, fontSize: 12, color: 'var(--ls-t1)' }} labelStyle={{ color: 'var(--ls-t3)' }} formatter={(v: number, nombre: string) => [cifra(v), nombre]} />
                    <Area type="monotone" dataKey="atencion" name="Necesitan atención" stroke={COLOR_ESTADO.naranja} strokeWidth={2} fill="url(#g-atencion)" />
                    <Area type="monotone" dataKey="ocultos" name="Ocultos" stroke={COLOR_ESTADO.rojo} strokeWidth={2} fill="url(#g-ocultos)" />
                    <Area type="monotone" dataKey="atencionConStock" name="Con stock y con problema" stroke={COLOR_ESTADO.violeta} strokeWidth={1.5} strokeDasharray="4 3" fill="none" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </section>

        <section className={CAJA.base}>
          <header className={CAJA.cabecera}>
            <h3 className="text-[13px] font-semibold text-[var(--ls-t1)]">Cuánto llevan abiertos</h3>
            <span className="text-[11.5px] text-[var(--ls-t4)]">{cifra(c.atencion)} que necesitan atención</span>
          </header>
          <div className={`${CAJA.cuerpo} flex flex-col gap-3`}>
            <Antiguedad a={c.antiguedad} />
          </div>
        </section>
      </div>

      {/* ---- temas + incidencias que más se repiten ---- */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <section className={CAJA.base}>
          <header className={CAJA.cabecera}>
            <h3 className="text-[13px] font-semibold text-[var(--ls-t1)]">Por tema</h3>
            <span className="ml-auto flex items-center gap-3 text-[11px] text-[var(--ls-t4)]">
              <Leyenda color={COLOR_ESTADO.naranja} texto="necesitan atención" />
              <Leyenda color="var(--ls-sup3)" texto="con algún aviso" />
            </span>
          </header>
          <div className={`${CAJA.cuerpo} flex flex-col gap-[10px]`}>
            {panel.temas.length === 0 ? (
              <p className="text-[12.5px]" style={{ color: COLOR_ESTADO.verde }}>Ningún listing revisado tiene incidencias.</p>
            ) : (
              panel.temas.map((t) => {
                const max = Math.max(...panel.temas.map((x) => x.todos), 1)
                return (
                  <div key={t.tema} className="grid grid-cols-[110px_minmax(0,1fr)_auto] items-center gap-3" title={ROTULO_TEMA[t.tema].largo}>
                    <span className="truncate text-[12px] text-[var(--ls-t2)]">{ROTULO_TEMA[t.tema].corto}</span>
                    <div className="relative h-[10px] overflow-hidden rounded-full bg-[var(--ls-sup2)]">
                      <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--ls-sup3)]" style={{ width: `${(t.todos / max) * 100}%` }} />
                      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(t.atencion / max) * 100}%`, background: COLOR_ESTADO.naranja }} />
                    </div>
                    <span className="w-[92px] text-right text-[11.5px] tabular-nums text-[var(--ls-t3)]">
                      <strong className="text-[var(--ls-t1)]">{cifra(t.atencion)}</strong> / {cifra(t.todos)}
                    </span>
                  </div>
                )
              })
            )}
          </div>
        </section>

        <section className={CAJA.base}>
          <header className={CAJA.cabecera}>
            <h3 className="text-[13px] font-semibold text-[var(--ls-t1)]">Lo que más repite Amazon</h3>
            <button type="button" onClick={verIncidencias} className="ml-auto inline-flex items-center gap-1 text-[12px] font-medium text-[var(--ls-t2)] hover:text-[var(--ls-t1)]">
              Ver todas <ArrowRight className="h-3 w-3" />
            </button>
          </header>
          <div className="flex flex-col divide-y divide-[var(--ls-linea)]">
            {panel.codigos.length === 0 ? (
              <p className={`${CAJA.cuerpo} text-[12.5px] text-[var(--ls-t3)]`}>Sin incidencias.</p>
            ) : (
              panel.codigos.slice(0, 6).map((k) => (
                <button key={k.codigo} type="button" onClick={() => verCodigo(k.codigo)} className="flex items-start gap-3 px-4 py-[10px] text-left transition-colors hover:bg-[var(--ls-sup2)]" title="Ver los listings con esta incidencia">
                  <ColorDeGravedad gravedad={k.gravedad} />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-[12.5px] leading-[1.45] text-[var(--ls-t1)]">{k.mensaje || `Incidencia ${k.codigo}`}</span>
                    <span className="mt-[2px] block text-[11px] text-[var(--ls-t4)]">
                      {ROTULO_TEMA[k.tema].corto} · código {k.codigo}
                      {k.ocultan > 0 && <span style={{ color: COLOR_ESTADO.rojo }}> · oculta {cifra(k.ocultan)}</span>}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-[14px] font-semibold tabular-nums text-[var(--ls-t1)]">{cifra(k.listings)}</span>
                    <span className="block text-[10.5px] text-[var(--ls-t4)]">{k.conStock > 0 ? `${cifra(k.conStock)} con stock` : 'listings'}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </section>
      </div>

      {/* ---- por país, del mismo cliente ---- */}
      {todos && panel.paises.length > 1 && <PorPais paises={panel.paises} verPais={verPais} />}
    </div>
  )
}

function Anillo({ valor, color }: { valor: number; color: string }) {
  const r = 52
  const largo = 2 * Math.PI * r
  return (
    <div className="relative h-[132px] w-[132px]">
      <svg viewBox="0 0 132 132" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="66" cy="66" r={r} fill="none" stroke="var(--ls-sup2)" strokeWidth="11" />
        <circle cx="66" cy="66" r={r} fill="none" stroke={color} strokeWidth="11" strokeLinecap="round" strokeDasharray={`${largo * Math.max(0, Math.min(1, valor))} ${largo}`} style={{ transition: 'stroke-dasharray .6s ease' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[23px] font-semibold leading-none tracking-[-0.03em] tabular-nums" style={{ color }}>{pct(valor)}</span>
        <span className="mt-1 text-[11px] font-medium text-[var(--ls-t4)]">salud</span>
      </div>
    </div>
  )
}

function Tarjeta({ icono, titulo, valor, nota, color, alPulsar, destacada }: { icono: React.ReactNode; titulo: string; valor: number; nota: string; color?: string; alPulsar?: () => void; destacada?: boolean }) {
  const Caja = alPulsar ? 'button' : 'div'
  return (
    <Caja
      type={alPulsar ? 'button' : undefined}
      onClick={alPulsar}
      className={`${CAJA.base} flex flex-col gap-1 px-4 py-[14px] text-left ${alPulsar ? 'transition-colors hover:border-[var(--ls-linea2)] hover:bg-[var(--ls-sup2)]' : ''}`}
      style={destacada && color ? { boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 35%, transparent)`, background: `color-mix(in srgb, ${color} 6%, var(--ls-sup))` } : undefined}
    >
      <span className="flex items-center gap-[7px] text-[11.5px] font-medium text-[var(--ls-t3)]">
        <span className="flex h-[22px] w-[22px] items-center justify-center rounded-[7px] [&>svg]:h-[13px] [&>svg]:w-[13px]" style={{ color: color ?? 'var(--ls-t3)', background: `color-mix(in srgb, ${color ?? 'var(--ls-t3)'} 13%, transparent)` }}>
          {icono}
        </span>
        {titulo}
      </span>
      <span className="text-[24px] font-semibold leading-[1.15] tracking-[-0.02em] tabular-nums" style={{ color: valor > 0 ? (color ?? 'var(--ls-t1)') : 'var(--ls-t1)' }}>{cifra(valor)}</span>
      <span className="text-[11px] leading-[1.35] text-[var(--ls-t4)]">{nota}</span>
    </Caja>
  )
}

function Antiguedad({ a }: { a: { d7: number; d30: number; d90: number; mas: number } }) {
  const tramos = [
    { texto: 'Menos de 7 días', n: a.d7, color: COLOR_ESTADO.cian },
    { texto: 'De 7 a 30 días', n: a.d30, color: COLOR_ESTADO.ambar },
    { texto: 'De 30 a 90 días', n: a.d90, color: COLOR_ESTADO.naranja },
    { texto: 'Más de 90 días', n: a.mas, color: COLOR_ESTADO.rojo },
  ]
  const total = tramos.reduce((s, t) => s + t.n, 0)
  if (total === 0) return <p className="text-[12.5px]" style={{ color: COLOR_ESTADO.verde }}>Nada abierto ahora mismo.</p>
  return (
    <>
      <div className="flex h-[12px] overflow-hidden rounded-full bg-[var(--ls-sup2)]">
        {tramos.map((t) => (t.n > 0 ? <div key={t.texto} style={{ width: `${(t.n / total) * 100}%`, background: t.color }} title={`${t.texto}: ${cifra(t.n)}`} /> : null))}
      </div>
      <div className="flex flex-col gap-[7px]">
        {tramos.map((t) => (
          <div key={t.texto} className="flex items-center gap-2 text-[12px]">
            <span className="h-[9px] w-[9px] rounded-[3px]" style={{ background: t.color }} />
            <span className="text-[var(--ls-t2)]">{t.texto}</span>
            <span className="ml-auto tabular-nums font-semibold text-[var(--ls-t1)]">{cifra(t.n)}</span>
            <span className="w-[46px] text-right tabular-nums text-[11px] text-[var(--ls-t4)]">{pct(t.n / total, 0)}</span>
          </div>
        ))}
      </div>
      <p className="text-[11px] leading-[1.4] text-[var(--ls-t4)]">Desde el primer día que Amazon marcó el problema más antiguo de cada listing. Lo de más de 90 días suele ser algo que nadie está mirando.</p>
    </>
  )
}

function PorPais({ paises, verPais }: { paises: CifrasDePais[]; verPais: (id: string) => void }) {
  return (
    <section className={CAJA.base}>
      <header className={CAJA.cabecera}>
        <h3 className="text-[13px] font-semibold text-[var(--ls-t1)]">Por país</h3>
        <span className="text-[11.5px] text-[var(--ls-t4)]">pulsa uno para ver solo ese país</span>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-separate border-spacing-0 text-[12.5px]">
          <thead>
            <tr className="text-[11px] text-[var(--ls-t4)]">
              {['País', 'Salud', 'Revisados', 'Con stock y problema', 'Ocultos', 'Con errores', 'Solo avisos'].map((h, i) => (
                <th key={h} className={`bg-[var(--ls-sup2)] px-4 py-[8px] font-semibold ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paises.map((p) => {
              const s = saludDe(p)
              const t = tonoDeSalud(s)
              return (
                <tr key={p.id} onClick={() => verPais(p.id)} className="cursor-pointer hover:[&>td]:bg-[var(--ls-sup2)]">
                  <td className="border-t border-[var(--ls-linea)] px-4 py-[9px]">
                    <span className="mr-2" aria-hidden>{bandera(p.pais)}</span>
                    <span className="font-medium text-[var(--ls-t1)]">{p.nombre}</span>
                  </td>
                  <td className="border-t border-[var(--ls-linea)] px-4 py-[9px] text-right">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-[5px] w-[60px] overflow-hidden rounded-full bg-[var(--ls-sup2)]">
                        <span className="block h-full rounded-full" style={{ width: `${(s ?? 0) * 100}%`, background: colorDeTono(t) }} />
                      </span>
                      <span className="w-[52px] tabular-nums font-semibold" style={{ color: colorDeTono(t) }}>{pct(s)}</span>
                    </span>
                  </td>
                  <td className="border-t border-[var(--ls-linea)] px-4 py-[9px] text-right tabular-nums text-[var(--ls-t2)]">
                    {cifra(p.revisados)} <span className="text-[var(--ls-t4)]">/ {cifra(p.total)}</span>
                  </td>
                  <td className="border-t border-[var(--ls-linea)] px-4 py-[9px] text-right tabular-nums font-semibold" style={{ color: p.atencionConStock > 0 ? COLOR_ESTADO.rojo : 'var(--ls-t3)' }}>{cifra(p.atencionConStock)}</td>
                  <td className="border-t border-[var(--ls-linea)] px-4 py-[9px] text-right tabular-nums" style={{ color: p.ocultos > 0 ? COLOR_ESTADO.rojo : 'var(--ls-t3)' }}>{cifra(p.ocultos)}</td>
                  <td className="border-t border-[var(--ls-linea)] px-4 py-[9px] text-right tabular-nums text-[var(--ls-t2)]">{cifra(p.conErrores)}</td>
                  <td className="border-t border-[var(--ls-linea)] px-4 py-[9px] text-right tabular-nums text-[var(--ls-t3)]">{cifra(p.soloAvisos)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Leyenda({ color, texto }: { color: string; texto: string }) {
  return (
    <span className="inline-flex items-center gap-[5px]">
      <span className="h-[8px] w-[8px] rounded-[3px]" style={{ background: color }} />
      {texto}
    </span>
  )
}
