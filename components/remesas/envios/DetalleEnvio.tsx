'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import * as Menu from '@radix-ui/react-dropdown-menu'
import { ArrowLeft, Calendar, Check, CheckCircle2, ChevronDown, CircleHelp, CloudDownload, Copy, Loader2, MoreHorizontal, PackageX, Pencil, RefreshCw, Sparkles, StickyNote, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Boton, Confirmacion, Insignia, TACTIL } from '@/components/ui-ls'
import { analizarProductos, resumenDeRitmo } from '@/lib/fba/analisis'
import type { RemesaDePanel, SkuDePanel } from '@/lib/fba/datos'
import type { Actor } from '@/lib/fba/flujo'
import { estaEnlazada, haceCuanto } from '@/lib/fba/vista'
import { BarraAcciones } from '../propuestas/BarraAcciones'
import { cx } from '../comun/ui'
import { invalidarRemesas } from '../comun/useAgencia'
import { entero, fecha } from '../formato'
import { BotonInformePdf } from './BotonInformePdf'
import { BotonLeerVentas, useLeerVentas } from './BotonLeerVentas'
import { CifrasEnvio } from './CifrasEnvio'
import { InsigniaAmazon } from './estadoAmazon'
import { PestanasEnvio } from './PestanasEnvio'
import { esDelPlan, esDudoso, faltantesAlCerrar, nacioDePropuesta, nacioDePropuestaPorHistorial, ritmoDeReferencia } from './reglas'
import { SeguidorAmazon } from './SeguidorAmazon'

/**
 * UN ENVÍO REAL, CON TODO LO QUE SE SABE DE ÉL.
 *
 * Arriba, la ficha: estado en Amazon (y las insignias «Del plan», «Envío dudoso», «Cerrado con faltantes»), nombre,
 * número de envío, fechas y acciones (Informe PDF, Consultar en Amazon, Leer ventas, corregir y borrar). Debajo:
 *   · en el móvil, cuatro cifras clave y, plegados, el recorrido en Amazon y todas las cifras;
 *   · desde lg, el recorrido entero en una fila y las ocho cifras («Recorrido y Cifras desde lg»).
 * Después, para la agencia, la barra «¿y ahora qué?» del envío (BarraAcciones de Propuestas: enviada → cerrada, y
 * «Volver atrás» enviada → lista solo si la remesa nació de una propuesta y no se importó de Amazon, spec §11 D19).
 * Y las pestañas del desglose. La página hace scroll normal: ya no hay cabina de altura fija (§6.5).
 *
 * Aquí no hay pasos de trabajo —borrador, aprobada, etiquetas…—: eso es de Propuestas. Esto es lo que ya existe en Amazon.
 *
 * Tras cualquier escritura: el `router.refresh()` de siempre y, detrás, `invalidarRemesas(clienteId)` (D25).
 *
 * API (lo de siempre, más opcionales)
 *   <DetalleEnvio remesa skus hoy puedeEditar puedeBorrar puedeLeerVentas? conectado
 *     clienteId? actor? ritmoPlan? transporteMediano? onVolver? onBorrada? />
 */

