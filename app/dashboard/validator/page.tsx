'use client'

import { useRouter } from 'next/navigation'
import { Calculator, TrendingUp, BarChart3, Brain } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function ValidatorPage() {
  const router = useRouter()

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="heading-medium text-white mb-2">Validador de Productos Amazon FBA</h1>
        <p className="text-white/50">
          Digitaliza y automatiza el cálculo de rentabilidad de productos usando datos reales de Helium 10 y análisis de IA
        </p>
      </div>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Calculator className="h-6 w-6 text-[#FF6600]" />
            ¿Cómo funciona?
          </CardTitle>
          <CardDescription className="text-white/60">
            Herramienta completa de validación de productos para Amazon FBA
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-start gap-3 p-4 rounded-lg bg-white/5">
              <TrendingUp className="h-5 w-5 text-[#FF6600] mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="font-semibold text-white mb-1">Análisis Financiero</h3>
                <p className="text-sm text-white/70">
                  Calcula automáticamente ROI, margen, fees de Amazon y rentabilidad potencial
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-4 rounded-lg bg-white/5">
              <BarChart3 className="h-5 w-5 text-[#FF6600] mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="font-semibold text-white mb-1">Datos de Mercado</h3>
                <p className="text-sm text-white/70">
                  Analiza competencia, precios promedio y velocidad de ventas del TOP 10
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-4 rounded-lg bg-white/5">
              <Brain className="h-5 w-5 text-[#FF6600] mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="font-semibold text-white mb-1">Análisis IA</h3>
                <p className="text-sm text-white/70">
                  GPT-4o evalúa rentabilidad, competencia y da un veredicto GO/NO GO
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-4 rounded-lg bg-white/5">
              <Calculator className="h-5 w-5 text-[#FF6600] mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="font-semibold text-white mb-1">Visualización</h3>
                <p className="text-sm text-white/70">
                  Dashboard completo con gráficos, métricas y tabla de competidores
                </p>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-white/10">
            <Button
              onClick={() => router.push('/dashboard/validator/new')}
              className="w-full"
            >
              Comenzar Nueva Validación
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}


