# Facturas - datos de entrada (Invoice Master File) y reglas de calculo

Que hay en `Invoice Master File <yymmdd>.xlsx` (copia analizada: `docs/features/Facturas/Invoice Master File
260831.xlsx`), que hojas usa la extension, como se arma cada valor que va a GEVS y que reglas deciden que factura se
procesa. Complemento de `facturas-flujo-gevs.md` (donde va cada valor en pantalla).

## Hojas del archivo

| Hoja | Uso en la extension | Contenido |
|---|---|---|
| **`Master 1_BU v2`** | **Fuente de facturas** | una fila por factura x division (12 filas por factura), con el neto distribuido por BU |
| **`Master 2_STEPS`** | **Receta por cliente** | una fila por (cliente, tipo de documento) con payee, cuentas, tax code, titulo de la Description y las 15 acciones en prosa |
| **`Map`** | **Tabla maestra** | cliente -> OBS/3P, Variable/Fixed, Department, Payee Code, Debit Account; y BU -> GBU |
| **`Round`** | Regla de redondeo (se reimplementa) | hoja de trabajo manual: pegar 11 netos, redondear, sumar, IVA, total, cantidad de lineas |
| `Master 1_BU` | no (oculta, version vieja) | |
| `Pivot Master1`, `Sheet1`, `Sep Sales Portion`, `Aug Sales Portion`, `FX` | no | pivot, lista informal de accruals, distribucion de ventas por BU (ya volcada en Master 1), tipos de cambio |

Las hojas `Sales Portion` son el origen de la distribucion por BU, pero su resultado ya esta en `Master 1_BU v2`: la
extension no las necesita.

## `Master 1_BU v2`

Encabezado en la **fila 4**, datos desde la fila 5 (624 filas en la copia analizada). La extension ubica el encabezado
buscando la celda `Customer` y cada columna **por su nombre**, no por posicion: en 2026-09 Finanzas movio `Doc Type` al
principio y agrego `INVOICE ROUND AMOUNT` / `INVOICE ROUND VAT` (captura en `Facturas/master1-columnas-2026-09.png`) sin
que hubiera que tocar el parser.

| Columna | Ejemplo (MP 2943361) | Uso |
|---|---|---|
| Doc Type | `Invoice` / `Credit Note` / `Debit Note` | **tipo de documento**: prefijo de la Description (`F` / `CN`) y signo esperado de los montos (positivo / negativo). `Debit Note` no se carga |
| Year | 2026 | año de la Description |
| Cut Date | `JUL 26 to AUG 25` | trazabilidad (log/resultado) |
| Invoice Received | `AUG` | no |
| Impact Month | `AUG (Provision)` / `SEP (Ingresar)` | **mes de la Description** (se toma el prefijo de 3 letras) |
| Invoice Registered | `Approving` / `AUG` / `Pending` | espejo del estado; no se usa |
| Invoice Date | `2026-08-25` (fecha) | Invoice Date de GEVS y ISSUE_DATE del DFF. Se valida: hay filas con `sep` (texto) o vacias |
| Invoice Number | `2943361` (numero) | Invoice No y Description. Se normaliza a string |
| Customer | `MERCADO PAGO` | clave de la receta y del Map |
| OBS/3P | `OBS` | no |
| BU | `CNT` ... `TOTAL` | GBU de la linea (`DIV:<BU>`) |
| Division | `Refrigeration` ... `TOTAL` | fila TOTAL = totales de la factura |
| Invoice Net Amt (CLP) | `1508792.3878...` | **neto por BU** (sin redondear) |
| VAT (CLP) | 0 en divisiones; `1378553.17` en TOTAL | referencia (formula `Net*0.19` solo en TOTAL) |
| Total Amt (CLP) | `8634096.17` en TOTAL | referencia para el aviso de diferencia |
| Invoice Net Amt (USD), VAT (USD), Total Amt (USD), FX Rate | | no |
| INVOICE ROUND AMOUNT | `1508792` (`-10338484` en una NC) | `ROUND(neto, 0)` por linea, puesto por Finanzas (2026-09) para "ingresar sin comas ni puntos". Se **contrasta** con el redondeo calculado: si difieren, el plan da error. En la fila TOTAL es el ROUND de la suma sin redondear (difiere 1-2 CLP de la suma de redondeados): no se usa |
| INVOICE ROUND VAT | solo en TOTAL: `ROUND(VAT (CLP), 0)` | no se usa: es el IVA del neto sin redondear (y en facturas viejas de MP el `VAT (CLP)` no es 19%); la hoja Round lo calcula sobre el neto redondeado |
| Commission Type | `Monthly Commission`, `Commission (1era Quincena)`, `Commission (2da Quincena)`, `Logistic Cost`, `Commission (In transit)` | trazabilidad |
| Provision | `Provision (Based on External Report)` / `(Based on PO, One View)` | no |
| Variable /Fixed | `Variable` | no |
| Invoice Status | `Pending` / `Approving` / `AP Completed` / `Draft` / `Pending Report` | **elegibilidad** |
| BU (2da), Provision * | | no |
| Invoice URL | a veces el nombre del PDF (`2026-08-BILL-MercadoPago (2).pdf`) o una URL de acepta.com | ayuda a emparejar adjuntos |

