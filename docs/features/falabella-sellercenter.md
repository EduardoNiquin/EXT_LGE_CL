# Falabella SellerCenter
Apartado de herramientas sobre la **API de SellerCenter** (`https://sellercenter-api.falabella.com/`). **No opera sobre una pestana** (sin content script): todo corre en el **service worker** y el popup refleja el estado via `storage.onChanged`. Menu de modulos con el mismo patron que Magento. No confundir con `seller-center-falabella` (soporte Salesforce, otro sitio).

```
src/features/falabella-sellercenter/
├── constants.js   STORAGE_KEYS, MESSAGES, API (limites medidos), ITEM_STATUS_INACTIVOS, PHASE, FINISH_REASON
├── state.js       credenciales (persisted value) + run store de paquetes + result + draft
├── debug.js       __extLgeCl.falabellaSellercenter.* (en el SW)
├── api/           firma.js (HMAC-SHA256 WebCrypto, query ordenada) · cliente.js (llamar con reintentos, getOrdersPage, getMultipleOrderItems)
├── paquetes/      analisis.js (regla, pura) · export.js (texto/CSV/filas) · background/run.js (orquestador SW)
└── popup/         view.js (menu) · sections/paquetes.js · sections/credenciales.js
```

## API (medido oct-2026)
- **Firma:** HMAC-SHA256 con la API Key sobre todos los parametros ordenados por nombre (RFC 3986): `Action`, `Format=JSON`, `Timestamp` (ISO sin ms, `+00:00`), `UserID`, `Version=1.0` (fija; no es la version real) y los filtros. Se firma de nuevo en cada reintento (el Timestamp caduca, E003). Los filtros vacios/`undefined` NO se firman ni se mandan.
- **User-Agent:** la doc del portal pide `SELLER_ID/PHP/...`, pero el UA del navegador funciona (medido). Una extension no puede cambiarlo.
- **E007** = API Key de otro UserID (o contrasena del portal en vez de API Key). E007/E008/E009 y 4xx (salvo 429) no se reintentan.
- **GetOrders:** maximo **100 por pagina** (Limit 500/1000/5000 devuelve 100), ~1,3 s por pagina. `Body.Orders` es `[{Order:{...}}]`. Se pide `SortBy=created_at&SortDirection=ASC` para que la paginacion no se reordene. `OrderNumber` (el que ve la gente, p.ej. 3254612276) **no** sirve para `GetOrder` (E016): ese usa `OrderId` interno.
- **GetMultipleOrderItems:** `OrderIdList=[id,id,...]` (hasta 200), `Body.Orders.Order[]` con `OrderItems.OrderItem` (objeto si es uno solo → `comoLista`).
- **Hora:** `CreatedAt` viene en hora de Chile y el filtro la compara como UTC → se pide la ventana con 6 h de margen por punta y el dia se decide con `CreatedAt.slice(0,10)`. Solo hay ~30 dias hacia atras.

