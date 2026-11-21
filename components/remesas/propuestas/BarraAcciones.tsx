'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Archive, ArrowRight, ChevronDown, Send, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { Boton, Confirmacion } from '@/components/ui-ls'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import type { CajasDeRemesa } from '@/lib/fba/cajas'
import type { RemesaDePanel } from '@/lib/fba/datos'
import { puedeAvanzar, siguientesPasos, type Actor, type EstadoRemesa, type Transicion } from '@/lib/fba/flujo'
import { turnoDe } from '@/lib/fba/vista'
import { invalidarRemesas } from '../comun/useAgencia'
import { cx } from '../comun/ui'

/**
 * LA BARRA DE «¿Y AHORA QUÉ?».
 *
 * Solo salen los pasos que ESTE actor puede dar desde ESTE estado, y el principal dice antes de pulsarlo
 * qué va a pasar. Si no se puede dar todavía, el botón NO desaparece: sale apagado con la lista de lo que
 * falta, entera y de una vez. Esconderlo obliga a adivinar por qué no está.
 *
 * Marcar como enviada no es un clic: abre el diálogo que pide el número de envío FBA y lo comprueba contra
 * Amazon. La decisión de si se puede es SIEMPRE de lib/fba/flujo.ts; la ruta la vuelve a comprobar con lo
 * que hay en la base y contesta 409 si alguien lo movió entre medias (con «Recargar»).
 *
 * TAMBIÉN PARA LOS ENVÍOS (spec remesas-pro §8, D19). Desde `enviada` hay dos pasos que existían en flujo.ts
 * sin botón: «Volver atrás» (enviada → lista, se marcó por error) y «Cerrar» (enviada → cerrada). Los dos
 * piden confirmación antes de mandar nada: volver atrás también devuelve el envío propuesto del plan a «En
 * preparación», y cerrar deja de seguir el envío. La API no cambia: quien la monta (Envíos) decide si la enseña.
 *
 * DÓNDE VA. En el escritorio, pegada abajo dentro de la columna (sticky). En el móvil, fija abajo de la
 * pantalla en un PORTAL (`.pagina-de-ruta` deja un `transform` y un `fixed` dentro se colocaría respecto a
 * ella) con el hueco de la barra de inicio del teléfono (safe-area), y un hueco del mismo alto al final de
 * la página para que no tape lo último.
 */

const ORDEN: EstadoRemesa[] = ['borrador', 'aprobada', 'encajando', 'lista', 'enviada', 'cerrada']

/** Los pasos que piden confirmación antes de mandarse, con lo que se dice en ella */
const CONFIRMAR: Partial<Record<string, { titulo: string; descripcion: string; boton: string; tono: 'peligro' | 'normal' }>> = {
  'enviada>lista': {
    titulo: '¿Volver a «Lista para enviar»?',
    descripcion:
      'Solo si se marcó como enviada por error y la mercancía todavía no ha salido. Vuelve a las propuestas y, si nació de un envío propuesto del plan, ese envío vuelve a «En preparación».',
    boton: 'Volver atrás',
    tono: 'peligro',
  },
  'enviada>cerrada': {
    titulo: '¿Cerrar este envío?',
    descripcion: 'Es para cuando Amazon ya ha terminado de recibir. La remesa deja de moverse y su estado en Amazon deja de seguirse solo.',
    boton: 'Cerrar el envío',
    tono: 'normal',
  },
}

const claveDe = (t: Pick<Transicion, 'desde' | 'hasta'>) => `${t.desde}>${t.hasta}`

