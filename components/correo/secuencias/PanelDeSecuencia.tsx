'use client'

import { Ban, ChevronDown, FastForward, Loader2, Pause, Pencil, Play, RotateCcw, SkipForward, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Avatar, Esqueleto, Revelar } from '@/components/rendimiento/ui'
import { hace, type PasoDeDetalle } from '@/lib/correo/secuencias/vistas'
import { BOTON_ICONO, BOTON_PRIMARIO, BOTON_SECUNDARIO, CAMPO } from '../ui'
import { ChipDeEstado } from './ColaDeLeads'
import { accionar, cuando, useDetalle, type CuerpoDeAccion } from './datos'
import { COLOR_DE_TONO, ESTILO_DE_EVENTO, LineaMini, Nodo, estiloDelPaso } from './LineaDeTiempo'
import { TarjetaDeLectura } from './RespuestasLeidas'

/**
 * EL DETALLE DE UNA SECUENCIA: SU LÍNEA DE TIEMPO, SUS CORREOS Y TODO LO QUE HA PASADO.
 *
 * Un panel que entra por la derecha. Arriba, la misma línea de tiempo de la cola. Después cada correo con su texto (lo que saldrá, o lo que salió; si la IA
 * lo adaptó a lo nuevo de la ficha, las dos versiones), y abajo el rastro: cada decisión del motor con su porqué («aplazado: el buzón ya ha enviado hoy 70
 * de 70»). Quien puede (el dueño del buzón o un administrador) pausa, reanuda, cancela, adelanta, salta o reintenta; solo el dueño edita los textos, porque
 * saldrán con su nombre.
 */

interface Props {
  id: string
  ahora: number
  onCerrar: () => void
  /** Algo ha cambiado: que la cola y el tablero se refresquen */
  alCambiar: () => void
}

function TextoPlegable({ texto, lineas = 5 }: { texto: string; lineas?: number }) {
  const [abierto, setAbierto] = useState(false)
  const largo = texto.split('\n').length > lineas || texto.length > 380
  return (
    <div>
      <p className={`whitespace-pre-wrap text-[12.5px] leading-relaxed text-[var(--ls-t2)] ${abierto ? '' : 'line-clamp-5'}`}>{texto}</p>
      {largo && (
        <button type="button" onClick={() => setAbierto((v) => !v)} className="mt-1 inline-flex items-center gap-1 text-[11.5px] text-[var(--ls-acc)] hover:underline">
          <ChevronDown className={`h-3 w-3 transition-transform ${abierto ? 'rotate-180' : ''}`} aria-hidden /> {abierto ? 'Ver menos' : 'Ver todo'}
        </button>
      )}
    </div>
  )
}

