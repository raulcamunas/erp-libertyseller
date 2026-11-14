'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Check, ChevronDown, ChevronRight, ClipboardCopy, ExternalLink, Layers, UserRound } from 'lucide-react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { CAJA } from '@/components/marketing-test/piezas'
import { ACCIONES, RUTA_SELLER_CENTRAL, type TareaDeHoy } from '@/lib/cumplimiento/acciones'
import { urlSellerCentral } from '@/lib/cumplimiento/enlaces'
import { NIVELES, ROTULO_NIVEL } from '@/lib/cumplimiento/tipos'
import type { PanelDeCumplimiento } from '@/lib/cumplimiento/panel-calculo'
import { COLOR_NIVEL, haceTiempo, textoPlazo } from './comun'

type PanelOk = Extract<PanelDeCumplimiento, { ok: true }>
const cifra = (v: number) => v.toLocaleString('es-ES')

/** Las preferencias de esta pestaña se recuerdan en el navegador: cada persona tiene su forma de trabajar */
const CLAVE_PREFS = 'cumplimiento-hoy'

/**
 * «HOY»: QUÉ HAY QUE REVISAR, AGRUPADO POR LO QUE HAY QUE HACER.
 *
 * Es la pestaña de trabajo del día a día. En vez de 80 códigos de Amazon, una lista de tareas («Pedir la aprobación de
 * la marca», «Registrar la RAP», «Cambiar la imagen principal») con los pasos en Seller Central, ordenadas por lo que
 * cuesta dinero: primero lo que Amazon tiene oculto, luego la normativa con plazo, luego lo que se vende pero peor. Y
 * dentro de cada grupo, lo que tiene stock delante (lo que se está dejando de vender hoy).
 *
 * Por defecto solo se ve lo que tiene stock y nada de los avisos menores: lo demás está a un clic, pero no estorba.
 */