export function BarraAcciones({
  remesa,
  actor,
  cajas,
  onMarcarEnviada,
  clienteId,
}: {
  remesa: RemesaDePanel
  actor: Actor
  cajas: CajasDeRemesa | null
  onMarcarEnviada: () => void
  /** Para vaciar la memoria de las pantallas de ese cliente al mover. Sin él se vacía toda (es lo seguro) */
  clienteId?: string
}) {
  const router = useRouter()
  const [moviendo, setMoviendo] = useState<EstadoRemesa | null>(null)
  const [confirmando, setConfirmando] = useState<Transicion | null>(null)
  const [verMotivos, setVerMotivos] = useState(false)

  const pasos = siguientesPasos(remesa.estado, actor)
  const desde = ORDEN.indexOf(remesa.estado)
  const adelante = pasos.filter((p) => ORDEN.indexOf(p.hasta) > desde)
  const atras = pasos.filter((p) => ORDEN.indexOf(p.hasta) < desde)
  const principal = adelante[0] ?? null

  const permiso = principal
    ? puedeAvanzar(remesa.estado, principal.hasta, actor, {
        lineas: remesa.lineas.length,
        cuadre: cajas?.cuadre,
        cajas: cajas?.estado,
        // El número se pide en el diálogo, justo al pulsar: aquí no puede bloquear
        referencia: 'se-pide-al-pulsar',
      })
    : null

  function pulsar(t: Transicion) {
    if (t.hasta === 'enviada') return onMarcarEnviada()
    if (CONFIRMAR[claveDe(t)]) return setConfirmando(t)
    void mover(t.hasta)
  }

  async function mover(hasta: EstadoRemesa): Promise<void> {
    setMoviendo(hasta)
    try {
      const res = await fetch(`/api/fba/remesas/${remesa.id}/estado`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // El paso que se está viendo: si alguien lo movió entre medias, el servidor contesta 409 y no aplica nada
        body: JSON.stringify({ hasta, desde: remesa.estado }),
      })
      const p = (await res.json().catch(() => null)) as { error?: string; motivos?: string[]; conflicto?: boolean } | null
      if (res.status === 409 && p?.conflicto) {
        toast.error(p.error ?? 'Alguien ha cambiado esto. Recarga.', {
          action: {
            label: 'Recargar',
            onClick: () => {
              router.refresh()
              invalidarRemesas(clienteId ?? null)
            },
          },
        })
        return
      }
      if (!res.ok) {
        // Se enseñan TODOS los motivos, uno por línea: arreglar de uno en uno obliga a reintentar tantas
        // veces como cosas falten.
        toast.error(p?.motivos?.join('\n') ?? p?.error ?? 'No se ha podido mover')
        return
      }
      toast.success('Hecho')
      router.refresh()
      invalidarRemesas(clienteId ?? null)
    } catch {
      toast.error('Se ha cortado la conexión con el servidor. Revisa la red y vuelve a probar.')
    } finally {
      setMoviendo(null)
    }
  }

  const turno = turnoDe(remesa.estado, remesa.lineas.length, remesa.propuesta)
  const mensaje = actor === 'agencia' ? turno.paraAgencia : turno.paraCliente
  const motivos = permiso && !permiso.puede ? permiso.motivos : []
  const confirmacion = confirmando ? CONFIRMAR[claveDe(confirmando)] : undefined

  /** Lo que dice la barra: qué falta, o qué pasa al pulsar, o de quién es el turno */
  const texto = (movil: boolean): ReactNode => {
    if (motivos.length > 0) {
      // En el móvil se ve el primero y el resto se despliega: una pared de avisos fija abajo taparía la pantalla
      const visibles = movil && !verMotivos ? motivos.slice(0, 1) : motivos
      const resto = motivos.length - 1
      return (
        <div className="min-w-0">
          <ul className={cx('space-y-[3px]', movil && verMotivos && 'max-h-[30vh] overflow-y-auto')}>
            {visibles.map((m) => (
              <li key={m.texto} className="flex items-start gap-[6px] text-[12.5px] leading-[1.45] text-[var(--ls-t2)]">
                <AlertTriangle className="mt-[2px] h-[13px] w-[13px] shrink-0" style={{ color: COLOR_ESTADO.ambar }} aria-hidden />
                <span className="min-w-0">{m.texto}</span>
              </li>
            ))}
          </ul>
          {movil && resto > 0 && (
            <button
              type="button"
              onClick={() => setVerMotivos((v) => !v)}
              className="mt-[2px] inline-flex min-h-[32px] items-center gap-1 text-[12px] font-medium text-[var(--ls-t3)]"
              aria-expanded={verMotivos}
            >
              <ChevronDown className={cx('h-3 w-3 transition-transform motion-reduce:transition-none', verMotivos && 'rotate-180')} aria-hidden />
              {verMotivos ? 'Ver menos' : `${resto === 1 ? 'Falta 1 cosa' : `Faltan ${resto} cosas`} más`}
            </button>
          )}
        </div>
      )
    }
    if (principal) {
      return (
        <p className="min-w-0 text-[12.5px] leading-[1.45] text-[var(--ls-t3)]">
          <b className="font-semibold text-[var(--ls-t2)]">Siguiente:</b> {principal.consecuencia}
        </p>
      )
    }
    return <p className="min-w-0 text-[12.5px] leading-[1.45] text-[var(--ls-t3)]">{mensaje}</p>
  }

  const botones = (
    <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
      {atras.map((p) => (
        <Boton key={p.hasta} variante="secundario" tamano="sm" icono={Undo2} cargando={moviendo === p.hasta} disabled={moviendo !== null} title={p.consecuencia} onClick={() => pulsar(p)}>
          {p.boton}
        </Boton>
      ))}
      {principal && (
        <Boton
          variante="primario"
          tamano="sm"
          icono={principal.hasta === 'enviada' ? Send : principal.hasta === 'cerrada' ? Archive : ArrowRight}
          cargando={moviendo === principal.hasta}
          disabled={!permiso?.puede || moviendo !== null}
          title={permiso?.puede ? principal.consecuencia : permiso?.motivos.map((m) => m.texto).join('. ')}
          onClick={() => pulsar(principal)}
        >
          {principal.boton}
        </Boton>
      )}
    </div>
  )

  return (
    <>
      {/* Escritorio: pegada abajo de la columna, sin portal (sticky no se rompe con el transform de la página) */}
      <div className="sticky bottom-3 z-20 hidden lg:block">
        <div
          role="region"
          aria-label="Siguiente paso"
          className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[14px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] px-4 py-[10px] shadow-[var(--ls-sombra-2)]"
        >
          <div className="min-w-[220px] flex-1">{texto(false)}</div>
          {botones}
        </div>
      </div>

      <BarraMovil>
        <div className="min-w-0 flex-1 basis-[200px]">{texto(true)}</div>
        {botones}
      </BarraMovil>

      {confirmando && confirmacion && (
        <Confirmacion
          abierto
          onCambio={(abierto) => {
            if (!abierto) setConfirmando(null)
          }}
          titulo={confirmacion.titulo}
          descripcion={confirmacion.descripcion}
          palabra={null}
          tono={confirmacion.tono}
          textoConfirmar={confirmacion.boton}
          onConfirmar={async () => {
            const t = confirmando
            await mover(t.hasta)
            setConfirmando(null)
          }}
        />
      )}
    </>
  )
}