function TarjetaDePaso({
  paso,
  ahora,
  puedeAdministrar,
  puedeEditar,
  ocupado,
  onAccion,
  escalon,
}: {
  paso: PasoDeDetalle
  ahora: number
  puedeAdministrar: boolean
  puedeEditar: boolean
  ocupado: boolean
  onAccion: (c: CuerpoDeAccion) => Promise<boolean>
  escalon: number
}) {
  const e = estiloDelPaso(paso)
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState(paso.texto)
  const [asunto, setAsunto] = useState(paso.asunto)
  const [verOriginal, setVerOriginal] = useState(false)
  const abierto = paso.estado === 'pendiente' || paso.estado === 'pausado'
  const salio = paso.estado === 'enviado'
  const hora = salio ? paso.enviadoAt : paso.programadoAt

  async function guardar() {
    const hecho = await onAccion({ accion: 'editar', pasoId: paso.id, asunto: asunto !== paso.asunto ? asunto : undefined, texto: texto !== paso.texto ? texto : undefined })
    if (hecho) setEditando(false)
  }

  return (
    <Revelar i={escalon}>
      <article className="rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-3">
        <header className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <Nodo Icono={e.Icono} tono={e.tono} lleno={salio} discontinuo={e.discontinuo} tamano={20} />
          <h3 className="text-[12.5px] font-semibold text-[var(--ls-t1)]">{paso.orden === 0 ? 'Primer correo' : `Seguimiento ${paso.orden}`}</h3>
          <span className="text-[11px] font-medium" style={{ color: COLOR_DE_TONO[e.tono] }}>
            {paso.etiqueta}
          </span>
          {hora && <span className="text-[11.5px] tabular-nums text-[var(--ls-t4)]">· {cuando(hora, ahora)}</span>}
          {paso.adaptado && <span className="rounded-[4px] bg-[var(--ls-acc-suave)] px-1.5 text-[10.5px] font-medium text-[var(--ls-acc)]">{paso.revision?.escrito ? 'escrito por la IA al enviar' : 'adaptado por la IA'}</span>}
        </header>

        {paso.esperando && <p className="mt-1.5 text-[11.5px] text-[var(--ls-e-ambar)]">Espera: {paso.esperando}</p>}
        {paso.motivo && paso.estado !== 'pendiente' && paso.estado !== 'enviado' && <p className="mt-1.5 text-[11.5px] leading-snug text-[var(--ls-t3)]">{paso.motivo}</p>}
        {paso.revision && (
          <p className="mt-1.5 text-[11.5px] leading-snug text-[var(--ls-t3)]">
            <span className="font-medium text-[var(--ls-t2)]">{paso.revision.escrito ? 'La IA lo escribió con todo lo que consta del lead:' : 'La IA leyó lo nuevo de la ficha:'}</span> {paso.revision.motivo}
          </p>
        )}

        {editando ? (
          <div className="mt-2 space-y-2">
            <input value={asunto} onChange={(ev) => setAsunto(ev.target.value)} maxLength={300} aria-label="Asunto" className={CAMPO} />
            <textarea value={texto} onChange={(ev) => setTexto(ev.target.value)} rows={9} aria-label="Texto del seguimiento" className="w-full resize-y rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-3 text-[12.5px] leading-relaxed text-[var(--ls-t1)] outline-none focus:border-[var(--ls-acc-graf)]" />
            <p className="text-[11px] text-[var(--ls-t4)]">La firma de tu buzón se añade sola al enviar. No puede hablar de dinero ni dejar huecos por rellenar.</p>
            <div className="flex gap-2">
              <button type="button" disabled={ocupado} onClick={() => void guardar()} className={`${BOTON_PRIMARIO} !h-8 !px-3 !text-[12.5px]`}>
                {ocupado && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} Guardar
              </button>
              <button type="button" onClick={() => { setEditando(false); setTexto(paso.texto); setAsunto(paso.asunto) }} className={BOTON_SECUNDARIO}>
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-2 space-y-1.5">
            <p className="text-[12px] text-[var(--ls-t3)]">
              <span className="text-[var(--ls-t4)]">Asunto:</span> {paso.asunto}
            </p>
            {paso.textoDeEnsayo ? (
              <>
                <div className="rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-2.5">
                  <p className="mb-1 text-[11px] font-semibold text-[var(--ls-t3)]">Esto es lo que habría enviado la IA (ensayo)</p>
                  <TextoPlegable texto={paso.textoDeEnsayo} />
                </div>
                <button type="button" onClick={() => setVerOriginal((v) => !v)} className="text-[11.5px] text-[var(--ls-t3)] underline underline-offset-2 hover:text-[var(--ls-t1)]">
                  {verOriginal ? 'Ocultar el borrador' : 'Ver el borrador programado'}
                </button>
                {verOriginal && <div className="rounded-[6px] bg-[var(--ls-sup2)] p-2.5"><TextoPlegable texto={paso.texto} /></div>}
              </>
            ) : (
              <>
                <TextoPlegable texto={salio && paso.textoEnviado ? paso.textoEnviado : paso.texto} />
                {paso.adaptado && paso.textoEnviado && (
                  <button type="button" onClick={() => setVerOriginal((v) => !v)} className="text-[11.5px] text-[var(--ls-t3)] underline underline-offset-2 hover:text-[var(--ls-t1)]">
                    {verOriginal ? (paso.revision?.escrito ? 'Ocultar el borrador' : 'Ocultar el texto original') : paso.revision?.escrito ? 'Ver el borrador programado' : 'Ver el texto original'}
                  </button>
                )}
                {verOriginal && <div className="rounded-[6px] bg-[var(--ls-sup2)] p-2.5"><TextoPlegable texto={paso.texto} /></div>}
              </>
            )}
          </div>
        )}

        {!editando && (puedeAdministrar || puedeEditar) && (paso.orden > 0) && (abierto || paso.estado === 'fallido') && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {puedeAdministrar && paso.estado === 'pendiente' && (
              <button type="button" disabled={ocupado} onClick={() => void onAccion({ accion: 'adelantar', pasoId: paso.id })} className={BOTON_SECUNDARIO} title="Lo adelanta al primer momento en que puede salir (los controles de siempre siguen valiendo)">
                <FastForward className="h-3.5 w-3.5" aria-hidden /> Enviar ya
              </button>
            )}
            {puedeEditar && abierto && (
              <button type="button" disabled={ocupado} onClick={() => setEditando(true)} className={BOTON_SECUNDARIO}>
                <Pencil className="h-3.5 w-3.5" aria-hidden /> Editar
              </button>
            )}
            {puedeAdministrar && abierto && (
              <button type="button" disabled={ocupado} onClick={() => void onAccion({ accion: 'saltar', pasoId: paso.id })} className={BOTON_SECUNDARIO}>
                <SkipForward className="h-3.5 w-3.5" aria-hidden /> Saltar
              </button>
            )}
            {puedeAdministrar && paso.estado === 'fallido' && (
              <button type="button" disabled={ocupado} onClick={() => void onAccion({ accion: 'reintentar', pasoId: paso.id })} className={BOTON_SECUNDARIO}>
                <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Reintentar
              </button>
            )}
          </div>
        )}
      </article>
    </Revelar>
  )
}

