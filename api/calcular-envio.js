module.exports = async function handler(req, res) {
  // CORS
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

  if (!carrito || !carrito.ciudad_destino || !carrito.items) {
    return res.status(400).json({ error: 'Faltan datos del carrito' });
  }

  const normalizarTexto = (texto) => {
    if (!texto) return "";
    return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
  };

  // Envia.com espera el código corto del departamento (ISO 3166-2:CO), no el
  // nombre completo — "Cundinamarca" causa un error "String is too long".
  // Esta tabla convierte el nombre (como se guarda en Configuración o como
  // llega del selector de departamento del cliente) al código de 2-3 letras.
  const DEPARTAMENTO_A_CODIGO = {
    'AMAZONAS': 'AMA', 'ANTIOQUIA': 'ANT', 'ARAUCA': 'ARA', 'ATLANTICO': 'ATL',
    'BOLIVAR': 'BOL', 'BOYACA': 'BOY', 'CALDAS': 'CAL', 'CAQUETA': 'CAQ',
    'CASANARE': 'CAS', 'CAUCA': 'CAU', 'CESAR': 'CES', 'CHOCO': 'CHO',
    'CORDOBA': 'COR', 'CUNDINAMARCA': 'CUN', 'GUAINIA': 'GUA', 'GUAVIARE': 'GUV',
    'HUILA': 'HUI', 'LA GUAJIRA': 'LAG', 'GUAJIRA': 'LAG', 'MAGDALENA': 'MAG',
    'META': 'MET', 'NARINO': 'NAR', 'NORTE DE SANTANDER': 'NSA', 'PUTUMAYO': 'PUT',
    'QUINDIO': 'QUI', 'RISARALDA': 'RIS',
    'SAN ANDRES, PROVIDENCIA Y SANTA CATALINA': 'SAP', 'SAN ANDRES Y PROVIDENCIA': 'SAP',
    'SANTANDER': 'SAN', 'SUCRE': 'SUC', 'TOLIMA': 'TOL', 'VALLE DEL CAUCA': 'VAC',
    'VALLE': 'VAC', 'VAUPES': 'VAU', 'VICHADA': 'VID',
    'BOGOTA': 'DC', 'BOGOTA D.C.': 'DC', 'BOGOTA DC': 'DC', 'DISTRITO CAPITAL': 'DC'
  };

  const getStateCode = (nombreDepto) => {
    const normalizado = normalizarTexto(nombreDepto);
    return DEPARTAMENTO_A_CODIGO[normalizado] || nombreDepto; // si no se reconoce, se envía tal cual
  };

  const FIREBASE_URL = "https://pandaventa-cdc06-default-rtdb.firebaseio.com";
  const TARIFA_CONTINGENCIA = 15000;

  // ENVIA_TOKEN se lee SOLO de la variable de entorno de Vercel — nunca hardcodeado aquí.
  const ENVIA_TOKEN = process.env.ENVIA_TOKEN;
  // Por defecto apunta al entorno de pruebas (sandbox). Cuando ya hayas verificado
  // que las cotizaciones funcionan bien, define ENVIA_BASE_URL=https://api.envia.com
  // en Vercel para pasar a producción (genera cobros/etiquetas reales).
  const ENVIA_BASE_URL = process.env.ENVIA_BASE_URL || "https://api-test.envia.com";

  // Códigos de transportadora tal como los espera la API de Envia.com.
  // Si alguno de estos códigos no es exacto, verifica los códigos reales
  // disponibles para Colombia con GET {ENVIA_BASE_URL}/carrier?country_code=CO
  const CARRIERS = ['interrapidisimo', 'servientrega'];
  const CARRIER_LABELS = {
    interrapidisimo: 'Interrapidísimo',
    servientrega: 'Servientrega'
  };

  try {
    const ciudadNormalizada = normalizarTexto(carrito.ciudad_destino);
    const esBogota = ciudadNormalizada === "BOGOTA" || ciudadNormalizada === "BOGOTA D.C." || ciudadNormalizada === "BOGOTA DC";

    if (esBogota) {
      // Envío local gratis en Bogotá: no hace falta cotizar con ninguna transportadora.
      return res.status(200).json({
        status: 'success',
        es_gratis: true,
        metodo_entrega: "Envío Local",
        mensaje: "¡Envío Gratis!"
      });
    }

    // Leer configuración (dirección de origen + tarifa de respaldo)
    const settingsRes = await fetch(`${FIREBASE_URL}/settings.json`);
    const settings = await settingsRes.json() || {};
    const origin = settings.originAddress || {};
    const fallbackRate = parseFloat(settings.shippingCost);
    const fallbackCost = (!isNaN(fallbackRate) && fallbackRate >= 0) ? fallbackRate : TARIFA_CONTINGENCIA;

    // Sin token o sin dirección de origen configurada: no se puede cotizar en
    // tiempo real. Se usa la tarifa de respaldo en vez de fallar la compra.
    if (!ENVIA_TOKEN || !origin.street || !origin.city) {
      return res.status(200).json({
        status: 'success',
        es_gratis: false,
        costo_envio: fallbackCost,
        mensaje: 'Tarifa de respaldo (cotización en tiempo real no configurada aún — falta el token de Envia o la dirección de origen en Configuración)'
      });
    }

    // Peso total del pedido. Si algún producto no tiene peso definido, se asume
    // 0.3kg por unidad como valor conservador para no subestimar el costo real.
    const pesoTotal = carrito.items.reduce((sum, item) => sum + ((item.weight || 0.3) * (item.qty || 1)), 0) || 0.3;
    const valorDeclarado = carrito.items.reduce((sum, item) => sum + (item.price * item.qty), 0);

    // Para Colombia, Envia exige que "city" y "postalCode" sean el Código DANE
    // del municipio (no el nombre ni el código postal real). Este endpoint
    // resuelve el nombre de la ciudad a ese código automáticamente.
    const locateColombiaCity = async (cityName, stateCode) => {
      try {
        const resp = await fetch(`${ENVIA_BASE_URL}/locate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ city: cityName, state: stateCode, country: 'CO' })
        });
        const json = await resp.json().catch(() => null);
        console.log(`Locate city (${cityName}, ${stateCode}) ->`, resp.status, JSON.stringify(json));
        if (resp.ok && json && json.city) {
          return String(json.city);
        }
      } catch (e) {
        console.error(`Error localizando ciudad "${cityName}":`, e.message);
      }
      return null;
    };

    const origenStateCode = getStateCode(origin.state);
    const destinoStateCode = getStateCode(carrito.departamento_destino);

    const [origenDane, destinoDane] = await Promise.all([
      locateColombiaCity(origin.city, origenStateCode),
      locateColombiaCity(carrito.ciudad_destino, destinoStateCode)
    ]);

    if (!origenDane || !destinoDane) {
      // No se pudo resolver el Código DANE de alguna de las dos ciudades:
      // sin esto, Servientrega/Interrapidísimo van a rechazar la cotización.
      return res.status(200).json({
        status: 'success',
        es_gratis: false,
        costo_envio: fallbackCost,
        mensaje: `No se pudo identificar la ciudad ${!origenDane ? 'de origen' : 'de destino'} en el catálogo DANE de Colombia; se aplicó la tarifa de respaldo`
      });
    }

    const originPayload = {
      name: origin.name || 'Tienda',
      phone: (origin.phone || '3000000000').replace(/\D/g, ''),
      street: origin.street,
      city: origenDane,
      state: origenStateCode || '',
      country: 'CO',
      postalCode: origenDane
    };

    const destinationPayload = {
      name: carrito.nombre_destino || 'Cliente',
      phone: (carrito.telefono_destino || '3000000000').replace(/\D/g, ''),
      street: carrito.direccion_destino || carrito.ciudad_destino,
      city: destinoDane,
      state: destinoStateCode,
      country: 'CO',
      postalCode: destinoDane
    };

    const packagePayload = [{
      type: 'box',
      content: 'Productos varios',
      amount: 1,
      declaredValue: valorDeclarado,
      weight: Number(pesoTotal.toFixed(2)),
      weightUnit: 'KG',
      lengthUnit: 'CM',
      // Dimensiones estimadas genéricas. Si en el futuro guardas alto/ancho/largo
      // por producto, reemplaza esto por el cálculo real según lo que haya en el carrito.
      dimensions: { length: 25, width: 20, height: 15 }
    }];

    // Cotiza en paralelo con cada transportadora configurada
    const resultados = await Promise.allSettled(
      CARRIERS.map(carrier =>
        fetch(`${ENVIA_BASE_URL}/ship/rate/`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${ENVIA_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            origin: originPayload,
            destination: destinationPayload,
            packages: packagePayload,
            shipment: { type: 1, carrier }
          })
        }).then(async r => {
          const json = await r.json().catch(() => null);
          if (!r.ok) {
            console.error(`Envia.com (${carrier}) respondió ${r.status}:`, JSON.stringify(json));
          } else {
            // Log de diagnóstico: aunque la petición sea 200, Envia puede responder
            // sin tarifas (ej. transportadora no habilitada en la cuenta, ruta no
            // cubierta, dirección inválida). Esto nos deja ver la razón exacta.
            console.log(`Envia.com (${carrier}) respuesta 200:`, JSON.stringify(json));
          }
          return json;
        })
      )
    );

    let opciones = [];
    resultados.forEach((result, idx) => {
      if (result.status === 'fulfilled' && result.value && Array.isArray(result.value.data)) {
        result.value.data.forEach(rate => {
          const price = parseFloat(rate.totalPrice);
          if (!isNaN(price) && price > 0) {
            const carrierCode = rate.carrier || CARRIERS[idx];
            opciones.push({
              carrier: carrierCode,
              carrier_label: `${CARRIER_LABELS[carrierCode] || carrierCode}${rate.serviceDescription ? ' - ' + rate.serviceDescription : ''}`,
              price,
              days: rate.deliveryEstimate || '2-5 días hábiles'
            });
          }
        });
      } else if (result.status === 'rejected') {
        console.error(`Fallo cotizando con ${CARRIERS[idx]}:`, result.reason);
      }
    });

    opciones.sort((a, b) => a.price - b.price);

    if (opciones.length === 0) {
      // La API respondió pero ninguna transportadora dio tarifa (dirección no
      // cubierta, credenciales inválidas, etc.): usamos la tarifa de respaldo
      // en vez de bloquear la compra.
      return res.status(200).json({
        status: 'success',
        es_gratis: false,
        costo_envio: fallbackCost,
        mensaje: 'No se recibieron tarifas de las transportadoras para este destino; se aplicó la tarifa de respaldo'
      });
    }

    return res.status(200).json({
      status: 'success',
      es_gratis: false,
      opciones
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
