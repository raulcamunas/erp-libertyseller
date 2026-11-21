'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Check, ChevronDown, ChevronRight, CircleAlert, Loader2, ShieldAlert, Sparkles, X } from 'lucide-react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { CAJA } from '@/components/marketing-test/piezas'
import { llamar } from '@/components/marketing-test/llamar'
import { bytesDe, caracteresDe, coberturaDe, LIMITE_BACKEND_BYTES, LIMITE_BULLETS_BYTES, LIMITE_HIGHLIGHTS_CARACTERES, LIMITE_TITULO_CARACTERES } from '@/lib/seo/cobertura'
import { esRelevante, NOMBRE_DE_ETAPA, RESPONSABLE } from '@/lib/seo/embudo'
import { avisosRojos, DIAS_DE_VALIDEZ_PROPUESTA, motivoFichaCambiada, trozosNuevos, type AvisoDeVigilancia, type TextosPropuestos } from '@/lib/seo/propuesta'
import type { PropuestaGuardada } from '@/lib/seo/propuesta-servidor'
import type { ventanaDeCambio } from '@/lib/seo/tareas'
import { BotonCopiar, type DiagnosticoDeProducto } from './comun'
import { useDelProducto } from './useDelProducto'

const ESTADO: Record<PropuestaGuardada['estado'], { texto: string; color: string }> = {
  pendiente: { texto: 'Pendiente de tu OK', color: COLOR_ESTADO.ambar },
  aplicada: { texto: 'Aplicada en Amazon', color: COLOR_ESTADO.verde },
  descartada: { texto: 'Descartada', color: 'var(--ls-t4)' },
  error: { texto: 'Amazon la rechazó', color: COLOR_ESTADO.rojo },
}

const CADUCADA = { texto: 'Caducada', color: 'var(--ls-t4)' }
const estadoDe = (p: PropuestaGuardada) => (p.caducada ? CADUCADA : ESTADO[p.estado])

const fecha = (iso: string) => new Date(iso).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/**
 * LA PROPUESTA DE FICHA CON IA de un producto, con las reglas de 2026 del SOP. La IA PROPONE y aquí se ve, al lado de lo que hay, con lo nuevo resaltado, los recuentos CALCULADOS (caracteres y
 * bytes), la cobertura de búsquedas antes y después, lo descartado y por qué. Cada campo se copia para pegarlo en Seller Central.
 *
 * Antes de pedirla, la puerta de salida del SOP: si el embudo dice que se pierde en clics, carrito o compra, se avisa (se puede pedir igual, pero sabiendo que no es lo primero). A Amazon solo
 * llega si una persona pulsa «Aplicar en Amazon» y lo confirma (dos clics a propósito: cambia la ficha del cliente); y no si la ficha se cambió hace menos de 30 días. Los Item Highlights se
 * mandan con el atributo del tipo de producto (si no lo tiene, se avisa). Después se comprueba al releer la ficha si de verdad ha quedado.
 *
 * Frenos (fallos 13 y 14): los avisos ROJOS de la vigilancia (marca de un rival arriba, búsqueda descartada, título sin la marca) salen arriba y, si hay alguno, «Aplicar» pide una SEGUNDA
 * confirmación que los enumera. Si la ficha guardada de hoy ya no es aquella sobre la que se escribió la propuesta, o la propuesta tiene más de 7 días, «Aplicar» no se ofrece: hay que pedir otra.
 */
