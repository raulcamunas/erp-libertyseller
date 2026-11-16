'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ArrowLeft, Calendar, Check, CheckCircle2, ChevronDown, Circle, ClipboardList, History, Pencil, Send, StickyNote, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Boton, Confirmacion, Insignia, Pestanas, Tarjeta } from '@/components/ui-ls'
import { CAMPO, COLOR_ESTADO, type TonoEstado } from '@/lib/estilo/denso'
import type { CajasDeRemesa } from '@/lib/fba/cajas'
import type { RemesaDePanel } from '@/lib/fba/datos'
import { ESTADOS, puedeImprimirEtiquetas } from '@/lib/fba/flujo'
import { diasEntre, leToca, turnoDe } from '@/lib/fba/vista'
import type { ClienteRemesas, SesionRemesas } from '../comun/tipos-ui'
import { invalidarRemesas } from '../comun/useAgencia'
import { cx } from '../comun/ui'
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
import { esDelPlan } from './ListaPropuestas'
import { RevisionPropuesta } from './RevisionPropuesta'
import { ImprimirEtiquetas } from './ImprimirEtiquetas'
import { PlantillasAmazon } from './PlantillasAmazon'
import { TarjetaAnalisisIa } from './TarjetaAnalisisIa'

/**
 * EL ESPACIO DE TRABAJO DE UNA PROPUESTA.
 *
 * Una propuesta es lo que se está preparando con el cliente y todavía no existe en Amazon: se propone qué
 * mandar, el cliente lo aprueba, etiqueta, encaja y dice las medidas de las cajas, y la agencia crea el envío y
 * lo enlaza. Esta pantalla se adapta a la fase: arriba la ficha y el mapa de fases, en medio lo que toca hacer
 * AHORA y abajo, pegada, la barra con el siguiente paso.
 *
 * Cuando se marca como enviada deja de estar aquí y aparece en «Envíos».
 *
 * QUIÉN VE QUÉ (spec remesas-pro §1.4, D21, D27 y D39; cambio de comportamiento anotado):
 *   · Agencia que edita (admin o empleado con la casilla `remesas`): el análisis de la IA, las plantillas de
 *     Amazon (manifiesto y embalaje) y la dirección de origen. Antes era solo el administrador.
 *   · Solo administrador, como antes: «Enviar a Amazon» por API (escribe en Amazon) y borrar la propuesta.
 *   · Cliente de fuera con `puede_editar`: editar el boceto en borrador, aprobar («Acepto» va por su enlace),
 *     etiquetas y encaje. Sin el análisis de la IA (D26: ni le llega).
 *
 * La página hace scroll normal (fuera la cabina de altura fija): en el móvil lista y detalle van apilados y se
 * vuelve con «← Volver»; nada de esto va en una hoja modal (D38), que rompería los desplegables del editor.
 */

const TONO_FASE: Record<(typeof ESTADOS)[keyof typeof ESTADOS]['tono'], TonoEstado> = {
  borrador: 'gris',
  espera: 'ambar',
  trabajo: 'azul',
  camino: 'cian',
  hecho: 'verde',
}

