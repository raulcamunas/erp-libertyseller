'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Package } from 'lucide-react'
import { EstadoVacio } from '@/components/ui-ls'
import { analizarProductos, resumenDeRitmo } from '@/lib/fba/analisis'
import type { PanelRemesas, RemesaDePanel } from '@/lib/fba/datos'
import { esEnvio, estaEnlazada } from '@/lib/fba/vista'
import type { ClienteRemesas, SesionRemesas } from '../comun/tipos-ui'
import { cx } from '../comun/ui'
import { invalidarRemesas } from '../comun/useAgencia'
import { esPlanDeAgencia, usePlan } from '../comun/usePlan'
import { AvisoEnviosNuevos } from './AvisoEnviosNuevos'
import { DetalleEnvio } from './DetalleEnvio'
import { ListaEnvios } from './ListaEnvios'
import { ritmosDelPlan } from './reglas'

/**
 * LA SECCIÓN «ENVÍOS» DE UN CLIENTE, MONTADA (`?vista=cliente&seccion=envios`). Spec remesas-pro §8, §6.5 y §11 D38, D41.
 *
 *   · Arriba, el aviso «Hay N envíos nuevos en Amazon… [Importar]» (AvisoEnviosNuevos, D41).
 *   · ESCRITORIO (lg+): lista a la izquierda en una columna pegajosa con su propio scroll (una sola anidación) y el
 *     detalle a la derecha, que hace scroll con la página. Sin cabina de altura fija.
 *   · MÓVIL: lista y detalle APILADOS con «← Volver» (D38): al elegir un envío se ve solo el detalle y la ventana sube a
 *     su principio; al volver, la lista aparece donde estaba. Ni PanelLateral ni scrollIntoView.
 *   · El ritmo de cada referencia (planificador) va al lado del de cada envío; el transporte mediano decide el «Envío
 *     dudoso». Se piden con usePlan (memoria de 5 min); sin plan, el panel.
 *   · Tras cualquier cambio de los envíos que trae el panel (alguien cerró, volvió atrás, borró, enlazó…), se vacía la
 *     memoria de las rutas nuevas de este cliente (invalidarRemesas), como pide D25: también cuando el cambio lo hizo la
 *     BarraAcciones de Propuestas, que solo hace router.refresh().
 *
 * Los diálogos «Importar pedidos» y «Traer un envío» los monta quien tiene el estado (EspacioRemesas): aquí se piden con
 * `onImportar` y `onTraer`, y al terminar ellos hacen router.refresh() + invalidarRemesas(clienteId).
 *
 *   <SeccionEnvios cliente sesion panel remesaAbierta? enviosNuevos? onImportar onTraer onElegir? />
 */

