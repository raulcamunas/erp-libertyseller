'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Check, ChevronDown, ChevronRight, Loader2, ShieldAlert, Sparkles, X } from 'lucide-react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { CAJA } from '@/components/marketing-test/piezas'
import { llamar } from '@/components/marketing-test/llamar'
import { bytesDe, LIMITE_BACKEND_BYTES, LIMITE_TITULO_CARACTERES } from '@/lib/seo/cobertura'
import { PRIMER_TRAMO_TITULO, trozosNuevos, type TextosPropuestos } from '@/lib/seo/propuesta'
import type { PropuestaGuardada } from '@/lib/seo/propuesta-servidor'
import { useDelProducto } from './useDelProducto'

const ESTADO: Record<PropuestaGuardada['estado'], { texto: string; color: string }> = {
  pendiente: { texto: 'Pendiente de tu OK', color: COLOR_ESTADO.ambar },
  aplicada: { texto: 'Aplicada en Amazon', color: COLOR_ESTADO.verde },
  descartada: { texto: 'Descartada', color: 'var(--ls-t4)' },
  error: { texto: 'Amazon la rechazó', color: COLOR_ESTADO.rojo },
}

const fecha = (iso: string) => new Date(iso).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/**
 * LA PROPUESTA DE FICHA CON IA de un producto. La IA PROPONE y aquí se ve, al lado de lo que hay, con lo nuevo resaltado y por qué. A Amazon solo llega si una persona pulsa «Aplicar en Amazon» y lo
 * confirma (dos clics a propósito: cambia la ficha del cliente).
 */