### Agrupacion en documentos

Una factura son **12 filas consecutivas**: 11 divisiones + `TOTAL`, con estos pares fijos Division -> BU:

| Division | BU (GBU) | | Division | BU (GBU) |
|---|---|---|---|---|
| Refrigeration | CNT | | Audio | PNT |
| Cooking | CVT | | Monitor | GTT |
| Dishwasher | CDT | | RAC | DGT |
| WM | DFT | | Air Cleaner | DLT |
| VCC | DVT | | SAC | DMT |
| Television | GLT | | TOTAL | TOTAL |

Clave de agrupacion: `Customer + Invoice Number + Invoice Date + Cut Date + Commission Type + Doc Type`. En la copia
analizada eso da 51 documentos; uno de Paris tiene 24 filas (dos bloques con la misma clave): se toman las divisiones sin
duplicar y, si una division aparece dos veces con montos distintos, el documento se marca "ambiguo" y no es elegible.

### Elegibilidad (v1)

Un documento entra al proceso solo si:

1. `Invoice Status` = `Pending` (los demas se listan con el motivo: `Approving` = ya registrado, `AP Completed` = ya
   aprobado, `Draft` y `Pending Report` = fuera de alcance por ahora).
2. `Doc Type` = `Invoice` o `Credit Note`, con el **signo que corresponde**: una factura lleva todo >= 0 y una nota de
   credito todo <= 0 (lineas y TOTAL); un monto con el signo cambiado es un error del Excel. `Debit Note` no se soporta.
3. El cliente tiene receta con `System Module` = `Complex voucher` (ver Master 2).
4. `Invoice Number` presente y `Invoice Date` es una fecha valida.
5. Al menos una BU con neto distinto de 0 y `TOTAL` distinto de 0.
6. Adjuntos asignados: factura (PDF) y detalle (obligatorios); distribution se ignora por ahora.

En la copia de 2026-09-21 cumplen dos documentos de FALABELLA (DIRECT): la factura 494026 (cargada ese dia por la
extension) y la nota de credito 459689; el resto de las Pending de Complex voucher no tiene numero todavia. El popup
ofrece un override "procesar igual" (con aviso) para pruebas.

## `Master 2_STEPS` (receta)

Encabezados en la fila 5; datos en las filas 6-19. Columnas que se leen:

| Col | Encabezado | Uso |
|---|---|---|
| C | Payee | clave (= `Customer` de Master 1) |
| D | Doc No | 33 = factura, 61 = nota de credito (informativo) |
| E | Doc Type | `Invoice` / `Credit Note` / `Debit Note` |
| F | System Module | `Complex voucher` (unico soportado); `Commission & Charge_Others` e `ITMS ...` quedan fuera |
| G | Invoice Type | `Vendor Invoice (CHL)` -> `#InvoiceTypeId` = `55001` |
| J | Payee Code | VLOOKUP a Map (valor cacheado) |
| L | Description (title) | `PG Commission MERCADO PAGO, 1.0%-2.3% - ` (termina en ` - `: se recorta) |
| O | Credit-Account | `21117701` en todos |
| P | Debit-Department | VLOOKUP a Map (valor cacheado) |
| T | VAT Tax Code | `CLIDD19` |
| U | Debit-Account | VLOOKUP a Map (valor cacheado) |

El resto (K, Q, R, S, V..AH) son las instrucciones en prosa "ACTION 1..15" que coinciden con `facturas-flujo-gevs.md`.

Recetas Complex voucher (Invoice):

