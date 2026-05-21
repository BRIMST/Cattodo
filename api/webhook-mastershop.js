/**
 * POST /api/webhook-mastershop
 * Recibe notificaciones automáticas de Mastershop sobre cambios de estado de guías.
 * 
 * REGISTRAR ESTE WEBHOOK EN MASTERSHOP:
 * URL: https://pandaventa.com/api/webhook-mastershop
 * Eventos: order.shipped, order.delivered, order.returned, order.cancelled
 */
module.exports = async function handler(req, res) {
    // Los webhooks siempre usan POST
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Método no permitido' });
    }

    try {
        const FIREBASE_URL = "https://pandaventa-cdc06-default-rtdb.firebaseio.com";
        const payload = req.body;

        console.log("Webhook Mastershop recibido:", JSON.stringify(payload));

        // Extraer datos del evento de Mastershop
        const { event, order_id, tracking_number, status } = payload;

        if (!order_id) {
            return res.status(400).json({ message: 'Payload inválido: falta order_id' });
        }

        // ====== MAPEO DE ESTADOS LOGÍSTICOS ======
        // Traduce los estados de Mastershop al campo 'estado_envio' interno de PandaVenta.
        // No interfiere con el campo 'status' (estado de pago/completado) de la orden.
        const MAPA_ESTADOS = {
            // Estados de Mastershop       => estado_envio interno en PandaVenta
            'pending':                        'pendiente',
            'confirmed':                      'confirmado',
            'processing':                     'en_preparacion',
            'shipped':                        'en_transito',
            'in_transit':                     'en_transito',
            'out_for_delivery':               'en_reparto',
            'delivered':                      'entregado',
            'returned':                       'devuelto',
            'cancelled':                      'cancelado',
            'failed_delivery':                'novedad',
            'novedad':                        'novedad'
        };

        // Normalizar el estado que manda Mastershop
        const estadoMastershop = (status || event || '').toLowerCase().replace('order.', '');
        const estadoInterno    = MAPA_ESTADOS[estadoMastershop] || 'desconocido';

        // Buscar la orden interna por su campo mastershop_order_id
        const ordersRes = await fetch(`${FIREBASE_URL}/orders.json`);
        if (!ordersRes.ok) {
            throw new Error('No se pudo leer las órdenes de Firebase');
        }

        const ordersObj = await ordersRes.json();

        if (!ordersObj) {
            // Mastershop espera un 200 para no reenviar el webhook en bucle
            return res.status(200).json({ message: 'No hay órdenes registradas aún.' });
        }

        // Encontrar la orden interna que coincide con el order_id de Mastershop
        const localKey = Object.keys(ordersObj).find(
            key => ordersObj[key].mastershop_order_id === String(order_id)
        );

        if (!localKey) {
            console.warn(`Webhook: No se encontró orden local para Mastershop order_id: ${order_id}`);
            return res.status(200).json({ message: 'Orden no encontrada localmente, ignorado.' });
        }

        // Actualizar SOLO el campo de estado logístico (sin tocar estado de pago)
        const actualizacion = {
            estado_envio:       estadoInterno,
            numero_guia:        tracking_number || ordersObj[localKey].numero_guia || null,
            ultimo_evento:      estadoMastershop,
            fecha_ultimo_evento: new Date().toISOString()
        };

        // Si fue entregado, marcar también la orden como completada
        if (estadoInterno === 'entregado') {
            actualizacion.status      = 'completed';
            actualizacion.completedAt = Date.now();
        }

        // Si fue devuelto o novedad, alertar pero NO cambiar estado de pago
        if (estadoInterno === 'devuelto' || estadoInterno === 'novedad') {
            actualizacion.requiere_atencion = true;
        }

        await fetch(`${FIREBASE_URL}/orders/${localKey}.json`, {
            method:  'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(actualizacion)
        });

        console.log(`Orden ${localKey} actualizada: estado_envio = '${estadoInterno}'`);

        // Responder 200 OK a Mastershop para confirmar recepción del webhook
        return res.status(200).json({
            status:        'success',
            orden_local:   localKey,
            estado_aplicado: estadoInterno
        });

    } catch (error) {
        console.error("Error en webhook-mastershop:", error.message);
        // Importante: devolver 200 igualmente para que Mastershop no reintente en bucle
        return res.status(200).json({
            status:  'error',
            message: error.message
        });
    }
};
