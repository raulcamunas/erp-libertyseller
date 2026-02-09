'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Clock } from 'lucide-react'
import { cn } from '@/lib/utils'

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

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

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

      {/* Comparativa: Madrid, Argentina, diferencia */}
      <Card className="glass-card border-white/10">
        <CardHeader className="pb-1 pt-3 px-3">
          <CardTitle className="text-xs font-semibold text-white/90">
            Comparativa en este momento
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 px-3 pb-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="p-2.5 rounded-lg bg-white/[0.04] border border-white/10">
              <span className="text-white/50">En Madrid: </span>
              <span className="font-bold text-white tabular-nums">
                {formatTime(now, 'Europe/Madrid')}
              </span>
            </div>
            <div className="p-2.5 rounded-lg bg-white/[0.04] border border-white/10">
              <span className="text-white/50">En Argentina: </span>
              <span className="font-bold text-white tabular-nums">
                {formatTime(now, 'America/Argentina/Buenos_Aires')}
              </span>
            </div>
            <div className="p-2.5 rounded-lg bg-[#FF6600]/10 border border-[#FF6600]/20">
              <span className="text-white/50">Diferencia: </span>
              <span className="font-bold text-[#FF6600]">
                {getOffsetLabel('Europe/Madrid', 'America/Argentina/Buenos_Aires', now)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function getOffsetLabel(tzA: string, tzB: string, date: Date): string {
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    })
      .formatToParts(date)
      .reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {} as Record<string, string>)
  const a = fmt(tzA)
  const b = fmt(tzB)
  const minA = parseInt(a.hour ?? '0', 10) * 60 + parseInt(a.minute ?? '0', 10)
  const minB = parseInt(b.hour ?? '0', 10) * 60 + parseInt(b.minute ?? '0', 10)
  let diff = minA - minB
  if (diff > 12 * 60) diff -= 24 * 60
  if (diff < -12 * 60) diff += 24 * 60
  const diffHours = Math.round(diff / 60)
  if (diffHours === 0) return 'Misma hora'
  if (diffHours > 0) return `Madrid va ${diffHours} h por delante`
  return `Argentina va ${Math.abs(diffHours)} h por delante`
}
