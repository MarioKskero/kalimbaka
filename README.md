# Kalimbapp

Guía visual tipo _Guitar Hero_ para tocar la kalimba con tabs numéricos. La app muestra las notas cayendo por el carril de cada tecla, marca el momento de tocar y permite escuchar la melodía sintetizada.

- **Angular 22** standalone + SCSS + signals.
- **Vitest** para tests de dominio.
- **Canvas** para el reproductor.
- **WebAudio** para el sonido de notas y el metrónomo.
- **@tonejs/midi** para importar MIDI.
- Sin backend: todo se guarda en el navegador.

## Índice

1. [Arranque rápido](#arranque-rápido)
2. [Cómo se usa](#cómo-se-usa)
3. [Kalimbas soportadas](#kalimbas-soportadas)
4. [Formato de tabs de texto](#formato-de-tabs-de-texto)
5. [Catálogo de canciones](#catálogo-de-canciones)
6. [MIDI](#midi)
7. [Reducción MIDI sin pérdidas](#reducción-sin-pérdidas)
8. [Reproductor](#reproductor)
9. [Calibración](#calibración)
10. [Visor de tab y exportación aproximada](#visor-de-tab-y-exportación-aproximada)
11. [Persistencia](#persistencia)
12. [Arquitectura](#arquitectura)
13. [Desarrollo y tests](#desarrollo-y-tests)
14. [Problemas frecuentes](#problemas-frecuentes)
15. [Limitaciones actuales](#limitaciones-actuales)
16. [Créditos y contenido](#créditos-y-contenido)

---

## Arranque rápido

Requisitos:

- Node.js moderno (probado con Node 24).
- npm.

```bash
npm install
npm start
```

El servidor de desarrollo queda configurado en:

```text
http://0.0.0.0:4300
```

Abre `http://localhost:4300/` o la IP de tu equipo en la red local. El script ya incluye `--host 0.0.0.0 --port 4300 --poll=1000 --allowed-hosts=*`.

En Alpine Linux, si Node no está instalado:

```bash
apk add --no-cache nodejs npm
```

Otros comandos:

```bash
npm run build          # build de producción en dist/kalimbapp/browser
npm run start:prod     # sirve la configuración de producción en el 4300
npm test -- --watch=false
```

La configuración de producción usa `baseHref: "/kalimbaka/"`, pensada para publicar en `https://<usuario>.github.io/kalimbaka/`. El directorio `dist` ya no está ignorado, así que puedes subir el contenido de `dist/kalimbapp/browser`.

> Los tests usan el builder `@angular/build:unit-test` con Vitest. No uses `npm test -- --run`; el flag correcto es `--watch=false`.

Al cambiar archivos de `public/songs`, `public/songs/index.json` o los propios MIDI, haz una **recarga completa** de la página. El catálogo se carga al iniciar la app y las peticiones llevan cache-busting (`?v=timestamp` + `cache: no-store`).

---

## Cómo se usa

1. **Biblioteca**: elige si tu kalimba es de 8, 17 o 21 teclas.
2. **Calibra la pantalla** si vas a superponer la guía sobre el instrumento.
3. **Elige un tab** de la lista o impórtalo.
4. Pulsa **Jugar**.
5. Coloca el móvil en un soporte delante de la kalimba, en horizontal.
6. Toca la tecla indicada cuando la nota llegue a la línea brillante.

En la biblioteca puedes:

- cambiar el tamaño de kalimba;
- ajustar BPM por defecto y articulación;
- importar tabs de texto, varios archivos o un MIDI;
- calibrar;
- abrir la guía de uso;
- ver el tab con el icono del ojo;
- exportar la biblioteca importada a JSON.

---

## Kalimbas soportadas

Se usan los layouts estándar en Do mayor:

| Tamaño    | Rango | Nota central |
| --------- | ----- | ------------ |
| 8 teclas  | C4–C5 | C4 (`1`)     |
| 17 teclas | C4–E6 | C4 (`1`)     |
| 21 teclas | F3–E6 | F3 (`4,`)    |

- El 21 incluye cuatro graves extra (`F3 G3 A3 B3`) y el resto es igual que el 17.
- Los tabs de 17 teclas funcionan en una kalimba de 21.
- El 8 es más limitado: muchas notas de tabs de 17 no cabrán.
- No hay layouts alternativos ni cromáticos en esta versión.

---

## Formato de tabs de texto

El formato normal es texto numérico, similar a KalimbaTabs.net.

### Metadatos

```text
title: Mi canción
artist: Autor
bpm: 84
kalimba: 17
grid: 1
```

- `title`: título.
- `artist`: artista.
- `bpm`: tempo.
- `kalimba`: 8, 17 o 21.
- `grid`: eventos por pulso. `1` = una nota por pulso (por defecto), `2` = corcheas, `4` = semicorcheas. El parser también acepta `3` y `6`.

Alias aceptados:

- Título: `title`, `titulo`, `cancion`, `song`, `nombre`, `name`.
- Artista: `artist`, `artista`, `autor`, `author`.
- BPM: `bpm`, `tempo`.
- Kalimba: `kalimba`, `teclas`, `keys`, `size`.
- Grid: `grid`, `subdivision`, `eventsPerBeat`.

### Notas

- Grados `1`–`7`.
- `8` se interpreta como `1'` (do agudo).
- Octava arriba: `°`, `*`, `'`, `′`, `’`, `•`, `·`.
- Dos octavas arriba: `''`, `”`, `**`.
- Octava abajo: `.`, `,`.
- Acordes/slides: `(1 5)`, `(135)`, `(3'1'6)`.
- Silencios: `-`, `0` o `~`. Cada símbolo ocupa un evento de la rejilla.
- Repetición de línea: `x2`, `(x2)`, `[x2]`.
- Loop de canción: `🔁`.
- Comentarios: líneas que empiezan por `#`, `//` o `;`.
- Las líneas con texto (2+ letras seguidas) se tratan como letras de canción y se ignoran.

### Ejemplo

```text
title: His Theme (extracto)
artist: Toby Fox
bpm: 84
kalimba: 17

(1 5) 2' 1' 5 7 7 1'
4 5 1' 5 7 7 1'
(3 5) 2' 1' 5 7 7 1'
6 5 1' 3' 2' 1' 2'
🔁
```

### Pausas de frase

La regla es fija: **cada línea en blanco añade un pulso completo de pausa**. No hay ajuste de modo ni de cantidad en la interfaz.

- Un tab con líneas consecutivas suena continuo.
- Si quieres respirar entre frases, deja una línea vacía.
- La pausa de una línea en blanco es de **1 beat**, aunque el tab use `grid: 2` o `grid: 4`.
- No pongas líneas en blanco dentro de una frase si no quieres pausas.

### Articulación

El ajuste **“Articulación entre notas”** (0–40%) acorta la duración de la nota dentro de su evento. **No cambia el tempo**. Es distinto de los silencios y de las pausas de frase.

---

## Catálogo de canciones

Las demos integradas están en `public/songs/` y se listan en `public/songs/index.json`.

### Canción de texto

```json
{
  "id": "mi-cancion",
  "title": "Mi canción",
  "artist": "Autor",
  "bpm": 84,
  "kalimba": 17,
  "file": "mi-cancion.txt"
}
```

El archivo `.txt` contiene el tab con sus metadatos. El `title`, `artist`, `bpm` y `kalimba` del índice tienen prioridad sobre los del archivo.

### Canción MIDI

```json
{
  "id": "mi-cancion-midi",
  "title": "Mi canción (MIDI)",
  "artist": "Autor",
  "midi": "mi-cancion.mid"
}
```

- `midi`: nombre del archivo dentro de `public/songs/`. También puedes usar `file` con extensión `.mid`/`.midi`.
- La entrada **no fija** pista, tamaño, BPM, transposición ni reducción. La app analiza el archivo y, la primera vez que pulses **Jugar**, abre el diálogo de configuración con el tamaño base del usuario, el BPM original del MIDI y la reducción sin pérdidas por defecto.
- La configuración elegida se guarda por canción y se muestra en **“Listo para tocar”**, donde también se puede cambiar.
- En las demos MIDI, `title` y `artist` del índice siguen teniendo prioridad.

> Si una entrada del índice falla (archivo inexistente o MIDI corrupto), el `Promise.all` de carga de demos puede dejar sin cargar el resto. Revisa la consola y el aviso de la biblioteca.

### Añadir una canción

1. Copia el `.txt` o `.mid` en `public/songs/`.
2. Añade su entrada a `public/songs/index.json`.
3. Recarga la app.

---

## MIDI

### Importación manual

1. Pulsa **Importar MIDI** en la biblioteca.
2. Elige un `.mid` o `.midi`.
3. La canción se añade como **MIDI sin configurar**. No se selecciona la pista automáticamente.
4. Pulsa **Jugar**. La primera vez se abre el diálogo de configuración:
   - pista/canal (la percusión se ignora);
   - tamaño de kalimba (parte del tamaño base del usuario);
   - BPM de reproducción (parte del BPM original del MIDI);
   - transposición (se calcula con **Auto** al elegir pista; puedes ajustarla a mano);
   - reducción: octavas y cromatismos activos por defecto; quitar acordes opcional.
5. Revisa el informe de notas exactas, plegadas, ajustadas y omitidas.
6. Guarda la configuración.

El MIDI se guarda con su fuente original para poder reconfigurarlo y, una vez configurado, con los datos estructurados de la pista elegida. La canción aparece etiquetada como **MIDI** y la biblioteca muestra el tamaño y BPM guardados. En **“Listo para tocar”** verás la pista, la transposición y la reducción, con un botón **Configurar MIDI** para cambiarlo.

### Comportamiento

- Se importa **una pista/canal** a la vez.
- La percusión se ignora.
- Se recorta el silencio inicial de la pista (la primera nota pasa a 0).
- Se conservan tiempos y duraciones reales.
- El BPM del reproductor escala la canción: **subir BPM acelera**, **bajar BPM ralentiza**.
- Se usa el tempo inicial del MIDI. Los cambios internos de tempo no se reflejan en el metrónomo.
- La transposición se calcula con **Auto** al elegir la pista; puedes ajustarla a mano y volver a pedir la sugerencia.
- Las notas que no caben se pueden plegar de octava, ajustar de semitono o quitar con la reducción.
- Las canciones MIDI también se exportan/importan en el JSON de biblioteca, incluyendo la fuente original si existe.

### Reducción sin pérdidas

Con `foldOctaves` y `snapChromatic` activos:

- **Exacta**: la nota existe en la kalimba.
- **Octava**: misma clase de nota en otra octava.
- **Cromatismo**: se ajusta al semitono más cercano (ej. A#4→A4/B4).
- **Acordes**: se reparten entre teclas sin repetir; si hay colisión se busca otra opción.
- **Quitar acordes**: opcional; conserva la nota más aguda de cada grupo simultáneo.

En la demo de Monkey Island, el diálogo no preselecciona la pista. Elige una pista: la transposición se calcula con **Auto** y puedes ajustarla o volver a pedir la sugerencia. Revisa el informe antes de guardar; la configuración queda guardada para esa canción.

### Qué se pierde

La reducción no puede conservar el tono exacto de una nota cromática en una kalimba de Do mayor. Siempre hay un compromiso:

- plegar octavas cambia el registro;
- ajustar cromatismos cambia el tono;
- quitar acordes elimina voces;
- si hay más notas simultáneas que teclas, alguna se omite.

La app informa de cada caso.

---

## Reproductor

- **Tamaño de kalimba**: en tabs de texto se usa el elegido en la biblioteca. En MIDI configurado se usa el tamaño guardado con esa canción; se puede cambiar desde **Configurar MIDI** en “Listo para tocar”. Los avisos de notas que no caben siguen disponibles.
- **Pantalla completa / landscape**: intenta fullscreen y bloqueo de orientación; en portrait muestra “Gira el móvil”.
- **Cuenta atrás**: 4 beats al empezar.
- **Pausa**: el botón de pausa/play congela la pantalla sin abrir modal. Se cortan notas, metrónomo y cuentas atrás.
- **Ajustes**: el engranaje pausa y abre la modal de configuración.
- **Atrás**: durante la partida abre la modal de pausa/opciones.
- **−10 s / +10 s**: barra superior y modal de pausa; también flechas izquierda/derecha.
- **Sonido de notas**: toggle de altavoz. Las notas se sintetizan con WebAudio.
- **Tocar con teclado**: activa la entrada de teclado y muestra la tecla asignada sobre cada carril.
- **Configurar teclado**: permite reasignar cada nota y restaurar el mapa por defecto. El mapa se comparte entre los tamaños de kalimba.
- **Metrónomo**: opcional, independiente del sonido de notas.
- **Loop**: repite la canción.
- **BPM**: 30–240.
- **Articulación**: 0–40%.
- **Notas visibles**: 3–12 pulsos.
- **Cuenta atrás al reanudar**: 0–4 pulsos.
- **HUD superior**: “Ahora”, barra de avance y “Siguiente”. Durante los silencios “Ahora” queda vacío y “Siguiente” salta al siguiente sonido real.
- **Línea de golpe al 94%** de la altura: los números de nota quedan junto al borde inferior.
- **Wake Lock**: intenta mantener la pantalla encendida.

Atajos:

- `Espacio`: pausa/reanuda.
- `←` / `→`: ±10 s.
- `Esc`: cierra ajustes/calibración o pausa.
- Con el teclado activado, las teclas asignadas reproducen notas manualmente y permiten acordes. No se usan `Esc`, flechas, modificadores ni `F1–F12` porque el navegador o el sistema pueden interceptarlas.

---

## Calibración

- Botones **− / +** para escalar el ancho de los carriles.
- Arrastrar para recolocar la guía.
- Botón **Centrar** para resetear.
- Se guarda por tamaño de kalimba.
- No hay modo cámara/AR.

La idea es alinear los carriles virtuales con las teclas físicas cuando el móvil está en un soporte delante de la kalimba.

---

## Visor de tab y exportación aproximada

El icono del ojo en cada tarjeta abre el visor:

- **Tabs de texto**: muestra el contenido original y permite copiarlo.
- **MIDI configurado**: muestra resumen y lista de notas; también las estadísticas de reducción.
- **MIDI pendiente de configurar**: no tiene visor; pulsa Jugar para configurarlo.
- **Exportar tab** (solo MIDI):
  - rejilla `1/4`, `1/8` o `1/16`;
  - incluir silencios o no;
  - informe de pasos, acordes, notas omitidas y duración;
  - **Descargar tab .txt** o **Añadir a biblioteca**.
- El tab generado usa `grid` y conserva el BPM musical.
- La exportación es **aproximada**: pierde duraciones exactas, dinámica, cambios de tempo y microtiming.
- Si desactivas los silencios, el tab se compacta y cambia el ritmo.

---

## Persistencia

Claves de `localStorage`:

- `kalimbapp.songs.v1`: canciones importadas (texto y MIDI, incluida la fuente MIDI si existe).
- `kalimbapp.settings.v1`: tamaño, BPM por defecto, articulación, metrónomo, sonido, loop, teclado, notas visibles y cuenta atrás al reanudar.
- `kalimbapp.calibration.v1`: calibración por tamaño.
- `kalimbapp.keyboard.v1`: mapa de teclado manual.
- `kalimbapp.builtin-midi.v2`: configuración elegida para las demos MIDI.

Las demos integradas se cargan desde `public/songs/` en cada arranque. Los tabs importados no se envían a ningún servidor.

---

## Arquitectura

```text
src/
  core/
    kalimba/      dominio puro: tipos, layouts, notación, parser, timeline, geometría, seek
    midi/         dominio MIDI: tipos, mapeo/reducción, timeline, exportación a tab
  app/
    models/       Song y entradas de importación
    services/     biblioteca, ajustes, calibración, audio, fullscreen, parser MIDI
    components/   tarjetas, diálogos, canvas, calibración, visor
    pages/        biblioteca y reproductor
    app.*         shell y rutas
public/
  songs/          tabs y MIDI de demo + index.json
```

Rutas:

- `/` → biblioteca.
- `/play/:id` → reproductor.

Puntos clave:

- `src/core` no debe depender de Angular.
- Los servicios de Angular conectan el core con la UI.
- El reproductor dibuja con `requestAnimationFrame` en canvas.
- El catálogo se carga en `SongLibraryService` y usa `cache: no-store`.
- `@tonejs/midi` está permitido como CommonJS en `angular.json`.

---

## Desarrollo y tests

```bash
npm test -- --watch=false
npm run build
```

La suite cubre:

- parseo de tabs (incluidos los ejemplos de His Theme, Haggstrom y Monkey Island);
- layouts 8/17/21;
- timeline con grid y pausas de frase;
- cálculo de seek;
- importación MIDI y recorte de silencio inicial;
- mapeo MIDI exacto/octava/cromatismo;
- reducción y eliminación de acordes;
- exportación aproximada a tab.

Estado actual: **84 tests pasando** y build limpio.

No hay lint script ni runner E2E configurado. Prettier está instalado; puedes usar `npx prettier --write .` si lo necesitas.

### Probar en el móvil

1. `npm start`.
2. Abre `http://IP-DE-TU-EQUIPO:4300/` desde el móvil en la misma red.
3. Gira el móvil a horizontal.
4. Calibra y prueba una demo.

---

## Problemas frecuentes

**El puerto 4300 está ocupado**

Detén el proceso anterior. El script `start` ya usa `0.0.0.0:4300`.

**No aparecen canciones nuevas**

Haz recarga completa. El índice se lee al arrancar. Las peticiones llevan cache-busting, pero el servicio no se recarga solo.

**Una demo nueva rompe toda la biblioteca**

`SongLibraryService` carga las demos con `Promise.all`. Revisa:

- que el archivo exista en `public/songs/`;
- que el `id` sea único;
- que el MIDI sea válido y tenga alguna pista melódica;
- que el JSON sea válido.

**El MIDI empieza tarde**

La app recorta el silencio inicial por pista. Si aún ves un retardo, es la cuenta atrás de 4 beats o una pista que empieza más tarde por diseño.

**El BPM va al revés en MIDI**

No debe ocurrir: la escala es `sourceBpm / bpm`. Si se toca esa fórmula, recuerda que subir BPM debe acortar los tiempos.

**El sonido de notas no suena**

Los navegadores exigen un gesto del usuario. Pulsa Empezar/Reanudar y comprueba que el altavoz está activado. En iOS puede requerir interacción adicional.

**No entra en fullscreen o no bloquea la orientación**

Es best-effort. Safari/iOS tiene limitaciones. La app muestra el aviso de girar el móvil.

**Una nota cromática no suena**

En una kalimba de Do mayor no existe. Activa el ajuste de cromatismos o elige otra transposición/pista.

**Quiero quitar los acordes**

Abre **Configurar MIDI** desde **“Listo para tocar”** y activa **Quitar acordes**. Se conserva la nota más aguda de cada acorde.

---

## Limitaciones actuales

- Sin backend, sin cuentas y sin sincronización.
- Sin detección por micrófono ni puntuación de pulsaciones.
- Sin cámara/AR; la calibración es visual.
- Sin editor gráfico de tabs; se editan como texto/JSON.
- Sin layouts alternativos ni kalimbas cromáticas.
- Los tabs de texto no tienen ritmo real: cada evento ocupa un paso de la rejilla (por defecto un pulso).
- La pausa de frase es fija: una línea en blanco = un beat.
- La exportación MIDI→tab es aproximada.
- Los cambios de tempo internos del MIDI no se reflejan en el metrónomo.
- La importación MIDI trabaja con una pista/canal, no mezcla varias.
- En un 17 en Do mayor, las notas cromáticas no se pueden conservar exactas.
- No hay PWA/service worker; es una app web servida por Angular.

---

## Créditos y contenido

- Layouts basados en la disposición estándar de kalimba en Do mayor.
- Formato de tabs inspirado en KalimbaTabs.net.
- Los tabs y MIDI de demo son ejemplos de uso; los derechos de las canciones pertenecen a sus autores. Úsalos solo si tienes derecho a ello.
- Angular, `@tonejs/midi`, Vitest y el resto de dependencias mantienen sus propias licencias.
