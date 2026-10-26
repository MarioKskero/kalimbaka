# AGENTS.md — Guía para agentes

Este documento resume la arquitectura, las reglas de negocio y las trampas conocidas de **Kalimbapp**. Léelo antes de tocar código.

## 1. Estado del proyecto

- App Angular 22 standalone + SCSS + signals.
- Sin backend. Persistencia en `localStorage`.
- Reproductor en canvas + WebAudio.
- Importación de tabs de texto y MIDI (`@tonejs/midi`).
- Tests con Vitest vía `ng test`.
- Actualmente: **97 tests pasando** y `npm run build` correcto.
- El proyecto está dentro de un repositorio git. No hagas commits salvo que se pida explícitamente.
- La base `/kalimbaka/` se aplica en `deploy.sh` con `--base-href`; la configuración de producción no fija `baseHref`.

## 2. Comandos

```bash
npm install
npm start                  # ng serve --host 0.0.0.0 --port 4300 --poll=1000 --allowed-hosts=*
npm run start:prod         # producción en 0.0.0.0:4300
npm run build              # dist/kalimbapp/browser
npm run watch
npm test -- --watch=false  # tests Vitest
```

No existe script de lint ni runner E2E. Prettier está instalado:

```bash
npx prettier --write .
```

No uses `npm test -- --run`; el flag correcto es `--watch=false`.

## 3. Entorno

- Alpine Linux, Node 24 (probado con 24.22.1), npm 11.
- Angular 22.2.x, TypeScript ~6.0, Vitest 5 + jsdom 30.
- `@tonejs/midi` 2.0.28. Es CommonJS: está declarado en `angular.json` → `allowedCommonJsDependencies`.
- El scaffold es zoneless/signals. Evita introducir `zone.js` sin motivo.
- Presupuesto de estilos por componente: warning 16 kB, error 32 kB.
- El servidor de desarrollo debe escuchar en `0.0.0.0:4300`.

## 4. Estructura

```text
src/core/kalimba/   dominio puro de kalimba (sin Angular)
src/core/midi/      dominio puro MIDI (sin Angular)
src/app/models/     Song e inputs de importación
src/app/services/   biblioteca, ajustes, calibración, audio, fullscreen, parser MIDI
ngsw-config.json    configuración del service worker (app + canciones)
public/manifest.webmanifest + public/icons/  manifest e iconos PWA
src/app/components/ presentacionales: tarjetas, diálogos, canvas, calibración, visor
src/app/pages/      library.page y player.page
public/songs/       tabs/MIDI de demo + index.json
```

Rutas:

- `/` → biblioteca.
- `/play/:id` → reproductor.

## 5. Reglas de arquitectura

- `src/core` **no** debe importar Angular ni servicios de la app.
- Los servicios Angular hacen de puente entre core y UI.
- No poner estado global en componentes.
- Componentes: datos por `input()`, eventos por `output()`.
- Mantener el parser y el timeline puros y testeables.
- La UI está en español; los identificadores de código en inglés.
- Evitar dependencias nuevas. Si hace falta una, revisa licencia, tamaño y compatibilidad con Angular.

## 6. Modelos clave

### Song

```ts
interface Song {
  id: string;
  title: string;
  artist?: string;
  bpm: number;
  kalimbaSize: 8 | 17 | 21;
  tabText: string;
  builtIn: boolean;
  createdAt: number;
  repeat?: boolean;
  midi?: MidiSongData;
  midiSource?: string; // MIDI original en base64, para reconfigurar
  midiFileName?: string;
}
```

- Para canciones MIDI configuradas, `midi` existe y `tabText` es `''`.
- Para MIDI pendientes de configurar, `midiSource` existe y `midi` es `undefined`. El reproductor debe abrir el diálogo de configuración antes de construir el timeline.
- `Song.kalimbaSize` es el tamaño guardado con la configuración MIDI. En MIDI configurado, el reproductor usa ese tamaño; en texto, `settings.kalimbaSize`.
- El reproductor debe bifurcar por `song.midi` y `song.midiSource`.
- No mezclar la lógica de tab de texto y MIDI en la misma rama sin comprobar `midi`.

