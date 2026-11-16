'use client'

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { BellOff, BellRing, Clock, Mail, MailOpen, MoreHorizontal, Paperclip, Star, UserPlus } from 'lucide-react'
import { memo, useEffect, useRef, useState, type PointerEvent as EventoDePuntero } from 'react'
import { Avatar } from '@/components/ui-ls/Avatar'
import { FOCO } from '@/components/ui-ls/Boton'
import { PanelLateral } from '@/components/ui-ls/PanelLateral'
import { fechaDeLista } from '@/lib/correo/fechas'
import { colorDeBuzon, direccionCorta } from '@/lib/correo/marcas'
import type { Duracion } from '@/lib/correo/tipos'
import { cn } from '@/lib/utils'
import type { PropsDeFilaDeHilo } from './contratos'
import { esHiloDeRebote, puedeEncargarHilo, seAtenua } from './lista-de-hilos'
import { AvatarDeRemitente, DURACIONES, ETIQUETA_DE_DURACION, MenuDeSilencio } from './piezas'

/**
 * UNA FILA DE LA LISTA DE HILOS (spec 1.2, 1.4 y 1.6). `memo`: el sondeo cada 30 s funde la primera página y una fila que no cambia
 * conserva el MISMO objeto, así que no se repinta.
 *
 *   · 72 px en lg y 76 px en el móvil. Avatar del remitente (robot si es automático, triángulo ámbar si es un rebote) con el minipunto del
 *     buzón cuando la lista mezcla varios (Mis correos, Asignados a mí).
 *   · Sin leer: barra naranja de 3 px a la izquierda (se encoge al leerlo), punto y negrita. La abierta: --ls-sup2 y la barra también.
 *   · Etiquetas: 📎, ⏱ espera, Auto, ★, BellOff y la miniavatar de quien lo lleva.
 *   · Silenciado: opacidad 0.55 (en 200 ms). NUNCA si es un rebote: un rebote avisa siempre.
 *   · Ordenador: acciones al pasar el ratón (★, leído/no leído, silenciar), en un fundido de 120 ms.
 *     Móvil (puntero sin hover): el «⋯» de la fila o un toque largo abren una hoja con ★, Leído, Silenciar y Asignar.
 *   · Marcar y destacar solo si el buzón es `puedeResponder`; silenciar basta con leerlo. Sin buzón (ya no se lee) no hay acciones.
 *   · Nueva: entra desde arriba (y −8 → 0, 180 ms) con un brillo naranja en el filo que se apaga en 1,2 s.
 */

const TOQUE_LARGO_MS = 480
const TOLERANCIA_PX = 10

const ACCION =
  'inline-flex h-7 w-7 items-center justify-center rounded-[8px] text-[var(--ls-t3)] transition-colors hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)] ' + FOCO

const OPCION_DE_HOJA =
  'flex min-h-11 w-full items-center gap-3 rounded-[10px] px-3 text-left text-[15px] text-[var(--ls-t1)] transition-colors hover:bg-[var(--ls-sup2)] active:bg-[var(--ls-sup3)] ' + FOCO

