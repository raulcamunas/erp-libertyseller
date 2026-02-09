'use client'

import { useState, useEffect, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Clock, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

// Prefijos CP México -> zona horaria (primeros 2 dígitos: estado)
const CP_PREFIX_TZ: Record<string, string> = {
  '21': 'America/Tijuana',   // Baja California
  '22': 'America/Tijuana',   // Baja California
  '23': 'America/Mazatlan',  // Baja California Sur (Pacífico)
  '77': 'America/Cancun',    // Quintana Roo
  '78': 'America/Merida',    // Campeche
  '83': 'America/Hermosillo', // Sonora
  '84': 'America/Hermosillo',
  '85': 'America/Hermosillo',
  '97': 'America/Merida',    // Yucatán
}
const TZ_DEFAULT = 'America/Mexico_City'

function getTzForCp(cp: string): string {
  const prefix = cp.slice(0, 2)
  return CP_PREFIX_TZ[prefix] ?? TZ_DEFAULT
}

const ZONAS_MEXICO = [
  { id: 'noroeste', name: 'Zona Noroeste', tz: 'America/Tijuana', city: 'Tijuana, Baja California' },
  { id: 'pacifico', name: 'Zona Pacífico', tz: 'America/Hermosillo', city: 'Hermosillo, Sonora' },
  { id: 'centro', name: 'Zona Centro', tz: 'America/Mexico_City', city: 'Ciudad de México' },
  { id: 'sureste', name: 'Zona Sureste', tz: 'America/Cancun', city: 'Cancún, Quintana Roo' },
] as const

const REFERENCIA_ARGENTINA = { name: 'Argentina', tz: 'America/Argentina/Buenos_Aires', city: 'Buenos Aires' }
const ESPANA_MADRID = { name: 'España (Madrid)', tz: 'Europe/Madrid', city: 'Madrid' }

function formatTime(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat('es-ES', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}

function formatDate(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat('es-ES', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(date)
}

function getGmtOffset(date: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
    }).formatToParts(date)
    const tz = parts.find((p) => p.type === 'timeZoneName')?.value ?? ''
    if (!tz) return ''
    // Normalizar "GMT-06:00" -> "GMT-6", "GMT+01:00" -> "GMT+1"
    const m = tz.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/)
    if (m) {
      const sign = m[1]
      const h = parseInt(m[2], 10)
      const min = m[3] ? parseInt(m[3], 10) : 0
      if (min === 0) return `GMT${sign}${h}`
      return `GMT${sign}${h}:${String(min).padStart(2, '0')}`
    }
    return tz
  } catch {
    return ''
  }
}

function TimeCard({
  title,
  subtitle,
  time,
  date,
  gmt,
  accent = false,
}: {
  title: string
  subtitle: string
  time: string
  date: string
  gmt?: string
  accent?: boolean
}) {
  return (
    <Card
      className={cn(
        'glass-card transition-all duration-300 hover:border-white/20',
        accent && 'border-[#FF6600]/40 bg-[#FF6600]/[0.06]'
      )}
    >
      <CardHeader className="pb-0 pt-2 px-3">
        <CardTitle className="text-xs font-semibold text-white/90 flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 text-[#FF6600]" />
          {title}
          {gmt && (
            <span className="text-[10px] font-normal text-[#FF6600]/90 ml-0.5">
              {gmt}
            </span>
          )}
        </CardTitle>
        <p className="text-[11px] text-white/50 mt-0.5">{subtitle}</p>
      </CardHeader>
      <CardContent className="pt-0 px-3 pb-2">
        <div className="text-lg md:text-xl font-bold text-white tabular-nums tracking-tight">
          {time}
        </div>
        <div className="text-[11px] text-white/50 mt-0.5">{date}</div>
      </CardContent>
    </Card>
  )
}

