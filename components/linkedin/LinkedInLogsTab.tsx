'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fetchAll } from '@/lib/supabase/paginacion'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { Building2, User, Loader2 } from 'lucide-react'

interface LogEntry {
  id: string
  type: 'company_created' | 'company_updated' | 'prospect_created' | 'prospect_updated'
  entity_id: string
  entity_name: string
  timestamp: string
  details?: string
}

export function LinkedInLogsTab() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    loadLogs()
  }, [])

  const loadLogs = async () => {
    setLoading(true)
    try {
      // PAGINADAS Y EN PARALELO. Este panel es un histórico: sin `.range()`,
      // PostgREST corta a 1000 filas sin dar error y el histórico empezaría a
      // mentir por abajo en cuanto se pasara del millar (hoy 463 empresas y
      // 512 prospectos). El `.order('id')` de desempate hace falta para
      // paginar y está comprobado contra la base real que no altera el orden
      // actual: no hay ni un created_at repetido en ninguna de las dos tablas.
      // `fetchAll` lanza si falla un tramo, igual que hacía el `throw` de
      // antes, así que el try/catch de esta función lo sigue recogiendo igual.
      const [companies, prospects] = await Promise.all([
        fetchAll<{ id: string; name: string; created_at: string }>((desde, hasta) =>
          supabase
            .from('target_companies')
            .select('id, name, created_at')
            .order('created_at', { ascending: false })
            .order('id', { ascending: true })
            .range(desde, hasta)
        ),
        fetchAll<{
          id: string
          full_name: string
          company_id: string
          created_at: string
          updated_at: string
        }>((desde, hasta) =>
          supabase
            .from('company_prospects')
            .select('id, full_name, company_id, created_at, updated_at')
            .order('created_at', { ascending: false })
            .order('id', { ascending: true })
            .range(desde, hasta)
        ),
      ])

      // Obtener nombres de empresas para los prospectos
      const companyMap = new Map(
        companies.map(c => [c.id, c.name])
      )

      // Combinar todos los logs
      const allLogs: LogEntry[] = []

      // Logs de empresas (creación)
      ;(companies || []).forEach(company => {
        allLogs.push({
          id: `company-${company.id}-created`,
          type: 'company_created',
          entity_id: company.id,
          entity_name: company.name,
          timestamp: company.created_at,
        })
      })

      // Logs de prospectos (creación y actualización)
      ;(prospects || []).forEach(prospect => {
        const companyName = companyMap.get(prospect.company_id) || 'Empresa desconocida'
        
        // Log de creación
        allLogs.push({
          id: `prospect-${prospect.id}-created`,
          type: 'prospect_created',
          entity_id: prospect.id,
          entity_name: `${prospect.full_name} (${companyName})`,
          timestamp: prospect.created_at,
        })

        // Log de actualización (solo si updated_at es diferente de created_at)
        if (prospect.updated_at && prospect.updated_at !== prospect.created_at) {
          allLogs.push({
            id: `prospect-${prospect.id}-updated`,
            type: 'prospect_updated',
            entity_id: prospect.id,
            entity_name: `${prospect.full_name} (${companyName})`,
            timestamp: prospect.updated_at,
          })
        }
      })

      // Ordenar por fecha (más reciente primero)
      allLogs.sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )

      setLogs(allLogs)
    } catch (error) {
      console.error('Error loading logs:', error)
    } finally {
      setLoading(false)
    }
  }

  const getLogIcon = (type: LogEntry['type']) => {
    switch (type) {
      case 'company_created':
      case 'company_updated':
        return <Building2 className="h-4 w-4" />
      case 'prospect_created':
      case 'prospect_updated':
        return <User className="h-4 w-4" />
      default:
        return null
    }
  }

  const getLogLabel = (type: LogEntry['type']) => {
    switch (type) {
      case 'company_created':
        return 'Empresa creada'
      case 'company_updated':
        return 'Empresa actualizada'
      case 'prospect_created':
        return 'Prospecto creado'
      case 'prospect_updated':
        return 'Prospecto actualizado'
      default:
        return 'Acción'
    }
  }

  const getLogColor = (type: LogEntry['type']) => {
    switch (type) {
      case 'company_created':
      case 'prospect_created':
        return 'text-green-400'
      case 'company_updated':
      case 'prospect_updated':
        return 'text-blue-400'
      default:
        return 'text-white/70'
    }
  }

  if (loading) {
    return (
      <Card className="glass-card border-white/10">
        <CardContent className="pt-6">
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-[#FF6600]" />
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="glass-card border-white/10">
      <CardHeader>
        <CardTitle className="text-white">Logs de Actividad</CardTitle>
        <p className="text-white/50 text-sm mt-1">
          Historial de creación y modificación de empresas y prospectos
        </p>
      </CardHeader>
      <CardContent>
        {logs.length === 0 ? (
          <div className="text-center py-12 text-white/50">
            No hay logs disponibles
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-white/10">
                  <TableHead className="text-white/70">Fecha y Hora</TableHead>
                  <TableHead className="text-white/70">Tipo</TableHead>
                  <TableHead className="text-white/70">Entidad</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => {
                  const logDate = parseISO(log.timestamp)
                  const dateStr = format(logDate, 'dd/MM/yyyy', { locale: es })
                  const timeStr = format(logDate, 'HH:mm:ss', { locale: es })
                  
                  return (
                    <TableRow key={log.id} className="border-white/10">
                      <TableCell className="text-white">
                        <div className="flex flex-col">
                          <span className="font-medium">{dateStr}</span>
                          <span className="text-sm text-white/50">{timeStr}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className={getLogColor(log.type)}>
                            {getLogIcon(log.type)}
                          </span>
                          <span className={`${getLogColor(log.type)} font-medium`}>
                            {getLogLabel(log.type)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-white">
                        {log.entity_name}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

