# BATALLA NAVAL (secreto, multijugador, escena 3D)
Feature SOLO de popup (sin content script), sucesora de GATO (`gato.md` describe el desbloqueo, la presencia, el matchmaking por reto, el ranking y Firebase REST: todo eso sigue igual, con las claves de storage legacy `gato:*`). Reglas en `game.js` (logica pura): tablero COMPARTIDO de 16x16, flota `s4`,`s3`,`s2a`,`s2b` y 2 bombas (minas) por jugador; una mina detonada explota en 3x3 y dana SOLO a quien disparo.

## Rendicion y giro
- **Rendirse** (panel izquierdo de la batalla, confirmacion en dos pasos; en cualquier turno): `net.surrender` reclama el cierre con ETag sobre `status` (si el rival justo cerro la partida con un disparo, no hace nada) y deja `winner` = rival, +1 a su marcador, +1 a su ranking y `last:{res:'surrender'}`; contra la IA, `ai-game.surrender`. El despliegue ya tenia "Salir".
- **Girar con R** (o el boton "↻ Girar") el barco en mano: `rotateSelected()`. Acepta `e.code === 'KeyR'` (cualquier distribucion de teclado) e ignora inputs y atajos con Ctrl/Alt/Meta. Al tomar un barco, `showRotateHint()` muestra en el centro del escenario "Pulsa R para girar el barco" + la orientacion; a los 2.6 s se achica a una pastilla arriba (para no tapar donde se apunta) y vuelve a crecer un instante en cada giro.

## Jugar contra la IA (`ai-game.js`, local, NO puntua)
Boton "Jugar contra la IA" en el inicio. Partida sin Firebase: vive en `run.ai` (chrome.storage, sobrevive a cerrar el popup) con la MISMA forma que la de Firebase, asi `play.js` y la escena la muestran igual. `play.js` elige el backend con `api()`: `netApi` (net.js) o `localApi` (funciones puras de `ai-game.js` + `persist({ai})`); `run.mode === 'ai'` marca la partida local (no hay polling). Humano = P1, IA = P2 (`AI_NAME` "IA"); quien parte se sortea; mismo reloj de `TURN_MS`; la revancha es inmediata (flota nueva de la IA, se conserva el marcador).
- **Despliegue:** `randomFleet()` al azar con las reglas de `game.js` (`canPlaceShip`/`canPlaceBomb`).
- **Disparo (`aiPickShot`), cada `AI_THINK_MS` (1.1 s) via `scheduleAiMove()`:** 1) *rematar*: si algun barco del jugador tiene impactos y sigue a flote (`openHits`, info que la niebla de guerra tambien muestra), prolonga la linea si hay 2+ impactos contiguos alineados; si no, tantea las 4 vecinas (`targetCandidates`). 2) *cazar*: al azar en damero (el barco mas chico ocupa 2), evitando sus propios barcos y minas. Nunca repite casilla. Puede pisar una mina del jugador, como cualquiera.
- Tests: `tests/unit/batalla-naval-ai.test.js` (PRNG con semilla).

