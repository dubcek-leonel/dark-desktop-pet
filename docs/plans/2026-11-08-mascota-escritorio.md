# Plan: Dark — mascota de escritorio con IA

**Objetivo:** una app de escritorio para Windows donde **Dark** (un personaje original en sprites 2D) vive sobre las ventanas: camina, se sienta, duerme, se cuelga del borde, se puede arrastrar y conversa contigo. La IA puede ser local (Ollama) o en la nube (Claude u OpenAI) por API key. Más adelante tendrá memoria, recordatorios, voz y extras.

**Referencia:** se inspira en las *funciones* de "Capri AI" (itch.io). No se copia el personaje, el nombre, el arte ni el diseño.

**Última actualización:** 2026-11-08 (se agregan los sprites de Dark y el selector de proveedor de IA).

## Contexto del equipo (comprobado el 2026-11-08)

| Recurso | Estado |
|---|---|
| Sistema | Windows 11, 32 GB RAM |
| GPU | RTX 3050 Laptop, **4 GB VRAM** |
| Node / npm | v22.14.0 / 10.9.2 ✅ |
| Python | 3.11.9 ✅ |
| Git | 2.49 ✅ (la carpeta todavía no es repo) |
| Ollama | ❌ no instalado (es opcional si se usa una API en la nube) |

Con 4 GB de VRAM, el modelo local por defecto es **`qwen3:4b`**.

## Assets del personaje (listos)

Origen: `Downloads\dark-completo-22-animaciones.zip` → se copia a `assets/character/dark/`.

- 22 animaciones y 101 frames; PNG RGBA de 256×256, mirando a la derecha.
- Centro horizontal en x=128, pies en y=244 (hang: manos en y=12).
- `dark.json`: frames, `durationMs` por frame, `loop`, fila del atlas y patrón de archivo.
- `dark-atlas.png` (8 columnas × 22 filas), `icon-512.png` y `tray-32.png`.

| Grupo | Animaciones |
|---|---|
| Movimiento | idle, walk, drag, fall, land, hang |
| Descanso | sit_down, sit, yawn, sleep, wake_up |
| Conversación | think, listen, talk |
| Emociones | happy, sad, angry, surprised |
| Interacción | wave, click, work, dance |

## Restricciones globales

- **Stack:** Electron + Vite + TypeScript (plantilla `electron-vite`). Tests con **Vitest**.
- **Seguridad de Electron:** `contextIsolation: true`, `nodeIntegration: false`; todo acceso al sistema pasa por `preload` + IPC con tipos.
- **Las API keys** se guardan cifradas con `safeStorage` de Electron, nunca en texto plano ni en el repo. Las llamadas a la nube salen solo desde el proceso main.
- **Datos del usuario** en `app.getPath('userData')` (`config.json`, `memoria.json`).
- **Lógica pura separada de Electron** (`src/core/`) para testearla sin abrir ventanas.
- Cada tarea termina con tests en verde y un commit.

## Arquitectura

```
assets/character/dark/   sprites + dark.json + íconos
src/
  main/        ventanas, bandeja, IPC, movimiento de la ventana, llamadas a la IA
  preload/     puente seguro (window.api)
  renderer/    dibujo del sprite, burbuja de chat, ajustes
  core/        lógica pura: comportamiento, animaciones, proveedores de IA, config, memoria
tests/         Vitest
```

---

## Fase 1 — MVP: Dark vivo en el escritorio + chat (Tareas 1–8) ✅ hecha 2026-11-08

### Task 1: Preparar el proyecto
- `git init`, `.gitignore` (node_modules, out, dist, .superpowers).
- Generar la plantilla `electron-vite` (vanilla-ts) en la raíz, agregar Vitest y el script `npm test`.
- Copiar el paquete de Dark a `assets/character/dark/`.
- **Expected:** `npm test` pasa; `npm run dev` abre una ventana.
- Commit: `chore: scaffold electron-vite + vitest + dark assets`.

