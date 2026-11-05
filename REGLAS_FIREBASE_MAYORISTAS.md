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
