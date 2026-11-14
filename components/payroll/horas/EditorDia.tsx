'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Minus, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Boton, TACTIL_CUADRADO } from '@/components/ui-ls'
import { cn } from '@/lib/utils'
import { decidirGuardado, formatoHoras, leerHoras, sumarHoras } from '@/lib/payroll/horas'

/**
 * EL EDITOR DE UN DÍA. Va dentro de un popover anclado a la casilla en el PC y de una hoja inferior en el móvil (lo
 * decide quien lo monta); el contenido es el mismo.
 *
 * Aquí estaba el fallo gordo: «7,5» con coma se convertía en 0 y guardar 0 BORRABA el día. Ahora la casilla entiende
 * coma, punto, «7h» y «7:30»; lo que no entiende se enseña en rojo y NO se guarda; y el − / + sigue desde lo que hay.
 */
export function EditorDia({
  valorGuardado,
  notaGuardada,
  hayFila,
  guardando,
  onGuardar,
  onCerrar,
  autoFoco = true,
}: {
  valorGuardado: number
  notaGuardada: string | null
  hayFila: boolean
  guardando: boolean
  /** null = borrar el día. Devuelve true si se ha guardado. */
  onGuardar: (horas: number | null, nota: string | null) => Promise<boolean>
  onCerrar: () => void
  autoFoco?: boolean
}) {
  const [borrador, setBorrador] = useState(hayFila ? formatoHoras(valorGuardado) : '')
  const [nota, setNota] = useState(notaGuardada ?? '')
  const [aviso, setAviso] = useState<string | null>(null)
  const campo = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!autoFoco) return
    // En el móvil abrir el teclado al instante tapa media hoja: solo se enfoca con ratón
    if (window.matchMedia('(pointer: fine)').matches) campo.current?.select()
  }, [autoFoco])

  const lectura = leerHoras(borrador)
  const valorActual = lectura.tipo === 'horas' ? lectura.horas : null

  const paso = (delta: number) => {
    const r = sumarHoras(borrador, delta, valorGuardado)
    setAviso(r.aviso)
    setBorrador(r.texto)
  }

  const guardar = async () => {
    const d = decidirGuardado(borrador, hayFila)
    if (d.accion === 'error') {
      setAviso(d.motivo)
      toast.error(`No se ha guardado: ${d.motivo}`)
      campo.current?.focus()
      return
    }
    if (d.accion === 'nada') return onCerrar()
    if (await onGuardar(d.accion === 'borrar' ? null : d.horas, nota)) onCerrar()
  }

  const invalido = lectura.tipo === 'invalido'

  return (
    <div className="space-y-4">
      {/* − casilla + */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => paso(-0.5)}
          aria-label="Media hora menos"
          className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] text-[var(--ls-t2)] transition-colors hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]', TACTIL_CUADRADO)}
        >
          <Minus className="h-4 w-4" />
        </button>
        <div
          className={cn(
            'relative flex h-11 min-w-0 flex-1 items-center rounded-[10px] border bg-[var(--ls-sup2)] px-3 transition-colors focus-within:border-[var(--ls-acc-graf)]',
            invalido ? 'border-[var(--ls-e-rojo)]' : 'border-[var(--ls-linea2)]',
          )}
        >
          <input
            ref={campo}
            value={borrador}
            onChange={(e) => {
              setBorrador(e.target.value)
              setAviso(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void guardar()
              }
            }}
            inputMode="decimal"
            enterKeyHint="done"
            placeholder="0"
            aria-label="Horas del día"
            aria-invalid={invalido || undefined}
            className="w-full min-w-0 bg-transparent text-center text-[22px] font-semibold tabular-nums tracking-[-0.02em] text-[var(--ls-t1)] outline-none placeholder:text-[var(--ls-t4)]"
          />
          <span className="pointer-events-none text-[13px] text-[var(--ls-t4)]">h</span>
        </div>
        <button
          type="button"
          onClick={() => paso(0.5)}
          aria-label="Media hora más"
          className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] text-[var(--ls-t2)] transition-colors hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]', TACTIL_CUADRADO)}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {(aviso || invalido) && (
        <p role="alert" className="-mt-2 flex items-center gap-1.5 text-[12px] text-[var(--ls-e-rojo)]">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {aviso ?? (lectura.tipo === 'invalido' ? lectura.motivo : '')}
        </p>
      )}

      {/* Botones rápidos */}
      <div className="grid grid-cols-7 gap-1.5" role="group" aria-label="Horas rápidas">
        {[2, 3, 4, 5, 6, 7, 8].map((h) => {
          const activo = valorActual === h
          return (
            <button
              key={h}
              type="button"
              onClick={() => {
                setBorrador(String(h))
                setAviso(null)
              }}
              aria-pressed={activo}
              className={cn(
                'h-9 rounded-[9px] text-[13px] font-semibold tabular-nums transition-colors [@media(pointer:coarse)]:h-11',
                activo
                  ? 'bg-[var(--ls-acc-graf)] text-white shadow-[0_6px_16px_-8px_var(--ls-acc-graf)]'
                  : 'bg-[var(--ls-sup2)] text-[var(--ls-t3)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]',
              )}
            >
              {h}
            </button>
          )
        })}
      </div>

      {/* Nota del día (work_hours.note, que existía y no se enseñaba) */}
      <label className="block">
        <span className="mb-1 block text-[12px] text-[var(--ls-t3)]">Nota (opcional)</span>
        <input
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          maxLength={200}
          placeholder="Ej.: salí antes por médico"
          className="h-10 w-full rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-3 text-[13px] text-[var(--ls-t1)] outline-none transition-colors placeholder:text-[var(--ls-t4)] focus:border-[var(--ls-acc-graf)] [@media(pointer:coarse)]:h-11"
        />
      </label>

      <div className="flex items-center gap-2">
        {hayFila && (
          <Boton variante="peligro" soloIcono icono={Trash2} aria-label="Borrar las horas de este día" title="Borrar las horas de este día" disabled={guardando} onClick={() => onGuardar(null, null).then((ok) => ok && onCerrar())} />
        )}
        <div className="flex-1" />
        <Boton variante="fantasma" onClick={onCerrar}>
          Cancelar
        </Boton>
        <Boton variante="primario" cargando={guardando} disabled={invalido} onClick={() => void guardar()}>
          Guardar
        </Boton>
      </div>
    </div>
  )
}
