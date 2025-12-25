'use client'

import { useState, useCallback, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Upload, FileText, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import { useDropzone } from 'react-dropzone'
import { parseCSV, getVal } from '@/lib/utils/csv-parser'
import { toast } from 'sonner'
import { format } from 'date-fns'

interface UploadHoursComponentProps {
  employees: string[]
  initialEmployee?: string
}

interface CSVRow {
  Fecha?: string
  'Hora Inicio'?: string
  'Hora Fin'?: string
  'Duracion (s)'?: string
  'Duracion (min)'?: string
  Dominio?: string
  URL?: string
}

export function UploadHoursComponent({ employees, initialEmployee }: UploadHoursComponentProps) {
  const [selectedEmployee, setSelectedEmployee] = useState<string>(initialEmployee || employees[0] || '')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [preview, setPreview] = useState<CSVRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isEmployee, setIsEmployee] = useState(false)
  const supabase = createClient()

  // Verificar si el usuario es empleado
  useEffect(() => {
    const checkUserRole = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('role, full_name, email')
          .eq('id', user.id)
          .single()

        if (profile && profile.role === 'employee') {
          setIsEmployee(true)
          // Si es empleado y hay un initialEmployee, asegurarse de que esté seleccionado
          if (initialEmployee) {
            setSelectedEmployee(initialEmployee)
          } else {
            // Usar el nombre del perfil o email
            const employeeName = profile.full_name || profile.email || ''
            if (employeeName) {
              setSelectedEmployee(employeeName)
            }
          }
        }
      }
    }
    checkUserRole()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEmployee])

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0]
    if (!file) return

    if (!file.name.endsWith('.csv')) {
      setError('El archivo debe ser un CSV')
      return
    }

    setFile(file)
    setError(null)
    setPreview(null)

    // Leer y previsualizar el CSV
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string
        const rows = parseCSV(text)
        
        if (rows.length === 0) {
          setError('El CSV está vacío o no tiene el formato correcto')
          return
        }

        // Verificar que tenga las columnas necesarias
        const firstRow = rows[0]
        const hasRequiredColumns = 
          getVal(firstRow, ['Fecha', 'fecha']) &&
          getVal(firstRow, ['Hora Inicio', 'hora inicio', 'HoraInicio']) &&
          getVal(firstRow, ['Dominio', 'dominio']) &&
          getVal(firstRow, ['URL', 'url'])

        if (!hasRequiredColumns) {
          setError('El CSV debe contener las columnas: Fecha, Hora Inicio, Hora Fin, Duracion (s), Duracion (min), Dominio, URL')
          return
        }

        setPreview(rows.slice(0, 5)) // Mostrar primeras 5 filas
      } catch (err) {
        console.error('Error parsing CSV:', err)
        setError('Error al leer el archivo CSV')
      }
    }
    reader.readAsText(file, 'UTF-8')
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/csv': ['.csv']
    },
    multiple: false
  })

  const handleUpload = async () => {
    if (!selectedEmployee) {
      toast.error('Por favor selecciona un empleado')
      return
    }

    if (!file) {
      toast.error('Por favor selecciona un archivo CSV')
      return
    }

    setUploading(true)
    setError(null)

    try {
      // Leer el archivo
      const text = await file.text()
      const rows = parseCSV(text)

      if (rows.length === 0) {
        throw new Error('El CSV está vacío')
      }

      // Procesar todos los logs en un solo reporte
      const logs: Array<{
        domain: string
        url: string
        title: string | null
        startTime: string
        endTime: string | null
        duration: number
      }> = []

      let firstLogDate: Date | null = null

      for (const row of rows) {
        // Obtener valores usando getVal para flexibilidad
        const fecha = getVal(row, ['Fecha', 'fecha'])
        const horaInicio = getVal(row, ['Hora Inicio', 'hora inicio', 'HoraInicio'])
        const horaFin = getVal(row, ['Hora Fin', 'hora fin', 'HoraFin'])
        const duracionSegundos = getVal(row, ['Duracion (s)', 'duracion (s)', 'Duracion(s)', 'duracion(s)'])
        const dominio = getVal(row, ['Dominio', 'dominio'])
        const url = getVal(row, ['URL', 'url'])

        if (!fecha || !horaInicio || !dominio || !url) {
          console.warn('Fila incompleta, saltando:', row)
          continue
        }

        // Parsear fecha (formato: 23/12/2025)
        const [dia, mes, año] = fecha.split('/').map(Number)
        if (!dia || !mes || !año) {
          console.warn('Fecha inválida, saltando:', fecha)
          continue
        }

        // Parsear hora inicio (puede ser formato 24h: 16:59:11 o 12h: 3:32:31 p. m.)
        let hora: number, minuto: number, segundo: number = 0
        
        // Detectar si es formato 12 horas (contiene "a. m." o "p. m.")
        const horaLower = horaInicio.toLowerCase().trim()
        const isPM = horaLower.includes('p. m.') || horaLower.includes('pm')
        const isAM = horaLower.includes('a. m.') || horaLower.includes('am')
        
        if (isPM || isAM) {
          // Formato 12 horas: "3:32:31 p. m."
          const horaSinAMPM = horaInicio.replace(/[ap]\.?\s*m\.?/gi, '').trim()
          const partes = horaSinAMPM.split(':').map(Number)
          hora = partes[0] || 0
          minuto = partes[1] || 0
          segundo = partes[2] || 0
          
          // Convertir a 24 horas
          if (isPM && hora !== 12) {
            hora = hora + 12
          } else if (isAM && hora === 12) {
            hora = 0
          }
        } else {
          // Formato 24 horas: "16:59:11"
          const partes = horaInicio.split(':').map(Number)
          hora = partes[0]
          minuto = partes[1] || 0
          segundo = partes[2] || 0
        }
        
        if (hora === undefined || minuto === undefined) {
          console.warn('Hora inicio inválida, saltando:', horaInicio)
          continue
        }

        // Crear fecha/hora de inicio en hora local
        // Usar el constructor de Date con parámetros locales para evitar problemas de zona horaria
        const startDateTime = new Date(año, mes - 1, dia, hora, minuto, segundo || 0)
        
        // Verificar que la fecha sea válida
        if (isNaN(startDateTime.getTime())) {
          console.warn('Fecha/hora inválida, saltando:', { fecha, horaInicio, año, mes, dia, hora, minuto })
          continue
        }

        // Guardar la fecha del primer log para usarla como report_date
        if (!firstLogDate) {
          firstLogDate = new Date(startDateTime)
        }

        // Crear fecha/hora de fin si existe (puede ser formato 12h o 24h)
        let endDateTime: Date | null = null
        if (horaFin) {
          let horaFinNum: number, minutoFin: number, segundoFin: number = 0
          
          const horaFinLower = horaFin.toLowerCase().trim()
          const isPMFin = horaFinLower.includes('p. m.') || horaFinLower.includes('pm')
          const isAMFin = horaFinLower.includes('a. m.') || horaFinLower.includes('am')
          
          if (isPMFin || isAMFin) {
            // Formato 12 horas
            const horaSinAMPM = horaFin.replace(/[ap]\.?\s*m\.?/gi, '').trim()
            const partes = horaSinAMPM.split(':').map(Number)
            horaFinNum = partes[0] || 0
            minutoFin = partes[1] || 0
            segundoFin = partes[2] || 0
            
            // Convertir a 24 horas
            if (isPMFin && horaFinNum !== 12) {
              horaFinNum = horaFinNum + 12
            } else if (isAMFin && horaFinNum === 12) {
              horaFinNum = 0
            }
          } else {
            // Formato 24 horas
            const partes = horaFin.split(':').map(Number)
            horaFinNum = partes[0]
            minutoFin = partes[1] || 0
            segundoFin = partes[2] || 0
          }
          
          if (horaFinNum !== undefined && minutoFin !== undefined) {
            endDateTime = new Date(año, mes - 1, dia, horaFinNum, minutoFin, segundoFin || 0)
          }
        }

        // Calcular duración en segundos
        let durationSeconds = 0
        if (duracionSegundos) {
          durationSeconds = parseInt(String(duracionSegundos)) || 0
        } else if (endDateTime && startDateTime) {
          durationSeconds = Math.floor((endDateTime.getTime() - startDateTime.getTime()) / 1000)
        }

        if (durationSeconds <= 0) {
          console.warn('Duración inválida, saltando:', row)
          continue
        }

        // Obtener título del CSV (columna "Titulo")
        let title: string | null = getVal(row, ['Titulo', 'titulo', 'Título', 'título']) || null
        
        // Si no hay título en el CSV, usar el dominio como fallback
        if (!title) {
          try {
            if (url && url.startsWith('http')) {
              const urlObj = new URL(url)
              title = urlObj.hostname.replace('www.', '')
            } else {
              title = dominio
            }
          } catch {
            title = dominio
          }
        }

        // Agregar log al array (todos en un solo reporte)
        logs.push({
          domain: dominio,
          url: url,
          title: title,
          startTime: startDateTime.toISOString(),
          endTime: endDateTime ? endDateTime.toISOString() : null,
          duration: durationSeconds
        })
      }

      if (logs.length === 0) {
        throw new Error('No se pudieron procesar datos válidos del CSV')
      }

      // Usar la fecha del primer log redondeada al inicio del día como report_date
      // Esto permite que múltiples CSV del mismo día se agreguen al mismo reporte
      const reportDate = firstLogDate 
        ? (() => {
            // Crear fecha al inicio del día en hora local (00:00:00)
            // Usar los valores locales para evitar problemas de zona horaria
            const year = firstLogDate.getFullYear()
            const month = firstLogDate.getMonth()
            const day = firstLogDate.getDate()
            
            // Crear fecha en hora local (no UTC)
            const dayStart = new Date(year, month, day, 0, 0, 0, 0)
            
            // Convertir a UTC manteniendo la fecha local
            // Esto asegura que el report_date represente el inicio del día en la zona horaria local
            const utcDayStart = new Date(Date.UTC(year, month, day, 0, 0, 0, 0))
            
            console.log('📅 [UPLOAD] Report date calculation:', {
              firstLogDate: firstLogDate.toISOString(),
              firstLogDate_local: `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
              dayStart_local: dayStart.toISOString(),
              dayStart_utc: utcDayStart.toISOString(),
              dateString: format(dayStart, 'yyyy-MM-dd')
            })
            
            // Usar UTC para mantener consistencia con Supabase
            return utcDayStart.toISOString()
          })()
        : (() => {
            const now = new Date()
            const year = now.getFullYear()
            const month = now.getMonth()
            const day = now.getDate()
            const utcDayStart = new Date(Date.UTC(year, month, day, 0, 0, 0, 0))
            return utcDayStart.toISOString()
          })()
      
      console.log('📤 [UPLOAD] Subiendo reporte:', {
        employee: selectedEmployee,
        reportDate,
        logsCount: logs.length,
        firstLogTime: logs[0]?.startTime,
        lastLogTime: logs[logs.length - 1]?.startTime
      })

      // Subir un solo reporte con todos los logs
      try {
        console.log('📤 [UPLOAD] Enviando request a /api/tracker/ingest:', {
          employee_id: selectedEmployee,
          report_date: reportDate,
          logs_count: logs.length,
          first_log: logs[0]
        })

        // Asegurarse de que el employee_id esté limpio (sin espacios)
        const cleanEmployeeId = selectedEmployee.trim()
        
        console.log('📤 [UPLOAD] Enviando request a /api/tracker/ingest:', {
          employee_id: cleanEmployeeId,
          employee_id_original: selectedEmployee,
          report_date: reportDate,
          logs_count: logs.length,
          first_log: logs[0]
        })

        const response = await fetch('/api/tracker/ingest', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            employee_id: cleanEmployeeId,
            report_date: reportDate,
            logs: logs
          })
        })

        const result = await response.json()
        console.log('📥 [UPLOAD] Respuesta del servidor:', {
          status: response.status,
          ok: response.ok,
          result
        })

        if (!response.ok || !result.success) {
          const errorMsg = result.error || result.details || 'Error desconocido al subir el reporte'
          console.error('❌ [UPLOAD] Error del servidor:', errorMsg)
          throw new Error(errorMsg)
        }

        console.log('✅ [UPLOAD] Reporte subido exitosamente:', result.report_id)
        toast.success(`✅ Se subió 1 paquete con ${logs.length} actividades correctamente`)
        
        // Limpiar estado después de éxito
        setFile(null)
        setPreview(null)
        // No limpiar selectedEmployee para que el usuario pueda subir más archivos del mismo empleado
      } catch (err: any) {
        console.error('❌ [UPLOAD] Error completo:', err)
        const errorMessage = err.message || 'Error desconocido al subir los datos'
        throw new Error(errorMessage)
      }
    } catch (error: any) {
      console.error('❌ [UPLOAD] Error uploading CSV:', error)
      const errorMessage = error.message || 'Error al procesar el archivo CSV'
      setError(errorMessage)
      toast.error(`Error: ${errorMessage}`, {
        description: 'Revisa la consola del navegador para más detalles',
        duration: 5000
      })
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-white">Subir Horas</h1>
      </div>

      <Card className="glass-card border-white/10">
        <CardHeader>
          <CardTitle className="text-white">Subir Horas desde CSV</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Selector de Empleado */}
          <div className="space-y-2">
            <Label htmlFor="employee" className="text-white/70">Empleado</Label>
            {isEmployee && employees.length === 1 ? (
              // Si es empleado y solo hay una opción, mostrar como texto fijo
              <div className="bg-white/[0.05] border border-white/10 rounded-md px-3 py-2 text-white">
                {selectedEmployee || employees[0]}
              </div>
            ) : (
              <Select 
                value={selectedEmployee} 
                onValueChange={setSelectedEmployee}
                disabled={isEmployee && employees.length === 1}
              >
                <SelectTrigger id="employee" className="bg-white/[0.05] border-white/10 text-white">
                  <SelectValue placeholder="Seleccionar empleado" />
                </SelectTrigger>
                <SelectContent>
                  {employees.length === 0 ? (
                    <SelectItem value="no-employees" disabled>
                      No hay empleados disponibles
                    </SelectItem>
                  ) : (
                    employees.map(emp => (
                      <SelectItem key={emp} value={emp}>
                        {emp}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Área de Drop */}
          <div className="space-y-2">
            <Label className="text-white/70">Archivo CSV</Label>
            <div
              {...getRootProps()}
              className={`
                border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors
                ${isDragActive 
                  ? 'border-[#FF6600] bg-[#FF6600]/10' 
                  : 'border-white/20 hover:border-white/40 bg-white/[0.02]'
                }
                ${file ? 'border-green-500/50 bg-green-500/5' : ''}
              `}
            >
              <input {...getInputProps()} />
              {file ? (
                <div className="space-y-2">
                  <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto" />
                  <p className="text-white font-medium">{file.name}</p>
                  <p className="text-white/60 text-sm">
                    {preview ? `${preview.length} filas previsualizadas` : 'Archivo seleccionado'}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Upload className="h-12 w-12 text-white/50 mx-auto" />
                  <p className="text-white">
                    {isDragActive ? 'Suelta el archivo aquí' : 'Arrastra un archivo CSV aquí o haz clic para seleccionar'}
                  </p>
                  <p className="text-white/60 text-sm">
                    El CSV debe contener: Fecha, Hora Inicio, Hora Fin, Duracion (s), Duracion (min), Dominio, URL
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Preview del CSV */}
          {preview && preview.length > 0 && (
            <div className="space-y-2">
              <Label className="text-white/70">Vista Previa (primeras 5 filas)</Label>
              <div className="bg-white/[0.05] border border-white/10 rounded-lg p-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      {Object.keys(preview[0]).map(key => (
                        <th key={key} className="text-left p-2 text-white/70 font-semibold">
                          {key}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, idx) => (
                      <tr key={idx} className="border-b border-white/5">
                        {Object.values(row).map((val, valIdx) => (
                          <td key={valIdx} className="p-2 text-white/90 text-xs">
                            {String(val || '').substring(0, 30)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <Alert className="bg-red-500/10 border-red-500/50">
              <AlertCircle className="h-4 w-4 text-red-500" />
              <AlertDescription className="text-red-200">
                {error}
              </AlertDescription>
            </Alert>
          )}

          {/* Botón de Subir */}
          <Button
            onClick={handleUpload}
            disabled={!selectedEmployee || !file || uploading}
            className="w-full bg-[#FF6600] hover:bg-[#FF8533] text-white"
          >
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Subiendo...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Subir Horas
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