/**
 * LA BARRA EN EL MÓVIL: fija abajo, en portal y con el hueco de la barra de inicio. Deja en la página un hueco del
 * alto que mide de verdad (cambia si se despliegan los motivos), para que no tape lo último. Sin `backdrop-filter`:
 * en el móvil cuesta fotogramas al desplazarse.
 */
function BarraMovil({ children }: { children: ReactNode }) {
  const [montada, setMontada] = useState(false)
  const [alto, setAlto] = useState(0)
  const caja = useRef<HTMLDivElement>(null)

  useEffect(() => setMontada(true), [])
  useEffect(() => {
    const el = caja.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const medir = () => setAlto(el.getBoundingClientRect().height)
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [montada])

  return (
    <>
      <div aria-hidden className="lg:hidden" style={{ height: alto ? alto + 12 : 0 }} />
      {montada &&
        createPortal(
          <div
            ref={caja}
            role="region"
            aria-label="Siguiente paso"
            className="fixed inset-x-0 bottom-[var(--barra-hueco,0px)] z-40 border-t border-[var(--ls-linea2)] bg-[var(--ls-sup)] px-4 pb-[max(10px,env(safe-area-inset-bottom))] pt-[10px] shadow-[0_-10px_24px_-14px_rgba(0,0,0,0.55)] lg:hidden"
          >
            <div className="mx-auto flex max-w-[720px] flex-wrap items-center gap-x-3 gap-y-2">{children}</div>
          </div>,
          document.body,
        )}
    </>
  )
}