export function PropuestaConIa({ cuentaId, asin, hayBusquedas, hayFicha, mejoras }: { cuentaId: string; asin: string; hayBusquedas: boolean; hayFicha: boolean; mejoras: boolean }) {
  const { datos, recargar } = useDelProducto<{ propuestas: PropuestaGuardada[]; sinMigracion?: boolean }>(mejoras ? `/api/seo/propuestas?cuenta=${encodeURIComponent(cuentaId)}&asin=${asin}` : null)
  const [pidiendo, setPidiendo] = useState(false)
  const [confirmar, setConfirmar] = useState(false)
  const [aplicando, setAplicando] = useState(false)
  const [rechazo, setRechazo] = useState<{ motivo: string; issues: Array<{ message?: string; code?: string }> } | null>(null)
  const [verHistorial, setVerHistorial] = useState(false)

  const propuestas = datos?.propuestas ?? []
  const actual = propuestas[0] ?? null

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

  async function aplicar(id: string) {
    setAplicando(true)
    setRechazo(null)
    try {
      const res = await fetch('/api/seo/propuestas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cuenta: cuentaId, id, accion: 'aplicar' }) })
      const j = (await res.json().catch(() => ({}))) as { error?: string; issues?: Array<{ message?: string; code?: string }>; avisos?: string | null }
      if (!res.ok) {
        setRechazo({ motivo: j.error ?? `Error ${res.status}`, issues: j.issues ?? [] })
      } else {
        toast.success(j.avisos ? `Enviada a Amazon con avisos: ${j.avisos}` : 'Enviada a Amazon. La procesa en unos minutos y la ficha se vuelve a leer sola.')
      }
      setConfirmar(false)
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
  const boton = (
    <button type="button" disabled={!puedePedir} onClick={proponer} className="inline-flex h-[30px] items-center gap-[6px] rounded-[9px] bg-[var(--ls-acc-relleno)] px-3 text-[12.5px] font-semibold text-[var(--ls-acc-tinta)] disabled:opacity-50" title={!hayFicha ? 'Falta leer la ficha' : !hayBusquedas ? 'Faltan las búsquedas de Brand Analytics' : 'La IA escribe una propuesta. No se aplica sola.'}>
      {pidiendo ? <Loader2 className="h-[13px] w-[13px] animate-spin" /> : <Sparkles className="h-[13px] w-[13px]" />}
      {pidiendo ? 'La IA está escribiendo…' : actual ? 'Pedir otra propuesta' : 'Proponer ficha con IA'}
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
        {!mejoras || datos?.sinMigracion ? (
          <p className="text-[12.5px]" style={{ color: COLOR_ESTADO.ambar }}>Falta lanzar la migración 299 en Supabase para guardar las propuestas.</p>
        ) : pidiendo && !actual ? (
          <p className="text-[12.5px] text-[var(--ls-t3)]">Leyendo las búsquedas que venden y escribiendo título, bullets y backend. Tarda entre 20 segundos y un minuto…</p>
        ) : !actual ? (
          <p className="text-[12.5px] text-[var(--ls-t3)]">
            La IA reescribe el título, los bullets y el backend para las búsquedas que más VENDEN de este producto, sin inventar nada que no diga ya la ficha y respetando la marca. Verás la propuesta al lado de lo que hay, con lo nuevo resaltado y el porqué. No se toca Amazon hasta que tú lo apliques.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
              <span className="rounded-full px-[9px] py-[2px] font-semibold" style={{ color: ESTADO[actual.estado].color, background: `color-mix(in srgb, ${ESTADO[actual.estado].color} 13%, transparent)` }}>{ESTADO[actual.estado].texto}</span>
              <span className="text-[var(--ls-t4)]">propuesta del {fecha(actual.creadaAt)}{actual.modelo ? ` · ${actual.modelo}` : ''}</span>
              {actual.aplicadaAt && <span className="text-[var(--ls-t4)]">· aplicada el {fecha(actual.aplicadaAt)}</span>}
            </div>

            {actual.razonamiento.resumen && <p className="rounded-[10px] bg-[var(--ls-sup2)] px-3 py-[9px] text-[12.5px] leading-[1.55] text-[var(--ls-t2)]">{actual.razonamiento.resumen}</p>}

            <Comparacion antes={actual.antes} despues={actual.propuesta} />

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
            {(actual.razonamiento.avisos?.length ?? 0) > 0 && <p className="text-[11.5px] text-[var(--ls-t4)]">Al revisar la propuesta: {actual.razonamiento.avisos?.join(' ')}</p>}

            {(rechazo || (actual.error && actual.estado !== 'aplicada')) && (
              <div className="rounded-[10px] border px-3 py-[9px] text-[12px] leading-[1.5]" style={{ borderColor: `color-mix(in srgb, ${COLOR_ESTADO.rojo} 40%, transparent)`, color: COLOR_ESTADO.rojo }}>
                <div className="flex items-center gap-2 font-semibold"><ShieldAlert className="h-[13px] w-[13px]" /> Amazon no la ha aceptado</div>
                <div className="mt-1 text-[var(--ls-t2)]">{rechazo?.motivo ?? actual.error}</div>
                {(rechazo?.issues ?? []).map((i, k) => <div key={k} className="text-[11.5px] text-[var(--ls-t3)]">· {i.message ?? i.code}</div>)}
              </div>
            )}
            {actual.estado === 'aplicada' && actual.resultado?.mensaje && <p className="text-[11.5px] text-[var(--ls-t4)]">Avisos de Amazon al aplicar: {actual.resultado.mensaje}</p>}

            {actual.estado === 'pendiente' && (
              <div className="flex flex-wrap items-center gap-2 border-t border-[var(--ls-linea)] pt-3">
                {!confirmar ? (
                  <>
                    <button type="button" onClick={() => setConfirmar(true)} className="inline-flex h-[32px] items-center gap-[6px] rounded-[9px] bg-[var(--ls-acc-relleno)] px-3 text-[12.5px] font-semibold text-[var(--ls-acc-tinta)]">
                      <Check className="h-[13px] w-[13px]" /> Aplicar en Amazon
                    </button>
                    <button type="button" onClick={() => descartar(actual.id)} className="inline-flex h-[32px] items-center gap-[6px] rounded-[9px] border border-[var(--ls-linea)] px-3 text-[12.5px] font-medium text-[var(--ls-t2)] hover:bg-[var(--ls-sup2)]">
                      <X className="h-[13px] w-[13px]" /> Descartar
                    </button>
                  </>
                ) : (
                  <>
                    <span className="text-[12.5px] text-[var(--ls-t1)]">Esto cambia el título, los bullets y el backend de la ficha del cliente en Amazon. ¿Seguro?</span>
                    <button type="button" disabled={aplicando} onClick={() => aplicar(actual.id)} className="inline-flex h-[32px] items-center gap-[6px] rounded-[9px] px-3 text-[12.5px] font-semibold text-white disabled:opacity-60" style={{ background: COLOR_ESTADO.rojo }}>
                      {aplicando ? <Loader2 className="h-[13px] w-[13px] animate-spin" /> : <Check className="h-[13px] w-[13px]" />} {aplicando ? 'Validando y enviando…' : 'Sí, cambiar la ficha en Amazon'}
                    </button>
                    <button type="button" disabled={aplicando} onClick={() => setConfirmar(false)} className="h-[32px] rounded-[9px] px-3 text-[12.5px] font-medium text-[var(--ls-t2)] hover:bg-[var(--ls-sup2)]">Cancelar</button>
                  </>
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
                        <span className="w-[130px] font-medium" style={{ color: ESTADO[p.estado].color }}>{ESTADO[p.estado].texto}</span>
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

/** Lo que hay y lo propuesto, lado a lado, con las palabras nuevas resaltadas */
function Comparacion({ antes, despues }: { antes: TextosPropuestos; despues: TextosPropuestos }) {
  const resaltado = (viejo: string, nuevo: string) =>
    trozosNuevos(viejo, nuevo).map((t, i) => (t.nuevo ? <mark key={i} className="rounded-[3px] px-[1px] text-[var(--ls-t1)]" style={{ background: `color-mix(in srgb, ${COLOR_ESTADO.verde} 22%, transparent)` }}>{t.texto}</mark> : <span key={i}>{t.texto}</span>))
  const columna = 'min-w-0 rounded-[10px] border border-[var(--ls-linea)] px-3 py-[9px]'
  // El tramo que se ve en el móvil, cortado en el último espacio antes de los 75 caracteres (no a mitad de palabra)
  const espacio = despues.titulo.slice(0, PRIMER_TRAMO_TITULO + 1).lastIndexOf(' ')
  const corte = despues.titulo.length <= PRIMER_TRAMO_TITULO ? despues.titulo.length : espacio > 0 ? espacio : PRIMER_TRAMO_TITULO
  return (
    <div className="flex flex-col gap-3">
      <Fila etiqueta="Título" medidaAntes={`${antes.titulo.length} car.`} medidaDespues={`${despues.titulo.length} / ${LIMITE_TITULO_CARACTERES} car.`}>
        <div className={`${columna} text-[12.5px] leading-[1.5] text-[var(--ls-t3)]`}>{antes.titulo || '—'}</div>
        <div className={`${columna} text-[12.5px] leading-[1.5] text-[var(--ls-t2)]`} style={{ borderColor: `color-mix(in srgb, ${COLOR_ESTADO.verde} 35%, transparent)` }}>
          <span className="rounded-[3px] outline outline-1 outline-dashed outline-[var(--ls-linea2)]" title={`Los primeros ${PRIMER_TRAMO_TITULO} caracteres: lo que se ve en el móvil`}>{resaltado(antes.titulo, despues.titulo.slice(0, corte))}</span>
          {resaltado(antes.titulo, despues.titulo.slice(corte))}
        </div>
      </Fila>
      <Fila etiqueta="Bullets" medidaAntes={`${antes.bullets.length}`} medidaDespues={`${despues.bullets.length} de 5`}>
        <ul className={`${columna} flex flex-col gap-[6px] text-[12px] leading-[1.5] text-[var(--ls-t3)]`}>{antes.bullets.length ? antes.bullets.map((b, i) => <li key={i}>· {b}</li>) : <li>—</li>}</ul>
        <ul className={`${columna} flex flex-col gap-[6px] text-[12px] leading-[1.5] text-[var(--ls-t2)]`} style={{ borderColor: `color-mix(in srgb, ${COLOR_ESTADO.verde} 35%, transparent)` }}>
          {despues.bullets.map((b, i) => <li key={i}>· {resaltado(antes.bullets.join(' '), b)}</li>)}
        </ul>
      </Fila>
      <Fila etiqueta="Backend" medidaAntes={`${bytesDe(antes.backend)} bytes`} medidaDespues={`${bytesDe(despues.backend)} / ${LIMITE_BACKEND_BYTES} bytes`}>
        <div className={`${columna} font-mono text-[11.5px] leading-[1.6] text-[var(--ls-t3)]`}>{antes.backend || '—'}</div>
        <div className={`${columna} font-mono text-[11.5px] leading-[1.6] text-[var(--ls-t2)]`} style={{ borderColor: `color-mix(in srgb, ${COLOR_ESTADO.verde} 35%, transparent)` }}>{resaltado(antes.backend, despues.backend) }</div>
      </Fila>
    </div>
  )
}

function Fila({ etiqueta, medidaAntes, medidaDespues, children }: { etiqueta: string; medidaAntes: string; medidaDespues: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-[5px]">
      <div className="grid grid-cols-2 gap-3 text-[11px] text-[var(--ls-t4)]">
        <span><strong className="font-semibold text-[var(--ls-t2)]">{etiqueta}</strong> · ahora · {medidaAntes}</span>
        <span><strong className="font-semibold" style={{ color: COLOR_ESTADO.verde }}>Propuesta</strong> · {medidaDespues}</span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">{children}</div>
    </div>
  )
}
