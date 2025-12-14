'use client'

import { cn } from '@/lib/utils'
import { Calculator, Brain, AlertCircle, TrendingUp, TrendingDown, XCircle } from 'lucide-react'

interface ChangeReasonPanelProps {
  changes: Array<{
    'Texto de palabra clave': string
    'Puja Original'?: number
    'Puja': number
    'Operación': string
    'Decision Maker'?: 'ALGORITHM' | 'AI'
    'AI Reasoning'?: string
    'Entidad'?: string
    'Gasto'?: number
    'ACOS'?: number
    'CPC'?: number
    'ROAS'?: number
    'CTR'?: number
    'Clics'?: number
    'Ventas'?: number
    'Pedidos'?: number
  }>
  selectedIndex: number | null
  onSelectChange: (index: number | null) => void
}

export function ChangeReasonPanel({ changes, selectedIndex, onSelectChange }: ChangeReasonPanelProps) {
  if (selectedIndex === null || selectedIndex >= changes.length) {
    return (
      <div className="glass-card p-6 rounded-xl h-full flex items-center justify-center">
        <div className="text-center text-white/50">
          <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p className="text-sm">Selecciona un cambio para ver el detalle</p>
        </div>
      </div>
    )
  }

  const change = changes[selectedIndex]
  const originalBid = change['Puja Original'] || 0
  const newBid = change['Puja']
  const changePercent = originalBid > 0 
    ? ((newBid - originalBid) / originalBid) * 100 
    : 0
  const isNegative = change['Entidad'] === 'Palabra clave negativa'
  const decisionMaker = change['Decision Maker'] || 'ALGORITHM'

  // Extraer razón del cambio basándose en la operación y datos
  let reason = ''
  let reasonIcon = <Calculator className="h-5 w-5" />
  let reasonColor = 'text-blue-400'

  if (change['Operación'] === 'UPDATE') {
    if (changePercent < -50) {
      reason = `Bleeder detectado: Esta keyword tiene muchos clics pero 0 ventas. Se baja la puja de ${originalBid.toFixed(2)}€ a ${newBid.toFixed(2)}€ para reducir el gasto sin conversión.`
      reasonIcon = <TrendingDown className="h-5 w-5" />
      reasonColor = 'text-red-400'
    } else if (changePercent > 0) {
      reason = `Winner detectado: Esta keyword tiene un ACOS muy bajo (<10%). Se sube la puja de ${originalBid.toFixed(2)}€ a ${newBid.toFixed(2)}€ para escalar el rendimiento.`
      reasonIcon = <TrendingUp className="h-5 w-5" />
      reasonColor = 'text-green-400'
    } else if (changePercent < 0) {
      reason = `Corrección de ACOS: Esta keyword tiene un ACOS alto (>35%). Se baja la puja de ${originalBid.toFixed(2)}€ a ${newBid.toFixed(2)}€ para mejorar la rentabilidad.`
      reasonIcon = <TrendingDown className="h-5 w-5" />
      reasonColor = 'text-yellow-400'
    }
  } else if (change['Operación'] === 'CREATE' && !isNegative) {
    reason = `Harvesting: Este término ha generado pedidos con buen ACOS en una campaña automática. Se crea como keyword exacta en la campaña manual para controlar mejor el rendimiento.`
    reasonIcon = <TrendingUp className="h-5 w-5" />
    reasonColor = 'text-green-400'
  } else if (isNegative) {
    reason = `Negativa: Este término no está convirtiendo (0 pedidos con gasto/clics). Se añade como negativa para evitar futuros gastos en este término.`
    reasonIcon = <XCircle className="h-5 w-5" />
    reasonColor = 'text-red-400'
  }

  return (
    <div className="glass-card p-6 rounded-xl h-full flex flex-col">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-white mb-2">Detalle del Cambio</h3>
        <div className="flex items-center gap-2 mb-4">
          <span className={cn(
            "px-2 py-1 rounded-full text-xs font-semibold border",
            change['Operación'] === 'UPDATE' 
              ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
              : change['Operación'] === 'CREATE' && !isNegative
              ? "bg-green-500/20 text-green-400 border-green-500/30"
              : "bg-red-500/20 text-red-400 border-red-500/30"
          )}>
            {change['Operación']}
            {isNegative && ' (Negativa)'}
          </span>
          {decisionMaker === 'AI' ? (
            <div className="flex items-center gap-1 text-purple-400">
              <Brain className="h-4 w-4" />
              <span className="text-xs font-semibold">IA</span>
            </div>
          ) : (
            <div className="flex items-center gap-1 text-blue-400">
              <Calculator className="h-4 w-4" />
              <span className="text-xs font-semibold">Algoritmo</span>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4 flex-1">
        <div>
          <p className="text-sm text-white/60 mb-1">Keyword</p>
          <p className="text-white font-medium">{change['Texto de palabra clave']}</p>
        </div>

        {originalBid > 0 && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-white/60 mb-1">Puja Original</p>
              <p className="text-white font-semibold">{originalBid.toFixed(2)}€</p>
            </div>
            <div>
              <p className="text-sm text-white/60 mb-1">Puja Nueva</p>
              <p className={cn(
                "font-semibold",
                changePercent > 0 ? "text-green-400" : changePercent < 0 ? "text-red-400" : "text-white"
              )}>
                {newBid.toFixed(2)}€
                {changePercent !== 0 && (
                  <span className="ml-2 text-xs">
                    ({changePercent > 0 ? '+' : ''}{changePercent.toFixed(1)}%)
                  </span>
                )}
              </p>
            </div>
          </div>
        )}

        {/* Métricas adicionales */}
        {(change['Gasto'] || change['ACOS'] || change['CPC'] || change['ROAS'] || change['CTR'] || change['Clics'] || change['Ventas'] || change['Pedidos']) && (
          <div className="pt-4 border-t border-white/10">
            <p className="text-sm font-semibold text-white mb-3">Métricas del Término</p>
            <div className="grid grid-cols-2 gap-3">
              {change['Gasto'] !== undefined && change['Gasto'] > 0 && (
                <div>
                  <p className="text-xs text-white/60 mb-1">Gasto</p>
                  <p className="text-white font-semibold">{change['Gasto'].toFixed(2)}€</p>
                </div>
              )}
              {change['ACOS'] !== undefined && change['ACOS'] > 0 && (
                <div>
                  <p className="text-xs text-white/60 mb-1">ACOS</p>
                  <p className={cn(
                    "font-semibold",
                    change['ACOS'] > 35 
                      ? "text-red-400" 
                      : change['ACOS'] < 10
                      ? "text-green-400"
                      : "text-yellow-400"
                  )}>
                    {change['ACOS'].toFixed(2)}%
                  </p>
                </div>
              )}
              {change['CPC'] !== undefined && change['CPC'] > 0 && (
                <div>
                  <p className="text-xs text-white/60 mb-1">CPC</p>
                  <p className="text-white font-semibold">{change['CPC'].toFixed(2)}€</p>
                </div>
              )}
              {change['ROAS'] !== undefined && change['ROAS'] > 0 && (
                <div>
                  <p className="text-xs text-white/60 mb-1">ROAS</p>
                  <p className={cn(
                    "font-semibold",
                    change['ROAS'] > 3 ? "text-green-400" : change['ROAS'] > 1 ? "text-yellow-400" : "text-red-400"
                  )}>
                    {change['ROAS'].toFixed(2)}x
                  </p>
                </div>
              )}
              {change['CTR'] !== undefined && change['CTR'] > 0 && (
                <div>
                  <p className="text-xs text-white/60 mb-1">CTR</p>
                  <p className="text-white font-semibold">{change['CTR'].toFixed(2)}%</p>
                </div>
              )}
              {change['Clics'] !== undefined && change['Clics'] > 0 && (
                <div>
                  <p className="text-xs text-white/60 mb-1">Clics</p>
                  <p className="text-white font-semibold">{change['Clics']}</p>
                </div>
              )}
              {change['Ventas'] !== undefined && change['Ventas'] > 0 && (
                <div>
                  <p className="text-xs text-white/60 mb-1">Ventas</p>
                  <p className="text-green-400 font-semibold">{change['Ventas'].toFixed(2)}€</p>
                </div>
              )}
              {change['Pedidos'] !== undefined && change['Pedidos'] > 0 && (
                <div>
                  <p className="text-xs text-white/60 mb-1">Pedidos</p>
                  <p className="text-green-400 font-semibold">{change['Pedidos']}</p>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="pt-4 border-t border-white/10">
          <div className="flex items-start gap-3">
            <div className={cn("mt-0.5", reasonColor)}>
              {reasonIcon}
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-white mb-2">Razón del Cambio</p>
              <p className="text-sm text-white/80 leading-relaxed">{reason}</p>
            </div>
          </div>
        </div>

        {change['AI Reasoning'] && (
          <div className="pt-4 border-t border-white/10">
            <div className="flex items-start gap-3">
              <Brain className="h-5 w-5 text-purple-400 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-purple-400 mb-2">Análisis de IA</p>
                <p className="text-sm text-white/80 leading-relaxed italic">
                  "{change['AI Reasoning']}"
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