### Task 2: Ventana transparente sobre el escritorio
- Ventana de 256×256 `transparent`, `frame: false`, `alwaysOnTop` (nivel `screen-saver`), `skipTaskbar`, sin sombra y sin cambio de tamaño.
- Que los clics atraviesen lo transparente: `setIgnoreMouseEvents(true, { forward: true })`. El renderer revisa el alfa del píxel bajo el mouse y avisa por IPC cuando el puntero está sobre Dark.
- Bandeja del sistema con `tray-32.png`: Mostrar/Ocultar, Chat, Ajustes, Salir.
- **Expected:** se puede hacer clic en lo que está "detrás" de Dark, excepto en él mismo.
- Commit: `feat: transparent click-through pet window + tray`.

### Task 3: Reproductor de animaciones (TDD)
- `src/core/animation.ts`: carga `dark.json` y, dado un tiempo, devuelve el frame actual. Respeta `loop: false` (avisa con `onFinished`) y el volteo horizontal.
- Renderer: `<canvas>` de 256×256 que dibuja el frame desde el atlas, con espejo si mira a la izquierda.
- Tests: avance de frames por `durationMs`, que las animaciones de una vez terminen y avisen, y que el loop vuelva a 0.
- **Expected:** tests en verde; Dark aparece en idle en pantalla.
- Commit: `feat: sprite animation player`.

### Task 4: Motor de comportamiento (TDD)
- `src/core/behavior.ts`: máquina de estados con los grupos de arriba. Entradas: tiempo, área de trabajo (`workArea` de cada monitor), posición, eventos (clic, arrastrar, soltar, IA pensando/hablando/emoción). Salida: estado, animación y nueva posición.
- Reglas:
  - Al abrir: `wave` → `idle`.
  - En reposo: alterna al azar `idle`, `walk` hacia un punto al azar, `sit_down → sit` y a veces `dance`.
  - Sin actividad por N minutos: `yawn → sleep`; al hacer clic: `wake_up → idle`.
  - Clic: `click`; varios clics seguidos: `surprised`.
  - Arrastrar: `drag`; al soltar: `fall` con gravedad hasta la barra de tareas → `land` → `idle`.
  - Soltar pegado al borde superior: `hang`.
  - Nunca sale del área visible, ni con varios monitores.
- Tests de cada transición, de los límites y de la gravedad.
- **Expected:** tests en verde.
- Commit: `feat(core): pet behavior state machine`.

### Task 5: Unir comportamiento, ventana y arrastre
- El main ejecuta el tick (~30 fps), mueve la `BrowserWindow` y envía el estado al renderer.
- Arrastre con el mouse (posición global) y suelta → física.
- **Expected:** Dark camina, se sienta, se duerme, se arrastra, cae, aterriza y se cuelga.
- Commit: `feat: wire behavior to window movement`.

### Task 6: Proveedores de IA (TDD)
- `src/core/ai/`: una interfaz común `AIProvider.chat(messages, onToken)` con streaming.
- **Decisión del usuario (2026-11-08): Google AI Studio (Gemini) como proveedor principal.** Se implementa como cliente **compatible con OpenAI** (`/v1beta/openai/chat/completions` de `generativelanguage.googleapis.com`), así el mismo código también sirve para OpenAI y Groq. Ollama queda como segunda opción. Claude se deja para más adelante.
- **Personalidad elegida: sarcástico y algo flojo.**
- Prompt de sistema con la personalidad de Dark. La IA termina cada respuesta con una etiqueta de emoción `[emo:happy|sad|angry|surprised|neutral]`, que se quita del texto y dispara la animación.
- Errores claros: sin conexión, key inválida, modelo inexistente, timeout.
- Tests con `fetch`/SDK simulados: stream, extracción de la emoción y errores.
- **Expected:** tests en verde.
- Commit: `feat(core): pluggable AI providers with streaming`.

### Task 7: Burbuja de chat
- Clic derecho o doble clic en Dark → campo de texto. Al enviar: `think` mientras espera, `talk` mientras escribe la respuesta en una **burbuja** encima, y al final la emoción → `idle`.
- La burbuja es una segunda ventana transparente que sigue a Dark.
- Historial de la sesión (últimos N mensajes) como contexto. Ventana de chat completa desde la bandeja.
- **Expected:** escribes "hola", Dark piensa, responde en la burbuja y reacciona.
- Commit: `feat: chat bubble wired to AI`.