### MidiSongData

```ts
interface MidiSongData {
  bpm: number; // BPM original del MIDI (para escalar tiempos)
  transposition: number; // semitonos aplicados
  notes: MidiNoteData[]; // startMs/durationMs/midi/velocity
  trackId?: string;
  trackName?: string;
  channel?: number;
  instrument?: string;
  reduction?: MidiReduction;
}
```

### MidiReduction

```ts
interface MidiReduction {
  foldOctaves: boolean;
  snapChromatic: boolean;
  removeChords?: boolean;
}
```

- `DEFAULT_MIDI_REDUCTION` = octavas + cromatismos, sin quitar acordes.
- `RECOMMENDED_MIDI_REDUCTION` = octavas + cromatismos + quitar acordes (solo melodía); es el estado recomendado del diálogo MIDI.
- `STRICT_MIDI_REDUCTION` = todo desactivado.
- Las funciones core reciben `reduction`; si no se pasa, son estrictas. La app pasa `midi.reduction ?? DEFAULT_MIDI_REDUCTION`.
- `removeChords` conserva la nota más aguda de cada grupo simultáneo.

## 7. Catálogo `public/songs/index.json`

### Texto

```json
{
  "id": "song",
  "title": "Song",
  "artist": "Artist",
  "bpm": 84,
  "kalimba": 17,
  "file": "song.txt"
}
```

### MIDI

```json
{
  "id": "song-midi",
  "title": "Song (MIDI)",
  "artist": "Artist",
  "midi": "song.mid"
}
```

- `midi` o `file` con extensión `.mid`/`.midi`.
- Las entradas MIDI **no** fijan `track`, `transposition`, `reduction`, `bpm` ni `kalimba`. La app las ignora: cada usuario configura la canción al pulsar Jugar por primera vez.
- `title` es opcional en entradas MIDI; se usa el título del MIDI como fallback.
- El índice se carga al iniciar y se cachea con `?v=timestamp` + `cache: no-store`.
- Una entrada inválida puede tumbar todas las demos porque `loadBuiltIns` usa `Promise.all`. Valida archivos e IDs.

## 8. Formato de tabs de texto

- Grados `1`–`7`; `8` = `1'`.
- Octava arriba: `°`, `*`, `'`, `′`, `’`, `•`, `·`.
- Dos octavas arriba: `''`, `”`, `**`.
- Octava abajo: `.`, `,`.
- Acordes: `(1 5)`, `(135)`, `(3'1'6)`.
- Silencios: `-`, `0`, `~` (un evento de rejilla cada uno).
- `x2`/`(x2)`/`[x2]` repite la línea.
- `🔁` activa loop.
- Comentarios: `#`, `//`, `;`.
- Líneas con 2+ letras se ignoran como letras de canción.
- Metadatos: título, artista, BPM, kalimba, `grid`.
- `grid` = eventos por pulso (`1`, `2`, `3`, `4`, `6`). Por defecto 1.
- **Las líneas en blanco son pausas**: exactamente 1 beat por línea en blanco. Es una regla fija, sin UI de configuración.
- La pausa de frase es un beat completo aunque el grid sea 2 o 4.
- La articulación (“pausa entre notas”) no cambia el tempo; solo acorta la nota.
- No introduzcas líneas en blanco en tabs generados salvo que quieras una pausa.

## 9. Timeline de texto

- `buildTimeline` coloca eventos cada `1 / eventsPerBeat` de beat.
- `pauseAfterBeats` se mide en beats completos.
- `startBeat` puede ser fraccionario.
- La duración de nota es `beatMs * (1 / eventsPerBeat) * noteFill`.
- `totalMs` incluye count-in y pausas.
- El metrónomo usa `timeMs / beatMs`; con grid 2 o 4 sigue marcando beats musicales, no cada evento.

## 10. MIDI: invariantes

### Tiempo

```ts
const scale = sourceBpm / bpm;
```

**No invertir esta fórmula.** Subir BPM debe acortar los tiempos; bajar BPM debe alargarlos.

