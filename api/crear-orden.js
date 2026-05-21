module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Método no permitido' });
    }

    try {
        const { cliente, items, ciudad_destino, departamento_destino, direccion_destino, orden_firebase_id } = req.body;

        if (!cliente || !items || !ciudad_destino) {
            return res.status(400).json({ message: 'Faltan datos requeridos' });
        }

        const FIREBASE_URL    = "https://pandaventa-cdc06-default-rtdb.firebaseio.com";
        const MASTERSHOP_TOKEN = process.env.MASTERSHOP_API_KEY || "laApX4jllnqGPuZ9bya748P-9o68vMDMQM5qRZSAtaKl9Q4dMM";
        const MASTERSHOP_URL   = process.env.MASTERSHOP_BASE_URL || "https://app.mastershop.com";

        const itemsDropi      = items.filter(item => item.origen === 'dropi');
        const itemsMastershop = items.filter(item => item.origen === 'mastershop');
        
        if (itemsDropi.length > 0) {
            const precioTotalDropi = itemsDropi.reduce((acc, item) => acc + (item.price * item.qty), 0);

            // Ajuste robusto del ID a número entero en caso de que lo necesite Dropi
            const payloadDropi = {
                id_transportadora: 1, // 1: Coordinadora (Por defecto)
                nombre_destinatario: cliente.nombre,
                telefono_destinatario: cliente.telefono,
                direccion_destinatario: direccion_destino,
                ciudad_destino: ciudad_destino.trim().toUpperCase(),
                departamento_destino: departamento_destino.trim().toUpperCase(),
                precio_total: precioTotalDropi, 
                observaciones: "Entregar en jornada diurna. Pedido automático desde PandaVenta.",
                productos: itemsDropi.map(item => ({
                    id: parseInt(item.id.replace(/\D/g, '')) || item.id,
                    cantidad: item.qty
                }))
            };

            const token = process.env.DROPI_TOKEN || "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwOlwvXC9hcHAuZHJvcGkuY286ODAiLCJpYXQiOjE3NzkyMTI3MTAsImV4cCI6NDkzNDg4NjMxMCwibmJmIjoxNzc5MjEyNzEwLCJqdGkiOiIyUlQ5YVY4T0V5ZkxlYjhKIiwic3ViIjo5MDM5NDAsInBydiI6Ijg3ZTBhZjFlZjlmZDE1ODEyZmRlYzk3MTUzYTE0ZTBiMDQ3NTQ2YWEiLCJhdWQiOiJXT09DT01FUkNFIiwidG9rZW5fdHlwZSI6IklOVEVHUkFUSU9OUyIsIndiX2lkIjoxLCJpbnRlZ3JhdGlvbl90eXBlIjoiV09PQ09NRVJDRSIsImludGVncmF0aW9uX3R5cGVfaWQiOjEsImlwX3VybCI6W10sImludGVncmF0aW9uX3VybCI6InBhbmRhdmVudGEuY29tIn0.I1_daYB1l5quV4xzuSlwca-_7AmSvpz7Vu8_DHa8Cjg";

            // Usamos fetch nativo en vez de axios para no requerir dependencias extra en Vercel
            const responseDropi = await fetch('https://api.dropi.co/api/orders/crearOrdenV2', { 
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payloadDropi)
            });

            if (responseDropi.ok) {
                const data = await responseDropi.json();
                return res.status(200).json({
                    status: 'success',
                    message: 'Orden procesada con éxito',
                    dropi_info: data.data || data
                });
            } else {
                const errText = await responseDropi.text();
                throw new Error(errText || 'Error desconocido en Dropi');
            }
        }

        // ====== BLOQUE MASTERSHOP ======
        if (itemsMastershop.length > 0) {
            const precioTotalMS = itemsMastershop.reduce((acc, item) => acc + (item.price * item.qty), 0);

            const payloadMS = {
                customer: {
                    name:    cliente.nombre,
                    phone:   cliente.telefono,
                    address: {
                        street:  direccion_destino,
                        city:    ciudad_destino.trim(),
                        state:   departamento_destino?.trim() || 'Cundinamarca',
                        country: 'CO'
                    }
                },
                payment_method:   'cash_on_delivery',
                amount_to_collect: precioTotalMS,
                line_items: itemsMastershop.map(item => ({
                    variant_id: item.mastershop_variant_id || item.id,
                    quantity:   item.qty
                }))
            };

            const msRes = await fetch(`${MASTERSHOP_URL}/api/v1/orders`, {
                method:  'POST',
                headers: {
                    'ms-api-key':    MASTERSHOP_TOKEN,
                    'Content-Type':  'application/json',
                    'Accept':        'application/json'
                },
                body: JSON.stringify(payloadMS)
            });

            if (msRes.ok) {
                const msData      = await msRes.json();
                const msOrder     = msData.data || msData;
                const msOrderId   = String(msOrder.id   || msOrder.order_id   || '');
                const msGuia      = String(msOrder.tracking_number || msOrder.guide_number || '');

                // Guardar ID externo y guía en la orden de Firebase para poder rastrearla con el webhook
                if (orden_firebase_id) {
                    await fetch(`${FIREBASE_URL}/orders/${orden_firebase_id}.json`, {
                        method:  'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body:    JSON.stringify({
                            mastershop_order_id: msOrderId,
                            numero_guia:         msGuia,
                            estado_envio:        'confirmado'
                        })
                    });
                }

                return res.status(200).json({
                    status:              'success',
                    message:             'Orden Mastershop creada con éxito',
                    mastershop_order_id: msOrderId,
                    numero_guia:         msGuia
                });
            } else {
                const errText = await msRes.text();
                throw new Error(`Mastershop ${msRes.status}: ${errText}`);
            }
        }

        // Si es producto propio (sin Dropi ni Mastershop)
        return res.status(200).json({
            status: 'success',
            message: 'Orden local registrada. Recuerda despachar desde tu bodega.'
        });

    } catch (error) {
        console.error("❌ Error al crear la orden:", error.message);
        return res.status(500).json({
            status: 'error',
            message: 'No se pudo procesar la orden',
            details: error.message
        });
    }
};
