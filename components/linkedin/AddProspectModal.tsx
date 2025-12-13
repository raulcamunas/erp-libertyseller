'use client'

import { useState } from 'react'
import { ProspectFormData, Agent } from '@/lib/types/linkedin'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { Save, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

interface AddProspectModalProps {
  open: boolean
  companyId: string
  companyName: string
  onClose: () => void
  onSuccess: () => void
}

export function AddProspectModal({
  open,
  companyId,
  companyName,
  onClose,
  onSuccess,
}: AddProspectModalProps) {
  const [formData, setFormData] = useState<ProspectFormData>({
    company_id: companyId,
    full_name: '',
    role: '',
    linkedin_url: '',
    phone: '',
    email: '',
    notes: '',
    status: 'identified',
    agent: 'Raul',
  })
  const [saving, setSaving] = useState(false)
  const supabase = createClient()

  const handleSave = async () => {
    if (!formData.full_name.trim()) {
      alert('El nombre completo es obligatorio')
      return
    }

    setSaving(true)
    try {
      const { error } = await supabase
        .from('company_prospects')
        .insert({
          company_id: formData.company_id,
          full_name: formData.full_name.trim(),
          role: formData.role || null,
          linkedin_url: formData.linkedin_url || null,
          phone: formData.phone || null,
          email: formData.email || null,
          notes: formData.notes || null,
          status: formData.status || 'identified',
          agent: formData.agent || 'Raul',
        })

      if (error) throw error

      // Reset form
      setFormData({
        company_id: companyId,
        full_name: '',
        role: '',
        linkedin_url: '',
        phone: '',
        email: '',
        notes: '',
        status: 'identified',
        agent: 'Raul',
      })
      onSuccess()
      onClose()
    } catch (error) {
      console.error('Error creating prospect:', error)
      alert('Error al crear el prospecto')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-[#080808] border-white/10 max-w-2xl max-h-[90vh] overflow-y-auto backdrop-blur-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-white">
            Añadir Nuevo Prospecto
          </DialogTitle>
          <DialogDescription className="text-white/60">
            Añade un empleado a {companyName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {/* Nombre Completo (obligatorio) */}
          <div>
            <Label htmlFor="full_name" className="text-sm font-semibold text-white mb-2 block">
              Nombre Completo *
            </Label>
            <Input
              id="full_name"
              value={formData.full_name}
              onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
              placeholder="Juan Pérez"
              className="input-glass"
            />
          </div>

          {/* Cargo y LinkedIn */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="role" className="text-sm font-semibold text-white mb-2 block">
                Cargo
              </Label>
              <Input
                id="role"
                value={formData.role}
                onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                placeholder="CEO, CTO, etc."
                className="input-glass"
              />
            </div>
            <div>
              <Label htmlFor="linkedin_url" className="text-sm font-semibold text-white mb-2 block">
                URL de LinkedIn
              </Label>
              <Input
                id="linkedin_url"
                value={formData.linkedin_url}
                onChange={(e) => setFormData({ ...formData, linkedin_url: e.target.value })}
                placeholder="https://linkedin.com/in/..."
                className="input-glass"
              />
            </div>
          </div>

          {/* Teléfono y Email */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="phone" className="text-sm font-semibold text-white mb-2 block">
                Teléfono
              </Label>
              <Input
                id="phone"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="+34 600 000 000"
                className="input-glass"
              />
            </div>
            <div>
              <Label htmlFor="email" className="text-sm font-semibold text-white mb-2 block">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="email@empresa.com"
                className="input-glass"
              />
            </div>
          </div>

          {/* Estado y Agente */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-sm font-semibold text-white mb-3 block">
                Estado
              </Label>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={() => setFormData({ ...formData, status: 'identified' })}
                  variant="outline"
                  size="sm"
                  className={cn(
                    "text-xs",
                    formData.status === 'identified'
                      ? "bg-[#FF6600]/20 border-2 border-[#FF6600] text-[#FF6600]"
                      : "bg-white/[0.05] border border-white/10 text-white/70 hover:border-[#FF6600]/30 hover:text-[#FF6600]"
                  )}
                >
                  Identificado
                </Button>
                <Button
                  type="button"
                  onClick={() => setFormData({ ...formData, status: 'connected' })}
                  variant="outline"
                  size="sm"
                  className={cn(
                    "text-xs",
                    formData.status === 'connected'
                      ? "bg-[#FF6600]/20 border-2 border-[#FF6600] text-[#FF6600]"
                      : "bg-white/[0.05] border border-white/10 text-white/70 hover:border-[#FF6600]/30 hover:text-[#FF6600]"
                  )}
                >
                  Conectado
                </Button>
                <Button
                  type="button"
                  onClick={() => setFormData({ ...formData, status: 'messaged' })}
                  variant="outline"
                  size="sm"
                  className={cn(
                    "text-xs",
                    formData.status === 'messaged'
                      ? "bg-[#FF6600]/20 border-2 border-[#FF6600] text-[#FF6600]"
                      : "bg-white/[0.05] border border-white/10 text-white/70 hover:border-[#FF6600]/30 hover:text-[#FF6600]"
                  )}
                >
                  Mensaje Enviado
                </Button>
                <Button
                  type="button"
                  onClick={() => setFormData({ ...formData, status: 'replied' })}
                  variant="outline"
                  size="sm"
                  className={cn(
                    "text-xs",
                    formData.status === 'replied'
                      ? "bg-purple-500/20 border-2 border-purple-400 text-purple-300"
                      : "bg-white/[0.05] border border-white/10 text-white/70 hover:border-purple-400/30 hover:text-purple-300"
                  )}
                >
                  Respondió
                </Button>
              </div>
            </div>
            <div>
              <Label className="text-sm font-semibold text-white mb-3 block">
                Agente
              </Label>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={() => setFormData({ ...formData, agent: 'Raul' })}
                  variant="outline"
                  size="sm"
                  className={cn(
                    "text-xs",
                    formData.agent === 'Raul'
                      ? "bg-[#FF6600]/20 border-2 border-[#FF6600] text-[#FF6600]"
                      : "bg-white/[0.05] border border-white/10 text-white/70 hover:border-[#FF6600]/30 hover:text-[#FF6600]"
                  )}
                >
                  Raul
                </Button>
                <Button
                  type="button"
                  onClick={() => setFormData({ ...formData, agent: 'Mario' })}
                  variant="outline"
                  size="sm"
                  className={cn(
                    "text-xs",
                    formData.agent === 'Mario'
                      ? "bg-orange-500/20 border-2 border-orange-400 text-orange-300"
                      : "bg-white/[0.05] border border-white/10 text-white/70 hover:border-orange-400/30 hover:text-orange-300"
                  )}
                >
                  Mario
                </Button>
              </div>
            </div>
          </div>

          {/* Notas */}
          <div>
            <Label htmlFor="notes" className="text-sm font-semibold text-white mb-2 block">
              Notas
            </Label>
            <Input
              id="notes"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Notas adicionales..."
              className="input-glass"
            />
          </div>

          {/* Botones */}
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1 border-white/20 hover:border-white/40"
            >
              <X className="h-4 w-4 mr-2" />
              Cancelar
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 bg-[#FF6600]/20 border-2 border-[#FF6600] text-[#FF6600] hover:bg-[#FF6600]/30 hover:border-[#FF6600]/80"
            >
              <Save className="h-4 w-4 mr-2" />
              {saving ? 'Creando...' : 'Crear Prospecto'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