- `countInMs` usa el BPM actual.
- `startMs = countInMs + (note.startMs - firstStart) * scale`.
- Se recorta el silencio inicial por pista en `MidiImportService` y también al construir el timeline.
- Se usa el tempo inicial; los cambios internos de tempo no mueven el metrónomo.

### Mapeo y reducción

Orden:

1. **Exacta**.
2. **Octava** si `foldOctaves` y la clase de nota existe en el layout.
3. **Cromatismo** si `snapChromatic` y la clase de nota **no** existe en el layout; se elige la tecla más cercana en semitonos.
4. **Sin candidato** → omitida.

- Un cromatismo no se puede conservar exacto en una kalimba C major.
- Una nota natural fuera de rango con `foldOctaves: false` se omite; no se ajusta a otra clase de nota.
- Los acordes se reparten sin repetir carril; puede haber backtracking o greedy.
- Notas idénticas simultáneas se deduplican para el mapeo y comparten carril.
- `removeChords` deja la nota más aguda del grupo.
- El informe debe distinguir: exactas, octavas, ajustadas y omitidas.
- `removedChordNotes` no cuenta como “omitida” en el aviso de pérdida.

### Transposición

- Si el JSON/import define `transposition`, se respeta (clamp -24..24).
- En la primera configuración, `suggestTransposition` se aplica al elegir pista (Auto por defecto). En reconfiguraciones se respeta la transposición guardada. Si el usuario la ajusta a mano, deja de recalcularse hasta que pulse **Auto**.
  - estricta: maximiza notas exactas;
  - con reducción: minimiza coste (exactas, plegados, ajustes y omisiones).
- La transposición debe fijarse antes de guardar la configuración MIDI.

### Pistas

- `MidiImportService` separa pistas/canales con @tonejs/midi.
- Se ignora percusión en el diálogo (canal 9 zero-based).
- Se sugiere melodía por altura media, número de notas, monofonía e instrumento y se preselecciona al configurar la canción; el usuario puede cambiarla.
- El catálogo MIDI no fija pista.

## 11. Reproductor