### Task 8: Ajustes y configuración persistente (TDD en config)
- `src/core/config.ts`: valores por defecto + validación + guardado.
- Ventana de ajustes: proveedor y modelo (lista desde el proveedor), API key (cifrada con `safeStorage`), nombre y personalidad, tamaño (escala 0.5×–2×), velocidad, frecuencia de baile o siesta, iniciar con Windows.
- **Expected:** los cambios se mantienen al reiniciar.
- Commit: `feat: settings window + persistent config`.

**Fin de la Fase 1:** app usable. Se revisa todo antes de seguir.

---

## Fase 2 — Memoria, utilidades e instalador (Tareas 9–12) ✅ hecha 2026-11-08

### Task 9: Memoria a largo plazo
- `memoria.json` con hechos sobre el usuario que la IA extrae al final de cada conversación (respuesta en JSON). Se inyectan en el prompt de sistema.
- En los ajustes: ver, editar y borrar recuerdos.

### Task 10: Recordatorios
- "Recuérdame X en 20 min" → etiqueta `[recordar:+20m|X]` en la respuesta (en vez de *tool calling*: funciona igual con todos los proveedores y con streaming) → notificación de Windows + Dark hace `wave` y lo dice en la burbuja.
- Los recordatorios se guardan y sobreviven a un reinicio.

### Task 11: Pomodoro
- 25/5 configurables. Durante el foco: `work` y sin interrupciones; en el descanso: `dance` o `wave` y un mensaje.

### Task 12: Instalador
- `electron-builder` → `.exe` (NSIS) con `icon-512.png` convertido a `.ico`.

## Fase 3 — Voz (Tareas 13–15)

### Task 13: Texto a voz (Piper, local)
- Se descargan el binario y una voz en español al activar la voz. Dark usa `talk` mientras suena el audio.

### Task 14: Voz a texto (whisper.cpp, local)
- Mantener una tecla o un botón para hablar → `listen` → transcripción → chat.

### Task 15: Palabra de activación
- Decir "Dark" lo activa. Se puede desactivar y muestra un indicador de "escuchando" (`listen`).

## Fase 4 — Extras (opcional)

- **Task 16:** comentarios espontáneos (cada X minutos dice algo, configurable).
- **Task 17:** varias skins o personajes (otro paquete con el mismo formato `json`).
- **Task 18:** personaje 3D (Three.js + VRM).
- **Task 19:** mod de Minecraft (Java), conectado por WebSocket local. Es un proyecto aparte.
- **Task 20:** versión Android. Es un proyecto aparte.

---

## Lo que el usuario debe hacer

| Cuándo | Qué |
|---|---|
| Antes de la Tarea 6 | Elegir el proveedor de IA. **Local:** instalar Ollama + `ollama pull qwen3:4b`. **Nube:** crear una API key (Claude u OpenAI) y pegarla en los ajustes (Tarea 8). |
| Antes de la Tarea 6 | Definir la personalidad de Dark (si no, se usa una por defecto: amable, sarcástico y algo flojo). |
| Fase 3 | Aceptar la descarga de Piper y Whisper (~100–300 MB). |

## Riesgos

| Riesgo | Mitigación |
|---|---|
| 4 GB de VRAM: Ollama lento | `qwen3:4b` o un proveedor en la nube |
| Dejar pasar los clics depende del sistema | Solo Windows; ventana del tamaño del sprite |
| Pequeña diferencia de estilo entre sprites viejos y nuevos | Ajustar la escala por animación en `dark.json` si se nota |
| Windows Defender marca un `.exe` sin firma | Avisarlo; la firma de código queda fuera del alcance |
| Filtrar la API key | `safeStorage`, solo el main la usa, nunca se loguea |

## Review Focus

- Seguridad de Electron (aislamiento, canales IPC limitados, manejo de la API key).
- Que Dark nunca quede fuera de la pantalla (varios monitores, cambio de resolución, barra de tareas en otro lado).
- Que los errores de la IA siempre terminen en un mensaje y en `idle`, nunca con la app colgada en `think`.
