import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { comprobarTamañoPeticion, leerCuerpoConTope, MAX_BYTES_WEBHOOK } from '@/lib/subidas-limite'

export async function POST(request: NextRequest) {
  try {
    /**
     * TOPE DE BYTES, ANTES DE PARSEAR NADA.
     *
     * Mismo caso y mismo motivo que app/api/webhooks/leads/route.ts: ruta sin
     * sesión ni secreto, y `request.json()` / `request.formData()` bufferizan el
     * cuerpo entero en memoria antes de que aquí se mire nada. Un megabyte es
     * mil veces lo que ocupa un formulario de contacto de verdad.
     */
    const demasiado = comprobarTamañoPeticion(request, MAX_BYTES_WEBHOOK)
    if (demasiado) return demasiado

    /**
     * Y EL TOPE QUE SÍ VE UN CUERPO TROCEADO, LEYENDO EL FLUJO. Mismo caso,
     * mismo motivo y misma limitación que app/api/webhooks/leads/route.ts: un
     * cuerpo troceado no trae Content-Length y se saltaba la comprobación de
     * arriba. Esto lee a trozos y aborta en el que cruza el megabyte, con lo
     * que la petición se rechaza con un 413 en vez de parsearse; el pico de
     * memoria del proceso NO lo evita, eso va en el proxy. Explicado entero en
     * lib/subidas-limite.ts.
     */
    const cuerpo = await leerCuerpoConTope(request, MAX_BYTES_WEBHOOK)
    if (cuerpo instanceof NextResponse) return cuerpo

    // Intentar parsear como JSON primero, si falla, intentar como form-data
    let body: any
    const contentType = request.headers.get('content-type') || ''

    try {
      if (contentType.includes('application/x-www-form-urlencoded')) {
        // Mismo resultado que `Object.fromEntries(formData.entries())` para un
        // cuerpo urlencoded, pero sobre el texto ya leído: el cuerpo solo se
        // puede consumir una vez.
        body = Object.fromEntries(new URLSearchParams(cuerpo.texto).entries())
      } else {
        // JSON por defecto, igual que antes
        body = JSON.parse(cuerpo.texto)
      }
    } catch (parseError) {
      console.error('Error parsing request body:', parseError)
      return NextResponse.json(
        { error: 'Error al parsear el cuerpo de la solicitud', details: String(parseError) },
        { status: 400 }
      )
    }
    
    // Traza SIN datos personales.
    //
    // QUÉ IMPIDE: que los datos de contacto de cada lead acaben en el log del
    // servidor. Antes esta línea era
    //
    //     console.log('Webhook received:', JSON.stringify(body, null, 2))
    //
    // y el cuerpo es el formulario de la web: nombre, email, teléfono, empresa,
    // mensaje e ingresos. O sea, la ficha completa de cada uno de los 3.978
    // leads de cold_leads y los 512 de company_prospects, en un log sin
    // caducidad ni control de acceso, que se copia entero cada vez que alguien
    // depura un despliegue.
    //
    // Lo que se necesitaba para depurar de verdad es saber si el formulario
    // trae los campos y con qué Content-Type llega, y eso se sigue viendo.
    console.log('Webhook lead recibido', {
      contentType,
      tieneNombre: !!(body.nombre || body.name),
      tieneEmail: !!body.email,
      tieneTelefono: !!(body.telefono || body.phone),
      camposRecibidos: Object.keys(body || {}).length,
    })

    // Validar campos requeridos (aceptar tanto 'nombre' como 'name', y 'telefono' como 'phone')
    const nombre = body.nombre || body.name
    const email = body.email
    const telefono = body.telefono || body.phone

    if (!nombre || !email) {
      // Sin PII, por lo mismo que la traza de arriba: aquí se registraba el
      // nombre y el email del lead en el log. Basta con saber cuál falta.
      console.error('Webhook lead rechazado: faltan campos', {
        tieneNombre: !!nombre,
        tieneEmail: !!email,
      })
      return NextResponse.json(
        { error: 'Los campos "nombre" (o "name") y "email" son requeridos' },
        { status: 400 }
      )
    }

    // Verificar que las variables de entorno estén configuradas
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      console.error('Missing Supabase environment variables')
      return NextResponse.json(
        { error: 'Error de configuración del servidor' },
        { status: 500 }
      )
    }

    // Crear cliente de Supabase público (sin autenticación para webhook)
    const supabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    // Construir mensaje con información adicional del formulario
    let mensaje = body.mensaje || ''
    const mensajeParts: string[] = []
    
    if (body.vendeEnAmazon) {
      mensajeParts.push(`Vende en Amazon: ${body.vendeEnAmazon}`)
    }
    if (body.sellingDuration) {
      mensajeParts.push(`Tiempo vendiendo: ${body.sellingDuration}`)
    }
    if (body.monthlyRevenue) {
      mensajeParts.push(`Facturación mensual: ${body.monthlyRevenue}`)
    }
    if (body.source) {
      mensajeParts.push(`Fuente: ${body.source}`)
    }
    
    if (mensajeParts.length > 0) {
      mensaje = mensajeParts.join('\n') + (mensaje ? '\n\n' + mensaje : '')
    }

    // Mapear campos del webhook a la tabla
    const leadData = {
      nombre: nombre.trim(),
      email: email.trim(),
      telefono: telefono ? telefono.trim() : null,
      empresa: body.empresa ? body.empresa.trim() : null,
      mensaje: mensaje || null,
      ingresos: body.ingresos || body.monthlyRevenue || null,
      status: 'registrado' as const // Estado inicial
    }

    // Sin PII: antes volcaba `JSON.stringify(leadData)` entero, o sea nombre,
    // email, teléfono, empresa, mensaje e ingresos del lead, al log.
    console.log('Insertando lead', {
      tieneTelefono: !!leadData.telefono,
      tieneEmpresa: !!leadData.empresa,
      tieneMensaje: !!leadData.mensaje,
    })

    // Insertar el lead en la base de datos
    const { data, error } = await supabase
      .from('web_leads')
      .insert([leadData])
      .select()
      .single()

    if (error) {
      console.error('Error inserting web lead:', {
        error: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        // `leadData` NO se registra: llevaba el nombre, el email y el teléfono
        // del lead al log. Para diagnosticar el fallo basta el error de
        // Postgres, que es lo que dice por qué no entró la fila.
      })
      return NextResponse.json(
        { 
          error: 'Error al guardar el lead', 
          details: error.message,
          code: error.code,
          hint: error.hint
        },
        { status: 500 }
      )
    }

    return NextResponse.json(
      {
        success: true,
        message: 'Lead creado exitosamente',
        data,
      },
      { status: 200 }
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
      message: 'Webhook endpoint para web leads',
      method: 'POST',
      required_fields: ['nombre (o name)', 'email'],
      optional_fields: [
        'telefono (o phone)',
        'empresa',
        'mensaje',
        'ingresos (o monthlyRevenue)',
        'vendeEnAmazon',
        'sellingDuration',
        'source',
        'timestamp'
      ],
      example: {
        nombre: 'Pepe',
        email: 'pepe@example.com',
        telefono: '678112754',
        vendeEnAmazon: 'Sí',
        sellingDuration: '0-1 año',
        monthlyRevenue: '0-5k',
        source: 'Hero Form'
      }
    },
    { status: 200 }
  )
}

