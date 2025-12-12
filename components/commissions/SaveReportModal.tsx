'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { X } from 'lucide-react'
import { LibertyButton } from '@/components/ui/LibertyButton'
import { CommissionCalculationData } from '@/lib/types/commissions'

interface SaveReportModalProps {
  clientId: string
  clientName: string
  data: CommissionCalculationData
  onClose: () => void
  onSaved: () => void
}

export function SaveReportModal({
  clientId,
  clientName,
  data,
  onClose,
  onSaved
}: SaveReportModalProps) {
  const [slug, setSlug] = useState('')
  const [period, setPeriod] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const supabase = createClient()

  const generateSlug = (text: string) => {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
  }

  const handleSave = async () => {
    if (!slug.trim()) {
      setError('El slug es requerido')
      return
    }

    setSaving(true)
    setError(null)

    try {
      const { error: saveError } = await supabase
        .from('commission_reports')
        .insert([
          {
            slug: slug.trim(),
            client_id: clientId,
            period: period || null,
            data: data,
            status: 'draft'
          }
        ])

      if (saveError) {
        if (saveError.code === '23505') {
          setError('Este slug ya existe. Usa otro.')
        } else {
          throw saveError
        }
      } else {
        onSaved()
      }
    } catch (err: any) {
      setError(err.message || 'Error al guardar el reporte')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}>
      <Card className="w-full max-w-md mx-auto">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-white">Guardar Reporte</CardTitle>
            <CardDescription>
              Guarda este cálculo para referencia futura
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8"
          >
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="label-uppercase text-white/70">
              Cliente
            </label>
            <Input
              value={clientName}
              disabled
              className="bg-white/[0.03]"
            />
          </div>

          <div className="space-y-2">
            <label className="label-uppercase text-white/70">
              Slug (URL única) *
            </label>
            <Input
              value={slug}
              onChange={(e) => setSlug(generateSlug(e.target.value))}
              placeholder="ej: jamones-nov-2024"
              required
            />
            <p className="text-xs text-white/50">
              Se usará para compartir el reporte: /commissions/report/{slug}
            </p>
          </div>

          <div className="space-y-2">
            <label className="label-uppercase text-white/70">
              Período (Opcional)
            </label>
            <Input
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              placeholder="ej: Noviembre 2024"
            />
          </div>

          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-4 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="flex-1"
            >
              Cancelar
            </Button>
            <LibertyButton
              onClick={handleSave}
              disabled={saving || !slug.trim()}
              className="flex-1"
            >
              {saving ? 'Guardando...' : 'Guardar'}
            </LibertyButton>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

