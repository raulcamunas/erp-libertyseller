import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { LeadFormData } from '@/lib/types/leads'

export async function POST(request: NextRequest) {
  try {
    // Verificar que el request tenga el formato correcto
    const body = await request.json()

    // Validar campos requeridos
    if (!body.name) {
      return NextResponse.json(
        { error: 'El campo "name" es requerido' },
        { status: 400 }
      )
    }

    // Preparar los datos del lead
    const leadData: LeadFormData = {
      name: body.name,
      phone: body.phone || null,
      email: body.email || null,
      revenue_range: body.revenue_range || null,
      is_amazon_seller: body.is_amazon_seller || false,
      status: body.status || 'nuevo',
      notes: body.notes || null,
    }

    // Crear cliente de Supabase
    const supabase = await createClient()

    // Insertar el lead en la base de datos
    const { data, error } = await supabase
      .from('leads')
      .insert([leadData])
      .select()
      .single()

    if (error) {
      console.error('Error inserting lead:', error)
      return NextResponse.json(
        { error: 'Error al guardar el lead', details: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json(
      {
        success: true,
        message: 'Lead creado exitosamente',
        data,
      },
      { status: 201 }
    )
  } catch (error: any) {
    console.error('Error processing webhook:', error)
    return NextResponse.json(
      { error: 'Error al procesar la solicitud', details: error.message },
      { status: 500 }
    )
  }
}

// Método GET para verificar que el endpoint funciona
export async function GET() {
  return NextResponse.json(
    {
      message: 'Webhook endpoint para leads',
      method: 'POST',
      required_fields: ['name'],
      optional_fields: ['phone', 'email', 'revenue_range', 'is_amazon_seller', 'status', 'notes'],
    },
    { status: 200 }
  )
}

