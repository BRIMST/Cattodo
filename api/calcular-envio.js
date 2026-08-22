module.exports = async function handler(req, res) {
  // CORS (opcional si es mismo dominio, pero buena práctica)
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const carrito = req.body;

  // Validar body
  if (!carrito || !carrito.ciudad_destino || !carrito.items) {
    return res.status(400).json({ error: 'Faltan datos del carrito' });
  }

  const normalizarTexto = (texto) => {
    if (!texto) return "";
    return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
  };

  const FIREBASE_URL = "https://pandaventa-cdc06-default-rtdb.firebaseio.com";
  const TARIFA_CONTINGENCIA = 15000;

  try {
    const ciudadNormalizada = normalizarTexto(carrito.ciudad_destino);
    const esBogota = ciudadNormalizada === "BOGOTA" || ciudadNormalizada === "BOGOTA D.C." || ciudadNormalizada === "BOGOTA DC";

    if (esBogota) {
      // Envío local gratis en Bogotá
      return res.status(200).json({
        status: 'success',
        costo_envio: 0,
        es_gratis: true,
        metodo_entrega: "Envío Local",
        mensaje: "¡Envío Gratis!"
      });
    }

    // Envíos nacionales: tarifa fija configurada en el panel de administración
    // (Configuración → "Costo de envío (otras ciudades)"). Antes esto se cotizaba
    // dinámicamente con la API de Dropi; al retirar esa integración, usamos la
    // tarifa que tú defines, con la tarifa de contingencia como respaldo.
    let costoNacional = TARIFA_CONTINGENCIA;
    try {
      const settingsRes = await fetch(`${FIREBASE_URL}/settings.json`);
      if (settingsRes.ok) {
        const settings = await settingsRes.json() || {};
        const configurado = parseFloat(settings.shippingCost);
        if (!isNaN(configurado) && configurado >= 0) {
          costoNacional = configurado;
        }
      }
    } catch (e) {
      console.warn("No se pudo leer el costo de envío configurado, usando tarifa de contingencia.");
    }

    return res.status(200).json({
      status: 'success',
      costo_envio: costoNacional,
      es_gratis: costoNacional === 0,
      metodo_entrega: "Contra entrega",
      mensaje: "Pagas en efectivo al recibir"
    });

  } catch (error) {
    console.error("Error al calcular envío:", error.message);
    return res.status(200).json({
      status: "success",
      costo_envio: TARIFA_CONTINGENCIA,
      mensaje: "Aplicando tarifa plana de contingencia"
    });
  }
};