## Identificar paquetes en ordenes
Busca ordenes con 2+ productos que Falabella dejo en **un solo paquete** (deberia haber un paquete y una guia por producto).
- **Regla (`analisis.js`):** entre los items activos (fuera `canceled`/`failed`/`returned`), si 2+ comparten `PackageId` → problema. Items sin `PackageId` aun no tienen paquete y no cuentan. Casos reales: **3254531299 bien** (PKG…AR / PKG…AQ, guias distintas); **3254612276 mal** (2 TV iguales con `PKG00002M1XS5` y la misma guia). En 30 dias: 131 multi-producto, ~33 mal, casi siempre el mismo SKU xN (hubo una de 10 unidades en 1 paquete) y alguna con SKUs mezclados.
- **Filtro de estados** (chips en el popup; `constants.js#ESTADOS`: pending, ready_to_ship, shipped, delivered, canceled, failed, returned; todos = sin filtro). Con filtro se hace **un recorrido de GetOrders por estado** (param `Status`, medido: cuadra con el conteo local) y se une por `OrderNumber`; ademas se filtra local con `pasaFiltroEstados` (basta que la orden tenga uno de los estados). Pendiente + Listo para despacho en 7 dias: 2.772 ordenes en vez de 4.408, ~14 s.
- **Flujo (`background/run.js`):** primera pagina de cada recorrido → `TotalCount` → resto de paginas de a 3 en paralelo (`enParalelo` corta al primer error) → dedupe por `OrderNumber` y filtro por dia/estado → solo `ItemsCount > 1` piden items, en lotes de 200 → `hallazgo()`. 7 dias sin filtro ≈ 4.400 ordenes, 45 paginas, **~20 s**.
- **Progreso:** `run.progress {paginasHechas, paginasTotal, ordenesApi, ordenesLeidas, lotesHechos, lotesTotal}`. El popup calcula % (pagina = 1 unidad, lote = 1 unidad) y el tiempo restante por ritmo (`calcularAvance`), recalculado cada 1 s.
- **Montos (medido en 3254612276):** `GrandTotal` (658,970) = `ProductTotal` (639,980 = suma de `PaidPrice`) + `ShippingFeeTotal` (18,990); `Voucher` (20,002) ya va restado en los productos. Los de cabecera traen coma de miles → `parseMonto`. Por item: `PaidPrice` (pagado) e `ItemPrice` (lista, antes del cupon).
- **Hallazgo** (`analisis.js#hallazgo`): cabecera + `montos {productos, envio, descuento, total}` + `items[]` (TODOS los de la orden: sku, nombre, estado, paquete, guia, precio, precioLista, compartido, activo), ordenados: primero los del paquete compartido, luego el resto por paquete, al final los cancelados. `totales()` = ordenes + monto total (suma de `total`).
- **Resultado** aparte en `falabella-sellercenter:paquetes:result` (`{desde, hasta, estados, hallazgos}`); el run lleva `stats` (con `conProblema` y `montoProblema`). Sin datos del comprador.
- **UI:** tarjetas de totales (ordenes con problema + monto total), una tarjeta `<details>` por orden (resumen: numero, total, fecha, productos/paquetes, chips de estado; al abrir: tabla de productos con SKU/nombre/paquete, precio pagado y tachado el de lista, estado; los del paquete compartido con borde de acento; montos Productos/Descuento/Envio/Total; guia y promesa), "Abrir todas", texto para copiar en un desplegable.
- **Salidas (orden: fecha de creacion → numero de orden → productos como en la tarjeta):** Excel con 2 hojas — **Ordenes** (una fila por orden, montos con formato `$`, fila TOTAL al pie) y **Productos** (una fila por producto, `N° 1 de 2`, precio pagado/lista, comparte paquete); CSV = filas de Productos. Los montos de la ORDEN van solo en la primera fila de cada orden para que sumar la columna no duplique. Texto: una linea por orden con su total + cabecera con el monto total. BOM + proteccion de formulas en el CSV.
- Si el SW muere a mitad, al despertar marca el run como interrumpido (`wirePaquetesBackground`).

## Credenciales (incluidas, cifradas en el build)
- **Texto plano solo en `keys/falabella-sellercenter.json`** (`{"userId","apiKey"}`; `keys/` esta en `.gitignore`). Nunca entra al repo.
- **Build (`vite.config.js` → `scripts/secretos.mjs#secretoDesdeArchivo`):** en cada build se cifra con **AES-256-GCM**, clave aleatoria nueva (partida en dos mitades XOR) e IV nuevo, con AAD `ext-lge-cl:falabella-sellercenter:v1`; se inyecta como `__FSC_EMBEBIDO__` (`define`). Cada build da un blob distinto. Sin el archivo (CI, otra PC) queda `null` y la feature pide credenciales en el popup. **Para armar el instalador hay que tener el archivo en `keys/`.**
- **Runtime (`api/embebido.js`, SOLO SW):** descifra con WebCrypto, en memoria (cache). La API Key nunca va a storage, logs ni al popup: el popup pregunta `ESTADO_CREDENCIALES` y recibe `{fuente, userId}`. Verificado: ni la key ni el correo aparecen en claro en `dist/`, y el blob solo esta en `service-worker.js`.
- **Override (`api/credenciales.js#resolverCredenciales`):** si la persona carga otras en el modulo **Credenciales de la API** (`chrome.storage.local["falabella-sellercenter:credenciales"]`, probadas con un `GetOrders` de 24 h) se usan esas; "Volver a las incluidas" las borra.
- **Limite (acordado con el usuario):** la clave para descifrar viaja en el mismo paquete, asi que esto frena a quien abra el ZIP o haga grep, no a quien depure el SW. La API Key tambien permite escribir (stock, estados): si se filtra, rotarla en SellerCenter → Usuarios, actualizar `keys/` y re-armar el instalador.

**Debug (`__extLgeCl.falabellaSellercenter.`, en el SW; ninguno devuelve la key):** `paquetes({desde,hasta})`, `cancel()`, `state()`, `result()`, `reset()`, `credenciales()` (fuente + UserID), `probar()`, `api(action, filtros)` (llamada firmada cruda), `orden(orderId)` (items + veredicto).
**Pendientes:** no corrige nada en SellerCenter (solo reporta); sin limite de tasa conocido para lecturas (3 en paralelo funciono sin errores).
