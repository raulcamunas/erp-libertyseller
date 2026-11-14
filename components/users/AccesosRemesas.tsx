'use client'

import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import { toast } from 'sonner'
import { Boton, Esqueleto } from '@/components/ui-ls'
import { Interruptor } from './piezas'

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
      <div className="flex flex-col gap-2" aria-busy>
        {Array.from({ length: 4 }, (_, i) => (
          <Esqueleto key={i} className="h-11 w-full rounded-[10px]" />
        ))}
      </div>
    )
  }

  const nVe = accesos.size

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] leading-snug text-[var(--ls-t4)]">
        Enciende las cuentas que puede ver. «Editar» le deja además crear y corregir remesas; borrar, nunca. Se guarda aparte, con su botón.
      </p>
      <ul className="max-h-[420px] divide-y divide-[var(--ls-linea)] overflow-y-auto rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]">
        {cuentas.map((c) => {
          const ve = accesos.has(c.id)
          const edita = accesos.get(c.id) === true
          return (
            <li key={c.id} className="flex items-center gap-2 py-1 pl-3 pr-1">
              <span className={`min-w-0 flex-1 truncate text-[13px] ${ve ? 'font-medium text-[var(--ls-t1)]' : 'text-[var(--ls-t3)]'}`}>{c.nombre}</span>
              <span className={`text-[11.5px] ${ve ? 'text-[var(--ls-t3)]' : 'text-[var(--ls-t4)] opacity-60'}`}>Editar</span>
              <Interruptor
                etiqueta={`Editar remesas de ${c.nombre}`}
                activo={edita}
                deshabilitado={!ve}
                onCambio={(v) => {
                  const m = new Map(accesos)
                  m.set(c.id, v)
                  setAccesos(m)
                }}
              />
              <Interruptor
                etiqueta={`Ver ${c.nombre}`}
                activo={ve}
                onCambio={(v) => {
                  const m = new Map(accesos)
                  if (v) m.set(c.id, m.get(c.id) ?? false)
                  else m.delete(c.id)
                  setAccesos(m)
                }}
              />
            </li>
          )
        })}
        {cuentas.length === 0 && <li className="p-3 text-[12px] text-[var(--ls-t4)]">No hay clientes de Amazon dados de alta.</li>}
      </ul>
      <div className="flex items-center gap-3">
        <span className="flex-1 text-[12px] tabular-nums text-[var(--ls-t3)]">
          {nVe} {nVe === 1 ? 'cuenta' : 'cuentas'}
        </span>
        <Boton variante="primario" icono={Save} onClick={guardar} cargando={guardando}>
          Guardar cuentas
        </Boton>
      </div>
    </div>
  )
}
