# AGENTS.md — Guía para agentes

Este documento resume la arquitectura, las reglas de negocio y las trampas conocidas de **Kalimbapp**. Léelo antes de tocar código.

## 1. Estado del proyecto

- App Angular 22 standalone + SCSS + signals.
- Sin backend. Persistencia en `localStorage`.
- Reproductor en canvas + WebAudio.
- Importación de tabs de texto, MIDI (`@tonejs/midi`) y MusicXML/MXL (`fflate`).
- Tests con Vitest vía `ng test`.
- Actualmente: **120 tests pasando** y `npm run build` correcto.
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
- `fflate` 0.8.3 (MIT) para descomprimir `.mxl`. Solo se usa en el parser MusicXML.
- El scaffold es zoneless/signals. Evita introducir `zone.js` sin motivo.
- Presupuesto de estilos por componente: warning 18 kB, error 32 kB.
- El servidor de desarrollo debe escuchar en `0.0.0.0:4300`.

## 4. Estructura

```text
src/core/kalimba/   dominio puro de kalimba (sin Angular)
src/core/midi/      dominio puro MIDI (sin Angular)
src/core/musicxml/  parser MusicXML/MXL y fusión de pentagramas (sin Angular)
src/app/models/     Song e inputs de importación
src/app/services/   biblioteca, ajustes, calibración, audio, fullscreen, parsers MIDI/MusicXML
ngsw-config.json    configuración del service worker (app + canciones)
public/manifest.webmanifest + public/icons/  manifest e iconos PWA
src/app/components/ presentacionales: tarjetas, diálogos, canvas, calibración, visor
src/app/pages/      library.page y player.page
public/songs/       tabs/MIDI/MusicXML de demo + index.json
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
  group?: string; // grupo/franquicia para agrupar en la biblioteca
  bpm: number;
  kalimbaSize: 8 | 17 | 21;
  tabText: string;
  builtIn: boolean;
  createdAt: number;
  repeat?: boolean;
  midi?: MidiSongData;
  midiSource?: string; // fuente original (MIDI o MusicXML) en base64
  midiFileName?: string; // extensión .mid/.musicxml/.xml/.mxl para elegir el parser
}
```

- `Song.group` es el grupo/franquicia visible en la biblioteca (p. ej. `Hollow Knight`, `Imagine Dragons`), independiente de `artist`. Si falta, la biblioteca usa `artist`; si tampoco hay, `Sin grupo`.
- Para canciones MIDI/MusicXML configuradas, `midi` existe y `tabText` es `''`.
- Para pistas pendientes de configurar, `midiSource` existe y `midi` es `undefined`. El reproductor debe abrir el diálogo de configuración antes de construir el timeline.
- `Song.kalimbaSize` es el tamaño guardado con la configuración de la pista. En pistas configuradas, el reproductor usa ese tamaño; en texto, `settings.kalimbaSize`.
- El reproductor debe bifurcar por `song.midi` y `song.midiSource`.
- No mezclar la lógica de tab de texto y pista en la misma rama sin comprobar `midi`.
- La extensión de `midiFileName` decide si la fuente se parsea como MIDI o MusicXML.

### MidiSongData

