# Reglas de Firebase para el portal mayorista

El portal mayorista (`/mayoristas`) guarda los datos privados en tres nodos nuevos de
Realtime Database. Para que **solo los mayoristas activos** puedan ver los precios, hay
que aplicar estas reglas en **Firebase Console → Realtime Database → Reglas**.

## 1. Agregar estos tres nodos dentro de `"rules"`

```json
"wholesalers": {
  ".read": "auth != null && !root.child('wholesalers').child(auth.uid).exists()",
  "$uid": {
    ".read": "auth != null && auth.uid === $uid",
    ".write": "auth != null && !root.child('wholesalers').child(auth.uid).exists()"
  }
},
"wholesalePrices": {
  ".read": "auth != null && (!root.child('wholesalers').child(auth.uid).exists() || root.child('wholesalers').child(auth.uid).child('active').val() === true)",
  ".write": "auth != null && !root.child('wholesalers').child(auth.uid).exists()"
},
"wholesaleConfig": {
  ".read": "auth != null && (!root.child('wholesalers').child(auth.uid).exists() || root.child('wholesalers').child(auth.uid).child('active').val() === true)",
  ".write": "auth != null && !root.child('wholesalers').child(auth.uid).exists()"
}
```

- `wholesalers/{uid}`: el personal lee y escribe todo; cada mayorista solo puede leer su propio registro.
- `wholesalePrices` y `wholesaleConfig`: los lee el personal y los mayoristas con `active: true`; solo el personal escribe.

## 2. IMPORTANTE: excluir a los mayoristas de las reglas del personal

Las cuentas de mayorista son usuarios de Firebase Authentication, igual que las de los
vendedores y el administrador. Si alguna regla actual dice solo `auth != null` para
permitir escribir o leer datos internos (`products`, `orders`, `clients`, `settings`,
etc.), **un mayorista tendría los mismos permisos que un vendedor**.

En cada regla que hoy sea `auth != null` para el personal, cámbiala por:

```
auth != null && !root.child('wholesalers').child(auth.uid).exists()
```

Ejemplo:

```json
"clients": {
  ".read": "auth != null && !root.child('wholesalers').child(auth.uid).exists()",
  ".write": "auth != null && !root.child('wholesalers').child(auth.uid).exists()"
}
```

No cambies las reglas que permiten crear pedidos a clientes sin sesión (`orders`), solo
las que hoy dependen de `auth != null` para identificar al personal.

## 3. Primer uso

1. Aplica las reglas (pasos 1 y 2).
2. Entra al panel de administración. Los precios mayoristas que estaban dentro de cada
   producto se mueven solos a `wholesalePrices` (verás un aviso 🔒) y el descuento
   por defecto pasa a `wholesaleConfig`.
3. En la pestaña **Mayoristas** crea las cuentas (correo y contraseña).
4. Los mayoristas entran en `https://pandaventa.com/mayoristas`.

> Quitar el acceso a un mayorista elimina su registro; para borrar también su cuenta de
> acceso, hazlo en Firebase Console → Authentication.

---

## 3. Nodos nuevos: seguimiento, opiniones y avisos de stock

Agregar dentro de `"rules"` (junto a `wholesalers`, `clients`, etc.). `STAFF` significa:
`auth != null && !root.child('wholesalers').child(auth.uid).exists()`

```json
"tracking": {
  "$ticket": {
    ".read": true,
    ".write": "!data.exists() || (auth != null && !root.child('wholesalers').child(auth.uid).exists())",
    ".validate": "newData.hasChildren(['estado', 'h'])"
  }
},
"reviewStats": {
  ".read": true,
  ".write": "auth != null && !root.child('wholesalers').child(auth.uid).exists()"
},
"reviews": {
  "$productId": {
    ".read": true,
    ".write": "auth != null && !root.child('wholesalers').child(auth.uid).exists()"
  }
},
"reviewsPending": {
  ".read": "auth != null && !root.child('wholesalers').child(auth.uid).exists()",
  ".write": "auth != null && !root.child('wholesalers').child(auth.uid).exists()",
  "$id": {
    ".write": "!data.exists() && newData.exists() || (auth != null && !root.child('wholesalers').child(auth.uid).exists())",
    ".validate": "newData.hasChildren(['productId', 'name', 'rating', 'comment', 'ts']) && newData.child('rating').isNumber() && newData.child('rating').val() >= 1 && newData.child('rating').val() <= 5 && newData.child('name').isString() && newData.child('name').val().length <= 40 && newData.child('comment').isString() && newData.child('comment').val().length <= 500"
  }
},
"stockAlerts": {
  ".read": "auth != null && !root.child('wholesalers').child(auth.uid).exists()",
  ".write": "auth != null && !root.child('wholesalers').child(auth.uid).exists()",
  "$productId": {
    "$id": {
      ".write": "!data.exists() && newData.exists()",
      ".validate": "newData.hasChildren(['phone', 'ts']) && newData.child('phone').isString() && newData.child('phone').val().length <= 15"
    }
  }
}
```

- `tracking`: el cliente lo consulta solo por su número exacto (`PV-XXXXXX`); no se puede listar.
- `reviewsPending` / `stockAlerts`: cualquier visitante puede **crear** una entrada, pero solo el equipo puede leerlas, aprobarlas o borrarlas.
- `reviews` / `reviewStats`: lectura pública, escritura solo del equipo.


## 4. Costos privados de productos (nuevo)

Agrega este bloque dentro de `"rules"` (junto a `wholesalePrices`). Solo el personal puede leer y escribir los costos:

```json
"productCosts": {
  ".read": "auth != null && !root.child('wholesalers').child(auth.uid).exists()",
  ".write": "auth != null && !root.child('wholesalers').child(auth.uid).exists()"
}
```

Al abrir el panel de administración con la sesión iniciada, los costos que aún estén dentro de `products/` se mueven solos a `productCosts/` y se borran del nodo público.
