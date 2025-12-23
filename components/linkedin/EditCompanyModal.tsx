'use client'

import { useState, useEffect } from 'react'
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
import { TargetCompany } from '@/lib/types/linkedin'

interface EditCompanyModalProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  company: TargetCompany | null
}

export function EditCompanyModal({ open, onClose, onSuccess, company }: EditCompanyModalProps) {
  const [name, setName] = useState('')
  const [amazonUrl, setAmazonUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    if (company) {
      setName(company.name)
      setAmazonUrl(company.amazon_url || '')
    }
  }, [company])

  const handleSave = async () => {
    if (!name.trim()) {
      alert('El nombre de la empresa es obligatorio')
      return
    }

    if (!company) return

    setSaving(true)
    try {
      const { error } = await supabase
        .from('target_companies')
        .update({ 
          name: name.trim(),
          amazon_url: amazonUrl.trim() || null
        })
        .eq('id', company.id)

      if (error) throw error

      onSuccess()
      onClose()
    } catch (error) {
      console.error('Error updating company:', error)
      alert('Error al actualizar la empresa')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-[#080808] border-white/10 backdrop-blur-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-white">
            Editar Empresa
          </DialogTitle>
          <DialogDescription className="text-white/60">
            Actualiza la información de la empresa
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

          <div>
            <Label htmlFor="amazon_url" className="text-sm font-semibold text-white mb-2 block">
              Página de Amazon (Opcional)
            </Label>
            <Input
              id="amazon_url"
              value={amazonUrl}
              onChange={(e) => setAmazonUrl(e.target.value)}
              placeholder="https://www.amazon.es/shops/..."
              className="input-glass"
              type="url"
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
              {saving ? 'Guardando...' : 'Guardar Cambios'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

