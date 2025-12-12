'use client'

import { useState } from 'react'
import { WebLead, WebLeadStatus } from '@/lib/types/web-leads'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Phone, Mail, Building2, Save, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { LibertyButton } from '@/components/ui/LibertyButton'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

interface LeadSheetProps {
  lead: WebLead
  onClose: () => void
  onUpdate: (lead: WebLead) => void
}

const STATUS_OPTIONS: { value: WebLeadStatus; label: string }[] = [
  { value: 'registrado', label: 'Registrado' },
  { value: 'contactado', label: 'Contactado' },
  { value: 'seguimiento', label: 'Seguimiento' },
  { value: 'interesado', label: 'Interesado' },
  { value: 'descartado', label: 'Descartado' },
]

export function LeadSheet({ lead, onClose, onUpdate }: LeadSheetProps) {
  const [status, setStatus] = useState<WebLeadStatus>(lead.status)
  const [notasInternas, setNotasInternas] = useState(lead.notas_internas || '')
  const [saving, setSaving] = useState(false)
  const supabase = createClient()

  const handleSave = async () => {
    setSaving(true)
    try {
      const { data, error } = await supabase
        .from('web_leads')
        .update({
          status,
          notas_internas: notasInternas,
        })
        .eq('id', lead.id)
        .select()
        .single()

      if (error) throw error
      if (!data) throw new Error('No data returned from update')

      onUpdate(data)
    } catch (error) {
      console.error('Error updating lead:', error)
      alert('Error al guardar los cambios')
    } finally {
      setSaving(false)
    }
  }

  const handleCall = () => {
    if (lead.telefono) {
      window.location.href = `tel:${lead.telefono}`
    }
  }

  const handleEmail = () => {
    if (lead.email) {
      window.location.href = `mailto:${lead.email}`
    }
  }

  return (
    <Sheet open={true} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-2xl bg-[#080808] border-l border-white/10 overflow-y-auto">
        <SheetHeader className="mb-6">
          <div className="flex items-start justify-between">
            <div>
              <SheetTitle className="text-2xl font-bold text-white mb-2">
                {lead.nombre}
              </SheetTitle>
              <SheetDescription className="text-white/60">
                Creado el {format(new Date(lead.created_at), "dd 'de' MMMM 'de' yyyy 'a las' HH:mm", { locale: es })}
              </SheetDescription>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-8 w-8"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </SheetHeader>

        <div className="space-y-6">
          {/* Información de Contacto */}
          <div className="glass-card p-4 space-y-3">
            <h3 className="font-semibold text-white mb-3">Información de Contacto</h3>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {lead.email && (
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-white/50" />
                  <div className="flex-1">
                    <Label className="text-xs text-white/50">Email</Label>
                    <p className="text-sm text-white">{lead.email}</p>
                  </div>
                  <Button
                    variant="glass"
                    size="sm"
                    onClick={handleEmail}
                    className="gap-2"
                  >
                    <Mail className="h-3.5 w-3.5" />
                    Email
                  </Button>
                </div>
              )}

              {lead.telefono && (
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-white/50" />
                  <div className="flex-1">
                    <Label className="text-xs text-white/50">Teléfono</Label>
                    <p className="text-sm text-white">{lead.telefono}</p>
                  </div>
                  <Button
                    variant="glass"
                    size="sm"
                    onClick={handleCall}
                    className="gap-2"
                  >
                    <Phone className="h-3.5 w-3.5" />
                    Llamar
                  </Button>
                </div>
              )}

              {lead.empresa && (
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-white/50" />
                  <div className="flex-1">
                    <Label className="text-xs text-white/50">Empresa</Label>
                    <p className="text-sm text-white">{lead.empresa}</p>
                  </div>
                </div>
              )}

              {lead.ingresos && (
                <div className="flex-1">
                  <Label className="text-xs text-white/50">Ingresos</Label>
                  <p className="text-sm text-white">{lead.ingresos}</p>
                </div>
              )}
            </div>
          </div>

          {/* Mensaje Original */}
          {lead.mensaje && (
            <div className="glass-card p-4">
              <Label className="text-xs text-white/50 mb-2 block">Mensaje Original</Label>
              <p className="text-sm text-white/80 whitespace-pre-wrap">
                {lead.mensaje}
              </p>
            </div>
          )}

          {/* Estado */}
          <div className="glass-card p-4">
            <Label htmlFor="status" className="text-sm font-semibold text-white mb-2 block">
              Estado
            </Label>
            <Select value={status} onValueChange={(value) => setStatus(value as WebLeadStatus)}>
              <SelectTrigger id="status" className="input-glass">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Notas Internas */}
          <div className="glass-card p-4">
            <Label htmlFor="notas" className="text-sm font-semibold text-white mb-2 block">
              Notas Internas
            </Label>
            <Textarea
              id="notas"
              value={notasInternas}
              onChange={(e) => setNotasInternas(e.target.value)}
              placeholder="Escribe aquí el seguimiento del lead, llamadas, emails, reuniones, etc..."
              className="input-glass min-h-[200px] resize-none"
            />
            <p className="text-xs text-white/50 mt-2">
              Usa este campo para llevar un registro detallado de todas las interacciones con el cliente.
            </p>
          </div>

          {/* Botones de Acción */}
          <div className="flex gap-3 items-stretch">
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1 h-12"
            >
              Cancelar
            </Button>
            <LibertyButton
              onClick={handleSave}
              disabled={saving}
              className="flex-1 h-12"
            >
              {saving ? 'Guardando...' : 'Guardar Cambios'}
            </LibertyButton>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

