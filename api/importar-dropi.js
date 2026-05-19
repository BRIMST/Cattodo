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

        // Asegúrate de que el path a la API sea el oficial de Dropi para buscar productos
        const dropiResponse = await fetch(`https://dropi.co/api/v1/product/${encodeURIComponent(id)}`, {
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

        // Dropi suele encapsular en data.data o venir directo en data
        const product = data.data || data;

        return res.status(200).json({
            status: 'success',
            producto: {
                id: product.id || id,
                origen: 'dropi', 
                nombre: product.name || product.nombre || product.title || 'Producto Importado',
                precio: product.sale_price || product.precio_venta || product.price || 0,
                precio_original: product.suggested_price || product.precio_sugerido || null,
                costo: product.cost || product.costo || product.wholesale_price || 0,
                stock: product.stock || product.quantity || 10,
                descripcion: product.description || product.descripcion || '',
                imagen: product.image_url || product.imagen_principal || (product.images && product.images[0]?.url) || ''
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
