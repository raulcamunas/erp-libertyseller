'use client'

import { Fragment, useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Keyboard } from 'lucide-react'
import { PanelLateral, mezcla } from '@/components/ui-ls'
import { ATAJOS, type AccionDeAtajo } from '@/lib/correo/atajos'
import type { PropsDeAyudaDeAtajos } from './contratos'
import { Kbd } from './piezas'

/**
 * LA CHULETA DE ATAJOS («?»). Un PanelLateral (Esc y foco los resuelve el kit; en el móvil es una hoja inferior) con ATAJOS de
 * lib/correo/atajos.ts repartidos en Navegar, Leer, Escribir y Organizar. Las teclas salen en <Kbd>; «⌘» se enseña como «Ctrl» fuera del Mac.
 */

export type GrupoDeChuleta = 'Navegar' | 'Leer' | 'Escribir' | 'Organizar'

export const GRUPOS_DE_CHULETA: readonly GrupoDeChuleta[] = ['Navegar', 'Leer', 'Escribir', 'Organizar']

/** Dónde va cada acción en la chuleta (lo de atajos.ts agrupa distinto: aquí manda este reparto) */
const GRUPO_DE_ACCION: Partial<Record<AccionDeAtajo, GrupoDeChuleta>> = {
  siguiente: 'Navegar',
  anterior: 'Navegar',
  buscar: 'Navegar',
  'ir-mis-correos': 'Navegar',
  'ir-asignados': 'Navegar',
  ayuda: 'Navegar',
  abrir: 'Leer',
  volver: 'Leer',
  redactar: 'Escribir',
  responder: 'Escribir',
  'responder-todos': 'Escribir',
  reenviar: 'Escribir',
  enviar: 'Escribir',
  destacar: 'Organizar',
  'no-leido': 'Organizar',
  silenciar: 'Organizar',
}

/** Las filas que se piden en la chuleta: el texto de «enviar» sin la nota de Windows (ya cambia la tecla) */
export function gruposDeLaChuleta(enMac: boolean): Array<{ grupo: GrupoDeChuleta; filas: Array<{ accion: AccionDeAtajo; teclas: string[]; texto: string; modo: ModoDeTeclas }> }> {
  return GRUPOS_DE_CHULETA.map((grupo) => ({
    grupo,
    filas: ATAJOS.filter((a) => (GRUPO_DE_ACCION[a.accion] ?? (a.grupo === 'Escribir' ? 'Escribir' : a.grupo === 'Conversación' ? 'Organizar' : 'Navegar')) === grupo).map((a) => ({
      accion: a.accion,
      teclas: a.teclas.map((t) => (t === '⌘' && !enMac ? 'Ctrl' : t)),
      texto: a.accion === 'enviar' ? 'Enviar lo que estás escribiendo' : a.texto,
      modo: modoDeTeclas(a.accion, a.teclas),
    })),
  })).filter((g) => g.filas.length > 0)
}

/** Cómo se leen varias teclas: «g luego i» (una tras otra), «↵ o o» (cualquiera de las dos) o «⇧ + U» (a la vez) */
export type ModoDeTeclas = 'secuencia' | 'alternativa' | 'combinacion'

function modoDeTeclas(accion: AccionDeAtajo, teclas: readonly string[]): ModoDeTeclas {
  if (teclas.length > 1 && teclas[0] === 'g') return 'secuencia'
  if (teclas.some((t) => ['⇧', '⌘', 'Ctrl', 'Alt'].includes(t))) return 'combinacion'
  return accion === 'abrir' || accion === 'volver' || teclas.length > 1 ? 'alternativa' : 'combinacion'
}

const UNION: Record<ModoDeTeclas, string> = { secuencia: 'luego', alternativa: 'o', combinacion: '+' }

const NOTA_DE_GRUPO: Record<GrupoDeChuleta, string> = {
  Navegar: 'Moverte por la lista y las carpetas',
  Leer: 'Abrir y cerrar conversaciones',
  Escribir: 'Si puedes responder desde ese buzón',
  Organizar: 'Sobre la conversación abierta',
}

function useEnMac(): boolean {
  const [enMac, setEnMac] = useState(true)
  useEffect(() => {
    try {
      const plataforma = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || navigator.userAgent
      setEnMac(/mac|iphone|ipad|ipod/i.test(plataforma))
    } catch {
      /* se queda con ⌘ */
    }
  }, [])
  return enMac
}

export function AyudaDeAtajos({ abierto, onCambio }: PropsDeAyudaDeAtajos) {
  const enMac = useEnMac()
  const sinMovimiento = useReducedMotion()
  const grupos = gruposDeLaChuleta(enMac)

  return (
    <PanelLateral
      abierto={abierto}
      onCambio={onCambio}
      titulo="Atajos de teclado"
      descripcion={`Funcionan cuando no estás escribiendo en un campo. Esc y ${enMac ? '⌘' : 'Ctrl'} + ↵ valen siempre.`}
      icono={Keyboard}
      acento="marca"
      ancho={440}
    >
      <div className="flex flex-col gap-5 px-4 py-4 sm:px-5">
        {grupos.map((g, i) => (
          <motion.section
            key={g.grupo}
            aria-labelledby={`atajos-${g.grupo}`}
            initial={sinMovimiento ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, delay: sinMovimiento ? 0 : i * 0.04 }}
          >
            <header className="mb-2 flex items-baseline justify-between gap-3">
              <h3 id={`atajos-${g.grupo}`} className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ls-t3)]">
                {g.grupo}
              </h3>
              <span className="truncate text-[12px] text-[var(--ls-t4)]">{NOTA_DE_GRUPO[g.grupo]}</span>
            </header>
            <ul className="overflow-hidden rounded-[14px] border border-[var(--ls-linea)]" style={{ background: mezcla('var(--ls-sup2)', 45) }}>
              {g.filas.map((f) => (
                <li
                  key={f.accion}
                  className="flex min-h-[44px] items-center justify-between gap-3 border-b border-[var(--ls-linea)] px-3 py-2 last:border-b-0 lg:min-h-[38px]"
                >
                  <span className="min-w-0 text-[13.5px] text-[var(--ls-t1)]">{f.texto}</span>
                  <span className="flex shrink-0 items-center gap-1" aria-label={f.teclas.join(` ${UNION[f.modo]} `)}>
                    {f.teclas.map((t, j) => (
                      <Fragment key={`${t}-${j}`}>
                        {j > 0 && (
                          <span aria-hidden className="px-0.5 text-[11px] text-[var(--ls-t4)]">
                            {UNION[f.modo]}
                          </span>
                        )}
                        <Kbd>{t}</Kbd>
                      </Fragment>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </motion.section>
        ))}
        <p className="text-[12px] leading-relaxed text-[var(--ls-t3)]">
          Pulsa <Kbd>?</Kbd> en cualquier momento para volver a ver esta lista.
        </p>
      </div>
    </PanelLateral>
  )
}
