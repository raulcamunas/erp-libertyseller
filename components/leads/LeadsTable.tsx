'use client'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Lead } from '@/lib/types/leads'
import { format } from 'date-fns'

interface LeadsTableProps {
  leads: Lead[]
}

export function LeadsTable({ leads }: LeadsTableProps) {
  const getStatusVariant = (status: string) => {
    switch (status) {
      case 'nuevo':
        return 'nuevo'
      case 'contactado':
        return 'contactado'
      case 'perdido':
        return 'perdido'
      default:
        return 'default'
    }
  }

  const formatDate = (dateString: string) => {
    try {
      return format(new Date(dateString), 'dd/MM/yyyy HH:mm')
    } catch {
      return dateString
    }
  }

  if (leads.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-white/50 text-lg">No hay leads registrados</p>
        <p className="text-white/30 text-sm mt-2">
          Los leads aparecerán aquí cuando se reciban desde n8n
        </p>
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Nombre</TableHead>
          <TableHead>Contacto</TableHead>
          <TableHead>Revenue Range</TableHead>
          <TableHead>Amazon Seller</TableHead>
          <TableHead>Estado</TableHead>
          <TableHead>Fecha</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {leads.map((lead) => (
          <TableRow key={lead.id}>
            <TableCell className="font-medium text-white">
              {lead.name}
            </TableCell>
            <TableCell>
              <div className="space-y-1">
                {lead.email && (
                  <div className="text-sm text-white/70">{lead.email}</div>
                )}
                {lead.phone && (
                  <div className="text-sm text-white/50">{lead.phone}</div>
                )}
              </div>
            </TableCell>
            <TableCell className="text-white/70">
              {lead.revenue_range || '-'}
            </TableCell>
            <TableCell>
              {lead.is_amazon_seller ? (
                <Badge variant="nuevo">Sí</Badge>
              ) : (
                <span className="text-white/30">No</span>
              )}
            </TableCell>
            <TableCell>
              <Badge variant={getStatusVariant(lead.status)}>
                {lead.status}
              </Badge>
            </TableCell>
            <TableCell className="text-white/50 text-sm">
              {formatDate(lead.created_at)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

