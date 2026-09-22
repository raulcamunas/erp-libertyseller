'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Checkbox } from '@/components/ui/checkbox'

/**
 * A QUÉ CUENTAS PUEDE ENTRAR ESTE USUARIO EN REMESAS A FBA.
 *
 * Se usa en la ficha de un usuario con rol 'cliente' (y sirve igual para un
 * empleado al que se le quiera dar una cuenta concreta). Una fila por cliente
 * de Amazon: puede verlo, y si puede además editarlo.
 *
 * Guarda al pulsar, no a cada casilla: el PUT sustituye la lista entera, así que
 * conviene mandarla cuando esté como se quiere y no a medio marcar.
 */

interface Cuenta {
  id: string
  nombre: string
}

interface Acceso {
  clientId: string
  puedeEditar: boolean
}

export function AccesosRemesas({ usuarioId }: { usuarioId: string }) {
  const [cuentas, setCuentas] = useState<Cuenta[]>([])
  const [accesos, setAccesos] = useState<Map<string, boolean>>(new Map())
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const [rc, ra] = await Promise.all([
          fetch('/api/amazon/clients').then((r) => r.json()),
          fetch(`/api/fba/accesos?usuario=${usuarioId}`).then((r) => r.json()),
        ])
        if (!vivo) return
        const lista: Cuenta[] = (rc.clients ?? rc.clientes ?? [])
          .map((c: { id: string; name?: string; nombre?: string }) => ({ id: c.id, nombre: c.name ?? c.nombre ?? c.id }))
          .sort((a: Cuenta, b: Cuenta) => a.nombre.localeCompare(b.nombre))
        setCuentas(lista)
        setAccesos(new Map(((ra.accesos ?? []) as Acceso[]).map((a) => [a.clientId, a.puedeEditar])))
      } catch {
        toast.error('No se han podido cargar las cuentas')
      } finally {
        if (vivo) setCargando(false)
      }
    })()
    return () => {
      vivo = false
    }
  }, [usuarioId])

  async function guardar() {
    setGuardando(true)
    try {
      const res = await fetch('/api/fba/accesos', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          usuario: usuarioId,
          accesos: [...accesos.entries()].map(([clientId, puedeEditar]) => ({ clientId, puedeEditar })),
        }),
      })
      const p = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        toast.error(p?.error ?? 'No se han podido guardar los accesos')
        return
      }
      toast.success(`Accesos guardados: ${accesos.size} cuenta${accesos.size === 1 ? '' : 's'}`)
    } finally {
      setGuardando(false)
    }
  }

  if (cargando) {
    return (
      <div className="flex items-center gap-2 py-3 text-[12px] text-white/40">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Cargando cuentas…
      </div>
    )
  }

  return (
    <div>
      <p className="mb-2 text-[11px] text-white/45">
        Marca las cuentas que puede ver. «Editar» le deja además crear y corregir remesas; borrar,
        nunca.
      </p>
      <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-white/10 p-2">
        {cuentas.map((c) => {
          const ve = accesos.has(c.id)
          const edita = accesos.get(c.id) === true
          return (
            <div key={c.id} className="flex items-center justify-between rounded px-2 py-1 hover:bg-white/[0.03]">
              <label className="flex cursor-pointer items-center gap-2 text-[12px] text-white">
                <Checkbox
                  checked={ve}
                  onCheckedChange={(v) => {
                    const m = new Map(accesos)
                    if (v) m.set(c.id, m.get(c.id) ?? false)
                    else m.delete(c.id)
                    setAccesos(m)
                  }}
                  className="border-white/30 data-[state=checked]:bg-[#FF6600] data-[state=checked]:border-[#FF6600]"
                />
                {c.nombre}
              </label>
              <label
                className={`flex items-center gap-1.5 text-[11px] ${ve ? 'cursor-pointer text-white/60' : 'text-white/20'}`}
              >
                <Checkbox
                  checked={edita}
                  disabled={!ve}
                  onCheckedChange={(v) => {
                    const m = new Map(accesos)
                    m.set(c.id, v === true)
                    setAccesos(m)
                  }}
                  className="border-white/30 data-[state=checked]:bg-[#FF6600] data-[state=checked]:border-[#FF6600] disabled:opacity-30"
                />
                Editar
              </label>
            </div>
          )
        })}
        {cuentas.length === 0 && (
          <p className="p-2 text-[11px] text-white/30">No hay clientes de Amazon dados de alta.</p>
        )}
      </div>
      <button
        type="button"
        onClick={guardar}
        disabled={guardando}
        className="mt-2 flex items-center gap-1.5 rounded-lg bg-[#FF6600] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[#FF6600]/85 disabled:opacity-40"
      >
        {guardando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Guardar accesos
      </button>
    </div>
  )
}
