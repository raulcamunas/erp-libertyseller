'use client'

import { useState } from 'react'
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
import { Save, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

interface AddCompanyModalProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

export function AddCompanyModal({ open, onClose, onSuccess }: AddCompanyModalProps) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const supabase = createClient()

  const handleSave = async () => {
    if (!name.trim()) {
      alert('El nombre de la empresa es obligatorio')
      return
    }

    setSaving(true)
    try {
      const { error } = await supabase
        .from('target_companies')
        .insert({ name: name.trim() })

      if (error) throw error

      setName('')
      onSuccess()
      onClose()
    } catch (error) {
      console.error('Error creating company:', error)
      alert('Error al crear la empresa')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-[#080808] border-white/10 backdrop-blur-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-white">
            Añadir Nueva Empresa
          </DialogTitle>
          <DialogDescription className="text-white/60">
            Crea un nuevo contenedor para gestionar prospectos
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          <div>
            <Label htmlFor="name" className="text-sm font-semibold text-white mb-2 block">
              Nombre de la Empresa
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: TechCorp Solutions"
              className="input-glass"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSave()
                }
              }}
            />
          </div>

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
              {saving ? 'Creando...' : 'Crear Empresa'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

