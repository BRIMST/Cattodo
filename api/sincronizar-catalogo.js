module.exports = async function handler(req, res) {
    if (req.method !== 'POST' && req.method !== 'GET') {
        return res.status(405).json({ message: 'Método no permitido' });
    }

    try {
        // En tu app.js usas esta base de datos Realtime Database (no Firestore)
        const FIREBASE_URL = "https://todo-en-uno-cf51e-default-rtdb.firebaseio.com";
        const DROPI_TOKEN = process.env.DROPI_TOKEN || "TU_TOKEN_AQUÍ";

        // 1. Obtener la configuración global de tu base de datos
        const settingsRes = await fetch(`${FIREBASE_URL}/settings.json`);
        const settings = await settingsRes.json() || {};
        
        // Usamos los valores de Firebase o los predeterminados de tu regla de negocio
        const MARGEN = settings.margenGlobal || 0.30; 
        const COSTOS_FIJOS = settings.costosFijos || 16000;

        // 2. Obtener todos los productos
        const productsRes = await fetch(`${FIREBASE_URL}/products.json`);
        const productsObj = await productsRes.json();

        if (!productsObj) {
            return res.status(200).json({ status: 'success', message: 'No hay productos para sincronizar.' });
        }

        let actualizados = 0;

        // 3. Recorrer los productos y sincronizar solo los de Dropi
        for (const key of Object.keys(productsObj)) {
            const prod = productsObj[key];
            const dropiId = prod.dropiId || prod.ref; // Usamos dropiId que acabamos de implementar, o 'ref' si es antiguo
            
            if (prod.origen === 'dropi' && dropiId) {
                try {
                    // Consultar el estado real actual en Dropi Colombia
                    const responseDropi = await fetch(`https://dropi.co/api/v1/product/${dropiId}`, {
                        headers: { 'Authorization': `Bearer ${DROPI_TOKEN}` }
                    });

                    if (responseDropi.ok) {
                        const dataDropi = await responseDropi.json();
                        const infoDropi = dataDropi.data || dataDropi;

                        // Obtenemos el costo de proveedor. Dropi puede retornarlo bajo "cost", "wholesale_price", etc.
                        const nuevoCostoProveedor = infoDropi.cost || infoDropi.wholesale_price || infoDropi.precio_proveedor || infoDropi.price || 0;
                        const nuevoStock = infoDropi.stock || infoDropi.quantity || 0;

                        // APLICAR FÓRMULA FINANCIERA DINÁMICA
                        let precioBase = (nuevoCostoProveedor + COSTOS_FIJOS) / (1 - MARGEN);
                        // Redondear hacia arriba al siguiente mil (Ej: 65120 -> 66000)
                        let precioRedondeado = Math.ceil(precioBase / 1000) * 1000;
                        let nuevoPVP = precioRedondeado - 100; // Efecto psicológico: $65.900

                        // 4. Guardar los datos frescos directamente mediante parche (PATCH) en Firebase RTDB
                        await fetch(`${FIREBASE_URL}/products/${key}.json`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                price: nuevoPVP,
                                stock: nuevoStock,
                                cost: nuevoCostoProveedor, // Actualizamos tu "Costo / Utilidad" interno
                                last_sync: new Date().toISOString()
                            })
                        });

                        actualizados++;
                    } else {
                        // Si el producto ya no existe en Dropi (Error 404), ocultar o stock 0
                        await fetch(`${FIREBASE_URL}/products/${key}.json`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ stock: 0, active: false })
                        });
                    }
                } catch (errProduct) {
                    console.error(`❌ Error sincronizando ítem Dropi ${dropiId}:`, errProduct.message);
                }
            }
        }

        return res.status(200).json({
            status: 'success',
            message: `Sincronización exitosa. Se actualizaron ${actualizados} productos de Dropi con margen del ${MARGEN * 100}%.`
        });

    } catch (error) {
        console.error("❌ Error global en sincronizador:", error.message);
        return res.status(500).json({ status: 'error', message: error.message });
    }
};