export function DetalleEnvio({
  remesa,
  skus,
  hoy,
  puedeEditar,
  puedeBorrar,
  puedeLeerVentas = false,
  conectado,
  clienteId,
  actor,
  ritmoPlan = null,
  transporteMediano = null,
  onVolver,
  onBorrada,
}: {
  remesa: RemesaDePanel
  skus: SkuDePanel[]
  hoy: string
  puedeEditar: boolean
  puedeBorrar: boolean
  /** Leer el libro mayor de Amazon ahora, sin esperar a la pasada de la noche. Solo administradores */
  puedeLeerVentas?: boolean
  conectado: boolean
  /** Para vaciar la memoria de las rutas nuevas tras escribir (invalidarRemesas) y para la pestaña Lotes */
  clienteId?: string
  /** Quién mira. Solo la agencia ve la barra «¿y ahora qué?» del envío */
  actor?: Actor
  /** Ritmo de cada referencia según el planificador (ud/día). null = sin plan: se usa el del panel */
  ritmoPlan?: Map<string, number> | null
  transporteMediano?: number | null
  /** En el móvil, «← Volver» a la lista (lista y detalle van apilados) */
  onVolver?: () => void
  onBorrada?: () => void
}) {
  const router = useRouter()
  const [siguiendo, setSiguiendo] = useState(false)
  const [editando, setEditando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [confirmarBorrado, setConfirmarBorrado] = useState(false)
  const [form, setForm] = useState({
    nombre: remesa.nombre ?? '',
    fechaEnvio: remesa.fechaEnvio,
    referenciaEnvio: remesa.referenciaEnvio ?? '',
    nota: remesa.nota ?? '',
  })
  const lectura = useLeerVentas(remesa.id, clienteId)

  // Las cifras de arriba salen del mismo cálculo que las pestañas
  const filas = useMemo(() => {
    const globales = new Map(skus.map((s) => [s.sku, s]))
    return analizarProductos(remesa, globales, hoy)
  }, [remesa, skus, hoy])
  const ritmo = useMemo(() => resumenDeRitmo(remesa, filas, hoy), [remesa, filas, hoy])
  const referencia = useMemo(
    () => ritmoDeReferencia(remesa.lineas.map((l) => l.sku), ritmoPlan, skus),
    [remesa.lineas, ritmoPlan, skus]
  )

  const delPlan = esDelPlan(remesa)
  const dudoso = esDudoso(remesa, hoy, transporteMediano)
  const faltanAlCerrar = faltantesAlCerrar(remesa)
  const esAgencia = actor === 'agencia'
  const conBarra = esAgencia && puedeEditar && remesa.estado === 'enviada'
  const deVuelta = useNacioDePropuesta(remesa, conBarra)

  /**
   * PREGUNTARLE A AMAZON AHORA MISMO.
   *
   * Pide el estado y cuántas unidades ha recibido de cada referencia, que es lo que el reparto usa para descontar: lo
   * que hay en el almacén es lo RECIBIDO, no lo declarado. Va a botón y no automático porque son dos llamadas a la API
   * y el cupo es del cliente; el resto del tiempo lo hace el ERP cada hora.
   */
  async function consultar(): Promise<boolean> {
    setSiguiendo(true)
    try {
      const res = await fetch(`/api/fba/remesas/${remesa.id}/seguir`, { method: 'POST' })
      const cuerpo = (await res.json().catch(() => null)) as { estado?: string; centro?: string | null; referencias?: number; faltan?: number; error?: string } | null

      if (!res.ok) {
        toast.error(cuerpo?.error ?? 'No se ha podido consultar el envío en Amazon')
        router.refresh()
        invalidarRemesas(clienteId)
        return false
      }
      const faltan = cuerpo?.faltan ?? 0
      if (faltan > 0) {
        toast.warning(`Amazon dice «${cuerpo?.estado}». Faltan ${faltan} unidad${faltan === 1 ? '' : 'es'} de las que se mandaron: el reparto ya cuenta con las recibidas.`)
      } else {
        toast.success(`Amazon dice «${cuerpo?.estado}»${cuerpo?.centro ? ` · ${cuerpo.centro}` : ''}. ${cuerpo?.referencias ?? 0} referencia(s) al día, sin unidades perdidas.`)
      }
      router.refresh()
      invalidarRemesas(clienteId)
      return true
    } catch {
      toast.error('Se ha cortado la conexión con el servidor. Vuelve a probar en un momento.')
      return false
    } finally {
      setSiguiendo(false)
    }
  }

  /** Enlazar un envío que no tenía número: se guarda y se comprueba contra Amazon */
  async function enlazar(numero: string): Promise<void> {
    const res = await fetch(`/api/fba/remesas/${remesa.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ referenciaEnvio: numero }),
    })
    if (!res.ok) {
      const p = (await res.json().catch(() => null)) as { error?: string } | null
      toast.error(p?.error ?? 'No se ha podido guardar el número')
      throw new Error('guardar')
    }
    const bien = await consultar()
    if (!bien) throw new Error('consultar')
  }

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
      toast.success('Envío actualizado')
      setEditando(false)
      router.refresh()
      invalidarRemesas(clienteId)
    } catch {
      toast.error('Se ha cortado la conexión con el servidor. Vuelve a probar en un momento.')
    } finally {
      setGuardando(false)
    }
  }

  /** Lanza si falla: así la confirmación se queda abierta y dice qué ha pasado */
  async function borrar() {
    const res = await fetch(`/api/fba/remesas/${remesa.id}`, { method: 'DELETE' })
    const p = (await res.json().catch(() => null)) as { error?: string } | null
    if (!res.ok) {
      toast.error(p?.error ?? 'No se ha podido borrar')
      throw new Error(p?.error ?? 'borrar')
    }
    toast.success('Envío borrado')
    onBorrada?.()
    router.refresh()
    invalidarRemesas(clienteId)
  }

  async function copiar() {
    if (!remesa.referenciaEnvio) return
    try {
      await navigator.clipboard.writeText(remesa.referenciaEnvio)
      toast.success('Número de envío copiado')
    } catch {
      toast.error('No se ha podido copiar')
    }
  }

  const enlazada = estaEnlazada(remesa)
  const puedeConsultar = enlazada && puedeEditar
  const puedeLeer = puedeLeerVentas && conectado && enlazada
  // Se destaca cuando Amazon ya tiene el envío en el almacén y el libro mayor aún no ha confirmado su llegada: es justo
  // cuando se acaba de traer y todo sale en cero
  const leerDestacado = !remesa.llegadaAt && ['CLOSED', 'RECEIVING', 'CHECKED_IN', 'DELIVERED'].includes(remesa.estadoAmazon ?? '')
  const conMenu = !editando && (puedeLeer || puedeEditar)

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {onVolver && (
        <div className="lg:hidden">
          <Boton tamano="sm" variante="fantasma" icono={ArrowLeft} onClick={onVolver} className="-ml-2">
            Volver a los envíos
          </Boton>
        </div>
      )}

      {/* ======= LA FICHA ======= */}
      <header className="relative overflow-hidden rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] shadow-[var(--ls-sombra-1)] before:pointer-events-none before:absolute before:inset-0 before:bg-[image:var(--ls-velo)]">
        <span aria-hidden className="absolute left-4 top-0 h-[2px] w-10 rounded-b-full" style={{ background: 'var(--ls-mod-remesas)' }} />
        <div className="relative flex flex-col gap-3 px-4 pb-4 pt-4 sm:px-5">
          <div className="flex min-w-0 flex-wrap items-center gap-[6px]">
            <InsigniaAmazon remesa={remesa} tamano="md" />
            {delPlan && (
              <Insignia tono="azul" icono={Sparkles} title="Nació de un envío propuesto por el planificador">
                Del plan
              </Insignia>
            )}
            {dudoso && (
              <Insignia
                tono="ambar"
                icono={CircleHelp}
                variante="solida"
                title="Salió hace demasiado y Amazon no ha recibido nada: no cuenta para la cobertura del plan. Pregunta a Amazon o confirma que el envío existe"
              >
                Envío dudoso
              </Insignia>
            )}
            {faltanAlCerrar !== null && (
              <Insignia tono="rojo" icono={PackageX} title="Amazon lo cerró con menos de lo que se mandó: se puede reclamar (pestaña Seguimiento)">
                Cerrado con faltantes: {entero(faltanAlCerrar)} no llegaron
              </Insignia>
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0 flex-1">
              {editando ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <CampoTexto etiqueta="Nombre" valor={form.nombre} onCambio={(nombre) => setForm({ ...form, nombre })} placeholder={`Envío del ${fecha(remesa.fechaEnvio)}`} />
                  <CampoTexto etiqueta="Número de envío FBA" valor={form.referenciaEnvio} onCambio={(referenciaEnvio) => setForm({ ...form, referenciaEnvio })} placeholder="FBA15ABCDEF" mono />
                  <CampoTexto etiqueta="Fecha de envío" tipo="date" valor={form.fechaEnvio} onCambio={(fechaEnvio) => setForm({ ...form, fechaEnvio })} />
                </div>
              ) : (
                <>
                  <h2 className="min-w-0 break-words text-[19px] font-semibold leading-[1.25] tracking-[-0.02em] text-[var(--ls-t1)] sm:text-[21px]">
                    {remesa.nombre ?? `Envío del ${fecha(remesa.fechaEnvio)}`}
                  </h2>
                  <div className="mt-[6px] flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-[var(--ls-t3)]">
                    {enlazada && (
                      <span className="inline-flex items-center gap-[2px] rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] py-[1px] pl-2 pr-[2px]" title="Número de envío FBA">
                        <span className="font-mono text-[12.5px] text-[var(--ls-t1)]">{remesa.referenciaEnvio}</span>
                        <button
                          type="button"
                          onClick={copiar}
                          className={cx('inline-flex h-6 w-6 items-center justify-center rounded-[6px] text-[var(--ls-t3)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]', '[@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9')}
                          aria-label="Copiar el número"
                          title="Copiar el número"
                        >
                          <Copy className="h-3 w-3" aria-hidden />
                        </button>
                      </span>
                    )}
                    <Dato icono={<Calendar className="h-3 w-3" />} titulo="Fecha de envío">
                      Enviado el {fecha(remesa.fechaEnvio)}
                    </Dato>
                    {remesa.llegadaAt && <Dato titulo="Cuándo entró en el almacén, según el libro mayor">Llegó el {fecha(remesa.llegadaAt)}</Dato>}
                    {remesa.seguimientoAt && <Dato titulo={`Última consulta a Amazon: ${fecha(remesa.seguimientoAt)}`}>Consultado {haceCuanto(remesa.seguimientoAt, hoy)}</Dato>}
                  </div>
                </>
              )}
            </div>

            {/* LAS ACCIONES. En el móvil, dos a la vista y el resto en «⋯» (spec §6.5); desde lg, todas */}
            <div className="flex flex-wrap items-center gap-2 xl:justify-end">
              {editando ? (
                <>
                  <Boton tamano="sm" icono={X} onClick={() => setEditando(false)}>
                    Cancelar
                  </Boton>
                  <Boton tamano="sm" variante="primario" icono={Check} cargando={guardando} onClick={() => void guardar()}>
                    Guardar
                  </Boton>
                </>
              ) : (
                <>
                  {/* Para cualquiera que pueda ver el envío, no solo para quien lo edita: es lo que se le manda al cliente */}
                  <BotonInformePdf remesaId={remesa.id} sinLineas={remesa.lineas.length === 0} />
                  {puedeConsultar && (
                    <Boton
                      tamano="sm"
                      icono={RefreshCw}
                      cargando={siguiendo}
                      onClick={() => void consultar()}
                      title="Preguntarle a Amazon por este envío: en qué estado va y cuántas unidades ha recibido"
                    >
                      {siguiendo ? 'Preguntando…' : 'Consultar en Amazon'}
                    </Boton>
                  )}
                  {puedeLeer && (
                    <span className={cx(leerDestacado ? 'inline-flex' : 'hidden lg:inline-flex')}>
                      <BotonLeerVentas remesaId={remesa.id} clienteId={clienteId} destacado={leerDestacado} />
                    </span>
                  )}
                  {puedeEditar && (
                    <span className="hidden items-center gap-1 lg:inline-flex">
                      <Boton tamano="sm" variante="fantasma" soloIcono icono={Pencil} aria-label="Corregir la ficha" title="Corregir la ficha" onClick={() => setEditando(true)} />
                      {puedeBorrar && (
                        <Boton
                          tamano="sm"
                          variante="fantasma"
                          soloIcono
                          icono={Trash2}
                          aria-label="Borrar el envío"
                          title="Borrar el envío"
                          className="hover:!text-[var(--ls-e-rojo)]"
                          onClick={() => setConfirmarBorrado(true)}
                        />
                      )}
                    </span>
                  )}
                  {conMenu && (
                    <Menu.Root modal={false}>
                      <Menu.Trigger asChild>
                        <Boton tamano="sm" variante="secundario" soloIcono icono={MoreHorizontal} aria-label="Más acciones" className="lg:hidden" />
                      </Menu.Trigger>
                      <Menu.Portal>
                        <Menu.Content
                          align="end"
                          sideOffset={6}
                          collisionPadding={12}
                          className="z-[60] min-w-[220px] rounded-[12px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] p-1 shadow-[var(--ls-sombra-3)]"
                        >
                          {puedeLeer && !leerDestacado && (
                            <Menu.Item className={ITEM_MENU} disabled={lectura.leyendo} onSelect={() => void lectura.leer()}>
                              {lectura.leyendo ? <Loader2 className="h-[14px] w-[14px] animate-spin" aria-hidden /> : <CloudDownload className="h-[14px] w-[14px]" aria-hidden />}
                              {lectura.leyendo ? 'Leyendo de Amazon…' : 'Leer ventas'}
                            </Menu.Item>
                          )}
                          {puedeEditar && (
                            <Menu.Item className={ITEM_MENU} onSelect={() => setEditando(true)}>
                              <Pencil className="h-[14px] w-[14px]" aria-hidden /> Corregir la ficha
                            </Menu.Item>
                          )}
                          {puedeEditar && puedeBorrar && (
                            <Menu.Item className={cx(ITEM_MENU, 'text-[var(--ls-e-rojo)] data-[highlighted]:text-[var(--ls-e-rojo)]')} onSelect={() => setConfirmarBorrado(true)}>
                              <Trash2 className="h-[14px] w-[14px]" aria-hidden /> Borrar el envío
                            </Menu.Item>
                          )}
                        </Menu.Content>
                      </Menu.Portal>
                    </Menu.Root>
                  )}
                </>
              )}
            </div>
          </div>

          {(editando || remesa.nota) && (
            <div className="flex items-start gap-2 rounded-[10px] bg-[var(--ls-sup2)] px-3 py-2 text-[12.5px] text-[var(--ls-t2)]">
              <StickyNote className="mt-[3px] h-3 w-3 shrink-0 text-[var(--ls-t4)]" aria-hidden />
              {editando ? (
                <textarea
                  value={form.nota}
                  onChange={(e) => setForm({ ...form, nota: e.target.value })}
                  rows={2}
                  placeholder="Una nota, si hace falta"
                  className="min-h-[56px] w-full resize-y rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-2 py-1 text-[13px] text-[var(--ls-t1)] outline-none focus:border-[var(--ls-acc-graf)]"
                  aria-label="Nota"
                />
              ) : (
                <span className="min-w-0 break-words">{remesa.nota}</span>
              )}
            </div>
          )}
        </div>

        {/* ---------- EL RECORRIDO Y LAS CIFRAS: enteros desde lg ---------- */}
        <div className="relative hidden border-t border-[var(--ls-linea)] px-5 py-3 lg:block">
          <SeguidorAmazon remesa={remesa} puedeEditar={puedeEditar} onEnlazar={enlazar} />
        </div>
        <div className="relative hidden border-t border-[var(--ls-linea)] lg:block">
          <CifrasEnvio remesa={remesa} ritmo={ritmo} ritmoReferencia={referencia} variante="fila" />
        </div>

        {/* ---------- en el móvil, lo esencial y el resto plegado ---------- */}
        <div className="relative border-t border-[var(--ls-linea)] lg:hidden">
          <CifrasEnvio remesa={remesa} ritmo={ritmo} ritmoReferencia={referencia} variante="clave" />
          {!enlazada && (
            <div className="border-t border-[var(--ls-linea)] px-4 py-3">
              <SeguidorAmazon remesa={remesa} puedeEditar={puedeEditar} onEnlazar={enlazar} />
            </div>
          )}
          <details className="group border-t border-[var(--ls-linea)]">
            <summary className={cx('flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-[13px] font-medium text-[var(--ls-t2)] [&::-webkit-details-marker]:hidden', TACTIL)}>
              {enlazada ? 'Recorrido en Amazon y todas las cifras' : 'Todas las cifras'}
              <ChevronDown className="h-4 w-4 text-[var(--ls-t4)] transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
            </summary>
            {enlazada && (
              <div className="border-t border-[var(--ls-linea)] px-4 py-3">
                <SeguidorAmazon remesa={remesa} puedeEditar={puedeEditar} onEnlazar={enlazar} vertical />
              </div>
            )}
            <div className="border-t border-[var(--ls-linea)]">
              <CifrasEnvio remesa={remesa} ritmo={ritmo} ritmoReferencia={referencia} variante="rejilla" />
            </div>
          </details>
        </div>
      </header>

      {/* ======= ¿Y AHORA QUÉ? (agencia) ======= */}
      {conBarra &&
        (deVuelta ? (
          <BarraAcciones remesa={remesa} actor="agencia" cajas={null} onMarcarEnviada={() => undefined} />
        ) : (
          <CerrarEnvio remesa={remesa} clienteId={clienteId} faltanAlCerrar={faltanAlCerrar} />
        ))}

      {/* ======= EL DESGLOSE ======= */}
      <PestanasEnvio
        remesa={remesa}
        skus={skus}
        hoy={hoy}
        conectado={conectado}
        esAdmin={puedeLeerVentas}
        clienteId={clienteId}
        ritmoReferencia={referencia.porSku}
        filas={filas}
        ritmo={ritmo}
      />

      {puedeBorrar && (
        <Confirmacion
          abierto={confirmarBorrado}
          onCambio={setConfirmarBorrado}
          titulo="¿Borrar este envío?"
          descripcion={`Se borra «${remesa.nombre ?? `Envío del ${fecha(remesa.fechaEnvio)}`}» del ERP con sus ${remesa.lineas.length} referencias. En Amazon no se toca nada. Sus ventas dejan de repartirse en él.`}
          palabra={null}
          textoConfirmar="Borrar el envío"
          onConfirmar={borrar}
        />
      )}
    </div>
  )
}

const ITEM_MENU =
  'flex min-h-[36px] cursor-pointer select-none items-center gap-2 rounded-[8px] px-[10px] text-[13px] text-[var(--ls-t2)] outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-[var(--ls-sup3)] data-[highlighted]:text-[var(--ls-t1)] [@media(pointer:coarse)]:min-h-[44px]'

/**
 * ¿PUEDE «VOLVER ATRÁS»? Solo si la remesa salió del flujo de propuestas y no se importó de Amazon (D19).
 *
 * Lo que se sabe sin preguntar (boceto reabierto, etiquetas, aprobación, análisis, envío propuesto) basta casi siempre.
 * Si no hay ninguna huella, se mira su historial una vez: una importada no tiene pasos de propuesta. Mientras llega, o
 * si no se puede leer, NO se ofrece volver atrás (lo prudente: deshacer un envío que no era una propuesta lo rompería).
 */
function useNacioDePropuesta(remesa: RemesaDePanel, activo: boolean): boolean {
  const porHuellas = nacioDePropuesta(remesa)
  const [porHistorial, setPorHistorial] = useState<{ id: string; si: boolean } | null>(null)
  useEffect(() => {
    if (!activo || porHuellas) return
    let vivo = true
    fetch(`/api/fba/remesas/${remesa.id}/historial`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((p: { eventos?: Array<{ accion: string; hasta?: string | null }> } | null) => {
        if (vivo) setPorHistorial({ id: remesa.id, si: nacioDePropuestaPorHistorial(p?.eventos ?? []) })
      })
      .catch(() => vivo && setPorHistorial({ id: remesa.id, si: false }))
    return () => {
      vivo = false
    }
  }, [activo, porHuellas, remesa.id])
  return porHuellas || (porHistorial?.id === remesa.id && porHistorial.si)
}

/**
 * CERRAR UN ENVÍO IMPORTADO. Es la misma transición de lib/fba/flujo.ts (enviada → cerrada) y la misma ruta que usa
 * BarraAcciones, sin «Volver atrás»: un envío que se trajo de Amazon nunca fue una propuesta a la que volver.
 */
function CerrarEnvio({ remesa, clienteId, faltanAlCerrar }: { remesa: RemesaDePanel; clienteId?: string; faltanAlCerrar: number | null }) {
  const router = useRouter()
  const [moviendo, setMoviendo] = useState(false)
  const cerradoEnAmazon = (remesa.estadoAmazon ?? '').toUpperCase() === 'CLOSED'

  async function cerrar() {
    setMoviendo(true)
    try {
      const res = await fetch(`/api/fba/remesas/${remesa.id}/estado`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // El paso que se está viendo: si alguien lo movió entre medias, el servidor contesta 409 y no aplica nada
        body: JSON.stringify({ hasta: 'cerrada', desde: remesa.estado }),
      })
      const p = (await res.json().catch(() => null)) as { error?: string; motivos?: string[]; conflicto?: boolean } | null
      if (res.status === 409 && p?.conflicto) {
        toast.error(p.error ?? 'Alguien ha cambiado esto. Recarga.', {
          action: {
            label: 'Recargar',
            onClick: () => {
              router.refresh()
              invalidarRemesas(clienteId)
            },
          },
        })
        return
      }
      if (!res.ok) {
        toast.error(p?.motivos?.join('\n') ?? p?.error ?? 'No se ha podido cerrar')
        return
      }
      toast.success('Envío cerrado')
      router.refresh()
      invalidarRemesas(clienteId)
    } catch {
      toast.error('Se ha cortado la conexión con el servidor. Vuelve a probar en un momento.')
    } finally {
      setMoviendo(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[14px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] px-4 py-3 shadow-[var(--ls-sombra-1)]">
      <p className="min-w-0 flex-1 basis-[220px] text-[12.5px] leading-[1.5] text-[var(--ls-t3)]">
        {cerradoEnAmazon ? (
          <>
            <CheckCircle2 className="mr-1 inline h-[14px] w-[14px] align-[-2px]" style={{ color: 'var(--ls-e-verde)' }} aria-hidden />
            Amazon ya lo dio por cerrado.{' '}
            {faltanAlCerrar !== null ? `Reclama antes las ${entero(faltanAlCerrar)} que no llegaron y ciérralo aquí.` : 'Ciérralo aquí para que deje de moverse.'}
          </>
        ) : (
          <>
            <b className="font-semibold text-[var(--ls-t2)]">Siguiente:</b> cuando Amazon termine de recibirlo, ciérralo. La remesa deja de moverse.
          </>
        )}
      </p>
      <Boton tamano="sm" variante={cerradoEnAmazon ? 'primario' : 'secundario'} icono={CheckCircle2} cargando={moviendo} onClick={() => void cerrar()} title="Amazon ha terminado de recibir. La remesa deja de moverse.">
        Cerrar envío
      </Boton>
    </div>
  )
}

function Dato({ icono, titulo, children }: { icono?: React.ReactNode; titulo?: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-[6px]" title={titulo}>
      {icono && <span className="text-[var(--ls-t4)]">{icono}</span>}
      {children}
    </span>
  )
}

function CampoTexto({
  etiqueta,
  valor,
  onCambio,
  placeholder,
  tipo = 'text',
  mono = false,
}: {
  etiqueta: string
  valor: string
  onCambio: (v: string) => void
  placeholder?: string
  tipo?: 'text' | 'date'
  mono?: boolean
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[11.5px] font-medium text-[var(--ls-t3)]">{etiqueta}</span>
      <input
        type={tipo}
        value={valor}
        onChange={(e) => onCambio(e.target.value)}
        placeholder={placeholder}
        spellCheck={!mono}
        className={cx(
          'h-9 w-full min-w-0 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 text-[13px] text-[var(--ls-t1)] outline-none placeholder:text-[var(--ls-t4)] focus:border-[var(--ls-acc-graf)] focus:shadow-[inset_0_0_0_1px_var(--ls-acc-graf)]',
          mono && 'font-mono',
          TACTIL
        )}
      />
    </label>
  )
}
