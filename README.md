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
