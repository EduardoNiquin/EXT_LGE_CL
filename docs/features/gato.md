# GATO (tic-tac-toe secreto)
Easter egg multijugador. **Feature SOLO de popup** (sin content script ni detector): el matchmaking y la partida corren mientras el popup/sidepanel esta abierto, contra **Firebase Realtime Database** via su **API REST** (NO el SDK: el CSP `script-src 'self'` lo bloquearia e inflaria el bundle).

**Desbloqueo (en `src/popup/popup.js`):** tocar el toggle de tema **`UNLOCK_CLICKS` (10) veces seguidas** (clics dentro de `UNLOCK_WINDOW_MS`=1500ms entre si). Flag persistido en `localStorage["ext:gato-unlocked"]`. Al desbloquear: el "logo" (la `.header-accent-bar` del header) se convierte en un **gatito** (SVG Twemoji limpio, `catSvg()` en constants) con animacion `gato-pop`, y la feature aparece en el home. Las features con `secret:true` (en `features.js`) se filtran via `visibleFeatures()` hasta el desbloqueo.

```
src/features/gato/
├── constants.js   RTDB_BASE, STORAGE_KEYS, UNLOCK_*, PHASE (idle/searching/challenged/playing/finished/leaderboard/ai), GAME_STATUS, WINNER, ROLE, AI_ROLE/AI_NAME, WIN_LINES, TURN_MS, POLL/PRESENCE/SEARCHERS timings, LEADERBOARD_PATH, CAT_SVG_PATHS + catSvg()
├── game.js        Logica pura: board/findWinner/isFull/otherRole/rolesFromUids/pairId/roleForUid + normalizeName/nameKey (ranking) + aiPickMove (IA defensiva)
├── ai-game.js     Partida local contra la IA (sin Firebase, NO puntua): makeAiGame/humanMove/cpuMove/passHuman
├── net.js         Presencia + matchmaking por reto + ranking + jugadas contra Firebase (usa shared/rtdb)
├── state.js       run store (gato:run) + draft (gato:draft, nombre) + getUid() (localStorage)
├── debug.js       __extLgeCl.gato.* (registrado desde view.js, contexto popup)
├── shared/rtdb.js Cliente REST minimo: rget/rset/rupdate/rpush/rremove + rgetWithEtag/rsetIfMatch (concurrencia optimista)
└── popup/ view.js (router 1 seccion + side-effect import de debug.js) · sections/play.js (toda la maquina de estados/UI)
```

**Identidad:** `getUid()` genera un uid estable (base36, seguro como key Firebase) en `localStorage["ext:gato-uid"]`. Roles deterministas: **P1 = uid menor** (marca **ROJO** `✕`), **P2 = uid mayor** (marca **NEGRO** `○`).

**Maquina de estados (`PHASE`, persistida en `gato:run` para restaurar al reabrir):** `idle` (nombre + jugadores activos + **Buscar partida / Jugar contra la IA / Clasificaciones**) → `searching` (lista de rivales para retar) → `challenged` ("X te ha retado", forzado) → `playing` (tablero) → `finished` (Ganador/Empate); ademas `leaderboard` (ranking) y `ai` (partida local). El "puntero" (phase+gameId+role o la partida IA en `run.ai`) vive en storage; la **verdad de la partida multijugador vive en Firebase** y se sondea por **polling** (`POLL_MS`=1s, sin SDK ni SSE).

**Presencia (`net.js`):** heartbeat `presence/$uid={name,ts}` cada `PRESENCE_BEAT_MS`; "activo" = ts dentro de `PRESENCE_FRESH_MS` (30s). `countActivePlayers` excluye al propio uid. Sin `onDisconnect` (feature del SDK) → presencia best-effort por frescura de ts.

**Matchmaking POR RETO (reemplaza el emparejamiento aleatorio):** se escribe un ticket `matchmaking/$uid={uid,name,ts,gameId,challenge}`. Mientras buscas, `listSearchers` muestra a los demas con ticket fresco y sin partida; **retas** a uno (`challengePlayer`). El retado queda **obligado** (`pollTicket` ve su `gameId`+`challenge` → fase `challenged` → "X te ha retado" → tablero). **Concurrencia (clave):** para que dos retos simultaneos al mismo rival no se pisen, el reclamo del slot del rival y del propio es **atomico via ETags** (`rgetWithEtag` + `rsetIfMatch`, `if-match`): si el slot ya esta tomado → `busy`; si me retaron a mi a la vez → `already-matched` (con rollback del reclamo del rival). El `gameId` es simetrico (`pairId`), asi que un reto mutuo converge a la **misma** partida.