```ts
interface MidiSongData {
  bpm: number; // BPM original de la pista importada (para escalar tiempos)
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

- Fuente de verdad para canciones: **solo `public/songs/`**.
- Cada archivo vive en la carpeta de su `group`, con slug ASCII en minúsculas (`hollow_knight/`, `imagine_dragons/`, `clasica/`, `studio_ghibli/`). Las canciones sin grupo claro o sin etiquetar van a `varios/`.
- Cuando se pida actualizar/añadir/renombrar canciones, ignora `docs/songs/` (build publicado); no lo edites ni lo uses como referencia salvo petición explícita.

### Texto

```json
{
  "id": "song",
  "title": "Song",
  "artist": "Artist",
  "group": "Grupo",
  "bpm": 84,
  "kalimba": 17,
  "file": "grupo/song.txt"
}
```

- `group` es el directorio/grupo donde aparece la canción en la biblioteca. Es independiente de `artist`: por ejemplo, todas las piezas de un videojuego comparten `group` aunque tengan compositores distintos. Si se omite, se usa `artist`.

### MIDI

```json
{
  "id": "song-midi",
  "title": "Song (MIDI)",
  "artist": "Artist",
  "group": "Grupo",
  "midi": "grupo/song.mid"
}
```

- `midi` o `file` con extensión `.mid`/`.midi`.
- Las entradas MIDI **no** fijan `track`, `transposition`, `reduction`, `bpm` ni `kalimba`. La app las ignora: cada usuario configura la canción al pulsar Jugar por primera vez.
- `title` es opcional en entradas MIDI; se usa el título del MIDI como fallback.
- El índice se carga al iniciar y se cachea con `?v=timestamp` + `cache: no-store`.

### MusicXML

```json
{
  "id": "song-musicxml",
  "title": "Song (MusicXML)",
  "artist": "Composer",
  "group": "Grupo",
  "musicxml": "grupo/song.mxl"
}
```

- `musicxml` o `file` con extensión `.musicxml`/`.xml`/`.mxl`.
- Las entradas MusicXML tampoco fijan pista ni configuración; la app genera una pista por pentagrama y, si hay varios, una fusión **Ambas manos**.
- `loadBuiltIns` aísla errores por entrada: una demo inexistente o inválida se omite en silencio y no tumba el resto. Aun así, valida archivos e IDs.
- La biblioteca muestra secciones plegables por `group` (directorios) y permite filtrar por ese grupo; el buscador también busca en título, artista y grupo.

### Nombres de archivo

- Usa slugs ASCII en minúsculas con letras, números y `_` (`aerosmith_dream_on.mid`).
- La carpeta es el slug del `group`; si no hay grupo claro, usa `varios/`. Las rutas del índice incluyen la carpeta (`hollow_knight/hollow_knight_hornet.mid`).
- Incluye el grupo/artista real y el título, o solo el título si no hay artista claro.
- Evita espacios, guiones, apóstrofes, acentos y signos como `?`, `(`, `)` o `¿`.
- Los `title` y `artist` visibles pueden conservar mayúsculas, acentos y puntuación.
- No uses el `artist` del catálogo cuando sea solo el arreglista o subidor (p. ej. `Xitetin`, `Xitete el Grande`); usa el grupo/artista real o el título.

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
- `startDelayBeats` añade un margen de entrada tras la cuenta atrás para que las notas no caigan durante el contador.
- La duración de nota es `beatMs * (1 / eventsPerBeat) * noteFill`.
- `totalMs` incluye count-in, margen de entrada y pausas.
- El metrónomo usa `timeMs / beatMs`; con grid 2 o 4 sigue marcando beats musicales, no cada evento.

## 10. MIDI: invariantes

### Tiempo

```ts
const scale = sourceBpm / bpm;
```

**No invertir esta fórmula.** Subir BPM debe acortar los tiempos; bajar BPM debe alargarlos.

- `countInMs` usa el BPM actual.
- `startMs = countInMs + startDelayMs + (note.startMs - firstStart) * scale`.
- `startDelayBeats` y `totalMs` incluyen el margen de entrada; `countInMs` sigue marcando solo el contador visible.
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
- Si hay exactamente dos pistas melódicas de piano, se añade una pista sintética **Ambas manos** (`midi:merge`) que las une respetando su posición temporal y deduplicando unísonos. No se preselecciona como melodía. El ID es determinista para recuperar la configuración guardada.
- Se sugiere melodía por altura media, número de notas, monofonía e instrumento y se preselecciona al configurar la canción; el usuario puede cambiarla.
- El catálogo MIDI no fija pista.

### MusicXML

- `src/core/musicxml` parsea `score-partwise` con `DOMParser`; `.mxl` se descomprime con `fflate`.
- La salida reutiliza `MidiAnalysis`/`MidiPart`: el resto del diálogo, reducción y timeline no cambia.
- Cada `<part>` con varios `<staff>` genera una pista por pentagrama y una pista sintética `merged` (“Ambas manos”).
- La fusión deduplica unísonos simultáneos y conserva la alineación temporal de las manos.
- La melodía probable se calcula solo entre pistas no fusionadas.
- Los IDs de pista deben ser deterministas (`musicxml:<parte>:staff:<n>`, `musicxml:<parte>:merge`) para recuperar la configuración guardada.
- Se usa el tempo inicial; los cambios internos se ignoran. Se omiten notas de adorno y percusión no afinada.
- En MusicXML no se guarda `channel`; el diálogo oculta “Canal” y usa “Pentagrama”.

## 11. Reproductor

- El canvas dibuja y emite `noteHit` al cruzar `startMs`; el audio usa ese evento.
- En texto, el reproductor usa `settings.kalimbaSize`; en MIDI/MusicXML configurado usa `Song.kalimbaSize`. En una pista sin configurar usa el tamaño base de ajustes y abre el diálogo de configuración antes de crear el timeline.
- El diálogo de pista parte del BPM original de la pista y de `RECOMMENDED_MIDI_REDUCTION` (octavas, cromatismos y quitar acordes). La pista se preselecciona con la melodía probable; la transposición se calcula con **Auto** y se puede ajustar a mano.
- En la primera configuración, el diálogo ofrece **Aplicar recomendados**: pista sugerida, BPM original, tamaño base, `RECOMMENDED_MIDI_REDUCTION` y transposición Auto. Tras aplicarlo, el botón pasa a **Guardar configuración**; si la configuración deja de coincidir con la recomendada, vuelve a **Aplicar recomendados**. La X de al lado cierra descartando cambios.
- La configuración se guarda en la canción. **“Listo para tocar”** debe mostrar pista/pentagrama, transposición y reducción, y permitir reabrir el diálogo con **Configurar MIDI** o **Configurar partitura**.
- Mantén los avisos y el selector de tamaño en canciones de texto. En MIDI/MusicXML configurado, el tamaño se cambia desde el configurador de pista, no desde el selector global.
- El tick del HUD se emite a ~15 fps.
- **Pausa**: congela pantalla y audio sin abrir modal.
- **Engranaje**: pausa y abre modal de ajustes.
- **Atrás**: durante la partida abre el menú de pausa; si no, vuelve a la biblioteca.
- **−10/+10 s**: barra superior, modal y flechas; usa tiempo musical sin count-in.
- **Reanudar**: cuenta atrás opcional 0–4; por defecto 0.
- El margen de entrada tras la cuenta atrás se fija al iniciar/reiniciar con las notas visibles configuradas; las notas empiezan a caer al acabar el contador.
- **Tempo rápido**: el botón de tempo de la cabecera de juego sustituye al de colores, muestra el porcentaje respecto al BPM base (`bpm / baseBpm`) y abre un diálogo con slider 30–240 y multiplicadores 0,25×/0,5×/0,75×/1×/1,25×. Se calculan sobre el BPM base (`song.midi?.bpm ?? song.bpm`), no sobre el BPM actual. Si se abre durante la reproducción, pausa antes. Al cambiar el BPM se conserva el pulso actual; reanudar continúa desde ese punto.
- **HUD inferior**: “Ahora” se vacía durante silencios; “Siguiente” salta rests y muestra la próxima nota real.
- Durante la reproducción la cabecera desaparece para dejar ver la caída de notas; un botón circular flotante con chevron en la parte superior la muestra de nuevo y vuelve a ocultarse a los ~3,2 s. Durante la cuenta atrás inicial permanece visible y se pliega al terminar. El HUD (Ahora, progreso y Siguiente) vive abajo, siempre visible y semitransparente.
- La línea de golpe del reproductor está al 2/3 de la altura (un tercio desde abajo), con una kalimba dibujada debajo: cuerpo de madera, puente, tinas de distinta longitud y la central marcada en ámbar. Calibración y reproductor comparten esa base para que el offsetY siga siendo válido. Los carriles y teclas solo se iluminan con pulsaciones manuales (touch o teclado), no con notas automáticas; la línea de golpe es fija y sin brillo. El círculo destino se ilumina con un halo y un anillo brillante cuando la nota entra en él, como guía de timing.
- Aciertos manuales: `judge.ts` compara la pulsación con la nota del carril (perfecto ±60 ms, bien ±130 ms). Solo se juzga la primera pulsación de cada `evento:carril`; el playback automático no genera efectos. `FallingNotesComponent.triggerHitEffect` dibuja un burst local y la etiqueta de precisión.
- **Puntuación**: `src/core/kalimba/score.ts` acumula perfectos, bien y fallos por `evento:carril` (cada nota de un acorde cuenta). Un fallo se registra cuando `timeMs - startMs > goodMs` y la clave no está consumida; las pulsaciones fuera de ventana no penalizan. `netAccuracy = (perfect + good) / juzgadas`; `weightedAccuracy = (perfect×100 + good×50) / (juzgadas×100)`. No hay marcador durante la partida para no tapar el campo: el resumen aparece solo en pausa/final como pastilla lateral, y la modal se compacta para no hacer scroll en móvil. `resetHitTracking` reinicia la puntuación (inicio, reinicio, seek, cambio de tamaño); el rebobinado del loop también. Pausa y cambio de BPM la conservan. En `onFinished` se marcan los fallos restantes para cerrar el total.
- El tamaño de nota es fijo (según el ancho/carril). `computeNoteScroll` mantiene la separación vertical mínima según la rejilla y reduce los pulsos visibles si la altura no da para el tamaño configurado; no se comprime la zona de caída.
- La canción se reinicia al cambiar tamaño o articulación. Cambiar BPM conserva la posición musical y reanudar continúa desde el mismo punto. Las pausas de frase son fijas: una línea en blanco = 1 beat.
- El loop de MIDI usa el ajuste de loop, no un `repeat` de canción.
- La app intenta fullscreen en el primer gesto y ofrece un icono para reintentarlo. `FullscreenService.isActive` debe reflejar `fullscreenchange`; no marcarlo activo de forma optimista.
- Volver del reproductor a la biblioteca no debe salir de fullscreen. El único control de la app para salir es el icono de la biblioteca, que alterna entrar/salir.
- La pausa y el seek deben cortar notas activas.
- El teclado manual usa el mapa puro de `src/core/kalimba/keyboard.ts`, se persiste en `kalimbapp.keyboard.v1` y comparte asignaciones por nota entre tamaños. Mantén reservadas `Esc`, espacio, flechas, modificadores y `F1–F12`.
- `PlayerSettings.noteColors` define los colores por defecto por grado (1–7); `PlayerSettings.tineColors` guarda overrides por ID de tina y permite repetir el mismo color en varias teclas. Canvas, teclas y calibración resuelven `tineColors[tine.id] ?? noteColors[grado]`. El modo colores del reproductor edita la tina tocada con una paleta táctil y sliders HSL, sin input nativo.
- La captura de teclado usa `event.code`, ignora repetición/modificadores/modales y limpia carriles activos al perder foco; el canvas solo dibuja el feedback recibido.
- El canvas convierte punteros de toda la columna visible en `lanePress`/`laneRelease` (multitáctil y glissando); ambos emiten arrays de carriles. `lanesAtX` en `geometry.ts` define una zona puente estrecha en el hueco entre teclas adyacentes. El reproductor pasa `resolveLanes` al canvas: el puente solo dispara ambas si pertenecen al mismo acorde (`selectBridgeLanes`); en el resto de casos se conserva la tecla que coincide o la más cercana. Así el canvas mantiene exactamente los carriles que suenan, también al deslizar el dedo. El canvas lleva un recuento por puntero para no duplicar pulsaciones si dos dedos comparten carril. El reproductor sintetiza el grupo de notas en una sola llamada de audio, registra un acierto por carril y une esos carriles con los del teclado en `manualLanes`. El audio y el estado viven en el reproductor, no en el canvas.
- No metas lógica de negocio en el canvas; solo dibujo/reloj.

## 12. Calibración y almacenamiento

Claves:

- `kalimbapp.songs.v1`
- `kalimbapp.settings.v1`
- `kalimbapp.calibration.v1`
- `kalimbapp.keyboard.v1`
- `kalimbapp.builtin-midi.v2`

`songs.v1` guarda la fuente original base64 de pistas MIDI/MusicXML; `builtin-midi.v2` guarda la configuración elegida para las demos de ambos formatos (el nombre se mantiene por compatibilidad).

Calibración:

- horizontal (ancho y `offsetX`) **por tamaño de kalimba**; `offsetY` (altura de la línea de notas) **global** para todos los tamaños y canciones;
- ancho inicial del 90% (`scale: 0.9`), `−/+` escala, arrastre para offset, reset;
- `Centrar` resetea el ancho y el centrado horizontal del tamaño actual sin mover la altura global;
- offsets normalizados;
- migra el formato antiguo global y el antiguo por tamaño;
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
- zona puente entre carriles adyacentes (`lanesAtX`) y selección solo en acordes (`selectBridgeLanes`);
- seek;
- puntuación (aciertos, fallos, acierto neto y precisión ponderada);
- importación MIDI y recorte de silencio;
- mapeo exacto/octava/snap;
- reducción y eliminación de acordes;
- parseo MusicXML (notas, acordes, silencios, ataduras, pentagramas, metadatos y MXL);
- fusión de pentagramas y deduplicación de unísonos;
- exportación aproximada.

La UI/canvas no tiene tests automatizados. Para cambios visuales, prueba manualmente en landscape y, si es posible, en un móvil real.

## 15. Flujos de cambio

### Añadir una canción de texto

1. Crear `public/songs/<grupo>/<id>.txt` con metadatos y notas.
2. Añadir entrada con `file` a `index.json`.
3. Recargar y probar.

### Añadir una canción MIDI

1. Copiar `.mid` a `public/songs/<grupo>/`.
2. Añadir entrada con `id`, `title`, `artist`, `group` y `midi` (sin pista, transposición ni reducción).
3. Verificar que el MIDI se parsea. La pista y la configuración se eligen al pulsar Jugar.
4. Recargar, configurar la demo y comprobar el informe de reducción.

### Añadir una canción MusicXML

1. Copiar `.musicxml`, `.xml` o `.mxl` a `public/songs/<grupo>/`.
2. Añadir entrada con `id`, `title`, `artist`, `group` y `musicxml` (sin pista, transposición ni reducción).
3. Verificar que el parser genera pentagramas y la fusión si hay varios.
4. Recargar, configurar la demo (incluida **Ambas manos**) y comprobar el informe.

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
- `loadBuiltIns` aísla errores por demo y los omite en silencio; no volver a un `Promise.all` que aborte todo o muestre un aviso por una entrada mala.
- `@tonejs/midi` es CommonJS; no quitar `allowedCommonJsDependencies`.
- `fflate` solo debe usarse para `.mxl`; no leer un `.mxl` como texto.
- No invertir la escala de BPM MIDI.
- No añadir líneas en blanco accidentales a tabs generados.
- No contar notas de acordes eliminados como “omitidas” en los avisos de pérdida.
- La calibración horizontal (ancho y `offsetX`) es por tamaño de kalimba; `offsetY` es global. No vuelvas a compartir el centrado horizontal entre tamaños.
- No intentar conservar cromatismos exactos en una kalimba C major: es imposible sin retunear.
- `Song.tabText` vacío es normal en MIDI/MusicXML; bifurca por `song.midi` y `song.midiSource`.
- Una pista sin configurar tiene `midiSource` pero no `midi`; el reproductor debe abrir la configuración y no mostrar “tab sin notas”.
- El visor muestra el tab de texto original; una pista MIDI/MusicXML configurada muestra notas, no un tab normal. Una pista pendiente no tiene visor.
- No vuelvas a fijar pista/transposición/reducción en el catálogo MIDI/MusicXML. La pista se preselecciona con la melodía probable; la transposición se sugiere con Auto en la primera configuración.
- MusicXML solo admite `score-partwise`; no añadas soporte de `.mscz`, `.gp*`, PDF u OMR sin pedirlo.
- La pista fusionada de MusicXML no debe ser la melodía probable ni auto-seleccionarse por defecto.
- Los IDs `musicxml:<parte>:staff:<n>` y `musicxml:<parte>:merge` deben seguir siendo deterministas para recuperar la configuración.
- No guardes `channel` en `MidiSongData` para MusicXML; el diálogo debe usar “Pentagrama”.
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
