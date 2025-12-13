'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Save, X, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'

export function AddClientForm() {
  const router = useRouter()
  const supabase = createClient()
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    currency: 'EUR',
    status: 'active' as 'active' | 'paused',
    logo_url: '',
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.name.trim()) {
      toast.error('El nombre del cliente es obligatorio')
      return
    }

    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('ppc_clients')
        .insert({
          name: formData.name.trim(),
          currency: formData.currency,
          status: formData.status,
          logo_url: formData.logo_url.trim() || null,
        })
        .select()
        .single()

      if (error) throw error

      toast.success('Cliente creado correctamente')
      router.push(`/dashboard/marketing/${data.id}`)
      router.refresh()
    } catch (error: any) {
      console.error('Error creating client:', error)
      toast.error(error.message || 'Error al crear el cliente')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="glass-card p-6 rounded-xl space-y-6">
        {/* Nombre del Cliente */}
        <div>
          <Label htmlFor="name" className="text-sm font-semibold text-white mb-2 block">
            Nombre del Cliente *
          </Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="Ej: TechCorp"
            className="input-glass"
            required
          />
        </div>

        {/* Moneda */}
        <div>
          <Label htmlFor="currency" className="text-sm font-semibold text-white mb-2 block">
            Moneda
          </Label>
          <Select
            value={formData.currency}
            onValueChange={(value) => setFormData({ ...formData, currency: value })}
          >
            <SelectTrigger className="input-glass">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="EUR">EUR (Euro)</SelectItem>
              <SelectItem value="USD">USD (Dólar)</SelectItem>
              <SelectItem value="GBP">GBP (Libra)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Estado */}
        <div>
          <Label htmlFor="status" className="text-sm font-semibold text-white mb-2 block">
            Estado
          </Label>
          <Select
            value={formData.status}
            onValueChange={(value: 'active' | 'paused') => setFormData({ ...formData, status: value })}
          >
            <SelectTrigger className="input-glass">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Activo</SelectItem>
              <SelectItem value="paused">Pausado</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Logo URL (Opcional) */}
        <div>
          <Label htmlFor="logo_url" className="text-sm font-semibold text-white mb-2 block">
            URL del Logo (Opcional)
          </Label>
          <Input
            id="logo_url"
            type="url"
            value={formData.logo_url}
            onChange={(e) => setFormData({ ...formData, logo_url: e.target.value })}
            placeholder="https://ejemplo.com/logo.png"
            className="input-glass"
          />
          <p className="text-xs text-white/50 mt-2">
            URL de la imagen del logo del cliente
          </p>
        </div>
      </div>

      {/* Botones */}
      <div className="flex gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          className="flex-1 border-white/20 hover:border-white/40"
        >
          <X className="h-4 w-4 mr-2" />
          Cancelar
        </Button>
        <Button
          type="submit"
          disabled={loading}
          className="flex-1 bg-[#FF6600] text-white hover:bg-[#FF6600]/90"
        >
          <Save className="h-4 w-4 mr-2" />
          {loading ? 'Creando...' : 'Crear Cliente'}
        </Button>
      </div>
    </form>
  )
}

