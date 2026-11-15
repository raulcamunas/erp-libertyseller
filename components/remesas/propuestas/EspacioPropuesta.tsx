'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Calendar, Check, CheckCircle2, ChevronDown, Circle, ClipboardList, History, Loader2, Pencil, Send, StickyNote, Trash2, X } from 'lucide-react'
import { Pestanas } from '@/components/ui-ls'
import { toast } from 'sonner'
import { BOTON, CAMPO, COLOR_ESTADO, TABLA, TIPO } from '@/lib/estilo/denso'
import { esClienteConCatalogo } from '@/lib/fba/catalogo/tipos'
import type { CajasDeRemesa } from '@/lib/fba/cajas'
import type { RemesaDePanel } from '@/lib/fba/datos'
import { puedeImprimirEtiquetas, type Actor } from '@/lib/fba/flujo'
import { diasEntre, leToca, turnoDe } from '@/lib/fba/vista'
import { cx, Insignia, Tarjeta } from '../comun/ui'
import { DireccionOrigen } from '../DireccionOrigen'
import { EditorBoceto } from '../EditorBoceto'
import { EditorCajas } from '../EditorCajas'
import { fecha } from '../formato'
import { EnviarAAmazon } from '../amazon/EnviarAAmazon'
import { BarraAcciones } from './BarraAcciones'
import { BotonExcel } from './BotonExcel'
import { EnlaceParaElCliente } from './EnlaceParaElCliente'
import { EnlazarEnvioDialog } from './EnlazarEnvioDialog'
import { FasesPropuesta } from './FasesPropuesta'
import { HistorialRemesa } from './HistorialRemesa'
import { RevisionPropuesta } from './RevisionPropuesta'
import { ImprimirEtiquetas } from './ImprimirEtiquetas'
import { PlantillasAmazon } from './PlantillasAmazon'
import { TarjetaAnalisisIa } from './TarjetaAnalisisIa'

/**
 * EL ESPACIO DE TRABAJO DE UNA PROPUESTA.
 *
 * Una propuesta es lo que se está preparando con el cliente y todavía no existe en
 * Amazon: se propone qué mandar, el cliente lo aprueba, etiqueta, encaja y dice
 * las medidas de las cajas, y la agencia crea el envío y lo enlaza. Esta pantalla
 * se adapta a la fase: arriba siempre el mapa de fases, en medio lo que toca
 * hacer AHORA y abajo, pegada, la barra con el siguiente paso.
 *
 * Cuando se marca como enviada deja de estar aquí y aparece en «Envíos».
 */

