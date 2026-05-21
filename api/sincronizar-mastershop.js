/**
 * GET/POST /api/sincronizar-mastershop
 * Sincroniza en lote el stock y precio de todos los productos con origen: 'mastershop'.
 * Se ejecuta automáticamente vía Cron Job de Vercel (ver vercel.json).
 */
module.exports = async function handler(req, res) {
    if (req.method !== 'POST' && req.method !== 'GET') {
        return res.status(405).json({ message: 'Método no permitido' });
    }

    try {
        const MASTERSHOP_TOKEN = process.env.MASTERSHOP_API_KEY || "laApX4jllnqGPuZ9bya748P-9o68vMDMQM5qRZSAtaKl9Q4dMM";
        const MASTERSHOP_URL   = process.env.MASTERSHOP_BASE_URL || "https://app.mastershop.com";
        const FIREBASE_URL     = "https://pandaventa-cdc06-default-rtdb.firebaseio.com";

        // 1. Leer configuración global de margen
        const settingsRes = await fetch(`${FIREBASE_URL}/settings.json`);
        const settings    = await settingsRes.json() || {};
        const MARGEN       = settings.margenGlobal || 0.30;
        const COSTOS_FIJOS = settings.costosFijos  || 16000;

        // 2. Leer TODOS los productos de Firebase
        const productsRes = await fetch(`${FIREBASE_URL}/products.json`);
        const productsObj = await productsRes.json();

        if (!productsObj) {
            return res.status(200).json({ status: 'success', message: 'No hay productos para sincronizar.' });
        }

        // 3. Filtrar solo los de Mastershop
        const mastershopKeys = Object.keys(productsObj).filter(
            key => productsObj[key].origen === 'mastershop' && productsObj[key].mastershop_variant_id
        );

        let actualizados = 0;
        let errores = 0;

        // 4. Procesar en lotes de 5 para no saturar la API
        const BATCH_SIZE = 5;
        for (let i = 0; i < mastershopKeys.length; i += BATCH_SIZE) {
            const lote = mastershopKeys.slice(i, i + BATCH_SIZE);

            await Promise.all(lote.map(async (key) => {
                const prod = productsObj[key];
                const variantId = prod.mastershop_variant_id;

                try {
                    const msRes = await fetch(`${MASTERSHOP_URL}/api/v1/variants/${variantId}`, {
                        headers: {
                            'ms-api-key': MASTERSHOP_TOKEN,
                            'Accept': 'application/json'
                        }
                    });

                    if (msRes.ok) {
                        const data    = await msRes.json();
                        const variant = data.data || data;

                        const nuevoCosto = parseFloat(variant.cost_price || variant.price || 0);
                        const nuevoStock = variant.stock_quantity ?? variant.stock ?? 0;

                        // Recalcular PVP con margen dinámico
                        let precioBase      = (nuevoCosto + COSTOS_FIJOS) / (1 - MARGEN);
                        let precioRedondeado = Math.ceil(precioBase / 1000) * 1000;
                        let nuevoPVP        = precioRedondeado - 100;

                        // Determinar si se activa o desactiva según stock
                        const activo = nuevoStock > 0;

                        await fetch(`${FIREBASE_URL}/products/${key}.json`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                price:     nuevoPVP,
                                cost:      nuevoCosto,
                                stock:     nuevoStock,
                                active:    activo,
                                last_sync: new Date().toISOString()
                            })
                        });

                        actualizados++;
                    } else {
                        // Variante ya no existe en Mastershop: ocultar producto
                        await fetch(`${FIREBASE_URL}/products/${key}.json`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ stock: 0, active: false })
                        });
                        errores++;
                    }
                } catch (errItem) {
                    console.error(`Error sincronizando Mastershop variante ${variantId}:`, errItem.message);
                    errores++;
                }
            }));
        }

        return res.status(200).json({
            status:  'success',
            message: `Sincronización Mastershop completada. Actualizados: ${actualizados}, Errores: ${errores}.`,
            margen_aplicado: `${MARGEN * 100}%`
        });

    } catch (error) {
        console.error("Error global en sincronizar-mastershop:", error.message);
        return res.status(500).json({ status: 'error', message: error.message });
    }
};
