'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { X, UserPlus } from 'lucide-react'
import {
  CrmClientWithDetails,
  CrmStage,
  CRM_STAGES,
  CRM_STAGE_LABELS,
  CRM_STAGE_COLORS,
} from '@/lib/types/crm'
import { CalendarPerson } from '@/lib/types/appointments'

interface NewLeadDialogProps {
  team: CalendarPerson[]
  onClose: () => void
  onCreated: (client: CrmClientWithDetails) => void
}

const field =
  'w-full bg-white/[0.04] border border-white/10 rounded-lg px-2.5 py-1.5 text-[13px] text-white outline-none focus:border-[#FF6600] transition-colors placeholder:text-white/25'

const labelCls = 'text-[11px] text-white/40 mb-1 block'

export function NewLeadDialog({ team, onClose, onCreated }: NewLeadDialogProps) {
  const supabase = createClient()
  const [saving, setSaving] = useState(false)

  const [name, setName] = useState('')
  const [company, setCompany] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [contactRole, setContactRole] = useState('')
  const [website, setWebsite] = useState('')
  const [country, setCountry] = useState('')
  const [marketplaces, setMarketplaces] = useState('')
  const [amazonLink, setAmazonLink] = useState('')
  const [revenue, setRevenue] = useState('')
  const [stage, setStage] = useState<CrmStage>('nuevo')
  const [ownerId, setOwnerId] = useState<string>('none')

  async function handleSave() {
    if (!name.trim()) {
      toast.error('El nombre del contacto es obligatorio')
      return
    }
    setSaving(true)
    try {
      const parsedRevenue = revenue.trim() === '' ? null : Number(revenue)
      const { data, error } = await supabase
        .from('crm_clients')
        .insert({
          // Sin appointment_id: es un alta manual, no viene de una cita.
          lead_name: name.trim(),
          lead_company: company.trim() || null,
          lead_email: email.trim() || null,
          lead_phone: phone.trim() || null,
          revenue_amount:
            parsedRevenue !== null && Number.isNaN(parsedRevenue) ? null : parsedRevenue,
          amazon_link: amazonLink.trim() || null,
          contact_role: contactRole.trim() || null,
          website: website.trim() || null,
          country: country.trim() || null,
          marketplaces: marketplaces.trim() || null,
          stage,
          owner_id: ownerId === 'none' ? null : ownerId,
        })
        .select('*')
        .single()
      if (error) throw error

      onCreated({ ...(data as CrmClientWithDetails), appointment: null })
      toast.success('Cliente añadido al CRM')
      onClose()
    } catch (err) {
      console.error('Error creando cliente:', err)
      toast.error('No se pudo crear el cliente')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.18 }}
        className="relative w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0d0d0d] p-4 shadow-2xl"
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-white font-semibold text-[15px] flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-[#FF6600]" /> Nuevo cliente
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-white/40 hover:text-white transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-[11px] text-white/35 mb-3">
          Para clientes que no vienen de una cita agendada. Los que sí vienen de
          una cita entran solos al marcarla como cualificada.
        </p>

        <div className="space-y-2.5">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelCls}>Contacto *</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                className={field}
                placeholder="Nombre y apellidos"
              />
            </div>
            <div>
              <label className={labelCls}>Empresa</label>
              <input
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                className={field}
                placeholder="Nombre de la empresa"
              />
            </div>
            <div>
              <label className={labelCls}>Email</label>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                className={field}
                placeholder="hola@empresa.com"
              />
            </div>
            <div>
              <label className={labelCls}>Teléfono</label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={field}
                placeholder="+34..."
              />
            </div>
            <div>
              <label className={labelCls}>Cargo</label>
              <input
                value={contactRole}
                onChange={(e) => setContactRole(e.target.value)}
                className={field}
                placeholder="CEO, responsable ecommerce..."
              />
            </div>
            <div>
              <label className={labelCls}>Web</label>
              <input
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                className={field}
                placeholder="https://..."
              />
            </div>
            <div>
              <label className={labelCls}>País</label>
              <input
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className={field}
                placeholder="España"
              />
            </div>
            <div>
              <label className={labelCls}>Marketplaces</label>
              <input
                value={marketplaces}
                onChange={(e) => setMarketplaces(e.target.value)}
                className={field}
                placeholder="ES, IT, DE..."
              />
            </div>
            <div>
              <label className={labelCls}>Facturación (€)</label>
              <input
                value={revenue}
                onChange={(e) => setRevenue(e.target.value)}
                inputMode="decimal"
                className={field}
                placeholder="0"
              />
            </div>
            <div>
              <label className={labelCls}>Responsable</label>
              <select
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
                className={`${field} cursor-pointer`}
              >
                <option value="none" className="bg-[#1a1a1a]">
                  Sin asignar
                </option>
                {team.map((p) => (
                  <option key={p.id} value={p.id} className="bg-[#1a1a1a]">
                    {p.full_name || p.email}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={labelCls}>Link de Amazon</label>
            <input
              value={amazonLink}
              onChange={(e) => setAmazonLink(e.target.value)}
              className={field}
              placeholder="https://amazon.es/..."
            />
          </div>

          <div>
            <label className={labelCls}>Estado</label>
            <div className="flex flex-wrap gap-1.5">
              {CRM_STAGES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStage(s)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${
                    stage === s
                      ? `${CRM_STAGE_COLORS[s]} ring-1 ring-white/20`
                      : 'border-white/10 text-white/40 hover:text-white/80 hover:border-white/25'
                  }`}
                >
                  {CRM_STAGE_LABELS[s]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-[12px] text-white/55 hover:text-white transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="px-4 py-1.5 rounded-lg bg-[#FF6600] text-[12px] font-semibold text-white disabled:opacity-40 transition-opacity"
          >
            {saving ? 'Guardando...' : 'Añadir cliente'}
          </button>
        </div>
      </motion.div>
    </div>
  )
}