function FilaDeHiloSinMemo({ hilo: h, activo, modo, buzon, nuevo, onElegir, onSilenciar, onAlternarLeido, onDestacar, onAsignar, esAdmin = false }: PropsDeFilaDeHilo) {
  const reducir = useReducedMotion()
  const [hoja, setHoja] = useState(false)
  const toque = useRef<{ x: number; y: number; t: ReturnType<typeof setTimeout> } | null>(null)
  const saltarClic = useRef(false)
  const ultimoPuntero = useRef<string>('mouse')

  useEffect(() => () => {
    if (toque.current) clearTimeout(toque.current.t)
  }, [])

  const sinLeer = h.noLeidos > 0
  const rebote = esHiloDeRebote(h)
  const atenuada = seAtenua(h)
  const puedeMarcar = !!buzon?.puedeResponder
  const puedeSilenciar = !!buzon && !rebote
  // La misma condición que en la vista del hilo (y que en el servidor): encarga quien responde desde el buzón o un administrador
  const puedeEncargar = !!onAsignar && puedeEncargarHilo(buzon, esAdmin)
  const conAcciones = puedeMarcar || puedeSilenciar || puedeEncargar
  const mezcla = modo !== 'buzon'
  const quien = h.contraparte || h.contraparteDireccion || '(sin remitente)'

  function cancelarToque() {
    if (toque.current) clearTimeout(toque.current.t)
    toque.current = null
  }
  function alBajar(e: EventoDePuntero<HTMLButtonElement>) {
    ultimoPuntero.current = e.pointerType
    if (e.pointerType !== 'touch' || !conAcciones) return
    cancelarToque()
    const { clientX: x, clientY: y } = e
    toque.current = {
      x,
      y,
      t: setTimeout(() => {
        toque.current = null
        saltarClic.current = true
        try {
          navigator.vibrate?.(8)
        } catch {
          /* no todos los navegadores lo dejan */
        }
        setHoja(true)
      }, TOQUE_LARGO_MS),
    }
  }
  function alMover(e: EventoDePuntero<HTMLButtonElement>) {
    const t = toque.current
    if (t && (Math.abs(e.clientX - t.x) > TOLERANCIA_PX || Math.abs(e.clientY - t.y) > TOLERANCIA_PX)) cancelarToque()
  }

  function cerrarYHacer(accion: () => void) {
    setHoja(false)
    accion()
  }

  return (
    <motion.li
      data-hilo-id={h.id}
      className="relative"
      initial={nuevo && !reducir ? { opacity: 0, y: -8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
    >
      <motion.div
        className={cn(
          'group relative flex min-h-[76px] items-stretch rounded-[10px] transition-colors lg:min-h-[72px]',
          activo
            ? 'bg-[var(--ls-sup2)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--ls-acc-graf)_28%,transparent)]'
            : '[@media(hover:hover)]:hover:bg-[var(--ls-sup2)]',
        )}
        initial={false}
        animate={{ opacity: atenuada ? 0.55 : 1 }}
        transition={{ duration: 0.2 }}
      >
        {/* La barra de sin leer (o de la abierta): se encoge al leerlo */}
        <AnimatePresence initial={false}>
          {(sinLeer || activo) && (
            <motion.span
              key="barra"
              aria-hidden
              className="pointer-events-none absolute bottom-2.5 left-0 top-2.5 w-[3px] origin-center rounded-full bg-[var(--ls-acc-graf)]"
              initial={{ scaleY: 0 }}
              animate={{ scaleY: 1 }}
              exit={{ scaleY: 0 }}
              transition={{ duration: 0.16 }}
            />
          )}
        </AnimatePresence>
        {/* El brillo de lo que acaba de llegar */}
        {nuevo && !reducir && (
          <motion.span
            key={h.ultimoMensajeAt}
            aria-hidden
            className="pointer-events-none absolute inset-y-1 left-0 w-10 rounded-l-[10px]"
            style={{ background: 'linear-gradient(90deg, color-mix(in srgb, var(--ls-acc-graf) 30%, transparent), transparent)' }}
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 1.2, ease: 'easeOut' }}
          />
        )}

        <button
          type="button"
          onClick={() => {
            if (saltarClic.current) {
              saltarClic.current = false
              return
            }
            onElegir(h.id)
          }}
          onPointerDown={alBajar}
          onPointerMove={alMover}
          onPointerUp={cancelarToque}
          onPointerCancel={cancelarToque}
          onPointerLeave={cancelarToque}
          onContextMenu={(e) => {
            // En el móvil el toque largo es nuestro (la hoja), no el menú del navegador
            if (conAcciones && ultimoPuntero.current === 'touch') e.preventDefault()
          }}
          aria-current={activo ? 'true' : undefined}
          className={cn(
            'flex min-w-0 flex-1 select-none items-start gap-3 rounded-[10px] py-2.5 pl-3.5 pr-2 text-left [-webkit-touch-callout:none] lg:py-2 lg:pr-3',
            FOCO,
          )}
        >
          <AvatarDeRemitente
            nombre={h.contraparte}
            direccion={h.contraparteDireccion}
            automatico={h.automatico}
            rebote={rebote}
            buzonColor={mezcla && buzon ? colorDeBuzon(buzon.direccion) : null}
            className="mt-0.5"
          />
          <span className="min-w-0 flex-1">
            {/* Línea 1: quién y cuándo */}
            <span className="flex items-baseline gap-2">
              <span className={cn('min-w-0 flex-1 truncate text-[14px] leading-[19px]', sinLeer ? 'font-semibold text-[var(--ls-t1)]' : 'font-medium text-[var(--ls-t2)]')}>
                {quien}
                {h.mensajes > 1 && <span className="ml-1.5 text-[12px] font-normal tabular-nums text-[var(--ls-t4)]">{h.mensajes}</span>}
              </span>
              {sinLeer && <span aria-hidden className="h-[7px] w-[7px] shrink-0 self-center rounded-full bg-[var(--ls-acc-graf)]" />}
              <time dateTime={h.ultimoMensajeAt} className={cn('shrink-0 text-[12px] tabular-nums', sinLeer ? 'font-medium text-[var(--ls-acc)]' : 'text-[var(--ls-t4)]')}>
                {fechaDeLista(h.ultimoMensajeAt)}
              </time>
            </span>
            {/* Línea 2: el asunto */}
            <span className={cn('block truncate text-[13.5px] leading-[18px]', sinLeer ? 'font-semibold text-[var(--ls-t1)]' : 'text-[var(--ls-t2)]')}>{h.asunto || '(sin asunto)'}</span>
            {/* Línea 3: la vista previa y las etiquetas */}
            <span className="mt-px flex items-center gap-1.5 lg:mt-0">
              <span className="min-w-0 flex-1 truncate text-[13px] leading-[18px] text-[var(--ls-t3)]">{h.vistaPrevia}</span>
              {mezcla && buzon && <span className="hidden max-w-[72px] shrink-0 truncate text-[11px] text-[var(--ls-t4)] lg:inline xl:max-w-[96px]">{direccionCorta(buzon.direccion)}</span>}
              {h.tieneAdjuntos && <Paperclip className="h-3.5 w-3.5 shrink-0 text-[var(--ls-t4)]" aria-label="Con adjuntos" />}
              {h.esperandoRespuesta && (
                <span title="Espera tu respuesta" className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-medium text-[var(--ls-e-ambar)]">
                  <Clock className="h-3.5 w-3.5" aria-hidden />
                  <span className="hidden sm:inline">espera</span>
                  <span className="sr-only sm:hidden">Espera tu respuesta</span>
                </span>
              )}
              {h.automatico && !rebote && (
                <span title="Automático: boletines, avisos y notificaciones" className="inline-flex h-[18px] shrink-0 items-center rounded-full bg-[var(--ls-sup3)] px-1.5 text-[10.5px] font-medium text-[var(--ls-t3)]">
                  Auto
                </span>
              )}
              {h.destacado && <Star className="h-3.5 w-3.5 shrink-0 fill-[var(--ls-e-ambar)] text-[var(--ls-e-ambar)]" aria-label="Destacado" />}
              {atenuada && (
                <span role="img" aria-label="Silenciada" title="Silenciada: no avisa ni suma en el número" className="inline-flex shrink-0 text-[var(--ls-t4)]">
                  <BellOff className="h-3.5 w-3.5" aria-hidden />
                </span>
              )}
              <AnimatePresence initial={false}>
                {h.asignadoA && (
                  <motion.span
                    key={h.asignadoA.id}
                    className="inline-flex shrink-0"
                    title={`Lo lleva ${h.asignadoA.nombre}`}
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.6, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 24 }}
                  >
                    <Avatar nombre={h.asignadoA.nombre} tamano={18} className="ring-2 ring-[var(--ls-sup)]" />
                    <span className="sr-only">Lo lleva {h.asignadoA.nombre}</span>
                  </motion.span>
                )}
              </AnimatePresence>
            </span>
            {sinLeer && <span className="sr-only">, sin leer</span>}
          </span>
        </button>

        {/* Ordenador: acciones rápidas al pasar el ratón (encima de la fecha) */}
        {conAcciones && (
          <span
            className={cn(
              'absolute right-1.5 top-1.5 hidden items-center gap-0.5 rounded-[9px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-0.5 shadow-[var(--ls-sombra-1)]',
              '[@media(hover:hover)]:flex',
              'pointer-events-none opacity-0 transition-opacity [transition-duration:120ms] motion-reduce:transition-none',
              'group-hover:pointer-events-auto group-hover:opacity-100 has-[:focus-visible]:pointer-events-auto has-[:focus-visible]:opacity-100',
              'has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100',
            )}
          >
            {puedeMarcar && (
              <button
                type="button"
                className={ACCION}
                onClick={() => onDestacar(h.id, !h.destacado)}
                aria-label={h.destacado ? 'Quitar la estrella' : 'Destacar'}
                title={h.destacado ? 'Quitar la estrella' : 'Destacar'}
              >
                <Star className={cn('h-3.5 w-3.5', h.destacado && 'fill-[var(--ls-e-ambar)] text-[var(--ls-e-ambar)]')} aria-hidden />
              </button>
            )}
            {puedeMarcar && (
              <button
                type="button"
                className={ACCION}
                onClick={() => onAlternarLeido(h.id, sinLeer)}
                aria-label={sinLeer ? 'Marcar como leído' : 'Marcar como no leído'}
                title={sinLeer ? 'Marcar como leído' : 'Marcar como no leído'}
              >
                {sinLeer ? <MailOpen className="h-3.5 w-3.5" aria-hidden /> : <Mail className="h-3.5 w-3.5" aria-hidden />}
              </button>
            )}
            {puedeSilenciar && (
              <MenuDeSilencio
                silenciado={h.silenciado}
                hasta={null}
                que="esta conversación"
                onElegir={(d) => onSilenciar(h.id, d)}
                className="h-7 w-7 rounded-[8px] lg:h-7 lg:w-7"
              />
            )}
          </span>
        )}

        {/* Móvil y tableta táctil: el «⋯» abre la hoja de acciones */}
        {conAcciones && (
          <button
            type="button"
            onClick={() => setHoja(true)}
            aria-label={`Acciones de la conversación con ${quien}`}
            aria-haspopup="dialog"
            className={cn('my-auto mr-1 inline-flex h-11 w-9 shrink-0 items-center justify-center rounded-[10px] text-[var(--ls-t3)] active:bg-[var(--ls-sup3)] [@media(hover:hover)]:hidden', FOCO)}
          >
            <MoreHorizontal className="h-[18px] w-[18px]" aria-hidden />
          </button>
        )}
      </motion.div>

      {hoja && (
        <PanelLateral abierto={hoja} onCambio={setHoja} titulo={h.asunto || '(sin asunto)'} descripcion={quien} ancho={380}>
          <div className="flex flex-col gap-0.5 overflow-y-auto p-2 pb-4">
            {puedeMarcar && (
              <button type="button" className={OPCION_DE_HOJA} onClick={() => cerrarYHacer(() => onDestacar(h.id, !h.destacado))}>
                <Star className={cn('h-[18px] w-[18px] text-[var(--ls-t3)]', h.destacado && 'fill-[var(--ls-e-ambar)] text-[var(--ls-e-ambar)]')} aria-hidden />
                {h.destacado ? 'Quitar la estrella' : 'Destacar'}
              </button>
            )}
            {puedeMarcar && (
              <button type="button" className={OPCION_DE_HOJA} onClick={() => cerrarYHacer(() => onAlternarLeido(h.id, sinLeer))}>
                {sinLeer ? <MailOpen className="h-[18px] w-[18px] text-[var(--ls-t3)]" aria-hidden /> : <Mail className="h-[18px] w-[18px] text-[var(--ls-t3)]" aria-hidden />}
                {sinLeer ? 'Marcar como leído' : 'Marcar como no leído'}
              </button>
            )}
            {puedeEncargar && onAsignar && (
              <button type="button" className={OPCION_DE_HOJA} onClick={() => cerrarYHacer(() => onAsignar(h.id))}>
                <UserPlus className="h-[18px] w-[18px] text-[var(--ls-t3)]" aria-hidden />
                {h.asignadoA ? `Cambiar quién lo lleva (${h.asignadoA.nombre})` : 'Asignar a una persona'}
              </button>
            )}
            {puedeSilenciar && (
              <div className="mt-1 border-t border-[var(--ls-linea)] pt-2" role="group" aria-label="Silenciar esta conversación">
                <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--ls-t3)]">{h.silenciado ? 'Silenciada' : 'Silenciar esta conversación'}</p>
                <p className="px-3 pb-1.5 text-[12.5px] text-[var(--ls-t4)]">No avisa ni suma en el número. Sigue a la vista, atenuada.</p>
                {h.silenciado && (
                  <button type="button" className={cn(OPCION_DE_HOJA, 'font-medium')} onClick={() => cerrarYHacer(() => onSilenciar(h.id, 'quitar'))}>
                    <BellRing className="h-[18px] w-[18px] text-[var(--ls-acc)]" aria-hidden />
                    Quitar silencio
                  </button>
                )}
                {DURACIONES.map((d: Duracion) => (
                  <button key={d} type="button" className={OPCION_DE_HOJA} onClick={() => cerrarYHacer(() => onSilenciar(h.id, d))}>
                    <BellOff className="h-[18px] w-[18px] text-[var(--ls-t3)]" aria-hidden />
                    {ETIQUETA_DE_DURACION[d]}
                  </button>
                ))}
              </div>
            )}
          </div>
        </PanelLateral>
      )}
    </motion.li>
  )
}

export const FilaDeHilo = memo(FilaDeHiloSinMemo)
FilaDeHilo.displayName = 'FilaDeHilo'

export type { PropsDeFilaDeHilo }
