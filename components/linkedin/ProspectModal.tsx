'use client'

import { useState, useEffect } from 'react'
import { CompanyProspect, ProspectStatus, Agent, ProspectStatusHistory } from '@/lib/types/linkedin'
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
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { ExternalLink, Linkedin, Phone, Mail, Save, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

interface ProspectModalProps {
  prospect: CompanyProspect | null
  open: boolean
  onClose: () => void
  onUpdate: () => void
}

const STATUS_OPTIONS: { value: ProspectStatus; label: string }[] = [
  { value: 'identified', label: 'Identificado' },
  { value: 'connected', label: 'Conectado' },
  { value: 'messaged', label: 'Mensaje Enviado' },
  { value: 'replied', label: 'Respondió' },
]

export function ProspectModal({ prospect, open, onClose, onUpdate }: ProspectModalProps) {
  const [phone, setPhone] = useState(prospect?.phone || '')
  const [email, setEmail] = useState(prospect?.email || '')
  const [notes, setNotes] = useState(prospect?.notes || '')
  const [status, setStatus] = useState<ProspectStatus>(prospect?.status || 'identified')
  const [agent, setAgent] = useState<Agent>(prospect?.agent || 'Raul')
  const [saving, setSaving] = useState(false)
  const [history, setHistory] = useState<ProspectStatusHistory[]>([])
  const supabase = createClient()

  // Actualizar estado cuando cambia el prospecto
  useEffect(() => {
    if (prospect) {
      setPhone(prospect.phone || '')
      setEmail(prospect.email || '')
      setNotes(prospect.notes || '')
      setStatus(prospect.status)
      setAgent(prospect.agent)
      loadHistory()
    }
  }, [prospect])

  // Cargar historial de cambios
  const loadHistory = async () => {
    if (!prospect) return
    
    try {
      const { data, error } = await supabase
        .from('prospect_status_history')
        .select('*')
        .eq('prospect_id', prospect.id)
        .order('changed_at', { ascending: false })

      if (error) throw error
      
      // Añadir el registro inicial de creación
      const fullHistory: ProspectStatusHistory[] = [
        {
          id: 'created',
          prospect_id: prospect.id,
          status: 'identified', // Estado inicial siempre es 'identified'
          changed_at: prospect.created_at,
          created_at: prospect.created_at,
        },
        ...(data || []),
      ]
      
      setHistory(fullHistory)
    } catch (error) {
      console.error('Error loading history:', error)
    }
  }

  // Función para obtener el color del punto según el estado
  const getStatusColor = (status: ProspectStatus): string => {
    switch (status) {
      case 'identified':
        return 'bg-white/20' // Gris
      case 'connected':
        return 'bg-[#FF6600]/70' // Naranja
      case 'messaged':
        return 'bg-[#FF6600]' // Naranja fuerte
      case 'replied':
        return 'bg-purple-400' // Morado
      default:
        return 'bg-white/20'
    }
  }

  // Función para obtener el nombre del estado
  const getStatusLabel = (status: ProspectStatus): string => {
    const option = STATUS_OPTIONS.find(opt => opt.value === status)
    return option?.label || status
  }

  const handleSave = async () => {
    if (!prospect) return

    setSaving(true)
    try {
      const { error } = await supabase
        .from('company_prospects')
        .update({
          phone: phone || null,
          email: email || null,
          notes: notes || null,
          status,
          agent,
        })
        .eq('id', prospect.id)

      if (error) throw error

      onUpdate()
      onClose()
    } catch (error) {
      console.error('Error updating prospect:', error)
      alert('Error al guardar los cambios')
    } finally {
      setSaving(false)
    }
  }

  if (!prospect) return null

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-[#080808] border-white/10 max-w-2xl max-h-[90vh] overflow-y-auto backdrop-blur-md">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-white">
            {prospect.full_name}
          </DialogTitle>
          <DialogDescription className="text-white/60">
            {prospect.role || 'Sin cargo especificado'} • Creado el{' '}
            {format(new Date(prospect.created_at), "dd 'de' MMMM 'de' yyyy", { locale: es })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* Link a LinkedIn */}
          {prospect.linkedin_url && (
            <div className="glass-card p-4">
              <Button
                variant="outline"
                onClick={() => window.open(prospect.linkedin_url!, '_blank')}
                className="w-full border-[#FF6600]/30 hover:border-[#FF6600]/50 hover:bg-[#FF6600]/10 text-[#FF6600]"
              >
                <Linkedin className="h-4 w-4 mr-2" />
                Ver Perfil de LinkedIn
                <ExternalLink className="h-4 w-4 ml-2" />
              </Button>
            </div>
          )}

          {/* Campos Editables */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Teléfono */}
            <div className="glass-card p-4">
              <Label htmlFor="phone" className="text-sm font-semibold text-white mb-2 block">
                <Phone className="h-4 w-4 inline mr-2 text-[#FF6600]" />
                Teléfono
              </Label>
              <Input
                id="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+34 600 000 000"
                className="input-glass"
              />
            </div>

            {/* Email */}
            <div className="glass-card p-4">
              <Label htmlFor="email" className="text-sm font-semibold text-white mb-2 block">
                <Mail className="h-4 w-4 inline mr-2 text-[#FF6600]" />
                Email
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@empresa.com"
                className="input-glass"
              />
            </div>
          </div>

          {/* Estado y Agente */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Estado */}
            <div className="glass-card p-4">
              <Label className="text-sm font-semibold text-white mb-3 block">
                Estado
              </Label>
              <div className="flex flex-wrap gap-2">
                {STATUS_OPTIONS.map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    onClick={() => setStatus(option.value)}
                    variant="outline"
                    size="sm"
                    className={cn(
                      "text-xs",
                      status === option.value
                        ? "bg-[#FF6600]/20 border-2 border-[#FF6600] text-[#FF6600]"
                        : "bg-white/[0.05] border border-white/10 text-white/70 hover:border-[#FF6600]/30 hover:text-[#FF6600]"
                    )}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Agente */}
            <div className="glass-card p-4">
              <Label className="text-sm font-semibold text-white mb-3 block">
                Agente
              </Label>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={() => setAgent('Raul')}
                  variant="outline"
                  size="sm"
                    className={cn(
                      "text-xs",
                      agent === 'Raul'
                        ? "bg-[#FF6600]/20 border-2 border-[#FF6600] text-[#FF6600]"
                        : "bg-white/[0.05] border border-white/10 text-white/70 hover:border-[#FF6600]/30 hover:text-[#FF6600]"
                    )}
                  >
                    Raul
                  </Button>
                  <Button
                    type="button"
                    onClick={() => setAgent('Mario')}
                    variant="outline"
                    size="sm"
                    className={cn(
                      "text-xs",
                      agent === 'Mario'
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
          <div className="glass-card p-4">
            <Label htmlFor="notes" className="text-sm font-semibold text-white mb-2 block">
              Notas
            </Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Apunta detalles importantes: 'Dijo que le interesa...', 'Quedamos en...', etc."
              className="input-glass min-h-[150px] resize-none"
            />
          </div>

          {/* Timeline de Cambios */}
          <div className="glass-card p-4">
            <Label className="text-sm font-semibold text-white mb-3 block">
              Historial
            </Label>
            <div className="space-y-3 text-sm">
              {history.length > 0 ? (
                history.map((entry, index) => (
                  <div key={entry.id || index} className="flex items-center gap-3 text-white/60">
                    <div className={cn("h-2.5 w-2.5 rounded-full flex-shrink-0", getStatusColor(entry.status))} />
                    <div className="flex-1">
                      <span className="font-medium text-white/80">
                        {entry.id === 'created' ? 'Creado' : `Cambiado a "${getStatusLabel(entry.status)}"`}
                      </span>
                      <span className="ml-2">
                        el {format(new Date(entry.changed_at), "dd/MM/yyyy 'a las' HH:mm", { locale: es })}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex items-center gap-2 text-white/60">
                  <div className="h-2 w-2 rounded-full bg-white/20" />
                  <span>
                    Creado el {format(new Date(prospect.created_at), "dd/MM/yyyy 'a las' HH:mm", { locale: es })}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Botones de Acción */}
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
              {saving ? 'Guardando...' : 'Guardar Cambios'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