export function PestanaHoy({
  panel,
  mercado,
  nombreCliente,
  nombrePais,
  verTarea,
}: {
  panel: PanelOk
  /** El país elegido, o 'todos' */
  mercado: string
  nombreCliente: string
  nombrePais: string
  verTarea: (t: TareaDeHoy, soloStock: boolean) => void
}) {
  const [soloStock, setSoloStock] = useState(true)
  const [menores, setMenores] = useState(false)
  const [abiertas, setAbiertas] = useState<ReadonlySet<string>>(new Set())
  const [copiado, setCopiado] = useState(false)

  useEffect(() => {
    try {
      const p = JSON.parse(window.localStorage.getItem(CLAVE_PREFS) ?? '{}') as { soloStock?: boolean; menores?: boolean }
      if (typeof p.soloStock === 'boolean') setSoloStock(p.soloStock)
      if (typeof p.menores === 'boolean') setMenores(p.menores)
    } catch {
      /* sin preferencias guardadas: las de por defecto */
    }
  }, [])
  const guardar = (p: { soloStock: boolean; menores: boolean }) => {
    try {
      window.localStorage.setItem(CLAVE_PREFS, JSON.stringify(p))
    } catch {
      /* nada */
    }
  }

  // El dominio de Seller Central de los enlaces: el del país elegido o, con «todos», el del país con más listings
  const mercadoEnlaces = mercado !== 'todos' ? mercado : (panel.paises.find((p) => p.pais === 'ES') ?? panel.paises[0])?.id ?? ''
  const c = panel.cifras

  const secciones = useMemo(() => {
    const niveles = NIVELES.filter((n) => menores || n !== 'menor')
    return niveles.map((nivel) => {
      const todas = panel.tareas.filter((t) => t.nivel === nivel)
      const conStock = todas.filter((t) => t.conStock > 0)
      return { nivel, todas, conStock, sinStock: todas.filter((t) => t.conStock === 0) }
    })
  }, [panel.tareas, menores])

  const nMenores = panel.tareas.filter((t) => t.nivel === 'menor').reduce((s, t) => s + t.listings, 0)
  const importantes = panel.tareas.filter((t) => t.nivel !== 'menor')
  const visiblesPorDefecto = importantes.filter((t) => t.conStock > 0)

  const alternar = (k: string) =>
    setAbiertas((prev) => {
      const s = new Set(prev)
      if (s.has(k)) s.delete(k)
      else s.add(k)
      return s
    })

  /** Un resumen en texto, para pegarlo en el chat del equipo o en una tarea del cliente */
  const copiar = async () => {
    const lineas = [`${nombreCliente} · ${nombrePais} — qué revisar hoy en Amazon`]
    for (const s of secciones) {
      const lista = (soloStock ? s.conStock : s.todas).filter((t) => t.nivel !== 'menor')
      if (lista.length === 0) continue
      lineas.push('', `${ROTULO_NIVEL[s.nivel].corto}:`)
      for (const t of lista) {
        const plazo = t.plazo ? ` · ${textoPlazo(t.plazo).texto.toLowerCase()}` : ''
        lineas.push(`• ${ACCIONES[t.accion].titulo}: ${cifra(t.conStock)} con stock (${cifra(t.listings)} listings)${plazo}`)
      }
    }
    try {
      await navigator.clipboard.writeText(lineas.join('\n'))
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1800)
    } catch {
      /* sin permiso de portapapeles: no pasa nada */
    }
  }

  if (c.revisados === 0)
    return (
      <div className={`${CAJA.base} max-w-[760px]`}>
        <div className={CAJA.cuerpo}>
          <p className="text-[13px] font-semibold text-[var(--ls-t1)]">Todavía no se ha revisado ningún listing aquí</p>
          <p className="mt-1 text-[12.5px] text-[var(--ls-t3)]">La revisión pasa sola cada hora, empezando por lo que tiene stock. También se puede lanzar ahora desde la pestaña «Listings».</p>
        </div>
      </div>
    )

  return (
    <div className="flex max-w-[1240px] flex-col gap-3 pb-8">
      {/* ---- la cabecera: lo que hay, y cómo se mira ---- */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-[var(--ls-t1)]">Qué revisar hoy</h2>
          <p className="mt-[2px] text-[12px] text-[var(--ls-t3)]">
            {visiblesPorDefecto.length === 0 ? (
              'Nada con stock que esté bloqueado o pendiente de normativa'
            ) : (
              <>
                <strong className="text-[var(--ls-t1)]">{visiblesPorDefecto.length}</strong> {visiblesPorDefecto.length === 1 ? 'tarea' : 'tareas'} con stock afectado ·{' '}
                <strong style={{ color: c.atencionConStock > 0 ? COLOR_ESTADO.rojo : undefined }}>{cifra(c.atencionConStock)}</strong> listings con stock ocultos o con error
              </>
            )}
            {c.total > c.revisados && <> · revisado el {Math.floor((c.revisados / c.total) * 100)} % del catálogo</>}
            {c.ultimaRevision && <> · última revisión {haceTiempo(c.ultimaRevision)}</>}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Interruptor
            encendido={soloStock}
            alPulsar={() => {
              setSoloStock(!soloStock)
              guardar({ soloStock: !soloStock, menores })
            }}
            texto="Solo con stock"
            ayuda="Lo que no tiene stock puede esperar: no se está dejando de vender nada"
          />
          <Interruptor
            encendido={menores}
            alPulsar={() => {
              setMenores(!menores)
              guardar({ soloStock, menores: !menores })
            }}
            texto="Ver también avisos menores"
            cuenta={nMenores}
            ayuda="Recomendaciones de Amazon, cambios rechazados que dejan la ficha como estaba y errores internos: no cambian nada en la venta"
          />
          <button type="button" onClick={() => void copiar()} className="inline-flex h-[30px] items-center gap-[6px] rounded-[9px] border border-[var(--ls-linea)] px-[10px] text-[12px] font-medium text-[var(--ls-t2)] transition-colors hover:border-[var(--ls-linea2)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]" title="Copiar la lista de tareas en texto, para pegarla en el chat o en una tarea del cliente">
            {copiado ? <Check className="h-[13px] w-[13px]" style={{ color: COLOR_ESTADO.verde }} /> : <ClipboardCopy className="h-[13px] w-[13px]" />}
            {copiado ? 'Copiado' : 'Copiar resumen'}
          </button>
        </div>
      </div>

      {importantes.length === 0 && (
        <div className={`${CAJA.base} ${CAJA.cuerpo}`}>
          <p className="text-[13px] font-semibold" style={{ color: COLOR_ESTADO.verde }}>Todo en orden</p>
          <p className="mt-1 text-[12.5px] text-[var(--ls-t3)]">
            Amazon no tiene nada oculto, ni normativa pendiente, ni nada que afecte a la venta en los listings revisados.
            {nMenores > 0 && !menores && <> Hay avisos menores (no cambian nada en la venta): están en «Ver también avisos menores».</>}
          </p>
        </div>
      )}

      {/* ---- una sección por importancia ---- */}
      {secciones.map((s) => {
        const lista = soloStock ? s.conStock : s.todas
        if (s.todas.length === 0) return null
        const claveSin = `sin|${s.nivel}`
        const verSin = abiertas.has(claveSin)
        return (
          <section key={s.nivel} className={CAJA.base} aria-label={ROTULO_NIVEL[s.nivel].corto}>
            <header className={CAJA.cabecera}>
              <span aria-hidden className="h-[9px] w-[9px] shrink-0 rounded-full" style={{ background: COLOR_NIVEL[s.nivel], boxShadow: `0 0 0 3px color-mix(in srgb, ${COLOR_NIVEL[s.nivel]} 18%, transparent)` }} />
              <h3 className="text-[13px] font-semibold text-[var(--ls-t1)]">{ROTULO_NIVEL[s.nivel].corto}</h3>
              <span className="hidden min-w-0 truncate text-[11.5px] text-[var(--ls-t4)] md:inline">{ROTULO_NIVEL[s.nivel].largo}</span>
              <span className="ml-auto shrink-0 rounded-full bg-[var(--ls-sup3)] px-[7px] text-[11px] font-semibold tabular-nums text-[var(--ls-t3)]">{lista.length}</span>
            </header>
            {lista.length === 0 ? (
              <p className={`${CAJA.cuerpo} text-[12.5px] text-[var(--ls-t3)]`}>Nada con stock. {s.sinStock.length > 0 && 'Lo que hay es de listings sin stock (abajo).'}</p>
            ) : (
              <div className="flex flex-col divide-y divide-[var(--ls-linea)]">
                {lista.map((t) => (
                  <Tarea key={`${t.nivel}|${t.accion}`} t={t} abierta={abiertas.has(`${t.nivel}|${t.accion}`)} alternar={() => alternar(`${t.nivel}|${t.accion}`)} mercado={mercadoEnlaces} ver={() => verTarea(t, soloStock && t.conStock > 0)} />
                ))}
              </div>
            )}
            {soloStock && s.sinStock.length > 0 && (
              <div className="border-t border-[var(--ls-linea)]">
                <button type="button" onClick={() => alternar(claveSin)} aria-expanded={verSin} className="flex w-full items-center gap-[6px] px-4 py-[9px] text-left text-[12px] text-[var(--ls-t3)] transition-colors hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]">
                  {verSin ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  {s.sinStock.length} {s.sinStock.length === 1 ? 'tarea' : 'tareas'} solo en listings sin stock ({cifra(s.sinStock.reduce((n, t) => n + t.listings, 0))} listings): pueden esperar
                </button>
                {verSin && (
                  <div className="flex flex-col divide-y divide-[var(--ls-linea)] border-t border-[var(--ls-linea)] opacity-80">
                    {s.sinStock.map((t) => (
                      <Tarea key={`${t.nivel}|${t.accion}`} t={t} abierta={abiertas.has(`${t.nivel}|${t.accion}`)} alternar={() => alternar(`${t.nivel}|${t.accion}`)} mercado={mercadoEnlaces} ver={() => verTarea(t, false)} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        )
      })}

      <p className="text-[11px] leading-[1.45] text-[var(--ls-t4)]">
        Cada tarea junta las incidencias de Amazon que se arreglan igual. Las cifras son de lo revisado: un listing con dos problemas distintos sale en las dos tareas.
        {!panel.exacto && <> Cifras aproximadas hasta lanzar la migración 306: un listing con dos incidencias de la misma tarea cuenta dos veces y los avisos menores salen incompletos.</>}
      </p>
    </div>
  )
}

function Tarea({ t, abierta, alternar, mercado, ver }: { t: TareaDeHoy; abierta: boolean; alternar: () => void; mercado: string; ver: () => void }) {
  const a = ACCIONES[t.accion]
  const plazo = t.plazo ? textoPlazo(t.plazo) : null
  const donde = a.donde ? RUTA_SELLER_CENTRAL[a.donde] : null
  const urlDonde = donde ? urlSellerCentral(mercado, donde.ruta) : null
  const [mensajeEntero, setMensajeEntero] = useState(false)

  return (
    <div className="px-4 py-[11px]">
      <div className="grid grid-cols-1 gap-x-4 gap-y-2 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-start">
        <div className="min-w-0">
          <button type="button" onClick={alternar} aria-expanded={abierta} className="group flex max-w-full items-start gap-[6px] text-left">
            {abierta ? <ChevronDown className="mt-[3px] h-3 w-3 shrink-0 text-[var(--ls-t4)]" /> : <ChevronRight className="mt-[3px] h-3 w-3 shrink-0 text-[var(--ls-t4)] group-hover:text-[var(--ls-t2)]" />}
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold leading-[1.35] text-[var(--ls-t1)]">{a.titulo}</span>
              <span className="mt-[2px] block text-[12px] leading-[1.45] text-[var(--ls-t3)]">{a.porque}</span>
            </span>
          </button>
          <div className="mt-[6px] flex flex-wrap items-center gap-[6px] pl-[18px]">
            {a.quien === 'cliente' && (
              <Etiqueta icono={<UserRound className="h-[11px] w-[11px]" />} color={COLOR_ESTADO.azul} titulo="Hace falta algo del cliente: documentos, un registro o un permiso">
                Necesita al cliente
              </Etiqueta>
            )}
            {a.deGolpe && (
              <Etiqueta icono={<Layers className="h-[11px] w-[11px]" />} color={COLOR_ESTADO.verde} titulo="Se arregla una vez y vale para todos los listings afectados">
                Se arregla de una vez
              </Etiqueta>
            )}
            {plazo && <Etiqueta color={plazo.color}>{plazo.texto}</Etiqueta>}
            {t.desde && <span className="text-[11px] text-[var(--ls-t4)]">la primera, {haceTiempo(t.desde)}</span>}
          </div>
        </div>

        <div className="flex items-baseline gap-2 pl-[18px] md:block md:pl-0 md:text-right">
          <span className="block text-[18px] font-semibold leading-none tabular-nums" style={{ color: t.conStock > 0 && t.nivel === 'bloquea' ? COLOR_ESTADO.rojo : 'var(--ls-t1)' }}>
            {cifra(t.conStock)}
          </span>
          <span className="mt-[3px] block text-[11px] text-[var(--ls-t4)]">con stock · de {cifra(t.listings)}</span>
        </div>

        <button type="button" onClick={ver} className="ml-[18px] inline-flex h-[28px] items-center justify-center gap-1 justify-self-start rounded-[8px] border border-[var(--ls-linea)] px-[10px] text-[12px] font-medium text-[var(--ls-t2)] transition-colors hover:border-[var(--ls-linea2)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)] md:ml-0 md:justify-self-end" title="Ver la lista de estos listings, con stock primero">
          Ver listings <ArrowRight className="h-3 w-3" />
        </button>
      </div>

      {abierta && (
        <div className="mt-[10px] ml-[18px] flex flex-col gap-[10px] rounded-[10px] bg-[var(--ls-sup2)] px-[14px] py-[11px]">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--ls-t4)]">Cómo se arregla</p>
            <ol className="mt-[5px] flex list-decimal flex-col gap-[4px] pl-[18px] text-[12.5px] leading-[1.5] text-[var(--ls-t2)]">
              {a.pasos.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ol>
          </div>
          {t.mensaje && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--ls-t4)]">Lo que dice Amazon</p>
              <button type="button" onClick={() => setMensajeEntero((v) => !v)} className={`mt-[4px] text-left text-[12px] leading-[1.5] text-[var(--ls-t3)] ${mensajeEntero ? '' : 'line-clamp-2'}`} title={mensajeEntero ? 'Ver menos' : 'Ver el mensaje entero'}>
                «{t.mensaje}»
              </button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-[var(--ls-t4)]">
            <span>Código{t.codigos.length === 1 ? '' : 's'} de Amazon: {t.codigos.join(' · ')}</span>
            {urlDonde && donde && (
              <a href={urlDonde} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-[var(--ls-t2)] hover:text-[var(--ls-t1)]" title="Hay que tener abierta la sesión con la cuenta del cliente">
                Seller Central · {donde.texto} <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {t.ayuda && (
              <a href={t.ayuda} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-[var(--ls-t2)] hover:text-[var(--ls-t1)]">
                Ayuda de Amazon <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Etiqueta({ children, color, icono, titulo }: { children: React.ReactNode; color: string; icono?: React.ReactNode; titulo?: string }) {
  return (
    <span title={titulo} className="inline-flex h-[20px] items-center gap-[4px] rounded-[6px] px-[7px] text-[11px] font-medium" style={{ color, background: `color-mix(in srgb, ${color} 12%, transparent)` }}>
      {icono}
      {children}
    </span>
  )
}

function Interruptor({ encendido, alPulsar, texto, ayuda, cuenta }: { encendido: boolean; alPulsar: () => void; texto: string; ayuda: string; cuenta?: number }) {
  return (
    <button type="button" role="switch" aria-checked={encendido} onClick={alPulsar} title={ayuda} className="inline-flex h-[30px] items-center gap-[7px] rounded-[9px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-[10px] text-[12px] font-medium text-[var(--ls-t2)] transition-colors hover:text-[var(--ls-t1)]">
      <span aria-hidden className={`relative h-[14px] w-[24px] rounded-full transition-colors ${encendido ? 'bg-[var(--ls-acc-graf)]' : 'bg-[var(--ls-sup3)]'}`}>
        <span className={`absolute top-[2px] h-[10px] w-[10px] rounded-full bg-white transition-all ${encendido ? 'left-[12px]' : 'left-[2px]'}`} />
      </span>
      {texto}
      {cuenta != null && cuenta > 0 && <span className="tabular-nums text-[11px] text-[var(--ls-t4)]">{cifra(cuenta)}</span>}
    </button>
  )
}

/** Para el número de la pestaña: las tareas que se ven por defecto (con stock, sin menores) */
export function tareasPendientes(tareas: readonly TareaDeHoy[]): number {
  return tareas.filter((t) => t.nivel !== 'menor' && t.conStock > 0).length
}

