'use client'

import { PPCWeeklySnapshot } from '@/lib/types/ppc'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TrendingUp } from 'lucide-react'

interface TopProductsTableProps {
  snapshot: PPCWeeklySnapshot | null
  currency: string
}

export function TopProductsTable({ snapshot, currency }: TopProductsTableProps) {
  if (!snapshot || !snapshot.top_products || !Array.isArray(snapshot.top_products) || snapshot.top_products.length === 0) {
    return (
      <div className="glass-card p-6 rounded-xl">
        <h3 className="text-lg font-semibold text-white mb-4">Top Productos</h3>
        <p className="text-white/60 text-center py-8">No hay datos de productos disponibles</p>
      </div>
    )
  }

  // Ordenar productos por ventas (o el campo relevante)
  const sortedProducts = [...snapshot.top_products]
    .sort((a: any, b: any) => {
      const salesA = parseFloat(String(a.sales || a.ventas || a.revenue || 0))
      const salesB = parseFloat(String(b.sales || b.ventas || b.revenue || 0))
      return salesB - salesA
    })
    .slice(0, 5)

  return (
    <div className="glass-card p-6 rounded-xl">
      <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
        <TrendingUp className="h-5 w-5 text-[#FF6600]" />
        Top 5 Productos (Última Semana)
      </h3>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-white/10">
              <TableHead className="text-white">#</TableHead>
              <TableHead className="text-white">Producto</TableHead>
              <TableHead className="text-white text-right">Ventas</TableHead>
              <TableHead className="text-white text-right">ACOS</TableHead>
              <TableHead className="text-white text-right">Gasto</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedProducts.map((product: any, index: number) => {
              const productName = product.name || product.product || product.asin || 'Producto desconocido'
              const sales = parseFloat(String(product.sales || product.ventas || product.revenue || 0))
              const acos = parseFloat(String(product.acos || product.ACOS || 0))
              const spend = parseFloat(String(product.spend || product.gasto || product.cost || 0))

              return (
                <TableRow key={index} className="border-white/10">
                  <TableCell className="text-white/70 font-semibold">
                    {index + 1}
                  </TableCell>
                  <TableCell className="text-white font-medium">
                    {productName}
                  </TableCell>
                  <TableCell className="text-white text-right">
                    {sales.toLocaleString('es-ES', {
                      style: 'currency',
                      currency: currency,
                    })}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={cn(
                      "font-semibold",
                      acos < 20 ? "text-green-400" : acos < 30 ? "text-yellow-400" : "text-red-400"
                    )}>
                      {acos.toFixed(2)}%
                    </span>
                  </TableCell>
                  <TableCell className="text-white/70 text-right">
                    {spend.toLocaleString('es-ES', {
                      style: 'currency',
                      currency: currency,
                    })}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function cn(...classes: (string | undefined)[]): string {
  return classes.filter(Boolean).join(' ')
}

