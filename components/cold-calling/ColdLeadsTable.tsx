'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { ExternalLink, Maximize2, PhoneCall } from 'lucide-react'
import {
  ColdLead,
  ColdLeadStatus,
  COLD_STATUSES,
  COLD_STATUS_LABELS,
  COLD_STATUS_DOTS,
  colorForList,
  telHref,
} from '@/lib/types/cold-leads'

interface ColdLeadsTableProps {
  leads: ColdLead[]
  currentUserId: string
  isAdmin: boolean
  selectedId: string | null
  onSelect: (id: string) => void
  /** Abre la ficha completa de ese lead */
  onOpenDetail: (id: string) => void
  onPatched: (id: string, patch: Partial<ColdLead>) => void
}

/** Celda de texto editable al vuelo, como en una hoja de cálculo */
function EditableCell({
  value,
  onSave,
  disabled,
  placeholder,
  className = '',
}: {
  value: string
  onSave: (v: string) => void
  disabled: boolean
  placeholder?: string
  className?: string
}) {
  const [draft, setDraft] = useState(value)
  const [editing, setEditing] = useState(false)

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          if (disabled) return
          setDraft(value)
          setEditing(true)
        }}
        disabled={disabled}
        title={value || undefined}
        className={`w-full text-left truncate px-2 py-1 rounded hover:bg-white/[0.06] transition-colors disabled:hover:bg-transparent ${
          value ? 'text-white/75' : 'text-white/20'
        } ${className}`}
      >
        {value || placeholder || '—'}
      </button>
    )
  }

  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false)
        if (draft !== value) onSave(draft)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setDraft(value)
          setEditing(false)
        }
      }}
      autoFocus
      className="w-full bg-white/[0.08] border border-[#FF6600] rounded px-2 py-1 text-white outline-none"
    />
  )
}

const TH =
  'px-2 py-1.5 text-left text-[10px] font-semibold text-white/40 uppercase tracking-wider whitespace-nowrap border-b border-white/10'