export function TimeZonesDashboard() {
  const [now, setNow] = useState<Date>(() => new Date())
  const [codigosSet, setCodigosSet] = useState<Set<string>>(new Set())
  const [cpBusqueda, setCpBusqueda] = useState('')

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    fetch('/api/usos-horarios/codigos-postales')
      .then((res) => res.json())
      .then((data: { codigos?: string[] }) => setCodigosSet(new Set(data.codigos ?? [])))
      .catch(() => setCodigosSet(new Set()))
  }, [])

  const cpNormalizado = useMemo(() => cpBusqueda.replace(/\D/g, '').slice(0, 5), [cpBusqueda])
  const cpValido = cpNormalizado.length === 5 && codigosSet.has(cpNormalizado)
  const tzCp = cpValido ? getTzForCp(cpNormalizado) : null

  return (
    <div className="space-y-8">
      {/* Bloque 1: México (4 zonas en fila vertical) */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-2">
          <div className="h-6 w-px bg-[#FF6600]" />
          <h2 className="label-uppercase text-white/70 text-[11px]">Zonas horarias México</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {ZONAS_MEXICO.map((zona) => (
            <TimeCard
              key={zona.id}
              title={zona.name}
              subtitle={zona.city}
              time={formatTime(now, zona.tz)}
              date={formatDate(now, zona.tz)}
              gmt={getGmtOffset(now, zona.tz)}
            />
          ))}
        </div>
      </div>

      {/* Bloque 2: Argentina y España juntas (2 tarjetas en fila) */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-2">
          <div className="h-6 w-px bg-[#FF6600]" />
          <h2 className="label-uppercase text-white/70 text-[11px]">Argentina y España</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <TimeCard
              title={REFERENCIA_ARGENTINA.name}
              subtitle={REFERENCIA_ARGENTINA.city}
              time={formatTime(now, REFERENCIA_ARGENTINA.tz)}
              date={formatDate(now, REFERENCIA_ARGENTINA.tz)}
              gmt={getGmtOffset(now, REFERENCIA_ARGENTINA.tz)}
              accent
            />
            <p className="text-[11px] text-white/50 px-1 mt-1.5">
              Hora de Buenos Aires (ART). Referencia para coordinación con Argentina.
            </p>
          </div>
          <div>
            <TimeCard
              title={ESPANA_MADRID.name}
              subtitle={ESPANA_MADRID.city}
              time={formatTime(now, ESPANA_MADRID.tz)}
              date={formatDate(now, ESPANA_MADRID.tz)}
              gmt={getGmtOffset(now, ESPANA_MADRID.tz)}
              accent
            />
            <p className="text-[11px] text-white/50 px-1 mt-1.5">
              Hora de Madrid (CET/CEST). Útil para alinear con equipo y clientes en España.
            </p>
          </div>
        </div>
      </div>

      {/* Buscador por código postal */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-2">
          <div className="h-6 w-px bg-[#FF6600]" />
          <h2 className="label-uppercase text-white/70 text-[11px]">Hora por código postal</h2>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          <div className="relative w-full sm:max-w-xs">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center justify-center w-6 h-6 text-white/40 pointer-events-none" aria-hidden>
              <Search className="h-4 w-4" />
            </span>
            <Input
              type="text"
              inputMode="numeric"
              placeholder="Ej. 03100"
              maxLength={5}
              value={cpBusqueda}
              onChange={(e) => setCpBusqueda(e.target.value.replace(/\D/g, ''))}
              className="pl-11 pr-3 h-9 text-sm bg-white/5 border-white/10 w-full"
            />
          </div>
          {cpNormalizado.length === 5 && !cpValido && (
            <span className="text-xs text-amber-400/90 shrink-0">Código no está en la lista</span>
          )}
        </div>
        {cpValido && tzCp && (
          <Card className="glass-card border-[#FF6600]/30 bg-[#FF6600]/[0.04]">
            <CardContent className="pt-3 px-3 pb-3">
              <p className="text-[11px] text-white/50 mb-2">En tiempo real para CP <strong className="text-white/80">{cpNormalizado}</strong></p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="p-2.5 rounded-lg bg-white/[0.06] border border-white/10">
                  <span className="text-white/50">Allí (CP {cpNormalizado}): </span>
                  <span className="font-bold text-white tabular-nums block mt-0.5 text-sm">
                    {formatTime(now, tzCp)}
                  </span>
                  <span className="text-[10px] text-white/40">{formatDate(now, tzCp)} · {getGmtOffset(now, tzCp)}</span>
                </div>
                <div className="p-2.5 rounded-lg bg-white/[0.06] border border-white/10">
                  <span className="text-white/50">Argentina: </span>
                  <span className="font-bold text-white tabular-nums block mt-0.5 text-sm">
                    {formatTime(now, REFERENCIA_ARGENTINA.tz)}
                  </span>
                  <span className="text-[10px] text-white/40">{formatDate(now, REFERENCIA_ARGENTINA.tz)} · {getGmtOffset(now, REFERENCIA_ARGENTINA.tz)}</span>
                </div>
                <div className="p-2.5 rounded-lg bg-white/[0.06] border border-white/10">
                  <span className="text-white/50">España (Madrid): </span>
                  <span className="font-bold text-white tabular-nums block mt-0.5 text-sm">
                    {formatTime(now, ESPANA_MADRID.tz)}
                  </span>
                  <span className="text-[10px] text-white/40">{formatDate(now, ESPANA_MADRID.tz)} · {getGmtOffset(now, ESPANA_MADRID.tz)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

