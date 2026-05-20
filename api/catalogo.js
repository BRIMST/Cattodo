module.exports = async function handler(req, res) {
    // LA MAGIA: Escudo de Caché en Vercel Edge Network
    // Si la petición viene del público (clientes), mantenemos el caché por 1 hora.
    // stale-while-revalidate permite servir la versión vieja al instante, 
    // mientras Vercel actualiza la base de datos en segundo plano silenciosamente.
    if (req.query.admin !== 'true') {
        res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=59');
    } else {
        // Si el administrador pide los datos (porque acaba de editar algo), rompemos el caché y forzamos la lectura fresca.
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
    
    try {
        const FIREBASE_URL = "https://todo-en-uno-cf51e-default-rtdb.firebaseio.com";
        
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
