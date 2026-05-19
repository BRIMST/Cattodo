module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ message: 'Método no permitido' });
    }

    const { id } = req.query;

    if (!id) {
        return res.status(400).json({ message: 'ID de producto requerido' });
    }

    try {
        const token = process.env.DROPI_TOKEN || "TU_TOKEN_AQUÍ";

        // El endpoint oficial de Dropi para buscar productos
        const dropiResponse = await fetch(`https://dropi.co/api/products/${encodeURIComponent(id)}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!dropiResponse.ok) {
            const text = await dropiResponse.text();
            throw new Error(`Error Dropi: ${dropiResponse.status} - ${text}`);
        }

        const data = await dropiResponse.json();

        // Dropi suele encapsular en data.data
        const product = data.data || data;

        return res.status(200).json({
            status: 'success',
            producto: {
                id: product.id || id,
                origen: 'dropi', 
                nombre: product.nombre || product.name || 'Producto Importado',
                precio: product.precio_venta || product.sale_price || 0,
                precio_original: product.precio_sugerido || product.suggested_price || null,
                costo: product.precio_proveedor || product.cost || 0,
                stock: product.stock || 0,
                descripcion: product.descripcion || product.description || '',
                imagen: (product.imagenes && product.imagenes.url) || product.image_url || ''
            }
        });

    } catch (error) {
        console.error("❌ Error al importar desde Dropi:", error.message);
        return res.status(500).json({
            status: 'error',
            message: 'No se pudo obtener la información del producto',
            details: error.message
        });
    }
};
