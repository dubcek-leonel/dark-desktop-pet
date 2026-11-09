# Dark — mascota de escritorio con IA

Una mascota que vive sobre tus ventanas de Windows: camina, se sienta, duerme, se cuelga del borde de la pantalla y conversa contigo. Hecha con **Electron + TypeScript**.

## Qué hace

- 🐾 **Vive en el escritorio**: ventana transparente que deja pasar los clics, con 22 animaciones (caminar, dormir, colgarse, bailar, emociones…). Puedes arrastrarlo y soltarlo, y cae con gravedad.
- 💬 **Chat con IA** en una burbuja de cómic, con personalidad configurable. Proveedores:
  - Google AI Studio (Gemini)
  - Cualquier API compatible con OpenAI
  - Ollama (local)
- ⚡ **Acciones por chat**:
  - Recordatorios, también repetidos: *"recuérdame tomar agua en 20 minutos"*, *"todos los días a las 9…"*
  - Pomodoro: *"pon un pomodoro de 45 minutos"*
  - Cancelar recordatorios
  - Animaciones: *"baila"*
  - Anotar datos: *"acuérdate de que…"*
- 🧠 **Memoria**: recuerda datos sobre ti entre conversaciones (se pueden ver y borrar).
- 🎙 **Voz**:
  - **Habla** con Piper (local, instantáneo) o con las voces naturales de Gemini.
  - **Escucha** con Whisper (local) o con Gemini.
  - Se activa con su nombre (*"Dark, …"*) y sigue la conversación sin que tengas que volver a llamarlo.
- 🍅 **Pomodoro**: mientras corre el foco, Dark trabaja en su laptop, y en el descanso baila.

## Ajustes

Los ajustes abren directamente en **Conexión**. Las categorías de la izquierda
son **Conexión**, **Voz y micrófono**, **Personaje**, **Recordatorios y foco** y
**Memoria**. El botón **Guardar cambios** siempre queda visible y confirma si se
guardó la configuración. Cambiar de categoría conserva lo que estás editando.

En **Voz y micrófono**, activa solo lo que quieras usar. Las voces locales y el
reconocimiento local se descargan con un botón explícito; no se descargan al
abrir la pantalla. Las pruebas de voz y micrófono guardan primero los cambios.

En **Recordatorios y foco** puedes crear recordatorios y controlar el Pomodoro
sin conectar la IA. **Abrir chat** está disponible desde cualquier categoría.

## Interacción con el personaje

- **Un clic:** Dark saluda o se despierta. Durante un Pomodoro muestra el tiempo restante.
- **Doble clic:** hace una animación; si está dormido, se despierta.
- **Arrastrar y soltar:** conserva el punto de agarre y cae con gravedad; junto al borde superior puede quedarse colgado.
- **Clic derecho → Conversar:** abre una barra pequeña para escribir debajo del personaje. Las respuestas aparecen en una burbuja aparte, encima de él.
- **Clic derecho → Hablar por voz**, o el micrófono de la barra: empieza a escuchar. Vuelve a pulsarlo para detener la escucha.
- **Enter:** enviar. **Esc** en la barra: cerrar la conversación y detener la escucha.
- **Clic sobre la respuesta / Siguiente:** avanzar por las páginas de una respuesta larga. Cerrar una respuesta deja abierta la barra para escribir.
- El menú también permite cambiar el tamaño, activar el paseo, sentarlo, hacerlo bailar o dormir.

Mientras la barra está abierta, Dark se queda cerca y deja espacio para escribir.
Las respuestas conservan los controles **Detener** y **Reintentar**. En
**Conversación reciente** puedes revisar los últimos turnos de esta sesión o
limpiarlos con confirmación. Los recuerdos personales se gestionan por separado.
El historial de conversación no se conserva al salir de la aplicación.

## Uso

```bash
npm install
npm run dev       # abrir en modo desarrollo
npm test          # tests
npm run dist      # instalador de Windows en dist/
```

La primera vez se abren los **Ajustes**: pega tu API key (por ejemplo, de [Google AI Studio](https://aistudio.google.com)). La key se guarda cifrada con tu usuario de Windows.

## Estructura

```
assets/character/dark/   sprites (atlas 8×22 de 256 px), dark.json, íconos
src/core/                lógica pura y testeada: comportamiento, animación, IA, acciones, voz
src/main/                Electron: ventanas, bandeja, chat, recordatorios, Pomodoro, voz
src/preload/             puente seguro (canales IPC permitidos)
src/renderer/            sprite, burbuja, ajustes, ventana de audio
tests/                   Vitest
docs/plans/              plan del proyecto
```

### Prueba en vivo con Gemini (opcional)

```bash
$env:GEMINI_KEY="tu-key"; npx vitest run tests/live.gemini.test.ts
```

## Nota sobre el arte

Los sprites incluidos son de uso personal. Antes de publicar o distribuir la app, hay que reemplazarlos por un personaje original.

## Verificación de la experiencia

Después de `npm run build`, estas comprobaciones opcionales usan Python con
Playwright y Microsoft Edge instalado:

```bash
python tests/chat-ui-check.py
python tests/pet-interaction-check.py
python tests/companion-ui-check.py
python tests/desktop-experience-check.py
```

La última abre Electron con un perfil temporal separado, sin credenciales, y
comprueba recordatorios guardados, Pomodoro, validación de entradas y recuperación
del chat. No modifica la configuración habitual del usuario.