export function ColdLeadsTable({
  leads,
  currentUserId,
  isAdmin,
  selectedId,
  onSelect,
  onOpenDetail,
  onPatched,
}: ColdLeadsTableProps) {
  const supabase = createClient()

  async function patch(id: string, fields: Partial<ColdLead>) {
    const { error } = await supabase.from('cold_leads').update(fields).eq('id', id)
    if (error) {
      console.error('Error guardando el lead:', error)
      toast.error('No se pudo guardar')
      return
    }
    onPatched(id, fields)
  }

  return (
    <div className="h-full overflow-auto rounded-2xl border border-white/10 bg-white/[0.02]">
      <table className="w-full border-collapse text-[12px]">
        <thead className="sticky top-0 z-20 bg-[#0d0d0d]">
          <tr>
            <th className={`${TH} sticky left-0 z-30 bg-[#0d0d0d] min-w-[190px]`}>
              Tienda
            </th>
            <th className={`${TH} min-w-[170px]`}>Empresa</th>
            <th className={`${TH} text-right min-w-[110px]`}>Facturación</th>
            <th className={`${TH} min-w-[170px]`}>Estado</th>
            <th className={`${TH} min-w-[140px]`}>Teléfono</th>
            <th className={`${TH} min-w-[120px]`}>Rellamar</th>
            <th className={`${TH} min-w-[280px]`}>Seguimiento</th>
            <th className={`${TH} min-w-[180px]`}>Email</th>
            <th className={`${TH} min-w-[120px]`}>Provincia</th>
            <th className={`${TH} min-w-[160px]`}>Categoría</th>
            <th className={`${TH} min-w-[110px]`}>Lista</th>
            <th className={`${TH} w-[70px]`}></th>
          </tr>
        </thead>
        <tbody>
          {leads.map((l) => {
            const canEdit = isAdmin || l.assigned_to === currentUserId
            const color = COLD_STATUS_DOTS[l.status]
            const active = l.id === selectedId
            const tel = telHref(l.phone)

            // Fondo teñido con el color del estado: es exactamente lo que
            // hacían en el Excel pintando la fila entera.
            const rowBg = active
              ? 'rgba(255,102,0,0.14)'
              : l.status === 'pendiente'
                ? 'transparent'
                : `${color}14`

            return (
              <tr
                key={l.id}
                onClick={() => onSelect(l.id)}
                style={{ backgroundColor: rowBg }}
                className="border-b border-white/[0.05] hover:brightness-125 transition-[filter] cursor-pointer align-middle"
              >
                <td
                  className="sticky left-0 z-10 px-2 py-1 font-semibold text-white whitespace-nowrap"
                  style={{ backgroundColor: rowBg === 'transparent' ? '#0d0d0d' : rowBg }}
                >
                  <span className="flex items-center gap-1.5">
                    <span
                      className="h-2 w-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: color }}
                    />
                    <span className="truncate max-w-[160px]" title={l.store_name}>
                      {l.store_name}
                    </span>
                  </span>
                </td>

                <td className="px-2 py-1 text-white/65">
                  <span className="truncate block max-w-[170px]" title={l.company || ''}>
                    {l.company || '—'}
                  </span>
                </td>

                <td className="px-2 py-1 text-right text-white/80 tabular-nums whitespace-nowrap">
                  {l.revenue_monthly != null
                    ? `${Math.round(Number(l.revenue_monthly)).toLocaleString('es-ES')} €`
                    : '—'}
                </td>

                <td className="px-1 py-1" onClick={(e) => e.stopPropagation()}>
                  <select
                    value={l.status}
                    disabled={!canEdit}
                    onChange={(e) =>
                      patch(l.id, {
                        status: e.target.value as ColdLeadStatus,
                        last_contacted_at: new Date().toISOString(),
                      })
                    }
                    className="w-full rounded px-1.5 py-1 text-[11px] font-medium text-white outline-none border cursor-pointer disabled:cursor-default"
                    style={{
                      backgroundColor: `${color}26`,
                      borderColor: `${color}66`,
                    }}
                  >
                    {COLD_STATUSES.map((s) => (
                      <option key={s} value={s} className="bg-[#1a1a1a] text-white">
                        {COLD_STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </td>

                <td
                  className="px-2 py-1 text-white/70 whitespace-nowrap"
                  onClick={(e) => e.stopPropagation()}
                >
                  {tel ? (
                    <a
                      href={`tel:${tel}`}
                      className="inline-flex items-center gap-1 hover:text-[#FF6600] transition-colors"
                      title="Llamar"
                    >
                      <PhoneCall className="h-3 w-3 flex-shrink-0" />
                      {l.phone}
                    </a>
                  ) : (
                    <span className="text-white/20">{l.phone || '—'}</span>
                  )}
                </td>

                <td className="px-1 py-1" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="date"
                    value={l.next_call_date ?? ''}
                    disabled={!canEdit}
                    onChange={(e) =>
                      patch(l.id, { next_call_date: e.target.value || null })
                    }
                    className="w-full bg-transparent hover:bg-white/[0.06] focus:bg-white/[0.08] rounded px-1 py-1 text-[11px] text-white/75 outline-none [color-scheme:dark] transition-colors"
                  />
                </td>

                <td className="px-1 py-1 max-w-[280px]" onClick={(e) => e.stopPropagation()}>
                  <EditableCell
                    value={l.follow_up ?? ''}
                    disabled={!canEdit}
                    placeholder="Añadir seguimiento..."
                    onSave={(v) => patch(l.id, { follow_up: v.trim() || null })}
                  />
                </td>

                <td className="px-2 py-1 text-white/55" onClick={(e) => e.stopPropagation()}>
                  {l.email ? (
                    <a
                      href={`mailto:${l.email.split(/[\s/,;]+/)[0]}`}
                      className="truncate block max-w-[180px] hover:text-[#FF6600] transition-colors"
                      title={l.email}
                    >
                      {l.email}
                    </a>
                  ) : (
                    <span className="text-white/20">—</span>
                  )}
                </td>

                <td className="px-2 py-1 text-white/55 whitespace-nowrap">
                  {l.province || '—'}
                </td>

                <td className="px-2 py-1 text-white/55">
                  <span
                    className="truncate block max-w-[160px]"
                    title={[l.category, l.subcategory].filter(Boolean).join(' · ')}
                  >
                    {l.category || '—'}
                  </span>
                </td>

                <td className="px-2 py-1 whitespace-nowrap">
                  {l.source_list && (
                    <span
                      className="text-[9px] font-medium px-1.5 py-0.5 rounded border leading-none"
                      style={{
                        color: colorForList(l.source_list),
                        borderColor: `${colorForList(l.source_list)}55`,
                        backgroundColor: `${colorForList(l.source_list)}1a`,
                      }}
                    >
                      {l.source_list}
                    </span>
                  )}
                </td>

                <td className="px-1 py-1 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onOpenDetail(l.id)}
                      title="Abrir ficha completa"
                      className="h-6 w-6 rounded flex items-center justify-center text-white/35 hover:text-white hover:bg-white/[0.08] transition-colors"
                    >
                      <Maximize2 className="h-3 w-3" />
                    </button>
                    {l.seller_url && (
                      <a
                        href={l.seller_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Ver en Amazon"
                        className="h-6 w-6 rounded flex items-center justify-center text-white/35 hover:text-white hover:bg-white/[0.08] transition-colors"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
