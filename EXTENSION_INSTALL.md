# Instalación de la extensión en Edge (entorno corporativo)

## ¿Por qué este flujo?

En el PC corporativo el DLP bloquea:

- Subir `<input type="file">` a internet (Web Store no es opción).
- Drag & drop de `.crx` sobre `edge://extensions/`.
- Cargar `.crx` empaquetados manualmente → Edge responde
  `CRX_REQUIRED_PROOF_MISSING` porque exige firma del Web Store.

Sí están permitidos: instalar programas, ejecutar comandos y modificar el
registro de Windows con admin local.

La salida es **force-install vía política local de Edge**: se escriben tres
claves en `HKLM\SOFTWARE\Policies\Microsoft\Edge` apuntando a un `update.xml`
local que sirve un `.crx` también local. Edge confía en esa ruta porque viene
de política, no de drag & drop.

## Requisitos previos

- Windows 10/11.
- Edge instalado en `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`.
  Si está en otra ruta, pasar `--edge="..."` a `pack:ext` o definir
  `MSEDGE_PATH`.
- Node 22+.
- Permisos de admin local (solo para aplicar el `.reg`).

## Primera instalación

```bash
npm install
npm run release:ext      # build + pack (.crx) + genera update.xml y .reg
npm run install:ext      # pide elevación, importa .reg, reinicia Edge
```

`release:ext` crea estos artefactos en `build/`:

| Archivo                       | Para qué |
|-------------------------------|----------|
| `build/edge-<version>.crx`    | Extensión firmada con `keys/extension.pem` |
| `build/update.xml`            | Manifest de update apuntando al `.crx` por `file:///` |
| `build/install-policy.reg`    | Importa las tres claves de política |
| `build/uninstall-policy.reg`  | Las borra |
| `build/extension-id.txt`      | ID estable derivado del `.pem` |
| `build/pack-info.json`        | Resumen JSON (id, versión, ruta del crx, key SPKI) |

La primera vez `pack:ext` genera `keys/extension.pem`. **No commitearlo.** Está
ignorado por `.gitignore`. Si se pierde, el ID cambia y la extensión se
considera otra distinta.

Tras `install:ext`, abrir `edge://extensions/` — debería aparecer la extensión
con la etiqueta *"Instalada por su organización"*.

Para verificar la política: `edge://policy/` → buscar `ExtensionInstallForcelist`.

## Actualizar la extensión

1. Subir `version` en `manifests/manifest.base.json` (y en cualquier override que la duplique).
2. `npm run release:ext`.
3. Edge detecta el cambio en `update.xml` (mismo `codebase`, nueva `version`) y
   actualiza solo. Forzar el chequeo desde `edge://extensions/` → modo
   desarrollador → "Actualizar".

No hace falta re-correr `install:ext` salvo que se mueva la ruta del `.crx` o
cambie el ID (es decir, salvo que se pierda el `.pem`).

## Revertir / desinstalar

```bash
npm run uninstall:ext
```

Importa `build/uninstall-policy.reg` (elimina las tres claves) y reinicia Edge.
La extensión desaparece del navegador en el siguiente arranque.

## Cómo funciona el ID

El ID de extensión de Edge/Chrome se deriva determinísticamente del `.pem`:

1. Extraer la clave pública SPKI en DER desde la privada.
2. `SHA-256(SPKI_DER)`.
3. Tomar los primeros 32 chars hex.
4. Mapear cada char hex `0..f` → `a..p` (`String.fromCharCode(97 + parseInt(c, 16))`).

El mismo `.pem` produce siempre el mismo ID, en cualquier máquina. Por eso el
script inyecta `key` (la SPKI en base64) en `dist/edge/manifest.json` antes de
empacar — garantiza que aun sin force-install el ID sea estable.

## Notas de seguridad

- `keys/extension.pem` es la identidad de la extensión. Tratarlo como una
  credencial. Backup en gestor de secretos, no en el repo.
- `ExtensionInstallSources = file:///*` permite instalaciones desde rutas
  locales. Mantener el `.crx` y `update.xml` en una ruta que solo el admin
  pueda modificar (por ejemplo `C:\ProgramData\...`) si el equipo va a ser
  compartido.
- El `uninstall-policy.reg` borra las tres ramas enteras. Si hay otras
  políticas de Edge configuradas a mano allí, ajustar el script.
