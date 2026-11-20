'use client'

import { useMinuto } from '@/components/cold-calling/HoraMexico'
import { horaLocal } from '@/lib/mexico/zona-horaria'

/**
 * LA HORA EN TIEMPO REAL DE DONDE SE LLAMA, discreta en la barra de la agenda: España, las dos franjas de México con más leads (Centro y Pacífico) y Colombia.
 * Usa el mismo reloj de minuto que las insignias de Cold Calling. En el servidor no pinta nada (la hora sería la del servidor).
 */
const RELOJES: Array<{ nombre: string; iana: string; titulo: string }> = [
  { nombre: 'España', iana: 'Europe/Madrid', titulo: 'España (Madrid)' },
  { nombre: 'MX Centro', iana: 'America/Mexico_City', titulo: 'México, franja Centro: CDMX, Jalisco, Nuevo León… (casi todo el país)' },
  { nombre: 'MX Pacífico', iana: 'America/Mazatlan', titulo: 'México, franja Pacífico: Sonora, Sinaloa, Nayarit y Baja California Sur' },
  { nombre: 'Colombia', iana: 'America/Bogota', titulo: 'Colombia (Bogotá)' },
]

export function RelojesDeLaAgenda() {
  const m = useMinuto()
  if (m === 0) return null
  return (
    <div className="flex items-center gap-3 text-[11.5px] text-[var(--ls-t4)] max-sm:hidden" aria-label="Hora local">
      {RELOJES.map((r) => {
        const h = horaLocal(r.iana)
        return (
          <span key={r.iana} title={`${r.titulo} · ${h.utc}`} className="inline-flex items-baseline gap-1 whitespace-nowrap">
            <span>{r.nombre}</span>
            <span className="font-medium tabular-nums text-[var(--ls-t3)]">{h.texto}</span>
          </span>
        )
      })}
    </div>
  )
}