**Partida (`games/$gameId`, gameId = `pairId` = uids ordenados con `__`):** `{ players:{P1,P2:{uid,name}}, board[9], turn, status, winner, moveDeadline, rematch:{P1,P2}, leaver, score:{P1,P2}, startedAt }`. **gameId determinista por par** ⇒ el **marcador de victorias sobrevive** entre revanchas y reconexiones. **Quien parte se elige al azar**. `ensureGame` preserva `score` existente y no pisa una partida en curso.

**Reloj (`TURN_MS`=10s):** tick local cada 250ms muestra el restante de `moveDeadline`. **Solo el jugador en turno escribe** sus jugadas (`makeMove`) y, si se agota su tiempo, **pasa su propio turno** (`passTurn`, una vez por deadline). `makeMove` resuelve ganador (3 en raya, `findWinner`) o empate, suma al marcador de la partida y, si hay ganador, **incrementa el ranking global** (lo hace solo quien cierra la jugada → un unico incremento).

**Clasificaciones / ranking global (`leaderboard/$nameKey={name,wins}`):** persistente y visible para todos. La key es el **nombre normalizado** (`nameKey`: minusculas, sin acentos, sanitizado para Firebase) ⇒ **case-insensitive** ("Pedro08" == "pedro08"). El incremento usa el **server value atomico** `{".sv":{"increment":1}}` (sin transacciones, sin perder cuentas en finales simultaneos). La vista lista nombre + victorias, orden desc.

**Jugar contra la IA (`ai-game.js`, local, NO puntua):** partida sin Firebase persistida en `run.ai`. Humano = P1 (ROJO), IA = P2 (NEGRO), quien parte al azar, mismo reloj de 10s. **IA defensiva (`aiPickMove`):** NO juega para ganar sino para **evitar perder** — si el humano amenaza con cerrar un 3 en linea (dos suyas + la tercera libre), tapa esa casilla; si hay varias amenazas tapa una; si no hay amenazas juega **al azar**. Defensiva ante tablero lleno/invalido (devuelve -1). La jugada de la IA se agenda con `AI_THINK_MS` de pausa.

**Revancha/salida:** multijugador → "Volver a jugar" marca `rematch/$role`; cuando ambos aceptan, **el host (P1) reinicia** preservando el marcador. IA → reinicia al instante preservando el marcador local. "Salir" (`leaveGame`): MP marca `leaver` (best-effort, el rival ve "abandono") + saca el ticket; IA limpia `run.ai`; ambos vuelven a `idle`. Navegar fuera dispara teardown via `aliveAndAttached()` (el popup no llama unmount): limpia timers, presencia y, si estaba `searching`, el ticket.

**UI (`sections/play.js`):** idle con 3 botones; searching con lista de rivales + botones "Retar" (deshabilitados durante el reto) + mensajes inline; reto recibido; ranking; tablero compartido MP/IA (topbar rival+reloj, turno, tablero 3×3 `border-radius:12px`/`aspect-ratio:1`, marcador, resultado). CSS `.gato-*` y `.header-accent-bar--cat/--pop` en `popup.css`.
**Debug `__extLgeCl.gato.`:** `uid()`, `state()`, `active()`, `searchers()`, `leaderboard()`, `game(id)`, `leave()`, `reset()`.

**Reglas RTDB (agregar `leaderboard`):**
```json
{ "rules": {
  "presence":    { "$uid": { ".read": true, ".write": true } },
  "matchmaking": { ".read": true, ".write": true },
  "games":       { "$gameId": { ".read": true, ".write": true } },
  "leaderboard": { ".read": true, ".write": true }
} }
```
**Pendientes/limitaciones:** la partida MP solo avanza con el popup abierto (persiste el estado, no el juego de fondo); si el jugador en turno cierra el popup nadie pasa su turno; matchmaking por reto sin transacciones reales (mitigado con ETags); reglas RTDB abiertas (sin auth); colisiones raras de `nameKey` si dos nombres distintos normalizan igual.