- El canvas dibuja y emite `noteHit` al cruzar `startMs`; el audio usa ese evento.
- En texto, el reproductor usa `settings.kalimbaSize`; en MIDI configurado usa `Song.kalimbaSize`. En MIDI sin configurar usa el tamaño base de ajustes y abre el diálogo de configuración antes de crear el timeline.
- El diálogo MIDI parte del BPM original del MIDI y de `RECOMMENDED_MIDI_REDUCTION` (octavas, cromatismos y quitar acordes). La pista se preselecciona con la melodía probable; la transposición se calcula con **Auto** y se puede ajustar a mano.
- En la primera configuración, el diálogo ofrece **Aplicar recomendados**: pista sugerida, BPM original, tamaño base, `RECOMMENDED_MIDI_REDUCTION` y transposición Auto. Tras aplicarlo, el botón pasa a **Guardar configuración**; si la configuración deja de coincidir con la recomendada, vuelve a **Aplicar recomendados**. La X de al lado cierra descartando cambios.
- La configuración MIDI se guarda en la canción. **“Listo para tocar”** debe mostrar pista, transposición y reducción, y permitir reabrir el diálogo con **Configurar MIDI**.
- Mantén los avisos y el selector de tamaño en canciones de texto. En MIDI configurado, el tamaño se cambia desde **Configurar MIDI**, no desde el selector global.
- El tick del HUD se emite a ~15 fps.
- **Pausa**: congela pantalla y audio sin abrir modal.
- **Engranaje**: pausa y abre modal de ajustes.
- **Atrás**: durante la partida abre el menú de pausa; si no, vuelve a la biblioteca.
- **−10/+10 s**: barra superior, modal y flechas; usa tiempo musical sin count-in.
- **Reanudar**: cuenta atrás opcional 0–4; por defecto 0.
- **HUD inferior**: “Ahora” se vacía durante silencios; “Siguiente” salta rests y muestra la próxima nota real.
- Durante la reproducción la cabecera desaparece para dejar ver la caída de notas; un botón circular flotante con chevron en la parte superior la muestra de nuevo y vuelve a ocultarse a los ~3,2 s. El HUD (Ahora, progreso y Siguiente) vive abajo, siempre visible y semitransparente.
- La línea de golpe del reproductor está al 2/3 de la altura (un tercio desde abajo), con una kalimba dibujada debajo: cuerpo de madera, puente, tinas de distinta longitud y la central marcada en ámbar. Calibración y reproductor comparten esa base para que el offsetY siga siendo válido. Los carriles y teclas solo se iluminan con pulsaciones manuales (touch o teclado), no con notas automáticas; la línea de golpe es fija y sin brillo.
- El tamaño de nota es fijo (según el ancho/carril). `computeNoteScroll` mantiene la separación vertical mínima según la rejilla y reduce los pulsos visibles si la altura no da para el tamaño configurado; no se comprime la zona de caída.
- La canción se reinicia al cambiar tamaño, BPM o articulación. Las pausas de frase son fijas: una línea en blanco = 1 beat.
- El loop de MIDI usa el ajuste de loop, no un `repeat` de canción.
- La app intenta fullscreen en el primer gesto y ofrece un icono para reintentarlo. `FullscreenService.isActive` debe reflejar `fullscreenchange`; no marcarlo activo de forma optimista.
- Volver del reproductor a la biblioteca no debe salir de fullscreen. El único control de la app para salir es el icono de la biblioteca, que alterna entrar/salir.
- La pausa y el seek deben cortar notas activas.
- El teclado manual usa el mapa puro de `src/core/kalimba/keyboard.ts`, se persiste en `kalimbapp.keyboard.v1` y comparte asignaciones por nota entre tamaños. Mantén reservadas `Esc`, espacio, flechas, modificadores y `F1–F12`.
- `PlayerSettings.noteColors` define los colores por defecto por grado (1–7); `PlayerSettings.tineColors` guarda overrides por ID de tina y permite repetir el mismo color en varias teclas. Canvas, teclas y calibración resuelven `tineColors[tine.id] ?? noteColors[grado]`. El modo colores del reproductor edita la tina tocada con una paleta táctil y sliders HSL, sin input nativo.
- La captura de teclado usa `event.code`, ignora repetición/modificadores/modales y limpia carriles activos al perder foco; el canvas solo dibuja el feedback recibido.
- El canvas convierte punteros de toda la columna visible en `lanePress`/`laneRelease` (multitáctil y glissando); el reproductor sintetiza la nota y une esos carriles con los del teclado en `manualLanes`. El audio y el estado viven en el reproductor, no en el canvas.
- No metas lógica de negocio en el canvas; solo dibujo/reloj.

## 12. Calibración y almacenamiento

Claves:

- `kalimbapp.songs.v1`
- `kalimbapp.settings.v1`
- `kalimbapp.calibration.v1`
- `kalimbapp.keyboard.v1`
- `kalimbapp.builtin-midi.v2`

Calibración:

- por tamaño de kalimba;
- ancho inicial del 90% (`scale: 0.9`), `−/+` escala, arrastre para offset, reset;
- offsets normalizados;
- no hay cámara/AR.

## 13. Visor y exportación

- Icono del ojo en cada tarjeta.
- Texto: tab original + copiar.
- MIDI: resumen, lista de notas y estadísticas de reducción.
- “Exportar tab” en MIDI:
  - rejilla 1/4, 1/8, 1/16;
  - silencios opcionales;
  - BPM objetivo;
  - descarga `.txt` o añade a biblioteca.
- La exportación es **aproximada**: pierde duraciones exactas, velocity, cambios de tempo y microtiming.
- El tab generado usa `grid` y no debe contener líneas en blanco salvo que se quiera pausa.

## 14. Tests y verificación

Antes de terminar cualquier cambio:

```bash
npm test -- --watch=false
npm run build
```

Cubre como mínimo:

- parser (octavas, acordes, rests, grid, metadatos, letras ignoradas);
- layouts 8/17/21;
- timeline (grid, pausas de frase);
- scroll de notas (tamaño fijo y pulsos visibles según altura);
- seek;
- importación MIDI y recorte de silencio;
- mapeo exacto/octava/snap;
- reducción y eliminación de acordes;
- exportación aproximada.