export function EspacioPropuesta({
  remesa,
  clienteId,
  clienteNombre,
  esAdmin,
  actor,
  puedeEditar,
  puedeBorrar,
  cajas,
  hoy,
  onEnviada,
}: {
  remesa: RemesaDePanel
  clienteId: string
  clienteNombre: string
  esAdmin: boolean
  /** Agencia (admin o empleado) o cliente: lo decide el rol, no esAdmin */
  actor: Actor
  puedeEditar: boolean
  puedeBorrar: boolean
  cajas: CajasDeRemesa | null
  hoy: string
  onEnviada: (id: string) => void
}) {
  const router = useRouter()
  const turno = turnoDe(remesa.estado, remesa.lineas.length, remesa.propuesta)
  const mio = leToca(turno, actor)

  const [editando, setEditando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [borrando, setBorrando] = useState(false)
  const [confirmarBorrado, setConfirmarBorrado] = useState(false)
  const [enlazando, setEnlazando] = useState(false)
  const [pestana, setPestana] = useState<'trabajo' | 'amazon' | 'historial'>('trabajo')
  // «Enviar a Amazon» desde el ERP: solo administradores, y desde que se encaja (en «Lista» se manda)
  const conEnvioAmazon = esAdmin && (remesa.estado === 'encajando' || remesa.estado === 'lista')
  const pestanaVista = pestana === 'amazon' && !conEnvioAmazon ? 'trabajo' : pestana
  const [form, setForm] = useState({ nombre: remesa.nombre ?? '', fechaEnvio: remesa.fechaEnvio, nota: remesa.nota ?? '' })

  // Al mandar la propuesta por el enlace, la tarjeta del enlace avisa para que se relea la remesa
  useEffect(() => {
    const recargar = () => router.refresh()
    window.addEventListener('remesas:recargar', recargar)
    return () => window.removeEventListener('remesas:recargar', recargar)
  }, [router])

  async function guardar() {
    setGuardando(true)
    try {
      const res = await fetch(`/api/fba/remesas/${remesa.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const p = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        toast.error(p?.error ?? 'No se ha podido guardar')
        return
      }
      toast.success('Propuesta actualizada')
      setEditando(false)
      router.refresh()
    } finally {
      setGuardando(false)
    }
  }

  async function borrar() {
    setBorrando(true)
    try {
      const res = await fetch(`/api/fba/remesas/${remesa.id}`, { method: 'DELETE' })
      const p = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        toast.error(p?.error ?? 'No se ha podido borrar')
        return
      }
      toast.success('Propuesta borrada')
      router.refresh()
    } finally {
      setBorrando(false)
      setConfirmarBorrado(false)
    }
  }

  const creada = remesa.creadaAt ? diasEntre(remesa.creadaAt, hoy) : null
  const unidades = remesa.lineas.reduce((s, l) => s + l.enviadas, 0)

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* ================= FICHA ================= */}
      <header className="shrink-0 rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-4 py-[11px]">
        {/* flex-wrap: en el móvil los botones de la derecha bajan de línea; sin ello estrujaban la ficha a una columna de 120 px («Envío 8 · l…») */}
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-[min(100%,260px)] flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {editando ? (
                <input
                  value={form.nombre}
                  onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                  placeholder={`Propuesta del ${fecha(remesa.fechaEnvio)}`}
                  className={cx(CAMPO.input, 'h-[30px] max-w-[420px] text-[15px] font-semibold')}
                  aria-label="Nombre de la propuesta"
                />
              ) : (
                <h2 className={cx(TIPO.xl, 'min-w-0 truncate text-[var(--ls-t1)]')}>{remesa.nombre ?? `Propuesta del ${fecha(remesa.fechaEnvio)}`}</h2>
              )}
              {remesa.version > 1 && (
                <span className="rounded-[4px] border border-[var(--ls-linea2)] px-[6px] py-[1px] text-[11px] font-semibold tabular-nums text-[var(--ls-t3)]" title="Se ha reabierto: va por esta versión">
                  v{remesa.version}
                </span>
              )}
              {mio ? (
                <Insignia tono="naranja" icono={<span className="h-[7px] w-[7px] rounded-full" style={{ background: 'currentColor' }} />}>
                  Te toca a ti
                </Insignia>
              ) : (
                <Insignia tono="gris" icono={<span className="h-[7px] w-[7px] rounded-full border border-current" />}>
                  {actor === 'agencia' ? 'Espera al cliente' : 'Espera a Liberty Seller'}
                </Insignia>
              )}
            </div>
            <p className="mt-[3px] text-[12px] text-[var(--ls-t3)]">{actor === 'agencia' ? turno.paraAgencia : turno.paraCliente}</p>

            <div className="mt-[7px] flex flex-wrap items-center gap-x-4 gap-y-[5px] text-[12px] text-[var(--ls-t3)]">
              <span className="inline-flex items-center gap-[6px]" title="Fecha prevista de envío">
                <Calendar className="h-3 w-3 text-[var(--ls-t4)]" />
                {editando ? (
                  <input type="date" value={form.fechaEnvio} onChange={(e) => setForm({ ...form, fechaEnvio: e.target.value })} className={cx(CAMPO.input, 'h-[24px] w-[135px]')} aria-label="Fecha prevista de envío" />
                ) : (
                  <>Para el {fecha(remesa.fechaEnvio)}</>
                )}
              </span>
              <span>
                {remesa.lineas.length} referencia{remesa.lineas.length === 1 ? '' : 's'} · {unidades.toLocaleString('es-ES')} unidades
              </span>
              {creada !== null && <span>Creada {creada <= 0 ? 'hoy' : creada === 1 ? 'ayer' : `hace ${creada} días`}</span>}
              {remesa.aprobadaAt && <span>Aprobada el {fecha(remesa.aprobadaAt)}</span>}
            </div>

            {(editando || remesa.nota) && (
              <div className="mt-[7px] flex items-start gap-[6px] text-[12px] text-[var(--ls-t3)]">
                <StickyNote className="mt-[2px] h-3 w-3 shrink-0" />
                {editando ? (
                  <textarea value={form.nota} onChange={(e) => setForm({ ...form, nota: e.target.value })} rows={2} placeholder="Una nota para el cliente o para el equipo" className={cx(CAMPO.input, 'h-auto py-1')} aria-label="Nota" />
                ) : (
                  <span>{remesa.nota}</span>
                )}
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-[6px]">
            {!editando && <BotonExcel remesaId={remesa.id} vacia={remesa.lineas.length === 0} />}
            {puedeEditar && (
              <div className="flex shrink-0 items-center gap-[6px]">
                {editando ? (
                  <>
                    <button type="button" onClick={() => setEditando(false)} className={cx(BOTON.base, BOTON.alto, BOTON.secundario)}>
                      <X className="h-3 w-3" />
                      Cancelar
                    </button>
                    <button type="button" onClick={guardar} disabled={guardando} className={cx(BOTON.base, BOTON.alto, BOTON.primario)}>
                      {guardando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      Guardar
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" onClick={() => setEditando(true)} className={cx(BOTON.icono, 'h-7 w-7')} title="Cambiar el nombre, la fecha o la nota">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    {puedeBorrar &&
                      (confirmarBorrado ? (
                        <span className="flex items-center gap-2 rounded-[6px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-2 py-1 text-[11.5px]">
                          <span className="text-[var(--ls-t2)]">¿Borrar?</span>
                          <button type="button" onClick={borrar} disabled={borrando} className="font-semibold text-[var(--ls-e-rojo)] hover:underline">
                            {borrando ? '…' : 'Sí'}
                          </button>
                          <button type="button" onClick={() => setConfirmarBorrado(false)} className="text-[var(--ls-t3)] hover:text-[var(--ls-t1)]">
                            No
                          </button>
                        </span>
                      ) : (
                        <button type="button" onClick={() => setConfirmarBorrado(true)} className={cx(BOTON.icono, 'h-7 w-7 hover:!text-[var(--ls-e-rojo)]')} title="Borrar la propuesta">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ))}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="shrink-0">
        <FasesPropuesta estado={remesa.estado} />
      </div>

      {/* El trabajo de ahora y, aparte, la línea de tiempo de quién hizo qué */}
      <div className="shrink-0">
        <Pestanas
          etiqueta="Secciones de la propuesta"
          acento="remesas"
          idPanel={`panel-propuesta-${remesa.id}`}
          opciones={[
            { id: 'trabajo', texto: 'Lo que toca', icono: ClipboardList },
            ...(conEnvioAmazon ? [{ id: 'amazon' as const, texto: 'Enviar a Amazon', icono: Send }] : []),
            { id: 'historial', texto: 'Historial', icono: History },
          ]}
          valor={pestanaVista}
          onCambio={setPestana}
        />
      </div>

      {pestanaVista === 'historial' ? (
        <div id={`panel-propuesta-${remesa.id}`} role="tabpanel" className="min-h-0 flex-1 overflow-y-auto pb-2 pr-[2px]">
          <HistorialRemesa key={`h-${remesa.id}`} remesaId={remesa.id} abierto />
        </div>
      ) : pestanaVista === 'amazon' ? (
        <div id={`panel-propuesta-${remesa.id}`} role="tabpanel" className="min-h-0 flex-1 overflow-y-auto pb-2 pr-[2px]">
          <EnviarAAmazon key={`a-${remesa.id}`} remesaId={remesa.id} />
        </div>
      ) : (
      /* ================= LO QUE TOCA HACER AHORA ================= */
      <div id={`panel-propuesta-${remesa.id}`} role="tabpanel" className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-2 pr-[2px]">
        {/* El porqué de una propuesta que nació con IA. Solo la agencia; abierto mientras se está revisando */}
        {esAdmin && remesa.analisisIa && <TarjetaAnalisisIa key={remesa.id} analisis={remesa.analisisIa} lineas={remesa.lineas} abierto={remesa.estado === 'borrador'} />}

        {/* La propuesta por enlace: lo que propusimos frente a lo que pide el cliente, y aprobar */}
        {remesa.estado === 'borrador' && actor === 'agencia' && <RevisionPropuesta remesa={remesa} puedeEditar={puedeEditar} />}
        {remesa.estado === 'borrador' && actor === 'agencia' && puedeEditar && <EnlaceParaElCliente remesaId={remesa.id} estado="borrador" />}

        {remesa.estado === 'borrador' && (
          <EditorBoceto
            clienteId={clienteId}
            clienteNombre={clienteNombre}
            esAdmin={esAdmin}
            puedeEditar={puedeEditar}
            conCatalogo={esClienteConCatalogo(clienteNombre)}
            remesaId={remesa.id}
            lineas={remesa.lineas}
            version={remesa.propuesta?.lineasVersion ?? null}
            onGuardado={() => router.refresh()}
          />
        )}

        {remesa.estado === 'aprobada' && (
          <>
            <Tarjeta titulo="El cliente ha dado el OK" ayuda="Ya no se cambia qué se manda sin reabrir la propuesta">
              <p className="flex items-start gap-2 text-[12.5px] leading-[1.5] text-[var(--ls-t2)]">
                <CheckCircle2 className="mt-[2px] h-4 w-4 shrink-0" style={{ color: COLOR_ESTADO.verde }} />
                <span>
                  Aprobada{remesa.aprobadaAt ? ` el ${fecha(remesa.aprobadaAt)}` : ''}. Ahora toca etiquetar la mercancía y, cuando esté, empezar a encajarla.
                </span>
              </p>
            </Tarjeta>
            <ImprimirEtiquetas remesa={remesa} destacado />
            {actor === 'agencia' && puedeEditar && <EnlaceParaElCliente remesaId={remesa.id} estado="aprobada" />}
            <ResumenLineas remesa={remesa} abierto />
          </>
        )}

        {remesa.estado === 'encajando' && (
          <>
            {/* El cliente no tiene por qué entrar al ERP para encajar: se le manda un enlace. Solo para quien puede editar:
                el enlace es una credencial de escritura sobre estas cajas */}
            {puedeEditar && <EnlaceParaElCliente remesaId={remesa.id} estado="encajando" />}
            <EditorCajas
              remesaId={remesa.id}
              lineas={remesa.lineas}
              cajasIniciales={(cajas?.cajas ?? []).map((c) => ({
                numero: c.numero,
                largoCm: c.largoCm,
                anchoCm: c.anchoCm,
                altoCm: c.altoCm,
                pesoKg: c.pesoKg,
                contenido: c.contenido,
              }))}
              puedeEditar={puedeEditar}
              version={cajas?.version ?? null}
            />
            {puedeImprimirEtiquetas(remesa.estado) && <ImprimirEtiquetas remesa={remesa} />}
            <ResumenLineas remesa={remesa} />
          </>
        )}

        {remesa.estado === 'lista' && (
          <>
            <PuntosDeControl remesa={remesa} cajas={cajas} />
            {conEnvioAmazon && (
              <button
                type="button"
                onClick={() => setPestana('amazon')}
                className="ls-elevar flex w-full items-center gap-3 rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-4 py-3 text-left [@media(pointer:coarse)]:min-h-[44px]"
              >
                <Send className="h-4 w-4 shrink-0" style={{ color: 'var(--ls-mod-remesas)' }} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-[var(--ls-t1)]">Crear el envío desde el ERP</span>
                  <span className="block text-[12px] text-[var(--ls-t3)]">Plan, reparto, UPS de Amazon y etiquetas sin salir de aquí. O, como siempre, con el manifiesto en Seller Central.</span>
                </span>
              </button>
            )}
            {esAdmin && <PlantillasAmazon remesaId={remesa.id} referencias={remesa.lineas.length} unidades={unidades} />}
            {esAdmin && <DireccionOrigen clienteId={clienteId} clienteNombre={clienteNombre} puedeEditar={puedeEditar} />}
            <ImprimirEtiquetas remesa={remesa} />
            {actor === 'agencia' && puedeEditar && <EnlaceParaElCliente remesaId={remesa.id} estado="lista" />}
            <ResumenLineas remesa={remesa} />
          </>
        )}

      </div>
      )}

      {/* ================= EL SIGUIENTE PASO ================= */}
      <BarraAcciones remesa={remesa} actor={actor} cajas={cajas} onMarcarEnviada={() => setEnlazando(true)} />

      {enlazando && (
        <EnlazarEnvioDialog
          remesa={remesa}
          onCerrar={() => setEnlazando(false)}
          onHecho={() => {
            setEnlazando(false)
            router.refresh()
            onEnviada(remesa.id)
          }}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Piezas                                                              */
/* ------------------------------------------------------------------ */

/** Lo que tiene que estar en orden antes de crear el envío en Amazon */
function PuntosDeControl({ remesa, cajas }: { remesa: RemesaDePanel; cajas: CajasDeRemesa | null }) {
  const cuadra = cajas?.cuadre.cuadra ?? false
  const sinMedidas = cajas?.estado.sinMedidas ?? 0
  const nCajas = cajas?.estado.cajas ?? 0
  const etiquetasAlDia = !!remesa.ultimaImpresion && remesa.ultimaImpresion.version >= remesa.version

  const puntos: Array<{ ok: boolean; texto: string; detalle?: string; informativo?: boolean }> = [
    { ok: cuadra && nCajas > 0, texto: 'Lo encajado cuadra con lo que se manda', detalle: nCajas === 0 ? 'No hay ninguna caja' : cuadra ? `${nCajas} caja${nCajas === 1 ? '' : 's'}, sin diferencias` : 'Hay referencias que no cuadran' },
    { ok: nCajas > 0 && sinMedidas === 0, texto: 'Todas las cajas llevan medidas y peso', detalle: sinMedidas > 0 ? `A ${sinMedidas} le faltan` : undefined },
    { ok: etiquetasAlDia, informativo: true, texto: 'Las etiquetas impresas son de esta versión', detalle: remesa.ultimaImpresion ? undefined : 'Todavía no se han impreso' },
  ]

  return (
    <Tarjeta titulo="Antes de crear el envío" ayuda="Lo que tiene que estar en orden para subirlo a Seller Central">
      <ul className="space-y-[7px]">
        {puntos.map((p) => (
          <li key={p.texto} className="flex items-start gap-2 text-[12.5px] text-[var(--ls-t2)]">
            {p.ok ? (
              <CheckCircle2 className="mt-[2px] h-[14px] w-[14px] shrink-0" style={{ color: COLOR_ESTADO.verde }} />
            ) : p.informativo ? (
              <Circle className="mt-[2px] h-[14px] w-[14px] shrink-0" style={{ color: COLOR_ESTADO.ambar }} />
            ) : (
              <AlertTriangle className="mt-[2px] h-[14px] w-[14px] shrink-0" style={{ color: COLOR_ESTADO.rojo }} />
            )}
            <span>
              {p.texto}
              {p.detalle && <span className="ml-2 text-[11.5px] text-[var(--ls-t4)]">{p.detalle}</span>}
            </span>
          </li>
        ))}
      </ul>
    </Tarjeta>
  )
}

/** Qué se manda, en solo lectura: para tenerlo delante mientras se etiqueta o se encaja */
function ResumenLineas({ remesa, abierto = false }: { remesa: RemesaDePanel; abierto?: boolean }) {
  const [ver, setVer] = useState(abierto)
  const unidades = remesa.lineas.reduce((s, l) => s + l.enviadas, 0)
  return (
    <section className="rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]">
      <button type="button" onClick={() => setVer((v) => !v)} className="flex w-full items-center justify-between gap-3 px-3 py-[9px] text-left" aria-expanded={ver}>
        <span className={cx(TIPO.l, 'text-[var(--ls-t1)]')}>
          Qué se manda
          <span className="ml-2 text-[11.5px] font-normal text-[var(--ls-t3)]">
            {remesa.lineas.length} referencia{remesa.lineas.length === 1 ? '' : 's'} · {unidades.toLocaleString('es-ES')} unidades
          </span>
        </span>
        <ChevronDown className={cx('h-4 w-4 text-[var(--ls-t4)] transition-transform', ver && 'rotate-180')} />
      </button>
      {ver && (
        <div className="max-h-[300px] overflow-auto border-t border-[var(--ls-linea)]">
          <table className={TABLA.tabla}>
            <thead>
              <tr>
                <th className={TABLA.cabecera}>SKU</th>
                <th className={TABLA.cabecera}>Producto</th>
                <th className={TABLA.cabecera}>Variante</th>
                <th className={cx(TABLA.cabecera, TABLA.derecha)}>Unidades</th>
              </tr>
            </thead>
            <tbody>
              {remesa.lineas.map((l) => (
                <tr key={l.sku} className={TABLA.fila}>
                  <td className={cx(TABLA.celda, 'font-mono text-[11.5px] text-[var(--ls-t3)]')}>{l.sku}</td>
                  <td className={cx(TABLA.celda, 'max-w-[380px] truncate text-[var(--ls-t1)]')} title={[l.referencia, l.nombre].filter(Boolean).join(' · ')}>
                    {/* La REF delante cuando la hay (ShoesF): «8412 · CUERO», como en su hoja */}
                    {l.referencia && <span className="mr-[6px] text-[var(--ls-t3)]">{l.referencia}</span>}
                    {l.nombre ?? (l.referencia ? '' : '—')}
                  </td>
                  <td className={cx(TABLA.celda, 'text-[var(--ls-t3)]')}>{l.variante ?? '—'}</td>
                  <td className={cx(TABLA.celda, TABLA.numero, 'font-semibold text-[var(--ls-t1)]')}>{l.enviadas}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
