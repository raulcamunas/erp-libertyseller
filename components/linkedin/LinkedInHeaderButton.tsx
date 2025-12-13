'use client'

import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { AddCompanyModal } from './AddCompanyModal'

export function LinkedInHeaderButton() {
  const [isAddCompanyModalOpen, setIsAddCompanyModalOpen] = useState(false)

  const handleCompanyAdded = async () => {
    // Recargar la página para actualizar las empresas
    window.location.reload()
  }

  return (
    <>
      <Button
        onClick={() => setIsAddCompanyModalOpen(true)}
        className="bg-[#FF6600]/20 border-2 border-[#FF6600] text-[#FF6600] hover:bg-[#FF6600]/30 hover:border-[#FF6600]/80"
      >
        <Plus className="h-4 w-4 mr-2" />
        Añadir Empresa
      </Button>

      <AddCompanyModal
        open={isAddCompanyModalOpen}
        onClose={() => setIsAddCompanyModalOpen(false)}
        onSuccess={handleCompanyAdded}
      />
    </>
  )
}