| Customer | Payee Code | Debit Department | Debit Account | Title |
|---|---|---|---|---|
| FALABELLA (DIRECT) | CL004831 | 20168 | 51357755 | Commission 3P FALABELLA Direct (Integration May 2026), 10%-13% |
| PARIS (FULLKOM) | CL004915 | 20169 | 51357755 | Commission 3P PARIS (Fullkom), 10.9% (8.0%+2.9%) |
| WALMART (FULLKOM) | CL004915 | 20170 | 51357755 | Commission 3P WALMART (Fullkom), 7.65% (4.75%+2.9%) |
| RIPLEY (FULLKOM) | CL004915 | 20171 | 51357755 | Commission 3P RIPLEY (Fullkom), 10.9% (8.0%+2.9%) |
| TRANSBANK | CL003010 | 20148 | 51357755 | Commission PG TRANSBANK, 0.9%-1.4% |
| MERCADO PAGO | CL005108 | 20148 | 51357755 | PG Commission MERCADO PAGO, 1.0%-2.3% |

Comunes: Credit Account `21117701`, VAT Tax Code `CLIDD19`, Invoice Type Vendor Invoice(CHL). Las **notas de credito**
tienen su propia fila (`Doc No` 61) solo para FALABELLA (DIRECT), TRANSBANK y MERCADO PAGO (Paris, Walmart y Ripley no la
tienen: "sin receta", no elegibles); repite los mismos codigos y titulo que la factura y agrega "ALL in NEGATIVE"
(lineas, IVA, SUPPLY_PRICE, ORIGINAL_TAX_AMOUNT) y, en Transbank y Mercado Pago, "no distribuir si el monto es peanuts"
(no se implementa: se distribuye siempre por BU). Hay tambien una fila `Debit Note` de Falabella sin `Doc No`: fuera.

**Regla de precedencia:** `Payee Code`, `Department` y `Debit Account` se leen de **Map** (fuente de los VLOOKUP); de
Master 2 se usan `title`, `Credit-Account`, `VAT Tax Code`, `Invoice Type` y `System Module`. Si Master 2 (valores
cacheados) difiere de Map, el popup lo avisa (el Excel pudo guardarse sin recalcular).

## `Map`

- `F16:K29`: `Customer | OBS/3P | Variable/Fixed | Department Code | Payee Code | Debit Account`. Filas: 3P Marketplace
  (Common) 20167; FALABELLA (DIRECT) 20168 CL004831; PARIS (FULLKOM) 20169 CL004915; WALMART (FULLKOM) 20170 CL004915;
  RIPLEY (FULLKOM) 20171 CL004915; MERCADO PAGO 20148 CL005108; TRANSBANK 20148 CL003010; OMS SOPTEC ... (otros modulos).
  Debit Account 51357755 salvo los fijos de OMS (51351103/51351105) y Camara de Comercio (51357777).
- `C17:D29`: `BU | GBU` (la tabla Division -> BU de arriba).

## `Round` y las reglas de calculo

La hoja: `E8:E18` = 11 netos pegados; `F = ROUND(E, 0)` (DFT ademas suma `E19`, un ajuste manual opcional); `G = F`
(columna "Copy"); `G5 = SUM(G8:G18)`; `H5 = G5*0.19`; `I5 = G5*1.19`; `K5 = COUNTIF(G8:G18, distinto de 0) + 1`.

Reglas que implementa `reglas/calculo.js` (con `n = numero de BUs con neto != 0`):

```
linea_i   = round(neto_i)            redondeo al ENTERO MAS CERCANO (no hacia arriba): 159502.41 -> 159502
NET'      = sum(linea_i)             puede diferir en 1 del TOTAL crudo (7255544 vs 7255543)
IVA'      = round(NET' * 0.19)       1378553 (de 1378553.36)
CREDIT    = NET' + IVA'              8634097  (cuadra debito = credito por construccion)
N         = n + 1                    filas Debit (BUs != 0 + la de IVA): 10 en el ejemplo
SUPPLY_PRICE        = NET'           7255544
ORIGINAL_TAX_AMOUNT = IVA'           1378553
ajuste E19 (DFT)    = 0 en v1
```

Las BUs con neto 0 (en el ejemplo DVT y DMT) **no generan fila**. El orden de las filas es el orden de la tabla
Division -> BU. Si `|CREDIT - Total Amt (CLP)| > 1` el popup avisa (en el ejemplo la factura real decia 8.634.096,56 y
se cargo 8.634.097, que es lo que dicta la hoja Round). Ojo: como `Total Amt` es la suma SIN redondear x 1.19, la
diferencia normal es de 1 a 2 CLP (494026: 1,90; NC 459689: 1,79), asi que ese aviso sale en casi todos los documentos.

