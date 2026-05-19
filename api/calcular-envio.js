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

  const TARIFA_FIJA_BOGOTA = 8000;
  const TARIFA_CONTINGENCIA = 15000;

  try {
    const ciudadNormalizada = normalizarTexto(carrito.ciudad_destino);
    const esBogota = ciudadNormalizada === "BOGOTA" || ciudadNormalizada === "BOGOTA D.C." || ciudadNormalizada === "BOGOTA DC";

    // Clasificar productos (por defecto 'propio' si no existe)
    const productosPropios = carrito.items.filter(p => !p.origen || p.origen === "propio");
    const productosDropi = carrito.items.filter(p => p.origen === "dropi");

    const tienePropios = productosPropios.length > 0;
    const tieneDropi = productosDropi.length > 0;

    let flete = 0;

    if (!esBogota) {
      // Nacional
      flete = await cotizarFleteDropi(carrito.items, carrito.ciudad_destino, carrito.departamento_destino);
    } else {
      // Bogotá
      if (tienePropios && !tieneDropi) {
        flete = TARIFA_FIJA_BOGOTA;
      } else if (!tienePropios && tieneDropi) {
        flete = await cotizarFleteDropi(productosDropi, carrito.ciudad_destino, carrito.departamento_destino);
      } else if (tienePropios && tieneDropi) {
        const costoDropi = await cotizarFleteDropi(productosDropi, carrito.ciudad_destino, carrito.departamento_destino);
        flete = TARIFA_FIJA_BOGOTA + costoDropi;
      }
    }

    return res.status(200).json({
      status: "success",
      costo_envio: flete,
      mensaje: "Envío calculado exitosamente"
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

async function cotizarFleteDropi(productos, ciudad, departamento) {
  if (productos.length === 0) return 0;

  const precioTotal = productos.reduce((suma, prod) => suma + (prod.price * prod.qty), 0);

  const productosApi = productos.map(prod => ({
    id: prod.id,
    cantidad: prod.qty
  }));

  const payload = {
    ciudad_destino: ciudad,
    departamento_destino: departamento,
    precio_total: precioTotal,
    productos: productosApi
  };

  const token = process.env.DROPI_TOKEN || "TU_TOKEN_AQUÍ";

  const respuesta = await fetch("https://dropi.co", { 
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });

  if (!respuesta.ok) {
    throw new Error(`Fallo en API Dropi: ${respuesta.status}`);
  }

  const transportadoras = await respuesta.json();

  if (!Array.isArray(transportadoras) || transportadoras.length === 0) {
    throw new Error("La API de Dropi no retornó transportadoras válidas.");
  }

  const transportadoraMasBarata = transportadoras.reduce((min, actual) => {
    return (actual.costo_transportadora < min.costo_transportadora) ? actual : min;
  });

  return transportadoraMasBarata.costo_transportadora;
}