La UI/canvas no tiene tests automatizados. Para cambios visuales, prueba manualmente en landscape y, si es posible, en un móvil real.

## 15. Flujos de cambio

### Añadir una canción de texto

1. Crear `public/songs/<id>.txt` con metadatos y notas.
2. Añadir entrada con `file` a `index.json`.
3. Recargar y probar.

### Añadir una canción MIDI

1. Copiar `.mid` a `public/songs/`.
2. Añadir entrada con `id`, `title`, `artist` y `midi` (sin pista, transposición ni reducción).
3. Verificar que el MIDI se parsea. La pista y la configuración se eligen al pulsar Jugar.
4. Recargar, configurar la demo y comprobar el informe de reducción.

### Cambiar el parser

- Actualizar `tab-parser.spec.ts`.
- Mantener compatibilidad con `grid` y las pausas por línea en blanco.
- No romper los tabs de demo.

### Cambiar el timeline

- Mantener `startBeat`, `startMs`, `durationMs`, `pauseAfterBeats` coherentes.
- Probar grid 1, 2 y 4.
- Recordar que las pausas de frase son beats completos.

### Cambiar la reducción MIDI

- Mantener el orden exacto → octava → cromatismo.
- Probar:
  - nota exacta;
  - natural fuera de rango (fold);
  - cromática (snap);
  - acorde sin colisiones;
  - acorde con colisión;
  - `removeChords`.
- Actualizar estadísticas (`exactCount`, `foldedCount`, `snappedCount`, `removedChordNotes`, `unsupportedCount`).

### Cambiar el reproductor

- No romper pausa sin modal, engranaje, atrás, seek, loop, count-in ni HUD.
- La escala de BPM MIDI es `sourceBpm / bpm`.
- El HUD debe saltarse los rests.

## 16. Trampas conocidas

- `npm test -- --run` no funciona; usar `--watch=false`.
- El catálogo de demos no se recarga solo: hace falta recarga completa.
- El `Promise.all` de demos es frágil ante una entrada mala.
- `@tonejs/midi` es CommonJS; no quitar `allowedCommonJsDependencies`.
- No invertir la escala de BPM MIDI.
- No añadir líneas en blanco accidentales a tabs generados.
- No contar notas de acordes eliminados como “omitidas” en los avisos de pérdida.
- No intentar conservar cromatismos exactos en una kalimba C major: es imposible sin retunear.
- `Song.tabText` vacío es normal en MIDI; bifurca por `song.midi` y `song.midiSource`.
- Un MIDI sin configurar tiene `midiSource` pero no `midi`; el reproductor debe abrir la configuración y no mostrar “tab sin notas”.
- El visor muestra el tab de texto original; el MIDI configurado muestra notas, no un tab normal. Un MIDI pendiente no tiene visor.
- No vuelvas a fijar pista/transposición/reducción en el catálogo MIDI. La pista se preselecciona con la melodía probable; la transposición se sugiere con Auto en la primera configuración.
- El formato de texto MIDI personalizado se retiró; no lo reintroduzcas sin pedirlo.
- La app es PWA en producción: service worker, manifest e iconos. El shell y `public/songs` se precargan; en desarrollo el SW está desactivado. `PwaInstallService` captura `beforeinstallprompt` y la biblioteca muestra un botón de instalar cuando está disponible. No hay detección por micrófono.
- Las demos musicales tienen derechos de sus autores; no añadas contenido sin permiso.

## 17. Convenciones

- TypeScript con tipos explícitos en APIs públicas.
- Signals para estado reactivo.
- Componentes standalone.
- SCSS con variables globales (`--panel`, `--cyan`, etc.).
- Textos de UI en español.
- Comentarios breves y solo cuando aporten.
- Mantener el código de `src/core` sin Angular.
- Preferir funciones puras y testearlas.
- No añadir dependencias sin justificar.

## 18. Criterio de “terminado”

- `npm test -- --watch=false` pasa.
- `npm run build` pasa sin errores.
- La funcionalidad se ha probado en biblioteca y, si aplica, en reproductor.
- Si cambia el comportamiento visible o el formato de datos, actualiza `README.md` y este `AGENTS.md`.
