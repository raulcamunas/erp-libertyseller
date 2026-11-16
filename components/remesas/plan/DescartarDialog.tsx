'use client'

import * as Dialogo from '@radix-ui/react-dialog'
import { useEffect, useId, useState } from 'react'
import { Ban } from 'lucide-react'
import { Boton, FOCO, TACTIL } from '@/components/ui-ls'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import type { MotivoDescarte } from '@/lib/fba/plan-tipos'
import { MOTIVO_DESCARTE } from '../comun/estilo-plan'
import { cx } from '../comun/ui'

/**
 * DESCARTAR UN ENVÍO PROPUESTO (spec remesas-pro §4.1 y D8): el motivo es OBLIGATORIO y deja 14 días de cuarentena
 * (el plan no lo vuelve a proponer salvo que suba la prioridad). «Se deja de vender» (descatalogada) además saca sus
 * referencias del planificador (`fba_reposicion_sku.excluir`).
 *
 * Dos formas, la misma lógica:
 *   <FormularioDescarte onConfirmar onCancelar? unidades? />   EN LÍNEA, sin portal: es la que va dentro del
 *       PanelEnvioPropuesto (un PanelLateral es un Radix Dialog modal y no admite diálogos con portal dentro, D38).
 *   <DescartarDialog abierto onCambio titulo? onConfirmar unidades? />   diálogo propio (Radix, en portal) para
 *       descartar desde una tarjeta del Plan, fuera de cualquier panel.
 *
 *   onConfirmar(motivo, nota) puede ser asíncrona: el botón espera y solo se cierra si devuelve true (o nada).
 *
 * Puro (con prueba en plan.prueba.ts): validarDescarte(motivo, nota) → texto del error o null.
 */

export const ORDEN_MOTIVOS: MotivoDescarte[] = [
  'cliente_no_quiere', 'cliente_sin_stock', 'ya_enviado_aparte', 'descatalogada', 'producto_cambia', 'datos_erroneos', 'otro',
]

const AYUDA_MOTIVO: Partial<Record<MotivoDescarte, string>> = {
  cliente_sin_stock: 'No tiene mercancía para mandar ahora.',
  ya_enviado_aparte: 'Lo mandó por su cuenta o en otra remesa.',
  descatalogada: 'Sus referencias dejan de planificarse (se pueden recuperar en Ajustes).',
  datos_erroneos: 'Ritmo, stock o plazos están mal: dinos qué en la nota.',
  otro: 'Cuéntalo en la nota.',
}

/** null = se puede descartar; si no, el texto de lo que falta */
export function validarDescarte(motivo: MotivoDescarte | null, nota: string): string | null {
  if (!motivo) return 'Elige por qué se descarta'
  if ((motivo === 'otro' || motivo === 'datos_erroneos') && nota.trim().length < 3) return 'Cuenta en la nota qué pasa'
  if (nota.length > 500) return 'La nota es demasiado larga (500 caracteres como mucho)'
  return null
}

type Confirmar = (motivo: MotivoDescarte, nota: string | null) => Promise<boolean | void> | boolean | void

