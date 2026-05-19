module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { id } = req.query;

    if (!id) {
        return res.status(400).json({ message: 'ID de producto requerido' });
    }

    try {
        const token = process.env.DROPI_TOKEN || "TU_TOKEN_AQUÍ";
        const FIREBASE_URL = "https://todo-en-uno-cf51e-default-rtdb.firebaseio.com";

        // 1. Obtener la configuración global de tu base de datos para el cálculo híbrido
        let MARGEN = 0.30;
        let COSTOS_FIJOS = 16000;
        try {
            const settingsRes = await fetch(`${FIREBASE_URL}/settings.json`);
            if (settingsRes.ok) {
                const settings = await settingsRes.json() || {};
                if (settings.margenGlobal) MARGEN = settings.margenGlobal;
                if (settings.costosFijos) COSTOS_FIJOS = settings.costosFijos;
            }
        } catch(e) { console.warn("Usando margen por defecto, no se pudo conectar a Firebase."); }

        // 2. Llamada a la API de Dropi mediante POST según la nueva directiva
        // Usamos api.dropi.co porque dropi.co es el WordPress
        const dropiResponse = await fetch(`https://api.dropi.co/api/products/buscarProductosV2`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ id_producto: parseInt(id) })
        });

        if (!dropiResponse.ok) {
            const text = await dropiResponse.text();
            throw new Error(`Error HTTP: ${dropiResponse.status} - ${text}`);
        }

        const data = await dropiResponse.json();

        // 3. Validación de la Respuesta
        // Dropi suele responder con un array en data.data o un objeto
        const productsArray = data.data || data;
        let product = null;

        if (Array.isArray(productsArray) && productsArray.length > 0) {
            product = productsArray[0];
        } else if (typeof productsArray === 'object' && productsArray !== null && productsArray.id) {
            product = productsArray;
        }

        if (!product) {
            return res.status(404).json({
                status: 'error',
                message: 'Producto no encontrado en Dropi (Array vacío).'
            });
        }

        const costoProveedor = product.precio_proveedor || product.cost || product.wholesale_price || 0;

        // 4. Cálculo Financiero Híbrido (Margen y Redondeo)
        let precioBase = (costoProveedor + COSTOS_FIJOS) / (1 - MARGEN);
        let precioRedondeado = Math.ceil(precioBase / 1000) * 1000;
        let nuevoPVP = precioRedondeado - 100; // Efecto psicológico: $65.900

        // 5. Retornamos los datos al Frontend para la Revisión UI
        // En lugar de guardar directo, llenamos el modal para que lo apruebes
        return res.status(200).json({
            status: 'success',
            producto: {
                id: product.id || id,
                origen: 'dropi', 
                nombre: product.nombre || product.name || 'Producto Importado',
                precio: nuevoPVP, // Enviamos el precio ya calculado matemáticamente
                precio_original: product.precio_sugerido || product.suggested_price || null,
                costo: costoProveedor,
                stock: product.stock || product.quantity || 0,
                descripcion: product.descripcion || product.description || '',
                imagen: (product.imagenes && product.imagenes[0] && product.imagenes[0].url) || product.image_url || ''
            }
        });

    } catch (error) {
        console.error("Detalle técnico del error:", error.message);
        return res.status(500).json({
            status: 'error',
            message: 'No se pudo importar el producto de Dropi',
            details: error.message
        });
    }
};
