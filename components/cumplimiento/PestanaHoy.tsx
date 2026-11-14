'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Check, ChevronDown, ClipboardCopy, EyeOff, ExternalLink, Gauge, History, Layers, ListTodo, MessageSquareShare, PartyPopper, Send, Store, UserRound, Wrench } from 'lucide-react'
import { Boton, CifraAnimada, FilaDeKpis, Insignia, Kpi, LineaDeTiempo, Tarjeta, TACTIL, BarraDeProgreso, type Hito } from '@/components/ui-ls'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { ACCIONES, RUTA_SELLER_CENTRAL, type TareaDeHoy } from '@/lib/cumplimiento/acciones'
import { RESOLUCION, ROTULO_RESOLUCION, type CorreccionRegistrada, type Resolucion } from '@/lib/cumplimiento/correccion'
import { urlSellerCentral } from '@/lib/cumplimiento/enlaces'
import { NIVELES, ROTULO_NIVEL, type Nivel } from '@/lib/cumplimiento/tipos'
import type { PanelDeCumplimiento } from '@/lib/cumplimiento/panel-calculo'
import { COLOR_NIVEL, cuentaAtras, haceTiempo, textoPlazo } from './comun'

type PanelOk = Extract<PanelDeCumplimiento, { ok: true }>
const cifra = (v: number) => v.toLocaleString('es-ES')

/** Las preferencias de esta pestaña se recuerdan en el navegador: cada persona tiene su forma de trabajar */
const CLAVE_PREFS = 'cumplimiento-hoy'

const ICONO_RESOLUCION: Record<Resolucion, typeof Wrench> = { erp: Wrench, 'seller-central': Store, cliente: UserRound }
const TONO_RESOLUCION: Record<Resolucion, 'verde' | 'azul' | 'violeta'> = { erp: 'verde', 'seller-central': 'azul', cliente: 'violeta' }

/**
 * «HOY»: QUÉ HAY QUE REVISAR, AGRUPADO POR LO QUE HAY QUE HACER.
 *
 * Es la pestaña de trabajo del día a día. En vez de 80 códigos de Amazon, una tarjeta por tarea («Pedir la aprobación de
 * la marca», «Registrar la RAP», «Rellenar el dato que falta») con su cifra grande, el plazo con cuenta atrás y el botón
 * que toca según quién lo arregla: «Corregir» si se hace desde el ERP, «Abrir Seller Central» si solo se puede allí, o
 * «Pedir al cliente» si hace falta algo suyo. Ordenadas por lo que cuesta dinero: primero lo oculto, luego la normativa
 * con plazo, luego lo que se vende pero peor; y dentro, lo que tiene stock delante.
 *
 * Por defecto solo se ve lo que tiene stock y nada de los avisos menores: lo demás está a un clic, pero no estorba.
 */