**Notas de credito:** la misma hoja Round con todo en negativo (nota "*Credit Note with Negative"). `ROUND` de Excel
aleja las mitades de cero tambien en negativo (`redondear` hace lo mismo: -2,5 -> -3) y el IVA sale negativo. Ejemplo NC
459689 (FALABELLA, `AUG (Provision)`): CNT -15797376, CDT -191528, DFT -36678441, GLT -23441649, PNT -2260696,
GTT -3576234, DGT -359074 (CVT, DVT, DLT y DMT en 0, sin fila); NET' -82304998, IVA' -15637950, CREDIT -97942948, N = 8;
Description `CN 459689 - Commission 3P FALABELLA Direct (Integration May 2026), 10%-13% - August 2026`.

**Contraste con `INVOICE ROUND AMOUNT`:** desde 2026-09 cada linea de Master 1 trae `ROUND(neto)` puesto por Finanzas
(en la copia analizada coincide con `redondear` en las 624 filas). Si una linea difiere, o Finanzas la ajusto a mano
(lo que antes era el `E19` de Round) o el Excel se guardo sin recalcular: en los dos casos el plan da **error** y lo
resuelve una persona en el Excel; la extension no elige entre los dos valores.

Ejemplo completo (MP 2943361, `Impact Month` = `AUG (Provision)`):

| Fila | BU | Neto Master 1 | Linea | Product |
|---|---|---|---|---|
| 1 | CNT | 1508792.3878 | 1508792 | DIV:CNT |
| 2 | CVT | 549.6401 | 550 | DIV:CVT |
| 3 | CDT | 64184.8199 | 64185 | DIV:CDT |
| 4 | DFT | 3153038.8212 | 3153039 | DIV:DFT |
| 5 | GLT | 1999164.7574 | 1999165 | DIV:GLT |
| 6 | PNT | 159502.4084 | 159502 | DIV:PNT |
| 7 | GTT | 211100.5097 | 211101 | DIV:GTT |
| 8 | DGT | 151982.7357 | 151983 | DIV:DGT |
| 9 | DLT | 7226.9198 | 7227 | DIV:DLT |
| 10 | VAT | | 1378553 | (vacio) |

## Description

```
<prefijo> <Invoice Number> - <title de Master 2 sin el " - " final> - <Mes en ingles> <Year>
F 2943361 - PG Commission MERCADO PAGO, 1.0%-2.3% - August 2026
```

- Prefijo: `F` para Invoice; `CN` para Credit Note (`TIPOS_DOCUMENTO` en `constants.js`).
- Mes: prefijo de 3 letras de `Impact Month` (`AUG (Provision)` -> August, `SEP (Ingresar)` -> September); año de `Year`.
- La misma cadena va en `#Description` y en la Description de **todas** las filas Debit (incluida la de IVA).

## Mapeo resumido columna -> campo GEVS

| Campo GEVS | Origen |
|---|---|
| Invoice Type | receta (`55001`) |
| Invoice No | Master 1 `Invoice Number` |
| Invoice Date, DFF ISSUE_DATE | Master 1 `Invoice Date` (`dd/MM/yyyy`) |
| Payee Code, DFF SUPPLIER | Map `Payee Code` |
| Description (cabecera y filas) | Description |
| Credit Account | Master 2 `Credit-Account` |
| Credit Amount | CREDIT |
| Debit Department (fila 0, heredado) | Map `Department Code` |
| Debit Account (filas ITEM) | Map `Debit Account` |
| Debit Amount (filas ITEM) | linea_i |
| Product tipo / valor | `DIV` / `DIV:<BU>` |
| Fila VAT: Line Type, Tax Code, DFF TAX_RATE_CODE | `VAT`, Master 2 `VAT Tax Code` |
| Fila VAT: Amount, DFF ORIGINAL_TAX_AMOUNT | IVA' |
| DFF SUPPLY_PRICE | NET' |
| Adjuntos | archivos subidos en el popup, emparejados por numero de factura en el nombre o `Invoice URL` |

## Supuestos a validar con Finanzas

- Redondeo al entero mas cercano (es lo que hace la hoja Round) y credito = NET' + IVA' aunque difiera del total real
  de la factura en 1 CLP.
- Accounting Date queda con el default (fecha del dia) y el Department del Credit con el default del usuario (20163).
- El ajuste `E19` de Round no se contempla (si aparece como una linea distinta en `INVOICE ROUND AMOUNT`, se detiene).
- Una factura o nota de credito por corrida.