## Escena 3D (`popup/scene/`)
Three.js (dependencia npm, empaquetada por Vite: cumple el CSP `script-src 'self'`). `play.js` la carga con `import()` dinamico recien al entrar al despliegue o a la batalla: el popup de inicio no paga el chunk `board3d.js` (~600 KB).
```
board3d.js      API: createBoard3D({onCellClick,onCellHover}) -> attach(el) · setMode('placing'|'battle') · setState(vs) · setGhost(g) · setTargetable(fn) · dispose()
visual-state.js PURO (testeado): snapshot -> { myShips, enemySunk, enemyHits, mines, misses, shotByMe } con la niebla de guerra
layout.js       1 unidad = 1 casilla, tablero centrado en el origen (fila 0 al fondo). cellCenter/cellAt + OLEAJE: WAVES (4 trenes de ondas) + TIDE (marea lenta) -> swell() en JS y WAVES_GLSL para el shader (una sola definicion: lo que flota sigue a la superficie que se ve). Casillas en TILE_Y=0.27, por encima de las crestas
camera.js       Perspectiva, inclinada 20° respecto de la vertical; el encuadre se ajusta al aspect ratio (el "zoom")
water.js        Plano 80x80 + ShaderMaterial: WAVES_GLSL en el vertex shader; normales por derivadas (facetado), valles oscuros/crestas claras, espuma en crestas, destellos del sol y vetas de corriente
tiles.js        InstancedMesh de 256 losas blancas semitransparentes que flotan; las ya disparadas se tinen
ships.js        Clon del .glb por barco; dano por seccion (segN <-> segN_broken, o sunk). Movimiento: arfada con la ola + cabeceo/rolido segun la PENDIENTE de la ola bajo proa/popa/bandas + vaiven propio + leve guinada; los barcos chicos se mueven mas
props.js        Minas (flotan y giran), bala hundida (agua), restos en llamas (impacto a barco rival oculto), mancha de mina
fx.js           impact (destello + bola de fuego + astillas + humo + anillo, <=1.5 s), explosion (mina, mas grande y humo negro), smoke (hundimiento), splash. Temblor de camara via fx.shake()
reticle.js      Mira: circulo rojo con X, solo donde se puede disparar
../icons.js     SVG de la bandeja: perfil de cada barco (mismos colores/aparejo que el .glb) y mina
models.js       GLTFLoader de assets/models/*.glb (cache por popup)
```
**Animaciones por diferencia, no por evento:** `setState` compara con lo ya conocido (`baseline`) y anima lo nuevo (impacto -> humo, agua -> salpicadura, mina -> explosion, hundido -> humo oscuro en todo el casco). El cambio de modelo se RETIENE `SMOKE_COVER_MS` (350 ms): se ve el modelo viejo hasta que el humo lo tapa. El primer `setState` de cada modo es la linea base (reabrir el popup no repite animaciones). Un barco rival solo se dibuja entero cuando se hunde; antes, sus impactos son restos en llamas.

**HUD en HTML** encima del canvas (`.bn-stage` > `.bn-canvas` + `.bn-hud` con dos `.bn-panel`): con escenario ancho, paneles a los lados; con escenario angosto (side panel vertical, container query), arriba y abajo. El resultado es un cartel centrado. Una grilla de 256 botones invisibles (`.bn-a11y`, clase `bn-cell`) mantiene teclado y lector de pantalla.

**Tamano:** durante la partida `body.bn-wide` ensancha el popup a 800x600 (maximo de Chrome); `releaseBoard()` la quita al salir de la partida (en `route()` y en `teardown()`), junto con el `dispose()` de la escena (renderer, geometrias y contexto WebGL).

## Modelos (`assets/`)
Hechos en Blender con `assets/blender/build_models.py` (primitivas por script: color solido, sombreado plano, sin texturas). Para regenerarlos se ejecuta dentro de Blender (p. ej. via el MCP de Blender):
```python
exec(open(r"<repo>/src/features/batalla-naval/assets/blender/build_models.py").read(),
     {"__name__": "__main__", "OUT_DIR": r"<repo>/src/features/batalla-naval/assets/models"})
```
Cada grupo se exporta en una escena limpia, asi los nodos conservan su nombre exacto (sin `.001`). **Contrato de nombres** (lo buscan `ships.js`/`props.js`): los barcos van con la proa hacia +X, centrados, con la linea de flotacion en y=0 y los nodos `seg0..seg{n-1}` (seg0 = popa = primera casilla), `segN_broken` y `sunk`. Los estilos: `s4` navio de linea (3 mastiles, dos baterias), `s3` fragata (2 mastiles) y `s2a`/`s2b` balandra (cangreja; casco rojo o azul). Ademas estan `mine.glb` (Hertz horns + aro) y `cannonball.glb`. `ships.js` ensancha la manga x1.45 porque desde arriba el casco se ve angosto.

## Probar
`npm run build:chrome`, recargar la extension y abrir `popup.html`. Para una partida sin segundo jugador: escribir `games/<uidA>__<uidB>` por REST con el rival ya `ready` y `gato:run` en `{phase:'playing', gameId, role}`; los disparos del rival se simulan con un PATCH (`setup/<rol>/ships/<i>/hits/<r_c>`, `last`, `turn`). **Borrar la partida de prueba al terminar.** La escena sola se puede montar con `import('/board3d.js')` desde la consola del popup y darle estados a mano.