export function PestanaHoy({
  panel,
  cliente,
  mercado,
  nombreCliente,
  nombrePais,
  verTarea,
  corregirTarea,
  vuelta,
}: {
  panel: PanelOk
  cliente: string
  /** El país elegido, o 'todos' */
  mercado: string
  nombreCliente: string
  nombrePais: string
  verTarea: (t: TareaDeHoy, soloStock: boolean) => void
  corregirTarea: (t: TareaDeHoy) => void
  /** Sube al corregir algo: se vuelven a pedir las últimas correcciones */
  vuelta: number
}) {
  const [soloStock, setSoloStock] = useState(true)
  const [menores, setMenores] = useState(false)
  const [verSinStock, setVerSinStock] = useState<ReadonlySet<Nivel>>(new Set())
  const [copiado, setCopiado] = useState(false)
  const correcciones = useCorrecciones(cliente, mercado, vuelta)

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

  // El dominio de Seller Central de los enlaces: el del país elegido o, con «todos», el de España o el primero
  const mercadoEnlaces = mercado !== 'todos' ? mercado : (panel.paises.find((p) => p.pais === 'ES') ?? panel.paises[0])?.id ?? ''
  const c = panel.cifras

  const secciones = useMemo(() => {
    const niveles = NIVELES.filter((n) => menores || n !== 'menor')
    return niveles.map((nivel) => {
      const todas = panel.tareas.filter((t) => t.nivel === nivel)
      return { nivel, todas, conStock: todas.filter((t) => t.conStock > 0), sinStock: todas.filter((t) => t.conStock === 0) }
    })
  }, [panel.tareas, menores])

  const nMenores = panel.tareas.filter((t) => t.nivel === 'menor').reduce((s, t) => s + t.listings, 0)
  const importantes = panel.tareas.filter((t) => t.nivel !== 'menor')
  const pendientes = importantes.filter((t) => t.conStock > 0)
  const corregibles = pendientes.filter((t) => RESOLUCION[t.accion] === 'erp').length

  // La serie de la foto diaria (los 30 últimos días) y el punto de hace una semana, para las variaciones
  const diario = panel.diario.slice(-30)
  const haceUnaSemana = diario.length > 7 ? diario[diario.length - 8] : diario[0]
  const salud = c.revisados > 0 ? (c.revisados - c.atencion) / c.revisados : null
  const enviadasSemana = correcciones?.lista.filter((x) => x.estado === 'aceptado' && Date.now() - Date.parse(x.creadoAt) < 7 * 86_400_000).length ?? null

  /** Un resumen en texto, para pegarlo en el chat del equipo o en una tarea del cliente */
  const copiar = async () => {
    const lineas = [`${nombreCliente} · ${nombrePais} — qué revisar hoy en Amazon`]
    for (const s of secciones) {
      const lista = (soloStock ? s.conStock : s.todas).filter((t) => t.nivel !== 'menor')
      if (lista.length === 0) continue
      lineas.push('', `${ROTULO_NIVEL[s.nivel].corto}:`)
      for (const t of lista) {
        const plazo = t.plazo ? ` · ${textoPlazo(t.plazo).texto.toLowerCase()}` : ''
        lineas.push(`• ${ACCIONES[t.accion].titulo}: ${cifra(t.conStock)} con stock (${cifra(t.listings)} listings) · ${ROTULO_RESOLUCION[RESOLUCION[t.accion]].corto.toLowerCase()}${plazo}`)
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
      <Tarjeta acento="cumplimiento" icono={ListTodo} titulo="Todavía no se ha revisado ningún listing aquí" className="max-w-[760px]">
        <p className="text-[13px] text-[var(--ls-t3)]">La revisión pasa sola cada hora, empezando por lo que tiene stock. También se puede lanzar ahora desde la pestaña «Listings».</p>
      </Tarjeta>
    )

  let indice = 0
  return (
    <div className="flex max-w-[1240px] flex-col gap-5 pb-10">
      {/* ---- las cifras de arriba ---- */}
      <FilaDeKpis minimo={200}>
        <Kpi
          indice={0}
          etiqueta="Con stock y bloqueados"
          valor={c.atencionConStock}
          icono={EyeOff}
          acento={c.atencionConStock > 0 ? COLOR_ESTADO.rojo : COLOR_ESTADO.verde}
          anterior={haceUnaSemana?.atencionConStock ?? null}
          mejor="baja"
          serie={diario.map((d) => d.atencionConStock)}
          nota="Listings con stock ocultos o con error: lo que se deja de vender hoy"
        />
        <Kpi indice={1} etiqueta="Tareas para hoy" valor={pendientes.length} icono={ListTodo} acento="cumplimiento" nota={corregibles > 0 ? `${corregibles} se ${corregibles === 1 ? 'corrige' : 'corrigen'} desde el ERP` : 'Con stock afectado'} />
        <Kpi
          indice={2}
          etiqueta="Salud del catálogo"
          valor={salud}
          formato={(v) => `${(Math.floor(v * 1000) / 10).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`}
          icono={Gauge}
          acento={salud == null ? 'neutro' : salud >= 0.95 ? COLOR_ESTADO.verde : salud >= 0.85 ? COLOR_ESTADO.ambar : COLOR_ESTADO.rojo}
          anterior={haceUnaSemana && haceUnaSemana.revisados > 0 ? (haceUnaSemana.revisados - haceUnaSemana.atencion) / haceUnaSemana.revisados : null}
          mejor="sube"
          serie={diario.map((d) => (d.revisados > 0 ? (d.revisados - d.atencion) / d.revisados : 0))}
          nota="Revisados sin errores ni ocultos"
        />
        <Kpi
          indice={3}
          etiqueta="Corregido esta semana"
          valor={enviadasSemana}
          icono={Send}
          acento={COLOR_ESTADO.verde}
          cargando={correcciones === null}
          nota={correcciones?.faltaMigracion ? 'Falta lanzar la migración 313' : 'Envíos desde el ERP aceptados por Amazon'}
        />
      </FilaDeKpis>

      {/* ---- el progreso y cómo se mira ---- */}
      <Tarjeta acento="cumplimiento" indice={4}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1">
            <BarraDeProgreso
              valor={c.revisados - c.atencion}
              maximo={Math.max(1, c.revisados)}
              tono={salud == null ? 'gris' : salud >= 0.95 ? 'verde' : salud >= 0.85 ? 'ambar' : 'rojo'}
              etiqueta="Listings revisados sin problemas"
              detalle={`${cifra(c.revisados - c.atencion)} de ${cifra(c.revisados)}`}
            />
            <p className="mt-2 text-[12px] text-[var(--ls-t4)]">
              {haceUnaSemana && haceUnaSemana.atencion !== c.atencion ? (
                haceUnaSemana.atencion > c.atencion ? (
                  <span style={{ color: COLOR_ESTADO.verde }}>{cifra(haceUnaSemana.atencion - c.atencion)} resueltos desde hace una semana</span>
                ) : (
                  <span style={{ color: COLOR_ESTADO.ambar }}>{cifra(c.atencion - haceUnaSemana.atencion)} más con atención que hace una semana</span>
                )
              ) : (
                'Igual que hace una semana'
              )}
              {c.total > c.revisados && <> · revisado el {Math.floor((c.revisados / c.total) * 100)} % del catálogo</>}
              {c.ultimaRevision && <> · última revisión {haceTiempo(c.ultimaRevision)}</>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
              texto="Avisos menores"
              cuenta={nMenores}
              ayuda="Recomendaciones de Amazon, cambios rechazados que dejan la ficha como estaba y errores internos: no cambian nada en la venta"
            />
            <Boton variante="secundario" tamano="sm" icono={copiado ? Check : ClipboardCopy} onClick={() => void copiar()} title="Copiar la lista de tareas en texto, para pegarla en el chat o en una tarea del cliente">
              {copiado ? 'Copiado' : 'Copiar resumen'}
            </Boton>
          </div>
        </div>
      </Tarjeta>

      {importantes.length === 0 && (
        <Tarjeta variante="destacada" acento={COLOR_ESTADO.verde} icono={PartyPopper} titulo="Todo en orden">
          <p className="text-[13px] text-[var(--ls-t3)]">
            Amazon no tiene nada oculto, ni normativa pendiente, ni nada que afecte a la venta en los listings revisados.
            {nMenores > 0 && !menores && <> Hay avisos menores (no cambian nada en la venta): enciende «Avisos menores» para verlos.</>}
          </p>
        </Tarjeta>
      )}

      {/* ---- una sección por importancia, con una tarjeta por tarea ---- */}
      {secciones.map((s) => {
        if (s.todas.length === 0) return null
        const lista = soloStock ? s.conStock : s.todas
        const abiertaSin = verSinStock.has(s.nivel)
        const color = COLOR_NIVEL[s.nivel]
        return (
          <section key={s.nivel} aria-label={ROTULO_NIVEL[s.nivel].corto} className="flex flex-col gap-3">
            <header className="flex items-center gap-3">
              <span aria-hidden className="h-[10px] w-[10px] shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 0 4px color-mix(in srgb, ${color} 18%, transparent), 0 0 14px color-mix(in srgb, ${color} 55%, transparent)` }} />
              <div className="min-w-0 flex-1">
                <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-[var(--ls-t1)]">{ROTULO_NIVEL[s.nivel].corto}</h2>
                <p className="hidden truncate text-[12px] text-[var(--ls-t4)] sm:block">{ROTULO_NIVEL[s.nivel].largo}</p>
              </div>
              <Insignia tono="gris" tamano="sm">
                {lista.length} {lista.length === 1 ? 'tarea' : 'tareas'}
              </Insignia>
            </header>
            {lista.length === 0 ? (
              <p className="rounded-[12px] border border-dashed border-[var(--ls-linea2)] px-4 py-3 text-[12.5px] text-[var(--ls-t3)]">Nada con stock. {s.sinStock.length > 0 && 'Lo que hay es de listings sin stock (abajo).'}</p>
            ) : (
              <div className="grid gap-3 xl:grid-cols-2">
                {lista.map((t) => (
                  <TarjetaDeTarea key={`${t.nivel}|${t.accion}`} t={t} indice={Math.min(12, ++indice)} mercado={mercadoEnlaces} nombreCliente={nombreCliente} nombrePais={nombrePais} ver={() => verTarea(t, soloStock && t.conStock > 0)} corregir={() => corregirTarea(t)} />
                ))}
              </div>
            )}
            {soloStock && s.sinStock.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setVerSinStock((prev) => { const n = new Set(prev); if (n.has(s.nivel)) n.delete(s.nivel); else n.add(s.nivel); return n })}
                  aria-expanded={abiertaSin}
                  className={`inline-flex items-center gap-[6px] rounded-[8px] px-2 text-left text-[12.5px] text-[var(--ls-t3)] transition-colors hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)] ${TACTIL}`}
                >
                  <ChevronDown className={`h-3 w-3 transition-transform ${abiertaSin ? '' : '-rotate-90'}`} />
                  {s.sinStock.length} {s.sinStock.length === 1 ? 'tarea' : 'tareas'} solo en listings sin stock ({cifra(s.sinStock.reduce((n, t) => n + t.listings, 0))} listings): pueden esperar
                </button>
                {abiertaSin && (
                  <div className="mt-3 grid gap-3 opacity-85 xl:grid-cols-2">
                    {s.sinStock.map((t) => (
                      <TarjetaDeTarea key={`${t.nivel}|${t.accion}`} t={t} mercado={mercadoEnlaces} nombreCliente={nombreCliente} nombrePais={nombrePais} ver={() => verTarea(t, false)} corregir={() => corregirTarea(t)} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        )
      })}

      {correcciones && correcciones.lista.length > 0 && <UltimasCorrecciones lista={correcciones.lista} />}

      <p className="text-[11.5px] leading-[1.5] text-[var(--ls-t4)]">
        Cada tarea junta las incidencias de Amazon que se arreglan igual. Las cifras son de lo revisado: un listing con dos problemas distintos sale en las dos tareas.
        {!panel.exacto && <> Cifras aproximadas hasta lanzar la migración 306: un listing con dos incidencias de la misma tarea cuenta dos veces y los avisos menores salen incompletos.</>}
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Una tarea                                                           */
/* ------------------------------------------------------------------ */

function TarjetaDeTarea({ t, indice, mercado, nombreCliente, nombrePais, ver, corregir }: { t: TareaDeHoy; indice?: number; mercado: string; nombreCliente: string; nombrePais: string; ver: () => void; corregir: () => void }) {
  const a = ACCIONES[t.accion]
  const resolucion = RESOLUCION[t.accion]
  const Icono = ICONO_RESOLUCION[resolucion]
  const plazo = t.plazo ? cuentaAtras(t.plazo) : null
  const donde = a.donde ? RUTA_SELLER_CENTRAL[a.donde] : null
  const urlDonde = donde ? urlSellerCentral(mercado, donde.ruta) : null
  const [abierta, setAbierta] = useState(false)
  const [copiado, setCopiado] = useState(false)
  const bloquea = t.nivel === 'bloquea' && t.conStock > 0
  const color = COLOR_NIVEL[t.nivel]

  const pedirAlCliente = async () => {
    const texto = [
      `Hola, ${nombreCliente}:`,
      '',
      `En Amazon ${nombrePais} tenemos pendiente «${a.titulo.toLowerCase()}», que afecta a ${cifra(t.listings)} ${t.listings === 1 ? 'producto' : 'productos'}${t.conStock > 0 ? ` (${cifra(t.conStock)} con stock)` : ''}.`,
      a.porque,
      t.plazo ? `Amazon da como plazo el ${textoPlazo(t.plazo).texto.replace(/^Plazo(?: de Amazon vencido el|:)\s*/, '')}.` : '',
      '',
      'Para resolverlo necesitamos que nos enviéis lo que pide Amazon. ¿Nos lo podéis mandar?',
    ]
      .filter((l, i, arr) => l !== '' || arr[i - 1] !== '')
      .join('\n')
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1800)
    } catch {
      /* sin portapapeles */
    }
  }

  const principal =
    resolucion === 'erp' ? (
      <Boton variante="primario" tamano="sm" icono={Wrench} onClick={corregir} title="Corregir el dato desde el ERP: se valida con Amazon antes de enviarlo">
        Corregir
      </Boton>
    ) : resolucion === 'seller-central' && urlDonde ? (
      <Boton variante="primario" tamano="sm" icono={ExternalLink} asChild>
        <a href={urlDonde} target="_blank" rel="noreferrer" title="Hay que tener abierta la sesión con la cuenta del cliente">
          Abrir Seller Central
        </a>
      </Boton>
    ) : resolucion === 'cliente' ? (
      <Boton variante="primario" tamano="sm" icono={copiado ? Check : MessageSquareShare} onClick={() => void pedirAlCliente()} title="Copia un mensaje para el cliente con lo que pide Amazon">
        {copiado ? 'Mensaje copiado' : 'Pedir al cliente'}
      </Boton>
    ) : null

  return (
    <Tarjeta
      variante={bloquea ? 'destacada' : 'normal'}
      acento={color}
      indice={indice}
      className="ls-elevar"
      sinRelleno
      aria-label={a.titulo}
    >
      <div className="flex gap-4 px-4 pb-3 pt-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px]" style={{ background: `linear-gradient(140deg, color-mix(in srgb, ${color} 26%, transparent), color-mix(in srgb, ${color} 8%, transparent))`, color, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 30%, transparent)` }}>
          <Icono className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] font-semibold leading-[1.35] tracking-[-0.01em] text-[var(--ls-t1)]">{a.titulo}</h3>
          <p className="mt-[3px] line-clamp-2 text-[12.5px] leading-[1.45] text-[var(--ls-t3)]">{a.porque}</p>
        </div>
        <div className="shrink-0 text-right">
          <CifraAnimada valor={t.conStock} formato={(v) => cifra(Math.round(v))} className="block text-[26px] font-semibold leading-none tabular-nums tracking-[-0.03em]" />
          <span className="mt-1 block text-[11px] text-[var(--ls-t4)]">con stock</span>
          <span className="block text-[11px] text-[var(--ls-t4)]">de {cifra(t.listings)}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-[6px] px-4 pb-3">
        <Insignia tamano="sm" tono={TONO_RESOLUCION[resolucion]} icono={Icono} title={ROTULO_RESOLUCION[resolucion].largo}>
          {ROTULO_RESOLUCION[resolucion].corto}
        </Insignia>
        {plazo && (
          <Insignia tamano="sm" tono={plazo.tono} vivo={plazo.dias <= 7} title={textoPlazo(t.plazo as string).texto}>
            {plazo.texto}
          </Insignia>
        )}
        {a.deGolpe && (
          <Insignia tamano="sm" tono="cian" icono={Layers} title="Se arregla una vez y vale para todos los listings afectados">
            De una vez
          </Insignia>
        )}
        {t.desde && <span className="text-[11px] text-[var(--ls-t4)]">la primera, {haceTiempo(t.desde)}</span>}
      </div>

      {abierta && (
        <div className="mx-4 mb-3 flex flex-col gap-[10px] rounded-[12px] bg-[var(--ls-sup2)] px-[14px] py-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--ls-t4)]">Cómo se arregla</p>
            <ol className="mt-[5px] flex list-decimal flex-col gap-[4px] pl-[18px] text-[12.5px] leading-[1.5] text-[var(--ls-t2)]">
              {a.pasos.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ol>
          </div>
          {t.mensaje && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--ls-t4)]">Lo que dice Amazon</p>
              <p className="mt-[4px] line-clamp-6 text-[12px] leading-[1.5] text-[var(--ls-t3)]">«{t.mensaje}»</p>
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

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--ls-linea)] px-4 py-[10px]">
        {principal}
        <Boton variante="secundario" tamano="sm" iconoDerecha={ArrowRight} onClick={ver} title="Ver la lista de estos listings, con stock primero">
          Ver listings
        </Boton>
        <Boton variante="fantasma" tamano="sm" className="ml-auto" onClick={() => setAbierta((v) => !v)} aria-expanded={abierta}>
          {abierta ? 'Menos' : 'Cómo se arregla'}
          <ChevronDown className={`h-3 w-3 transition-transform ${abierta ? 'rotate-180' : ''}`} aria-hidden />
        </Boton>
      </div>
    </Tarjeta>
  )
}

/* ------------------------------------------------------------------ */
/* Las últimas correcciones                                            */
/* ------------------------------------------------------------------ */

function useCorrecciones(cliente: string, mercado: string, vuelta: number): { lista: CorreccionRegistrada[]; faltaMigracion: boolean } | null {
  const [datos, setDatos] = useState<{ lista: CorreccionRegistrada[]; faltaMigracion: boolean } | null>(null)
  useEffect(() => {
    let vivo = true
    void fetch('/api/cumplimiento', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'correcciones', cliente, mercado }) })
      .then((r) => r.json())
      .then((j: { correcciones?: CorreccionRegistrada[] | null; faltaMigracion?: boolean }) => {
        if (vivo) setDatos({ lista: j.correcciones ?? [], faltaMigracion: Boolean(j.faltaMigracion) })
      })
      .catch(() => vivo && setDatos({ lista: [], faltaMigracion: false }))
    return () => {
      vivo = false
    }
  }, [cliente, mercado, vuelta])
  return datos
}

function UltimasCorrecciones({ lista }: { lista: CorreccionRegistrada[] }) {
  const hitos: Hito[] = lista.map((h) => ({
    id: h.id,
    titulo: (
      <>
        {h.sku} <span className="font-normal text-[var(--ls-t3)]">· {h.atributos.join(', ') || 'atributos'}</span>
      </>
    ),
    descripcion: h.estado === 'aceptado' ? 'Enviado y aceptado por Amazon' : (h.mensaje ?? 'Amazon lo rechazó'),
    cuando: h.creadoAt,
    tono: h.estado === 'aceptado' ? 'verde' : 'rojo',
    icono: Send,
    autor: h.creadoPor ?? undefined,
  }))
  return (
    <Tarjeta icono={History} acento="cumplimiento" titulo="Últimas correcciones desde el ERP" subtitulo="Cada envío queda registrado con lo que había antes">
      <LineaDeTiempo eventos={hitos} maximo={8} />
    </Tarjeta>
  )
}

function Interruptor({ encendido, alPulsar, texto, ayuda, cuenta }: { encendido: boolean; alPulsar: () => void; texto: string; ayuda: string; cuenta?: number }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={encendido}
      onClick={alPulsar}
      title={ayuda}
      className={`inline-flex h-8 items-center gap-2 rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-3 text-[12.5px] font-medium text-[var(--ls-t2)] transition-colors hover:text-[var(--ls-t1)] ${TACTIL}`}
    >
      <span aria-hidden className={`relative h-[16px] w-[28px] rounded-full transition-colors ${encendido ? 'bg-[var(--ls-acc-graf)]' : 'bg-[var(--ls-sup3)]'}`}>
        <span className={`absolute top-[2px] h-[12px] w-[12px] rounded-full bg-white shadow transition-all ${encendido ? 'left-[14px]' : 'left-[2px]'}`} />
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