export function FormularioDescarte({
  onConfirmar,
  onCancelar,
  unidades,
  className,
}: {
  onConfirmar: Confirmar
  onCancelar?: () => void
  unidades?: number | null
  className?: string
}) {
  const [motivo, setMotivo] = useState<MotivoDescarte | null>(null)
  const [nota, setNota] = useState('')
  const [tocado, setTocado] = useState(false)
  const [trabajando, setTrabajando] = useState(false)
  const id = useId()
  const error = validarDescarte(motivo, nota)

  const enviar = async () => {
    setTocado(true)
    if (error || !motivo || trabajando) return
    setTrabajando(true)
    try {
      await onConfirmar(motivo, nota.trim() || null)
    } finally {
      setTrabajando(false)
    }
  }

  return (
    <form
      className={cx('min-w-0', className)}
      onSubmit={(e) => {
        e.preventDefault()
        void enviar()
      }}
    >
      <fieldset className="min-w-0">
        <legend className="text-[13px] font-medium text-[var(--ls-t1)]">¿Por qué no se envía?</legend>
        <p className="mt-[2px] text-[12px] leading-[1.5] text-[var(--ls-t3)]">
          {unidades ? `Se quedan sin enviar ${unidades.toLocaleString('es-ES')} ud. ` : ''}El plan no lo vuelve a proponer en 14 días, salvo que se vuelva más urgente.
        </p>
        <div className="mt-3 grid gap-[6px] sm:grid-cols-2">
          {ORDEN_MOTIVOS.map((m) => {
            const activo = motivo === m
            return (
              <label
                key={m}
                className={cx(
                  'flex min-h-[40px] cursor-pointer items-start gap-[9px] rounded-[10px] border px-3 py-[8px] text-[12.5px] transition-colors',
                  TACTIL,
                  activo ? 'border-[color-mix(in_srgb,var(--ls-e-rojo)_45%,transparent)] bg-[color-mix(in_srgb,var(--ls-e-rojo)_9%,transparent)]' : 'border-[var(--ls-linea)] bg-[var(--ls-sup2)] hover:border-[var(--ls-linea2)]'
                )}
              >
                <input
                  type="radio"
                  name={`${id}-motivo`}
                  value={m}
                  checked={activo}
                  onChange={() => setMotivo(m)}
                  className="mt-[2px] h-[14px] w-[14px] shrink-0 accent-[var(--ls-e-rojo)]"
                />
                <span className="min-w-0">
                  <span className="block font-medium text-[var(--ls-t1)]">{MOTIVO_DESCARTE[m]}</span>
                  {AYUDA_MOTIVO[m] && <span className="block text-[11.5px] leading-[1.4] text-[var(--ls-t3)]">{AYUDA_MOTIVO[m]}</span>}
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>

      <label htmlFor={`${id}-nota`} className="mt-3 block text-[12.5px] text-[var(--ls-t3)]">
        Nota {motivo === 'otro' || motivo === 'datos_erroneos' ? '(obligatoria)' : '(opcional)'}
      </label>
      <textarea
        id={`${id}-nota`}
        value={nota}
        onChange={(e) => setNota(e.target.value)}
        rows={2}
        maxLength={500}
        placeholder="Lo que ha dicho el cliente, qué dato está mal…"
        className={cx(
          'mt-1 w-full resize-y rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-3 py-2 text-[13px] text-[var(--ls-t1)] placeholder:text-[var(--ls-t4)] [@media(pointer:coarse)]:text-[16px]',
          FOCO
        )}
      />

      {tocado && error && (
        <p role="alert" className="mt-2 text-[12px]" style={{ color: COLOR_ESTADO.rojo }}>
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancelar && (
          <Boton variante="secundario" onClick={onCancelar} disabled={trabajando}>
            Cancelar
          </Boton>
        )}
        <Boton type="submit" variante="peligro" icono={Ban} cargando={trabajando} disabled={tocado && !!error}>
          Descartar envío
        </Boton>
      </div>
    </form>
  )
}

export function DescartarDialog({
  abierto,
  onCambio,
  titulo = 'Descartar el envío propuesto',
  onConfirmar,
  unidades,
}: {
  abierto: boolean
  onCambio: (abierto: boolean) => void
  titulo?: string
  onConfirmar: Confirmar
  unidades?: number | null
}) {
  // Se reinicia el formulario cada vez que se abre
  const [vuelta, setVuelta] = useState(0)
  useEffect(() => {
    if (abierto) setVuelta((v) => v + 1)
  }, [abierto])

  return (
    <Dialogo.Root open={abierto} onOpenChange={onCambio}>
      <Dialogo.Portal>
        <Dialogo.Overlay className="fixed inset-0 z-[70] bg-[rgba(6,7,9,0.66)] data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <Dialogo.Content
          className={cx(
            'fixed inset-x-0 bottom-0 top-0 z-[70] m-auto h-fit max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[560px] overflow-y-auto rounded-[18px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] p-5 shadow-[var(--ls-sombra-3)] outline-none',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.97] motion-reduce:animate-none'
          )}
        >
          <Dialogo.Title className="text-[16px] font-semibold tracking-[-0.015em] text-[var(--ls-t1)]">{titulo}</Dialogo.Title>
          <Dialogo.Description className="sr-only">Elige el motivo por el que no se envía</Dialogo.Description>
          <FormularioDescarte
            key={vuelta}
            className="mt-3"
            unidades={unidades}
            onCancelar={() => onCambio(false)}
            onConfirmar={async (m, n) => {
              const r = await onConfirmar(m, n)
              if (r !== false) onCambio(false)
              return r
            }}
          />
        </Dialogo.Content>
      </Dialogo.Portal>
    </Dialogo.Root>
  )
}
