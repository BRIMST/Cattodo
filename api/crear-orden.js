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
        const { cliente, items, ciudad_destino, departamento_destino, direccion_destino } = req.body;

        if (!cliente || !items || !ciudad_destino) {
            return res.status(400).json({ message: 'Faltan datos requeridos' });
        }

        const itemsDropi = items.filter(item => item.origen === 'dropi');
        
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

            const token = process.env.DROPI_TOKEN || "TU_TOKEN_AQUÍ";

            // Usamos fetch nativo en vez de axios para no requerir dependencias extra en Vercel
            const responseDropi = await fetch('https://api.dropi.co/api/orders/crearOrdenV2', { 
                method: 'POST',
                headers: {
                    'dropi-integracion-key': token,
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

        // Si es producto propio
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