export function SeccionEnvios({
  cliente,
  sesion,
  panel,
  remesaAbierta = null,
  enviosNuevos = 0,
  onImportar,
  onTraer,
  onElegir,
  className,
}: {
  cliente: Pick<ClienteRemesas, 'id' | 'nombre' | 'puedeEditar'>
  sesion: Pick<SesionRemesas, 'actor' | 'esAdmin' | 'esAgencia'>
  panel: PanelRemesas
  /** La remesa que pide la URL (`?remesa=`): se abre al llegar */
  remesaAbierta?: string | null
  /** Envíos que Amazon tiene y el ERP no (ya filtrado por quien puede importarlos: `nuevosDe`) */
  enviosNuevos?: number
  onImportar: () => void
  onTraer: () => void
  /** Para quien quiera saber qué envío se mira (no toca la URL: `?remesa=` obliga al servidor a leer cajas) */
  onElegir?: (remesaId: string | null) => void
  className?: string
}) {
  const hoy = panel.hoy
  const envios = useMemo(() => panel.remesas.filter(esEnvio), [panel.remesas])
  const [elegido, setElegido] = useState<string | null>(remesaAbierta)
  // En el móvil, ¿se ve el detalle (y no la lista)? Al llegar con ?remesa= de un envío, sí
  const [abierto, setAbierto] = useState<boolean>(() => !!remesaAbierta && envios.some((r) => r.id === remesaAbierta))
  const raiz = useRef<HTMLDivElement>(null)
  const scrollDeLaLista = useRef(0)

  // Si la URL cambia de remesa (un enlace a otro envío del mismo cliente), se abre
  useEffect(() => {
    if (!remesaAbierta || !envios.some((r) => r.id === remesaAbierta)) return
    setElegido(remesaAbierta)
    setAbierto(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remesaAbierta])

  /**
   * LA ELEGIDA, DERIVADA Y NO CORREGIDA: si todavía no está en el panel (se acaba de crear y el servidor no ha contestado),
   * se enseña la de por defecto sin tocar la elección; cuando lleguen los datos, se abre sola.
   */
  const envio = envios.find((r) => r.id === elegido) ?? primeroPorDefecto(envios)

  // El plan: ritmo de cada referencia y transporte mediano (para «Envío dudoso»)
  const { plan } = usePlan(cliente.id, { todas: true })
  const ritmoPlan = useMemo(() => (plan && plan.lineas.length > 0 ? ritmosDelPlan(plan.lineas) : null), [plan])
  const transporteMediano = esPlanDeAgencia(plan) ? plan.medidas.transporteMediano : null

  /** Días de stock de cada envío, para señalar en la lista los que se agotan pronto (su propio ritmo) */
  const diasCobertura = useMemo(() => {
    const globales = new Map(panel.skus.map((s) => [s.sku, s]))
    const m = new Map<string, number | null>()
    for (const r of envios) m.set(r.id, r.quedan === 0 ? null : resumenDeRitmo(r, analizarProductos(r, globales, hoy), hoy).cobertura)
    return m
  }, [envios, panel.skus, hoy])

  // D25: si los envíos del panel cambian (estado, llegada, recibidas, alguno que se va o llega), la memoria de las rutas
  // nuevas de este cliente ya no vale. Pasa tras el router.refresh() de cualquier acción, también las de otros paquetes.
  const firma = useMemo(() => envios.map((r) => `${r.id}:${r.estado}:${r.estadoAmazon ?? ''}:${r.llegadaAt ?? ''}:${r.quedan}`).join('|'), [envios])
  const firmaAnterior = useRef(firma)
  useEffect(() => {
    if (firmaAnterior.current === firma) return
    firmaAnterior.current = firma
    invalidarRemesas(cliente.id)
  }, [firma, cliente.id])

  function esMovil() {
    return typeof window !== 'undefined' && !window.matchMedia('(min-width: 1024px)').matches
  }

  function elegir(id: string) {
    setElegido(id)
    onElegir?.(id)
    if (!esMovil()) return
    scrollDeLaLista.current = window.scrollY
    setAbierto(true)
    // La ventana sube al principio de la sección (no scrollIntoView: movía también contenedores con scroll)
    requestAnimationFrame(() => {
      const top = raiz.current ? raiz.current.getBoundingClientRect().top + window.scrollY - 72 : 0
      window.scrollTo({ top: Math.max(0, top), behavior: 'auto' })
    })
  }

  function volver() {
    setAbierto(false)
    const y = scrollDeLaLista.current
    requestAnimationFrame(() => window.scrollTo({ top: y, behavior: 'auto' }))
  }

  return (
    <div ref={raiz} className={cx('flex min-w-0 flex-col gap-4', className)}>
      {/* En el móvil, con un envío abierto, el aviso se queda en la lista: el detalle empieza arriba */}
      <AvisoEnviosNuevos nuevos={enviosNuevos} onImportar={onImportar} className={abierto ? 'hidden lg:flex' : undefined} />

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(280px,320px)_minmax(0,1fr)] lg:items-start">
        <div className={cx('min-w-0 lg:sticky lg:top-4 lg:flex lg:max-h-[calc(100vh-2rem)] lg:flex-col', abierto && 'hidden')}>
          <ListaEnvios
            envios={envios}
            seleccionada={envio?.id ?? null}
            onElegir={elegir}
            puedeEditar={cliente.puedeEditar}
            onTraer={onTraer}
            diasCobertura={diasCobertura}
            hoy={hoy}
            transporteMediano={transporteMediano}
            className="lg:min-h-0 lg:flex-1"
          />
        </div>

        <section aria-label="Detalle del envío" className={cx('min-w-0', !abierto && 'hidden lg:block', abierto && 'ls-aparecer lg:animate-none')}>
          {envio ? (
            <DetalleEnvio
              key={envio.id}
              remesa={envio}
              skus={panel.skus}
              hoy={hoy}
              puedeEditar={cliente.puedeEditar}
              puedeBorrar={sesion.esAdmin}
              puedeLeerVentas={sesion.esAdmin}
              conectado={panel.conectado}
              clienteId={cliente.id}
              actor={sesion.actor}
              ritmoPlan={ritmoPlan}
              transporteMediano={transporteMediano}
              onVolver={volver}
              onBorrada={() => {
                setElegido(null)
                setAbierto(false)
                onElegir?.(null)
              }}
            />
          ) : (
            <div className="rounded-[14px] border border-dashed border-[var(--ls-linea2)] bg-[var(--ls-sup)]">
              <EstadoVacio
                icono={Package}
                acento="remesas"
                titulo={envios.length === 0 ? 'Todavía no hay ningún envío' : 'Elige un envío de la lista'}
                descripcion={
                  envios.length === 0
                    ? 'Los envíos nacen de una propuesta: se prepara con el cliente, se marca como enviada y se enlaza con su número de Amazon. O se trae uno que ya existe por su número FBA.'
                    : 'Aquí aparece todo lo que se sabe de él: por dónde va en Amazon, cuánto ha llegado, cuánto se ha vendido y cuándo se agota.'
                }
                accion={envios.length === 0 && cliente.puedeEditar ? { texto: 'Traer un envío de Amazon', onClick: onTraer } : undefined}
              />
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

/** Al abrir Envíos, si no hay ninguno elegido, el más reciente de los enlazados que siga vivo */
function primeroPorDefecto(envios: RemesaDePanel[]): RemesaDePanel | null {
  const enlazados = envios.filter(estaEnlazada).sort((a, b) => b.fechaEnvio.localeCompare(a.fechaEnvio))
  return enlazados.find((r) => r.quedan > 0) ?? enlazados[0] ?? null
}
