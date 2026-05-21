/**
 * GET /api/importar-mastershop?id={mastershop_variant_id}
 * Importa un producto desde Mastershop al panel de administración.
 * El ID que debes buscar es el "variant_id" del producto en el catálogo de Mastershop.
 */
module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const { id } = req.query;
    if (!id) return res.status(400).json({ message: 'ID de variante de Mastershop requerido' });

    try {
        const MASTERSHOP_TOKEN = process.env.MASTERSHOP_API_KEY || "laApX4jllnqGPuZ9bya748P-9o68vMDMQM5qRZSAtaKl9Q4dMM";
        const MASTERSHOP_URL  = process.env.MASTERSHOP_BASE_URL || "https://app.mastershop.com";
        const FIREBASE_URL    = "https://pandaventa-cdc06-default-rtdb.firebaseio.com";

        // 1. Leer margen global desde Firebase
        let MARGEN = 0.30;
        let COSTOS_FIJOS = 16000;
        try {
            const settingsRes = await fetch(`${FIREBASE_URL}/settings.json`);
            if (settingsRes.ok) {
                const settings = await settingsRes.json() || {};
                if (settings.margenGlobal) MARGEN = settings.margenGlobal;
                if (settings.costosFijos)  COSTOS_FIJOS = settings.costosFijos;
            }
        } catch(e) { console.warn("Usando margen por defecto."); }

        // 2. Consultar el producto en Mastershop
        const msRes = await fetch(`${MASTERSHOP_URL}/api/v1/variants/${id}`, {
            method: 'GET',
            headers: {
                'ms-api-key': MASTERSHOP_TOKEN,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });

        if (!msRes.ok) {
            const text = await msRes.text();
            return res.status(200).json({
                status: 'error',
                message: `Mastershop respondió: ${msRes.status} - ${text}`
            });
        }

        const data = await msRes.json();
        // Mastershop puede encapsular en data.data o mandar el objeto directo
        const variant = data.data || data;

        if (!variant || !variant.id) {
            return res.status(200).json({
                status: 'error',
                message: 'Variante no encontrada en Mastershop.'
            });
        }

        const costoProveedor = parseFloat(variant.cost_price || variant.price || 0);

        // 3. Aplicar fórmula financiera con redondeo psicológico
        let precioBase      = (costoProveedor + COSTOS_FIJOS) / (1 - MARGEN);
        let precioRedondeado = Math.ceil(precioBase / 1000) * 1000;
        let nuevoPVP        = precioRedondeado - 100;

        // 4. Devolver datos al frontend para revisión (igual que con Dropi)
        return res.status(200).json({
            status: 'success',
            producto: {
                origen: 'mastershop',
                mastershop_variant_id: String(variant.id),
                nombre:      variant.name || variant.title || 'Producto Mastershop',
                precio:      nuevoPVP,
                costo:       costoProveedor,
                stock:       variant.stock_quantity ?? variant.stock ?? 0,
                descripcion: variant.description || '',
                imagen:      variant.image_url || variant.image || ''
            }
        });

    } catch (error) {
        console.error("Error importando desde Mastershop:", error.message);
        return res.status(200).json({
            status: 'error',
            message: 'Fallo en Mastershop: ' + error.message,
            details: error.message
        });
    }
};
