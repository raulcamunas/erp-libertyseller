'use client'

import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Plus, Trash2, Search, Copy, Phone } from 'lucide-react'

export interface PhoneNumber {
  id: string
  phone: string
  client: string | null
  other_use: string | null
  notes: string | null
  position: number | null
}

interface PhoneNumbersTableProps {
  initialRows: PhoneNumber[]
}

const cellInput =
  'w-full bg-transparent hover:bg-white/[0.05] focus:bg-white/[0.08] border border-transparent focus:border-[#FF6600] rounded px-2 py-1.5 text-[13px] text-white outline-none transition-colors placeholder:text-white/20'

export function PhoneNumbersTable({ initialRows }: PhoneNumbersTableProps) {
  const supabase = createClient()
  const [rows, setRows] = useState(initialRows)
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const sorted = [...rows].sort((a, b) => (a.position ?? 999) - (b.position ?? 999))
    if (!q) return sorted
    return sorted.filter((r) =>
      [r.phone, r.client, r.other_use, r.notes]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    )
  }, [rows, search])

  async function save(id: string, patch: Partial<PhoneNumber>) {
    const { error } = await supabase.from('phone_numbers').update(patch).eq('id', id)
    if (error) {
      console.error('Error guardando el número:', error)
      toast.error('No se pudo guardar')
      return
    }
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  async function addRow() {
    const nextPos = Math.max(0, ...rows.map((r) => r.position ?? 0)) + 1
    const { data, error } = await supabase
      .from('phone_numbers')
      .insert({ phone: '', position: nextPos })
      .select('*')
      .single()
    if (error) {
      console.error('Error añadiendo fila:', error)
      toast.error('No se pudo añadir')
      return
    }
    setRows((prev) => [...prev, data as PhoneNumber])
    setSearch('')
  }

  async function removeRow(id: string) {
    const { error } = await supabase.from('phone_numbers').delete().eq('id', id)
    if (error) {
      toast.error('No se pudo borrar')
      return
    }
    setRows((prev) => prev.filter((r) => r.id !== id))
  }

  return (
    <div className="space-y-3 max-w-[980px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative w-full sm:w-[280px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/30" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar número, cliente o uso..."
            className="w-full bg-white/[0.04] border border-white/10 rounded-lg pl-8 pr-2.5 py-1.5 text-[12px] text-white outline-none focus:border-[#FF6600] transition-colors placeholder:text-white/25"
          />
        </div>
        <span className="text-[11px] text-white/35">
          {rows.length} {rows.length === 1 ? 'número' : 'números'}
        </span>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="text-left px-2.5 py-2 text-[10px] font-semibold text-white/40 uppercase tracking-wider border-b border-white/10 w-[180px]">
                Teléfono
              </th>
              <th className="text-left px-2.5 py-2 text-[10px] font-semibold text-white/40 uppercase tracking-wider border-b border-white/10 w-[220px]">
                Cliente
              </th>
              <th className="text-left px-2.5 py-2 text-[10px] font-semibold text-white/40 uppercase tracking-wider border-b border-white/10">
                Otro uso
              </th>
              <th className="border-b border-white/10 w-[40px]" />
            </tr>
          </thead>
          <tbody>
            <AnimatePresence initial={false}>
              {filtered.map((r) => (
                <motion.tr
                  key={r.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="group border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors"
                >
                  <td className="px-1.5 py-0.5">
                    <div className="flex items-center gap-1">
                      <input
                        defaultValue={r.phone}
                        onBlur={(e) => {
                          const v = e.target.value.trim()
                          if (v !== r.phone) save(r.id, { phone: v })
                        }}
                        placeholder="600 000 000"
                        className={`${cellInput} tabular-nums font-medium`}
                      />
                      {r.phone && (
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(r.phone)
                            toast.success('Número copiado')
                          }}
                          className="h-6 w-6 flex-shrink-0 rounded flex items-center justify-center text-white/25 hover:text-white opacity-0 group-hover:opacity-100 transition-all"
                          title="Copiar"
                        >
                          <Copy className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-1.5 py-0.5">
                    <input
                      defaultValue={r.client ?? ''}
                      onBlur={(e) => {
                        const v = e.target.value.trim() || null
                        if (v !== (r.client ?? null)) save(r.id, { client: v })
                      }}
                      placeholder="—"
                      className={cellInput}
                    />
                  </td>
                  <td className="px-1.5 py-0.5">
                    <input
                      defaultValue={r.other_use ?? ''}
                      onBlur={(e) => {
                        const v = e.target.value.trim() || null
                        if (v !== (r.other_use ?? null)) save(r.id, { other_use: v })
                      }}
                      placeholder="—"
                      className={`${cellInput} text-white/75`}
                    />
                  </td>
                  <td className="px-1 py-0.5">
                    <button
                      type="button"
                      onClick={() => removeRow(r.id)}
                      className="h-6 w-6 rounded flex items-center justify-center text-white/20 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                      title="Borrar fila"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </td>
                </motion.tr>
              ))}
            </AnimatePresence>

            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-[12px] text-white/25">
                  {rows.length === 0
                    ? 'Todavía no hay números. Añade el primero abajo.'
                    : 'Ningún número coincide con la búsqueda.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <button
          type="button"
          onClick={addRow}
          className="w-full flex items-center justify-center gap-1.5 py-2.5 text-[12px] font-medium text-white/45 hover:text-white hover:bg-white/[0.03] transition-colors border-t border-white/[0.06]"
        >
          <Plus className="h-3.5 w-3.5" /> Añadir número
        </button>
      </div>

      <p className="text-[11px] text-white/25 flex items-center gap-1.5">
        <Phone className="h-3 w-3" /> Los cambios se guardan solos al salir de cada
        casilla.
      </p>
    </div>
  )
}
