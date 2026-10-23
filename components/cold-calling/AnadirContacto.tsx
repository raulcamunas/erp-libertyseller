'use client'

import { Loader2, Mail, Phone, Plus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { anadirEmail, anadirTelefono, type CamposDeContacto, type ContactosDeLead } from '@/lib/cold-calling/contactos'

/**
 * LA CAJITA «+» JUNTO A LOS TELÉFONOS Y CORREOS DE LA FICHA: para añadir uno nuevo sin salir de ella.
 *
 * Se elige si es un teléfono o un correo, se escribe y se guarda. El teléfono se guarda en formato internacional
 * («+34600112233»), así que se pega tal cual en WhatsApp o en Rinkel, y desde ese momento sus llamadas de Rinkel también se
 * enlazan con este lead. Si el lead no tenía ninguno, el nuevo pasa a ser el principal; si ya tenía, se añade como extra.
 * Uno que ya está (aunque esté escrito de otra forma) no se repite. La lógica está en lib/cold-calling/contactos.ts.
 */

const MENSAJES = {
  telefono: { invalido: 'No parece un teléfono. Escríbelo con 9 cifras o con el prefijo (+34…).', repetido: 'Ese teléfono ya está en la ficha.' },
  email: { invalido: 'No parece un correo.', repetido: 'Ese correo ya está en la ficha.' },
} as const

/**
 * `listo` es false mientras la ficha no ha traído los teléfonos y correos EXTRA (solo llegan con el detalle del lead, no con la
 * lista). Añadir antes de que lleguen escribiría el campo extra con solo el número nuevo y se llevaría por delante los que ya había.
 */
export function AnadirContacto({
  lead,
  guardar,
  listo = true,
}: {
  lead: ContactosDeLead
  guardar: (campos: CamposDeContacto) => Promise<boolean>
  listo?: boolean
}) {
  const [abierto, setAbierto] = useState(false)
  const [tipo, setTipo] = useState<'telefono' | 'email'>('telefono')
  const [texto, setTexto] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  const cambiar = (nuevo: 'telefono' | 'email') => {
    setTipo(nuevo)
    setError(null)
  }

  const enviar = async () => {
    if (guardando) return
    const r = tipo === 'telefono' ? anadirTelefono(lead, texto) : anadirEmail(lead, texto)
    if (!r.ok) {
      setError(MENSAJES[tipo][r.motivo])
      return
    }
    setGuardando(true)
    const bien = await guardar(r.campos)
    setGuardando(false)
    if (!bien) {
      setError('No se ha podido guardar. Vuelve a probar.')
      return
    }
    toast.success(tipo === 'telefono' ? `Teléfono añadido: ${r.valor}` : `Correo añadido: ${r.valor}`)
    setTexto('')
    setError(null)
    setAbierto(false)
  }

  const segmento = (id: 'telefono' | 'email', nombre: string, icono: React.ReactNode) => (
    <button
      type="button"
      onClick={() => cambiar(id)}
      aria-pressed={tipo === id}
      className={`inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-[6px] text-[12px] transition-colors ${
        tipo === id ? 'bg-[var(--ls-acc-suave)] text-[var(--ls-t1)] shadow-[inset_0_0_0_1px_var(--ls-acc-graf)]' : 'text-[var(--ls-t3)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]'
      }`}
    >
      {icono} {nombre}
    </button>
  )

  return (
    <Popover
      open={abierto && listo}
      onOpenChange={(v) => {
        setAbierto(v)
        if (!v) setError(null)
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={!listo}
          title={listo ? 'Añadir un teléfono o un correo a esta ficha' : 'Cargando la ficha…'}
          aria-label="Añadir un teléfono o un correo"
          className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-dashed border-[var(--ls-linea2)] px-2.5 text-[12.5px] text-[var(--ls-t3)] transition-colors hover:border-[var(--ls-acc-graf)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)] disabled:pointer-events-none disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden /> Añadir
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        collisionPadding={12}
        className="z-[80] w-[min(320px,calc(100vw-1.5rem))] space-y-2.5 rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] p-3 text-[var(--ls-t2)] shadow-2xl"
        onOpenAutoFocus={(e) => {
          // El cursor va al campo, no al primer botón
          e.preventDefault()
          document.getElementById('anadir-contacto-campo')?.focus()
        }}
      >
        <div className="flex gap-1 rounded-[8px] bg-[var(--ls-sup2)] p-0.5" role="group" aria-label="Qué se añade">
          {segmento('telefono', 'Teléfono', <Phone className="h-3.5 w-3.5" aria-hidden />)}
          {segmento('email', 'Correo', <Mail className="h-3.5 w-3.5" aria-hidden />)}
        </div>
        <input
          id="anadir-contacto-campo"
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void enviar()
            }
            // Escape cierra la cajita, no la ficha entera
            if (e.key === 'Escape') e.stopPropagation()
          }}
          inputMode={tipo === 'telefono' ? 'tel' : 'email'}
          autoComplete="off"
          placeholder={tipo === 'telefono' ? '600 11 22 33' : 'nombre@empresa.es'}
          aria-label={tipo === 'telefono' ? 'Teléfono nuevo' : 'Correo nuevo'}
          aria-invalid={error !== null}
          className="h-9 w-full rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2.5 text-[13px] text-[var(--ls-t1)] outline-none transition-colors placeholder:text-[var(--ls-t4)] focus:border-[var(--ls-acc-graf)]"
        />
        {error && (
          <p className="text-[11.5px] leading-snug text-[var(--ls-e-ambar)]" role="alert">
            {error}
          </p>
        )}
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] leading-snug text-[var(--ls-t4)]">{tipo === 'telefono' ? 'Se guarda con el +34 si es español.' : 'Se guarda en minúsculas.'}</p>
          <button
            type="button"
            onClick={() => void enviar()}
            disabled={guardando || texto.trim() === ''}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[6px] bg-[var(--ls-acc-relleno)] px-3 text-[12.5px] font-semibold text-[var(--ls-acc-tinta)] transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {guardando && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} Añadir
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