export function EspacioPropuesta({
  remesa,
  sesion,
  cliente,
  cajas,
  hoy,
  onEnviada,
  onVolver,
}: {
  remesa: RemesaDePanel
  sesion: SesionRemesas
  cliente: ClienteRemesas
  cajas: CajasDeRemesa | null
  hoy: string
  onEnviada: (id: string) => void
  /** Solo en el móvil (lista y detalle apilados): vuelve a la lista */
  onVolver?: () => void
}) {
  const router = useRouter()
  const actor = sesion.actor
  const puedeEditar = cliente.puedeEditar
  const esAdmin = sesion.esAdmin
  /** La agencia que edita este cliente: análisis de la IA, plantillas y dirección (antes, solo admin) */
  const agenciaEdita = sesion.esAgencia && puedeEditar
  const turno = turnoDe(remesa.estado, remesa.lineas.length, remesa.propuesta)
  const mio = leToca(turno, actor)

  const [editando, setEditando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [confirmarBorrado, setConfirmarBorrado] = useState(false)
  const [enlazando, setEnlazando] = useState(false)
  const [pestana, setPestana] = useState<'trabajo' | 'amazon' | 'historial'>('trabajo')
  // «Enviar a Amazon» desde el ERP: solo administradores, y desde que se encaja (en «Lista» se manda)
  const conEnvioAmazon = esAdmin && (remesa.estado === 'encajando' || remesa.estado === 'lista')
  const pestanaVista = pestana === 'amazon' && !conEnvioAmazon ? 'trabajo' : pestana
  const [form, setForm] = useState({ nombre: remesa.nombre ?? '', fechaEnvio: remesa.fechaEnvio, nota: remesa.nota ?? '' })

  /** Tras cualquier escritura: la página relee el panel y las pantallas de agencia olvidan lo de este cliente */
  const releer = () => {
    router.refresh()
    invalidarRemesas(cliente.id)
  }

  // Al mandar la propuesta por el enlace (o pulsar «Ver lo encajado»), la tarjeta del enlace avisa para que se relea
  useEffect(() => {
    const recargar = () => {
      router.refresh()
      invalidarRemesas(cliente.id)
    }
    window.addEventListener('remesas:recargar', recargar)
    return () => window.removeEventListener('remesas:recargar', recargar)
  }, [router, cliente.id])

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
      releer()
    } catch {
      toast.error('Se ha cortado la conexión con el servidor. Revisa la red y vuelve a probar.')
    } finally {
      setGuardando(false)
    }
  }

  async function borrar() {
    const res = await fetch(`/api/fba/remesas/${remesa.id}`, { method: 'DELETE' })
    const p = (await res.json().catch(() => null)) as { error?: string } | null
    if (!res.ok) {
      toast.error(p?.error ?? 'No se ha podido borrar')
      // Confirmacion solo se cierra si no falla
      throw new Error(p?.error ?? 'No se ha podido borrar')
    }
    toast.success('Propuesta borrada')
    releer()
  }

  const creada = remesa.creadaAt ? diasEntre(remesa.creadaAt, hoy) : null
  const unidades = remesa.lineas.reduce((s, l) => s + l.enviadas, 0)
  const fase = ESTADOS[remesa.estado]
  const delPlan = esDelPlan(remesa)
  const idPanel = `panel-propuesta-${remesa.id}`

  return (
    <div className="min-w-0 space-y-3">
      {onVolver && (
        <button
          type="button"
          onClick={onVolver}
          className="inline-flex min-h-[40px] items-center gap-[6px] rounded-[10px] px-1 text-[13px] font-medium text-[var(--ls-t2)] hover:text-[var(--ls-t1)] lg:hidden"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Volver a las propuestas
        </button>
      )}

      {/* ================= FICHA ================= */}
      <header className="relative overflow-hidden rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-4 py-3 shadow-[var(--ls-sombra-1)]">
        <span aria-hidden className="pointer-events-none absolute inset-y-3 left-0 w-[3px] rounded-r-full" style={{ background: 'var(--ls-mod-remesas)' }} />
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-[min(100%,260px)] flex-1">
            {editando ? (
              <input
                value={form.nombre}
                onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                placeholder={`Propuesta del ${fecha(remesa.fechaEnvio)}`}
                className={cx(CAMPO.input, 'h-9 max-w-[460px] text-[15px] font-semibold')}
                aria-label="Nombre de la propuesta"
              />
            ) : (
              <h2 className="min-w-0 break-words text-[17px] font-semibold leading-tight text-[var(--ls-t1)]">{remesa.nombre ?? `Propuesta del ${fecha(remesa.fechaEnvio)}`}</h2>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-[6px]">
              <Insignia tono={TONO_FASE[fase.tono]} title={fase.pista}>
                {fase.texto}
              </Insignia>
              {mio ? (
                <Insignia tono="naranja" vivo title={actor === 'agencia' ? turno.paraAgencia : turno.paraCliente}>
                  Te toca a ti
                </Insignia>
              ) : (
                <Insignia tono="gris" variante="contorno" title={actor === 'agencia' ? turno.paraAgencia : turno.paraCliente}>
                  {actor === 'agencia' ? 'Espera al cliente' : 'Espera a Liberty Seller'}
                </Insignia>
              )}
              {delPlan && sesion.esAgencia && (
                <Insignia tono="cian" variante="contorno" title="Nació de un envío propuesto por el planificador de reposición">
                  Del plan
                </Insignia>
              )}
              {remesa.version > 1 && (
                <Insignia tono="violeta" variante="contorno" punto={false} title="Se ha reabierto: va por esta versión. Las etiquetas de versiones anteriores ya no valen">
                  v{remesa.version}
                </Insignia>
              )}
            </div>

            <p className="mt-2 text-[12.5px] leading-[1.5] text-[var(--ls-t3)]">{actor === 'agencia' ? turno.paraAgencia : turno.paraCliente}</p>

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-[6px] text-[12.5px] text-[var(--ls-t3)]">
              <span className="inline-flex items-center gap-[6px]" title="Fecha prevista de envío">
                <Calendar className="h-[13px] w-[13px] text-[var(--ls-t4)]" aria-hidden />
                {editando ? (
                  <input type="date" value={form.fechaEnvio} onChange={(e) => setForm({ ...form, fechaEnvio: e.target.value })} className={cx(CAMPO.input, 'h-9 !w-[150px]')} aria-label="Fecha prevista de envío" />
                ) : (
                  <>Para el {fecha(remesa.fechaEnvio)}</>
                )}
              </span>
              <span className="tabular-nums">
                {remesa.lineas.length} referencia{remesa.lineas.length === 1 ? '' : 's'} · {unidades.toLocaleString('es-ES')} unidades
              </span>
              {creada !== null && <span>Creada {creada <= 0 ? 'hoy' : creada === 1 ? 'ayer' : `hace ${creada} días`}</span>}
              {remesa.aprobadaAt && <span>Aprobada el {fecha(remesa.aprobadaAt)}</span>}
            </div>

            {(editando || remesa.nota) && (
              <div className="mt-2 flex items-start gap-[6px] text-[12.5px] text-[var(--ls-t3)]">
                <StickyNote className="mt-[3px] h-[13px] w-[13px] shrink-0" aria-hidden />
                {editando ? (
                  <textarea value={form.nota} onChange={(e) => setForm({ ...form, nota: e.target.value })} rows={2} placeholder="Una nota para el cliente o para el equipo" className={cx(CAMPO.input, 'h-auto py-2')} aria-label="Nota" />
                ) : (
                  <span className="min-w-0 break-words">{remesa.nota}</span>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {editando ? (
              <>
                <Boton variante="secundario" tamano="sm" icono={X} onClick={() => setEditando(false)}>
                  Cancelar
                </Boton>
                <Boton variante="primario" tamano="sm" icono={Check} cargando={guardando} onClick={() => void guardar()}>
                  Guardar
                </Boton>
              </>
            ) : (
              <>
                <BotonExcel remesaId={remesa.id} vacia={remesa.lineas.length === 0} />
                {puedeEditar && <Boton variante="fantasma" tamano="sm" soloIcono icono={Pencil} aria-label="Cambiar el nombre, la fecha o la nota" title="Cambiar el nombre, la fecha o la nota" onClick={() => setEditando(true)} />}
                {puedeEditar && esAdmin && (
                  <Boton
                    variante="fantasma"
                    tamano="sm"
                    soloIcono
                    icono={Trash2}
                    aria-label="Borrar la propuesta"
                    title="Borrar la propuesta"
                    className="hover:!text-[var(--ls-e-rojo)]"
                    onClick={() => setConfirmarBorrado(true)}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </header>

      <FasesPropuesta estado={remesa.estado} />

      {/* El trabajo de ahora y, aparte, la línea de tiempo de quién hizo qué */}
      <Pestanas
        etiqueta="Secciones de la propuesta"
        acento="remesas"
        idPanel={idPanel}
        opciones={[
          { id: 'trabajo', texto: 'Lo que toca', icono: ClipboardList },
          ...(conEnvioAmazon ? [{ id: 'amazon' as const, texto: 'Enviar a Amazon', icono: Send }] : []),
          { id: 'historial', texto: 'Historial', icono: History },
        ]}
        valor={pestanaVista}
        onCambio={setPestana}
      />

      {pestanaVista === 'historial' ? (
        <div id={idPanel} role="tabpanel">
          <HistorialRemesa key={`h-${remesa.id}`} remesaId={remesa.id} abierto />
        </div>
      ) : pestanaVista === 'amazon' ? (
        <div id={idPanel} role="tabpanel">
          <EnviarAAmazon key={`a-${remesa.id}`} remesaId={remesa.id} />
        </div>
      ) : (
        /* ================= LO QUE TOCA HACER AHORA ================= */
        <div id={idPanel} role="tabpanel" className="space-y-3">
          {/* El porqué de una propuesta que nació con IA o del plan. Solo la agencia que edita; abierto mientras se revisa */}
          {agenciaEdita && remesa.analisisIa && <TarjetaAnalisisIa key={remesa.id} analisis={remesa.analisisIa} lineas={remesa.lineas} abierto={remesa.estado === 'borrador'} clienteId={cliente.id} />}

          {/* La propuesta por enlace: lo que propusimos frente a lo que pide el cliente, y aprobar */}
          {remesa.estado === 'borrador' && actor === 'agencia' && <RevisionPropuesta remesa={remesa} puedeEditar={puedeEditar} clienteId={cliente.id} />}
          {remesa.estado === 'borrador' && actor === 'agencia' && puedeEditar && <EnlaceParaElCliente remesaId={remesa.id} estado="borrador" />}

          {remesa.estado === 'borrador' && (
            <EditorBoceto
              clienteId={cliente.id}
              clienteNombre={cliente.nombre}
              esAdmin={esAdmin}
              puedeEditar={puedeEditar}
              conCatalogo={cliente.tieneCatalogo}
              remesaId={remesa.id}
              lineas={remesa.lineas}
              version={remesa.propuesta?.lineasVersion ?? null}
              onGuardado={releer}
            />
          )}

          {remesa.estado === 'aprobada' && (
            <>
              <Tarjeta icono={CheckCircle2} acento={COLOR_ESTADO.verde} titulo="El cliente ha dado el OK" subtitulo="Para cambiar qué se manda hay que reabrirla">
                <p className="text-[13px] leading-[1.55] text-[var(--ls-t2)]">
                  Aprobada{remesa.aprobadaAt ? ` el ${fecha(remesa.aprobadaAt)}` : ''}. Ahora toca etiquetar la mercancía y, cuando esté, empezar a encajarla.
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
                clienteId={cliente.id}
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
                  className="ls-elevar flex w-full items-center gap-3 rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-4 py-3 text-left [@media(hover:none)]:!transform-none [@media(pointer:coarse)]:min-h-[44px]"
                >
                  <Send className="h-4 w-4 shrink-0" style={{ color: 'var(--ls-mod-remesas)' }} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-[var(--ls-t1)]">Crear el envío desde el ERP</span>
                    <span className="block text-[12px] text-[var(--ls-t3)]">Plan, reparto, UPS de Amazon y etiquetas sin salir de aquí. O, como siempre, con el manifiesto en Seller Central.</span>
                  </span>
                </button>
              )}
              {agenciaEdita && <PlantillasAmazon remesaId={remesa.id} referencias={remesa.lineas.length} unidades={unidades} />}
              {agenciaEdita && <DireccionOrigen clienteId={cliente.id} clienteNombre={cliente.nombre} puedeEditar={puedeEditar} />}
              <ImprimirEtiquetas remesa={remesa} />
              {actor === 'agencia' && puedeEditar && <EnlaceParaElCliente remesaId={remesa.id} estado="lista" />}
              <ResumenLineas remesa={remesa} />
            </>
          )}
        </div>
      )}

      {/* ================= EL SIGUIENTE PASO ================= */}
      <BarraAcciones remesa={remesa} actor={actor} cajas={cajas} clienteId={cliente.id} onMarcarEnviada={() => setEnlazando(true)} />

      {enlazando && (
        <EnlazarEnvioDialog
          remesa={remesa}
          onCerrar={() => setEnlazando(false)}
          onHecho={() => {
            setEnlazando(false)
            releer()
            onEnviada(remesa.id)
          }}
        />
      )}

      <Confirmacion
        abierto={confirmarBorrado}
        onCambio={setConfirmarBorrado}
        titulo="¿Borrar esta propuesta?"
        descripcion={`Se borra «${remesa.nombre ?? `Propuesta del ${fecha(remesa.fechaEnvio)}`}» con sus ${remesa.lineas.length} referencias y sus cajas. Si nació de un envío propuesto del plan, ese envío vuelve a «Hablado».`}
        palabra={null}
        textoConfirmar="Borrar"
        onConfirmar={borrar}
      />
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
    <Tarjeta icono={ClipboardList} acento="remesas" titulo="Antes de crear el envío" subtitulo="Para subirlo a Seller Central">
      <ul className="space-y-2">
        {puntos.map((p) => (
          <li key={p.texto} className="flex items-start gap-2 text-[13px] text-[var(--ls-t2)]">
            {p.ok ? (
              <CheckCircle2 className="mt-[2px] h-[15px] w-[15px] shrink-0" style={{ color: COLOR_ESTADO.verde }} aria-label="Hecho" />
            ) : p.informativo ? (
              <Circle className="mt-[2px] h-[15px] w-[15px] shrink-0" style={{ color: COLOR_ESTADO.ambar }} aria-label="Pendiente" />
            ) : (
              <AlertTriangle className="mt-[2px] h-[15px] w-[15px] shrink-0" style={{ color: COLOR_ESTADO.rojo }} aria-label="Falta" />
            )}
            <span className="min-w-0">
              {p.texto}
              {p.detalle && <span className="ml-2 text-[12px] text-[var(--ls-t4)]">{p.detalle}</span>}
            </span>
          </li>
        ))}
      </ul>
    </Tarjeta>
  )
}

/** Qué se manda, en solo lectura: para tenerlo delante mientras se etiqueta o se encaja. En el móvil, filas apiladas */
function ResumenLineas({ remesa, abierto = false }: { remesa: RemesaDePanel; abierto?: boolean }) {
  const [ver, setVer] = useState(abierto)
  const unidades = remesa.lineas.reduce((s, l) => s + l.enviadas, 0)
  return (
    <section className="overflow-hidden rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]">
      <button type="button" onClick={() => setVer((v) => !v)} className="flex min-h-[48px] w-full items-center justify-between gap-3 px-4 py-[10px] text-left" aria-expanded={ver}>
        <span className="min-w-0 text-[13.5px] font-semibold text-[var(--ls-t1)]">
          Qué se manda
          <span className="ml-2 text-[12px] font-normal text-[var(--ls-t3)]">
            {remesa.lineas.length} referencia{remesa.lineas.length === 1 ? '' : 's'} · {unidades.toLocaleString('es-ES')} unidades
          </span>
        </span>
        <ChevronDown className={cx('h-4 w-4 shrink-0 text-[var(--ls-t4)] transition-transform motion-reduce:transition-none', ver && 'rotate-180')} aria-hidden />
      </button>
      {ver && (
        <div className="max-h-[360px] overflow-auto border-t border-[var(--ls-linea)]">
          <ul className="divide-y divide-[var(--ls-linea)]">
            {remesa.lineas.map((l) => (
              <li key={l.sku} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-2 sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)_minmax(0,120px)_64px]">
                <span className="truncate font-mono text-[12px] text-[var(--ls-t3)] max-sm:col-start-1 max-sm:row-start-2" title={l.sku}>
                  {l.sku}
                </span>
                <span className="min-w-0 truncate text-[13px] text-[var(--ls-t1)] max-sm:col-start-1 max-sm:row-start-1" title={[l.referencia, l.nombre].filter(Boolean).join(' · ')}>
                  {/* La REF delante cuando la hay (ShoesF): «8412 · CUERO», como en su hoja */}
                  {l.referencia && <span className="mr-[6px] text-[var(--ls-t3)]">{l.referencia}</span>}
                  {l.nombre ?? (l.referencia ? '' : '—')}
                  {l.variante && <span className="ml-[6px] text-[var(--ls-t3)] sm:hidden">· {l.variante}</span>}
                </span>
                <span className="hidden truncate text-[12.5px] text-[var(--ls-t3)] sm:block">{l.variante ?? '—'}</span>
                <span className="text-right text-[13px] font-semibold tabular-nums text-[var(--ls-t1)] max-sm:col-start-2 max-sm:row-span-2 max-sm:row-start-1">{l.enviadas}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
