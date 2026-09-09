module.exports = async function handler(req, res) {
    // LA MAGIA: Escudo de Caché en Vercel Edge Network
    // Si la petición viene del público (clientes), mantenemos el caché por 30 segundos.
    // stale-while-revalidate permite servir la versión vieja al instante mientras
    // Vercel actualiza la base de datos en segundo plano. Antes esto era 1 hora
    // (s-maxage=3600), lo que hacía que cambios del admin (productos nuevos, fotos,
    // configuración/campañas) tardaran hasta 1 hora en verse reflejados en la tienda
    // pública — parecía que los cambios "se revertían" solos.
    if (req.query.admin !== 'true') {
        res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=30');
    } else {
        // Si el administrador pide los datos (porque acaba de editar algo), rompemos el caché y forzamos la lectura fresca.
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
    
    try {
        const FIREBASE_URL = "https://pandaventa-cdc06-default-rtdb.firebaseio.com";
        
        // Leemos configuración y productos en un solo viaje desde el servidor, no desde el cliente.
        const [settingsRes, productsRes] = await Promise.all([
            fetch(`${FIREBASE_URL}/settings.json`),
            fetch(`${FIREBASE_URL}/products.json`)
        ]);

        const settings = await settingsRes.json();
        const products = await productsRes.json();

        return res.status(200).json({ settings, products });
    } catch (error) {
        return res.status(500).json({ error: 'Error interno conectando a DB' });
    }
};