export function PropuestaConIa({ cuentaId, asin, hayBusquedas, hayFicha, mejoras, diagnostico, ventana }: { cuentaId: string; asin: string; hayBusquedas: boolean; hayFicha: boolean; mejoras: boolean; diagnostico: DiagnosticoDeProducto | null; ventana: ReturnType<typeof ventanaDeCambio> }) {
  const { datos, recargar } = useDelProducto<{ propuestas: PropuestaGuardada[]; sinMigracion?: boolean }>(mejoras ? `/api/seo/propuestas?cuenta=${encodeURIComponent(cuentaId)}&asin=${asin}` : null)
  const [pidiendo, setPidiendo] = useState(false)
  // 0 = sin confirmar · 1 = primera confirmación · 2 = segunda, con los avisos rojos enumerados
  const [confirmar, setConfirmar] = useState<0 | 1 | 2>(0)
  const [aplicando, setAplicando] = useState(false)
  const [rechazo, setRechazo] = useState<{ motivo: string; issues: Array<{ message?: string; code?: string }>; freno: boolean } | null>(null)
  const [verHistorial, setVerHistorial] = useState(false)

  const propuestas = datos?.propuestas ?? []
  const actual = propuestas[0] ?? null
  const vigilancia: AvisoDeVigilancia[] = actual?.razonamiento.vigilancia ?? []
  const rojos = avisosRojos(vigilancia)
  const ambar = vigilancia.filter((a) => a.nivel === 'ambar')
  const fichaCambiada = actual?.fichaCambiada ?? []

  async function proponer() {
    setPidiendo(true)
    setRechazo(null)
    try {
      await llamar('/api/seo/propuestas', { metodo: 'POST', cuerpo: { cuenta: cuentaId, asin, accion: 'proponer' } })
      await recargar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido pedir la propuesta.')
    } finally {
      setPidiendo(false)
    }
  }

  async function aplicar(id: string, aceptarAvisos: boolean) {
    setAplicando(true)
    setRechazo(null)
    try {
      const res = await fetch('/api/seo/propuestas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cuenta: cuentaId, id, accion: 'aplicar', aceptarAvisos }) })
      const j = (await res.json().catch(() => ({}))) as { error?: string; issues?: Array<{ message?: string; code?: string }>; avisos?: string | null; fichaCambiada?: string[] | null; avisosRojos?: unknown[] | null }
      if (!res.ok) {
        // Un freno del ERP (ficha cambiada, avisos sin confirmar, caducada…) no es un rechazo de Amazon: no se ha mandado nada
        setRechazo({ motivo: j.error ?? `Error ${res.status}`, issues: j.issues ?? [], freno: (j.issues ?? []).length === 0 })
      } else {
        toast.success(j.avisos ? `Enviada a Amazon con avisos: ${j.avisos}` : 'Enviada a Amazon. La procesa en unos minutos y la ficha se vuelve a leer sola.')
      }
      setConfirmar(0)
      await recargar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido aplicar.')
    } finally {
      setAplicando(false)
    }
  }

  async function descartar(id: string) {
    try {
      await llamar('/api/seo/propuestas', { metodo: 'POST', cuerpo: { cuenta: cuentaId, id, accion: 'descartar' } })
      await recargar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido descartar.')
    }
  }

  const puedePedir = hayBusquedas && hayFicha && !pidiendo
  const v = diagnostico?.producto.veredicto
  const noEsSeo = v?.tipo === 'fuga'
  const boton = (
    <button type="button" disabled={!puedePedir} onClick={proponer} className="inline-flex h-[30px] items-center gap-[6px] rounded-[9px] bg-[var(--ls-acc-relleno)] px-3 text-[12.5px] font-semibold text-[var(--ls-acc-tinta)] disabled:opacity-50" title={!hayFicha ? 'Falta leer la ficha' : !hayBusquedas ? 'Faltan las búsquedas de Brand Analytics' : 'La IA escribe una propuesta. No se aplica sola.'}>
      {pidiendo ? <Loader2 className="h-[13px] w-[13px] animate-spin" /> : <Sparkles className="h-[13px] w-[13px]" />}
      {pidiendo ? 'La IA está escribiendo…' : noEsSeo ? 'Proponer igualmente' : actual ? 'Pedir otra propuesta' : 'Proponer ficha con IA'}
    </button>
  )

  return (
    <section className={CAJA.base}>
      <header className={`${CAJA.cabecera} flex-wrap`}>
        <Sparkles className="h-[14px] w-[14px]" style={{ color: 'var(--ls-acc)' }} />
        <h3 className="text-[13px] font-semibold text-[var(--ls-t1)]">Propuesta de ficha con IA</h3>
        <span className="text-[11.5px] text-[var(--ls-t4)]">la IA propone · solo se aplica en Amazon con tu OK</span>
        <span className="ml-auto">{mejoras && !datos?.sinMigracion && boton}</span>
      </header>
      <div className={`${CAJA.cuerpo} flex flex-col gap-3`}>
        {noEsSeo && v?.tipo === 'fuga' && (
          <p className="flex items-start gap-2 rounded-[10px] px-3 py-[8px] text-[12px] leading-[1.5]" style={{ color: COLOR_ESTADO.ambar, background: `color-mix(in srgb, ${COLOR_ESTADO.ambar} 9%, transparent)` }}>
            <CircleAlert className="mt-[2px] h-3 w-3 shrink-0" />
            <span>
              El embudo se cae en {NOMBRE_DE_ETAPA[v.etapa].toLowerCase()}: lo primero es de «{RESPONSABLE[v.etapa].quien}», no de la ficha. Una propuesta nueva no arregla eso (SOP: «para y dilo»).
            </span>
          </p>
        )}
        {!mejoras || datos?.sinMigracion ? (
          <p className="text-[12.5px]" style={{ color: COLOR_ESTADO.ambar }}>Falta lanzar la migración 299 en Supabase para guardar las propuestas.</p>
        ) : pidiendo && !actual ? (
          <p className="text-[12.5px] text-[var(--ls-t3)]">Leyendo las búsquedas que venden y escribiendo título, bullets y backend. Tarda entre 20 segundos y un minuto…</p>
        ) : !actual ? (
          <p className="text-[12.5px] text-[var(--ls-t3)]">
            La IA reescribe el título (75 caracteres), los Item Highlights (125), las cinco viñetas (1.000 bytes) y el backend (249 bytes) para las búsquedas DEL producto que más venden, sin las descartadas (ruido y falsos amigos por precio) y sin inventar nada que no diga ya la ficha. Verás la propuesta al lado de lo que hay, con los recuentos calculados, la cobertura antes y después y el porqué. No se toca Amazon hasta que tú lo apliques.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
              <span className="rounded-full px-[9px] py-[2px] font-semibold" style={{ color: estadoDe(actual).color, background: `color-mix(in srgb, ${estadoDe(actual).color} 13%, transparent)` }}>{estadoDe(actual).texto}</span>
              <span className="text-[var(--ls-t4)]">propuesta del {fecha(actual.creadaAt)}{actual.modelo ? ` · ${actual.modelo}` : ''}</span>
              {actual.aplicadaAt && <span className="text-[var(--ls-t4)]">· aplicada el {fecha(actual.aplicadaAt)}</span>}
            </div>

            {actual.estado === 'pendiente' && rojos.length > 0 && <AvisosRojos avisos={rojos} />}
            {actual.estado === 'pendiente' && !actual.caducada && fichaCambiada.length > 0 && (
              <p className="flex items-start gap-2 rounded-[10px] px-3 py-[8px] text-[12px] leading-[1.5]" style={{ color: COLOR_ESTADO.ambar, background: `color-mix(in srgb, ${COLOR_ESTADO.ambar} 9%, transparent)` }}>
                <CircleAlert className="mt-[2px] h-3 w-3 shrink-0" />
                <span>{motivoFichaCambiada(fichaCambiada)} Si la aplicaras, pisaría lo que se cambió después.</span>
              </p>
            )}
            {actual.caducada && (
              <p className="flex items-start gap-2 rounded-[10px] bg-[var(--ls-sup2)] px-3 py-[8px] text-[12px] leading-[1.5] text-[var(--ls-t3)]">
                <CircleAlert className="mt-[2px] h-3 w-3 shrink-0" />
                <span>Esta propuesta tiene más de {DIAS_DE_VALIDEZ_PROPUESTA} días y ha caducado: las búsquedas y la ficha pueden haber cambiado. Pulsa «Pedir otra propuesta» (cuesta céntimos).</span>
              </p>
            )}

            {actual.razonamiento.resumen && <p className="rounded-[10px] bg-[var(--ls-sup2)] px-3 py-[9px] text-[12.5px] leading-[1.55] text-[var(--ls-t2)]">{actual.razonamiento.resumen}</p>}

            <Comparacion antes={actual.antes} despues={actual.propuesta} />
            {diagnostico && <CoberturaAntesDespues d={diagnostico} antes={actual.antes} despues={actual.propuesta} />}

            {actual.razonamiento.cambios.length > 0 && (
              <div className="flex flex-col gap-[6px]">
                <span className="text-[12px] font-semibold text-[var(--ls-t1)]">Por qué</span>
                {actual.razonamiento.cambios.map((c, i) => (
                  <div key={i} className="grid grid-cols-[70px_minmax(0,1fr)] gap-2 text-[12px] leading-[1.5]">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.03em] text-[var(--ls-t4)]">{c.campo}</span>
                    <span className="text-[var(--ls-t2)]">
                      <span className="text-[var(--ls-t1)]">{c.que}</span>
                      {c.porQue && <span className="text-[var(--ls-t3)]"> — {c.porQue}</span>}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {actual.razonamiento.palabrasNuevas.length > 0 && (
              <div className="flex flex-wrap items-center gap-[5px]">
                <span className="text-[11.5px] text-[var(--ls-t4)]">Palabras que entran:</span>
                {actual.razonamiento.palabrasNuevas.map((p) => (
                  <span key={p} className="rounded-[6px] px-[7px] py-[1px] text-[11.5px] font-medium" style={{ color: COLOR_ESTADO.verde, background: `color-mix(in srgb, ${COLOR_ESTADO.verde} 12%, transparent)` }}>{p}</span>
                ))}
              </div>
            )}
            {(actual.razonamiento.descartado?.length ?? 0) > 0 && (
              <div className="flex flex-col gap-[4px]">
                <span className="text-[12px] font-semibold text-[var(--ls-t1)]">Descartado y por qué</span>
                {actual.razonamiento.descartado?.map((d) => (
                  <div key={d.termino} className="text-[12px] leading-[1.5] text-[var(--ls-t3)]">
                    <span className="font-medium text-[var(--ls-t2)]">{d.termino}</span> — {d.porQue}
                  </div>
                ))}
              </div>
            )}
            {(actual.razonamiento.avisos?.length ?? 0) > 0 && <p className="text-[11.5px]" style={{ color: COLOR_ESTADO.ambar }}>Al revisar la propuesta: {actual.razonamiento.avisos?.join(' ')}</p>}
            {ambar.length > 0 && (
              <ul className="flex flex-col gap-[3px] text-[11.5px] leading-[1.5]" style={{ color: COLOR_ESTADO.ambar }}>
                {ambar.map((a, i) => <li key={i}>· {a.texto}</li>)}
              </ul>
            )}

            {(rechazo || (actual.error && actual.estado !== 'aplicada')) && (
              <div className="rounded-[10px] border px-3 py-[9px] text-[12px] leading-[1.5]" style={{ borderColor: `color-mix(in srgb, ${COLOR_ESTADO.rojo} 40%, transparent)`, color: COLOR_ESTADO.rojo }}>
                <div className="flex items-center gap-2 font-semibold"><ShieldAlert className="h-[13px] w-[13px]" /> {(rechazo ? rechazo.freno : actual.estado === 'descartada') ? 'No se ha mandado nada a Amazon' : 'Amazon no la ha aceptado'}</div>
                <div className="mt-1 text-[var(--ls-t2)]">{rechazo?.motivo ?? actual.error}</div>
                {(rechazo?.issues ?? []).map((i, k) => <div key={k} className="text-[11.5px] text-[var(--ls-t3)]">· {i.message ?? i.code}</div>)}
              </div>
            )}
            {actual.estado === 'aplicada' && actual.resultado?.mensaje && <p className="text-[11.5px] text-[var(--ls-t4)]">Avisos de Amazon al aplicar: {actual.resultado.mensaje}</p>}
            {/* Solo las aplicadas con registro (migración 312) se verifican: las de antes, o sin la 312, se quedaban con «Comprobando…» para siempre */}
            {actual.estado === 'aplicada' && (actual.resultado?.edicionId || actual.resultado?.verificacion) && <Verificacion v={actual.resultado?.verificacion ?? null} />}

            {actual.estado === 'pendiente' && (
              <div className="flex flex-wrap items-center gap-2 border-t border-[var(--ls-linea)] pt-3">
                <BotonCopiar texto={textoParaCopiar(actual.propuesta)} etiqueta="Copiar todo" />
                {actual.caducada || fichaCambiada.length > 0 ? (
                  <>
                    <button type="button" disabled title={actual.caducada ? 'Ha caducado: pide otra propuesta' : 'La ficha ha cambiado: pide otra propuesta'} className="inline-flex h-[32px] cursor-not-allowed items-center gap-[6px] rounded-[9px] bg-[var(--ls-acc-relleno)] px-3 text-[12.5px] font-semibold text-[var(--ls-acc-tinta)] opacity-50">
                      <Check className="h-[13px] w-[13px]" /> Aplicar en Amazon
                    </button>
                    <button type="button" onClick={() => descartar(actual.id)} className="inline-flex h-[32px] items-center gap-[6px] rounded-[9px] border border-[var(--ls-linea)] px-3 text-[12.5px] font-medium text-[var(--ls-t2)] hover:bg-[var(--ls-sup2)]">
                      <X className="h-[13px] w-[13px]" /> Descartar
                    </button>
                  </>
                ) : ventana?.bloqueada ? (
                  <span className="text-[12px]" style={{ color: COLOR_ESTADO.ambar }}>
                    No se puede aplicar todavía: la ficha se cambió el {new Date(`${ventana.ultimo}T00:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', timeZone: 'UTC' })} y el SOP pide 30 días entre cambios de título.
                  </span>
                ) : confirmar === 0 ? (
                  <>
                    <button type="button" onClick={() => setConfirmar(1)} className="inline-flex h-[32px] items-center gap-[6px] rounded-[9px] bg-[var(--ls-acc-relleno)] px-3 text-[12.5px] font-semibold text-[var(--ls-acc-tinta)]">
                      <Check className="h-[13px] w-[13px]" /> Aplicar en Amazon
                    </button>
                    <button type="button" onClick={() => descartar(actual.id)} className="inline-flex h-[32px] items-center gap-[6px] rounded-[9px] border border-[var(--ls-linea)] px-3 text-[12.5px] font-medium text-[var(--ls-t2)] hover:bg-[var(--ls-sup2)]">
                      <X className="h-[13px] w-[13px]" /> Descartar
                    </button>
                  </>
                ) : confirmar === 1 ? (
                  <>
                    <span className="text-[12.5px] text-[var(--ls-t1)]">Esto cambia el título, los Item Highlights, las viñetas y el backend de la ficha del cliente en Amazon. SOP: en la semana sin pujas (S3) y guardando el texto anterior. ¿Seguro?</span>
                    <button type="button" disabled={aplicando} onClick={() => (rojos.length > 0 ? setConfirmar(2) : aplicar(actual.id, false))} className="inline-flex h-[32px] items-center gap-[6px] rounded-[9px] px-3 text-[12.5px] font-semibold text-white disabled:opacity-60" style={{ background: COLOR_ESTADO.rojo }}>
                      {aplicando ? <Loader2 className="h-[13px] w-[13px] animate-spin" /> : <Check className="h-[13px] w-[13px]" />} {aplicando ? 'Validando y enviando…' : 'Sí, cambiar la ficha en Amazon'}
                    </button>
                    <button type="button" disabled={aplicando} onClick={() => setConfirmar(0)} className="h-[32px] rounded-[9px] px-3 text-[12.5px] font-medium text-[var(--ls-t2)] hover:bg-[var(--ls-sup2)]">Cancelar</button>
                  </>
                ) : (
                  <div className="flex w-full flex-col gap-2">
                    <span className="text-[12.5px] font-semibold" style={{ color: COLOR_ESTADO.rojo }}>
                      Segunda confirmación: la propuesta tiene {rojos.length === 1 ? 'un aviso rojo' : `${rojos.length} avisos rojos`} y se mandaría tal cual.
                    </span>
                    <ul className="flex flex-col gap-[3px] text-[12px] leading-[1.5] text-[var(--ls-t2)]">
                      {rojos.map((a, i) => <li key={i}>· {a.texto}</li>)}
                    </ul>
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" disabled={aplicando} onClick={() => aplicar(actual.id, true)} className="inline-flex h-[32px] items-center gap-[6px] rounded-[9px] px-3 text-[12.5px] font-semibold text-white disabled:opacity-60" style={{ background: COLOR_ESTADO.rojo }}>
                        {aplicando ? <Loader2 className="h-[13px] w-[13px] animate-spin" /> : <ShieldAlert className="h-[13px] w-[13px]" />} {aplicando ? 'Validando y enviando…' : 'Aplicar con estos avisos'}
                      </button>
                      <button type="button" disabled={aplicando} onClick={() => setConfirmar(0)} className="h-[32px] rounded-[9px] px-3 text-[12.5px] font-medium text-[var(--ls-t2)] hover:bg-[var(--ls-sup2)]">Cancelar y revisarla</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {propuestas.length > 1 && (
              <div>
                <button type="button" onClick={() => setVerHistorial((v) => !v)} className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[var(--ls-t3)] hover:text-[var(--ls-t1)]">
                  {verHistorial ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />} Propuestas anteriores ({propuestas.length - 1})
                </button>
                {verHistorial && (
                  <div className="mt-2 flex flex-col gap-1">
                    {propuestas.slice(1).map((p) => (
                      <div key={p.id} className="flex items-center gap-2 text-[11.5px]">
                        <span className="w-[130px] shrink-0 font-medium" style={{ color: estadoDe(p).color }}>{estadoDe(p).texto}</span>
                        <span className="text-[var(--ls-t4)]">{fecha(p.creadaAt)}</span>
                        <span className="min-w-0 flex-1 truncate text-[var(--ls-t3)]">{p.propuesta.titulo}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}

/** Los avisos rojos de la vigilancia, arriba de todo: lo que no debería llegar a Amazon sin que alguien lo mire */
function AvisosRojos({ avisos }: { avisos: AvisoDeVigilancia[] }) {
  return (
    <div className="rounded-[10px] border px-3 py-[9px] text-[12px] leading-[1.5]" style={{ borderColor: `color-mix(in srgb, ${COLOR_ESTADO.rojo} 40%, transparent)`, background: `color-mix(in srgb, ${COLOR_ESTADO.rojo} 6%, transparent)` }}>
      <div className="flex items-center gap-2 font-semibold" style={{ color: COLOR_ESTADO.rojo }}>
        <ShieldAlert className="h-[13px] w-[13px]" /> {avisos.length === 1 ? 'Un aviso rojo' : `${avisos.length} avisos rojos`}: revísalo antes de aplicarla
      </div>
      <ul className="mt-1 flex flex-col gap-[2px] text-[var(--ls-t2)]">
        {avisos.map((a, i) => <li key={i}>· {a.texto}</li>)}
      </ul>
    </div>
  )
}

/** El texto de la propuesta, listo para pegar campo a campo en Seller Central */
function textoParaCopiar(p: TextosPropuestos): string {
  return [`TÍTULO\n${p.titulo}`, p.highlights ? `ITEM HIGHLIGHTS\n${p.highlights}` : '', `VIÑETAS\n${p.bullets.join('\n')}`, `BACKEND\n${p.backend}`].filter(Boolean).join('\n\n')
}

/** Lo que hay y lo propuesto, lado a lado, con las palabras nuevas resaltadas y los recuentos calculados (en rojo si se pasan) */
function Comparacion({ antes, despues }: { antes: TextosPropuestos; despues: TextosPropuestos }) {
  const resaltado = (viejo: string, nuevo: string) =>
    trozosNuevos(viejo, nuevo).map((t, i) => (t.nuevo ? <mark key={i} className="rounded-[3px] px-[1px] text-[var(--ls-t1)]" style={{ background: `color-mix(in srgb, ${COLOR_ESTADO.verde} 22%, transparent)` }}>{t.texto}</mark> : <span key={i}>{t.texto}</span>))
  const columna = 'min-w-0 rounded-[10px] border border-[var(--ls-linea)] px-3 py-[9px]'
  const borde = { borderColor: `color-mix(in srgb, ${COLOR_ESTADO.verde} 35%, transparent)` }
  const bytesBullets = (b: readonly string[]) => b.reduce((s, x) => s + bytesDe(x), 0)
  const medida = (n: number, max: number, unidad: string) => ({ texto: `${n.toLocaleString('es-ES')} / ${max.toLocaleString('es-ES')} ${unidad}`, pasa: n > max })
  const arriba = [antes.titulo, antes.highlights ?? '', ...antes.bullets].join(' ')
  return (
    <div className="flex flex-col gap-3">
      <Fila etiqueta="Título" medidaAntes={medida(caracteresDe(antes.titulo), LIMITE_TITULO_CARACTERES, 'car.')} medidaDespues={medida(caracteresDe(despues.titulo), LIMITE_TITULO_CARACTERES, 'car.')} copiar={despues.titulo}>
        <div className={`${columna} text-[12.5px] leading-[1.5] text-[var(--ls-t3)]`}>{antes.titulo || '—'}</div>
        <div className={`${columna} text-[12.5px] leading-[1.5] text-[var(--ls-t2)]`} style={borde}>{resaltado(antes.titulo, despues.titulo)}</div>
      </Fila>
      <Fila etiqueta="Item Highlights" medidaAntes={antes.highlights ? medida(caracteresDe(antes.highlights), LIMITE_HIGHLIGHTS_CARACTERES, 'car.') : { texto: 'no se lee de Amazon', pasa: false }} medidaDespues={medida(caracteresDe(despues.highlights), LIMITE_HIGHLIGHTS_CARACTERES, 'car.')} copiar={despues.highlights ?? ''}>
        {antes.highlights ? <div className={`${columna} text-[12.5px] leading-[1.5] text-[var(--ls-t3)]`}>{antes.highlights}</div> : <div className={`${columna} text-[12px] leading-[1.5] text-[var(--ls-t4)]`}>Sin leer de Amazon (el listing no los trae o el tipo de producto no los tiene).</div>}
        <div className={`${columna} text-[12.5px] leading-[1.5] text-[var(--ls-t2)]`} style={borde}>{despues.highlights ? resaltado(`${antes.titulo} ${antes.bullets.join(' ')} ${antes.backend}`, despues.highlights) : <span className="text-[var(--ls-t4)]">Esta propuesta es de antes de 2026 y no los trae: pide otra.</span>}</div>
      </Fila>
      <Fila etiqueta="Viñetas" medidaAntes={medida(bytesBullets(antes.bullets), LIMITE_BULLETS_BYTES, 'bytes')} medidaDespues={medida(bytesBullets(despues.bullets), LIMITE_BULLETS_BYTES, 'bytes')} copiar={despues.bullets.join('\n')}>
        <ul className={`${columna} flex flex-col gap-[6px] text-[12px] leading-[1.5] text-[var(--ls-t3)]`}>{antes.bullets.length ? antes.bullets.map((b, i) => <li key={i}>· {b}</li>) : <li>—</li>}</ul>
        <ul className={`${columna} flex flex-col gap-[6px] text-[12px] leading-[1.5] text-[var(--ls-t2)]`} style={borde}>
          {despues.bullets.map((b, i) => (
            <li key={i} className="flex gap-2">
              <span className="min-w-0 flex-1">· {resaltado(antes.bullets.join(' '), b)}</span>
              <span className="shrink-0 text-[10.5px] tabular-nums text-[var(--ls-t4)]">{bytesDe(b)} B</span>
            </li>
          ))}
        </ul>
      </Fila>
      <Fila etiqueta="Backend" medidaAntes={medida(bytesDe(antes.backend), LIMITE_BACKEND_BYTES, 'bytes')} medidaDespues={medida(bytesDe(despues.backend), LIMITE_BACKEND_BYTES, 'bytes')} copiar={despues.backend}>
        <div className={`${columna} font-mono text-[11.5px] leading-[1.6] text-[var(--ls-t3)]`}>{antes.backend || '—'}</div>
        <div className={`${columna} font-mono text-[11.5px] leading-[1.6] text-[var(--ls-t2)]`} style={borde}>{resaltado(`${antes.backend} ${arriba}`, despues.backend)}</div>
      </Fila>
    </div>
  )
}

/**
 * COBERTURA DE BÚSQUEDAS ANTES Y DESPUÉS (entregable del SOP): de las 20 búsquedas del producto que más compras mueven (sin ruido ni otro precio), cuántas están enteras en el título o los Item
 * Highlights (lo que más pesa) y cuántas tienen todas sus palabras en algún sitio de la ficha. Si una que estaba deja de estar, se dice: es el riesgo real de cambiar un título (perder palabras que
 * ya posicionaban).
 */
function CoberturaAntesDespues({ d, antes, despues }: { d: DiagnosticoDeProducto; antes: TextosPropuestos; despues: TextosPropuestos }) {
  const r = useMemo(() => {
    const top = d.busquedas
      .filter((b) => esRelevante(b.veredicto))
      .sort((a, b) => (b.fila.comprasTotal ?? 0) - (a.fila.comprasTotal ?? 0))
      .slice(0, 20)
      .map((b) => b.fila.consulta)
    const ficha = (t: TextosPropuestos) => ({ titulo: `${t.titulo} ${t.highlights ?? ''}`, bullets: t.bullets, descripcion: null, backend: t.backend })
    const medir = (t: TextosPropuestos) => {
      const f = ficha(t)
      const cob = top.map((q) => ({ q, c: coberturaDe(q, f) }))
      return { arriba: cob.filter((x) => x.c.titulo).map((x) => x.q), entera: cob.filter((x) => x.c.faltan.length === 0).map((x) => x.q) }
    }
    const a = medir(antes)
    const b = medir(despues)
    return { total: top.length, a, b, perdidas: a.entera.filter((q) => !b.entera.includes(q)) }
  }, [d, antes, despues])
  if (r.total === 0) return null
  const fila = (texto: string, x: number, y: number) => (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="min-w-0 flex-1 text-[var(--ls-t3)] sm:w-[260px] sm:flex-none">{texto}</span>
      <span className="tabular-nums text-[var(--ls-t3)]">{x}</span>
      <span className="text-[var(--ls-t4)]">→</span>
      <span className="font-semibold tabular-nums" style={{ color: y > x ? COLOR_ESTADO.verde : y < x ? COLOR_ESTADO.rojo : 'var(--ls-t1)' }}>{y}</span>
      <span className="text-[var(--ls-t4)]">de {r.total}</span>
    </div>
  )
  return (
    <div className="flex flex-col gap-[5px] rounded-[10px] bg-[var(--ls-sup2)] px-3 py-[9px]">
      <span className="text-[12px] font-semibold text-[var(--ls-t1)]">Cobertura de las {r.total} búsquedas del producto que más venden</span>
      {fila('Enteras en el título o los Item Highlights', r.a.arriba.length, r.b.arriba.length)}
      {fila('Con todas sus palabras en la ficha', r.a.entera.length, r.b.entera.length)}
      {r.perdidas.length > 0 && (
        <p className="text-[11.5px]" style={{ color: COLOR_ESTADO.rojo }}>
          Se pierden palabras de: {r.perdidas.join(', ')}. Revísalo antes de usarla: perder palabras que ya posicionaban es el riesgo real de un cambio de título.
        </p>
      )}
    </div>
  )
}

function Fila({ etiqueta, medidaAntes, medidaDespues, copiar, children }: { etiqueta: string; medidaAntes: { texto: string; pasa: boolean }; medidaDespues: { texto: string; pasa: boolean }; copiar: string; children: React.ReactNode }) {
  const color = (m: { pasa: boolean }) => (m.pasa ? { color: COLOR_ESTADO.rojo } : undefined)
  return (
    <div className="flex flex-col gap-[5px]">
      {/* En el móvil las dos cajas van una debajo de otra: los rótulos también (en dos columnas de 140 px la medida partía en cuatro líneas y «Copiar» se salía de la tarjeta) */}
      <div className="grid gap-1 text-[11px] text-[var(--ls-t4)] md:grid-cols-2 md:gap-3">
        <span>
          <strong className="font-semibold text-[var(--ls-t2)]">{etiqueta}</strong> · ahora · <span style={color(medidaAntes)}>{medidaAntes.texto}</span>
        </span>
        <span className="flex items-center gap-1">
          <strong className="font-semibold" style={{ color: COLOR_ESTADO.verde }}>Propuesta</strong> · <span style={color(medidaDespues)}>{medidaDespues.texto}</span>
          <span className="ml-auto">
            <BotonCopiar texto={copiar} compacto />
          </span>
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">{children}</div>
    </div>
  )
}

/** ¿Ha quedado de verdad en la ficha? Lo comprueba el ERP al releerla (migración 312) */
function Verificacion({ v }: { v: NonNullable<PropuestaGuardada['resultado']>['verificacion'] | null }) {
  if (!v) return <p className="flex items-center gap-2 text-[11.5px] text-[var(--ls-t4)]"><Loader2 className="h-3 w-3 animate-spin" /> Comprobando en la ficha que ha quedado (se relee sola cada 20 minutos).</p>
  const color = v.estado === 'aplicada' ? COLOR_ESTADO.verde : v.estado === 'parcial' ? COLOR_ESTADO.ambar : COLOR_ESTADO.rojo
  const texto = v.estado === 'aplicada' ? 'Comprobado: está en la ficha.' : v.estado === 'parcial' ? 'Solo una parte ha quedado en la ficha.' : 'No ha quedado en la ficha.'
  return (
    <p className="text-[12px] leading-[1.5]" style={{ color }}>
      <strong>{texto}</strong> {v.explicacion ? <span className="text-[var(--ls-t3)]">{v.explicacion}</span> : null}
    </p>
  )
}