export function PanelDeSecuencia({ id, ahora, onCerrar, alCambiar }: Props) {
  const { detalle, error, cargando, recargar } = useDetalle(id)
  const [ocupado, setOcupado] = useState(false)
  const [confirmaCancelar, setConfirmaCancelar] = useState(false)

  async function hacer(c: CuerpoDeAccion): Promise<boolean> {
    setOcupado(true)
    const r = await accionar(id, c)
    setOcupado(false)
    if (r.ok) toast.success(r.mensaje)
    else toast.error(r.mensaje)
    await recargar()
    alCambiar()
    return r.ok
  }

  const s = detalle?.secuencia
  const viva = s?.estado === 'activa' || s?.estado === 'pausada'
  const p = detalle?.permisos

  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-black/50" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()} onKeyDown={(e) => e.key === 'Escape' && onCerrar()}>
      <aside role="dialog" aria-modal="true" aria-label="Detalle de la secuencia" className="rend-desliza flex h-full w-full max-w-[560px] flex-col border-l border-[var(--ls-linea)] bg-[var(--ls-fondo)] shadow-2xl shadow-black/50">
        <header className="flex items-start justify-between gap-3 border-b border-[var(--ls-linea)] bg-[var(--ls-sup)] px-4 py-3">
          <div className="min-w-0">
            {s ? (
              <>
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-[14px] font-semibold text-[var(--ls-t1)]">{s.lead.nombre}</h2>
                  <ChipDeEstado tono={s.tono}>{s.etiquetaDeEstado}</ChipDeEstado>
                </div>
                <p className="mt-0.5 truncate text-[11.5px] text-[var(--ls-t3)]">{s.destinatario}</p>
                {!s.propio && (
                  <p className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--ls-t4)]">
                    <Avatar id={s.buzonId} nombre={s.propietario} tamano={16} /> Buzón de {s.propietario}
                  </p>
                )}
              </>
            ) : (
              <Esqueleto className="h-9 w-56" />
            )}
          </div>
          <button type="button" onClick={onCerrar} className={BOTON_ICONO} aria-label="Cerrar el detalle">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {error && !detalle && <p className="text-[12.5px] text-[var(--ls-e-ambar)]">{error}</p>}
          {cargando && !detalle && (
            <div className="space-y-2" aria-busy="true">
              <Esqueleto className="h-24 w-full" />
              <Esqueleto className="h-32 w-full" />
              <Esqueleto className="h-32 w-full" />
            </div>
          )}

          {s && detalle && p && (
            <>
              <div className="overflow-x-auto rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 py-3">
                <LineaMini item={s} ahora={ahora} />
              </div>

              {/* Si la IA ya ha leído lo que contestó, la tarjeta lo cuenta mejor que el motivo de una línea */}
              {s.motivo && s.estado !== 'activa' && !(detalle.respuesta && s.estado === 'respondida') && (
                <p className="rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 py-2 text-[12px] leading-snug text-[var(--ls-t2)]">{s.motivo}</p>
              )}
              {detalle.respuesta && <TarjetaDeLectura r={detalle.respuesta} ahora={ahora} />}

              {p.puedeAdministrar && viva && (
                <div className="flex flex-wrap items-center gap-2">
                  {s.estado === 'activa' ? (
                    <button type="button" disabled={ocupado} onClick={() => void hacer({ accion: 'pausar' })} className={BOTON_SECUNDARIO}>
                      <Pause className="h-3.5 w-3.5" aria-hidden /> Pausar
                    </button>
                  ) : (
                    <button type="button" disabled={ocupado} onClick={() => void hacer({ accion: 'reanudar' })} className={BOTON_PRIMARIO + ' !h-8 !px-3 !text-[12.5px]'}>
                      <Play className="h-3.5 w-3.5" aria-hidden /> Reanudar
                    </button>
                  )}
                  {confirmaCancelar ? (
                    <span className="flex items-center gap-2 text-[12px] text-[var(--ls-t3)]">
                      ¿Cancelar todos los seguimientos?
                      <button type="button" disabled={ocupado} onClick={() => void hacer({ accion: 'cancelar' }).then(() => setConfirmaCancelar(false))} className={`${BOTON_SECUNDARIO} border-[var(--ls-e-rojo)] text-[var(--ls-e-rojo)]`}>
                        Sí, cancelar
                      </button>
                      <button type="button" onClick={() => setConfirmaCancelar(false)} className="text-[12px] text-[var(--ls-t4)] hover:text-[var(--ls-t1)]">
                        No
                      </button>
                    </span>
                  ) : (
                    <button type="button" disabled={ocupado} onClick={() => setConfirmaCancelar(true)} className={BOTON_SECUNDARIO}>
                      <Ban className="h-3.5 w-3.5" aria-hidden /> Cancelar secuencia
                    </button>
                  )}
                </div>
              )}
              {!p.puedeAdministrar && <p className="text-[11.5px] text-[var(--ls-t4)]">Estás viendo la secuencia en solo lectura: solo su dueño o un administrador puede cambiarla.</p>}

              <section aria-label="Correos">
                <h3 className="mb-2 text-[11px] font-semibold text-[var(--ls-t4)]">Los correos</h3>
                <div className="space-y-2">
                  {detalle.pasos.map((paso, i) => (
                    <TarjetaDePaso key={paso.id} paso={paso} ahora={ahora} puedeAdministrar={p.puedeAdministrar && viva} puedeEditar={p.puedeEditar && viva} ocupado={ocupado} onAccion={hacer} escalon={i} />
                  ))}
                </div>
              </section>

              <section aria-label="Qué ha pasado">
                <h3 className="mb-2 text-[11px] font-semibold text-[var(--ls-t4)]">Qué ha pasado</h3>
                {detalle.eventos.length === 0 ? (
                  <p className="text-[12px] text-[var(--ls-t4)]">Todavía no se ha apuntado nada.</p>
                ) : (
                  <ol className="relative ml-3 space-y-3 border-l border-[var(--ls-linea2)] pl-5">
                    {[...detalle.eventos].reverse().map((ev, i) => {
                      const est = ESTILO_DE_EVENTO[ev.tipo] ?? { Icono: Pause, tono: 'gris' as const }
                      const Icono = est.Icono
                      return (
                        <li key={ev.id} className="sec-sube relative" style={{ '--d': Math.min(i, 12) } as React.CSSProperties}>
                          <span className="absolute -left-[31px] top-0.5 flex h-5 w-5 items-center justify-center rounded-full border-2 bg-[var(--ls-fondo)]" style={{ borderColor: COLOR_DE_TONO[est.tono], color: COLOR_DE_TONO[est.tono] }}>
                            <Icono className="h-2.5 w-2.5" strokeWidth={2.6} aria-hidden />
                          </span>
                          <p className="text-[12.5px] leading-snug text-[var(--ls-t2)]">{ev.detalle ?? ev.tipo}</p>
                          <p className="text-[11px] tabular-nums text-[var(--ls-t4)]" title={cuando(ev.en, ahora)}>
                            {hace(ahora, ev.en)}
                          </p>
                        </li>
                      )
                    })}
                  </ol>
                )}
              </section>
            </>
          )}
        </div>
      </aside>
    </div>
  )
}
