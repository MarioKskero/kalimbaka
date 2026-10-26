# Kalimbapp

Guía visual tipo _Guitar Hero_ para tocar la kalimba con tabs numéricos. La app muestra las notas cayendo por el carril de cada tecla, marca el momento de tocar y permite escuchar la melodía sintetizada.

- **Angular 22** standalone + SCSS + signals.
- **Vitest** para tests de dominio.
- **Canvas** para el reproductor.
- **WebAudio** para el sonido de notas y el metrónomo.
- **@tonejs/midi** para importar MIDI.
- **fflate** para descomprimir MusicXML `.mxl`.
- Sin backend: todo se guarda en el navegador.

## Índice

1. [Arranque rápido](#arranque-rápido)
2. [Cómo se usa](#cómo-se-usa)
3. [Kalimbas soportadas](#kalimbas-soportadas)
4. [Formato de tabs de texto](#formato-de-tabs-de-texto)
5. [Catálogo de canciones](#catálogo-de-canciones)
6. [MIDI](#midi)
7. [MusicXML](#musicxml)
8. [Reducción MIDI sin pérdidas](#reducción-sin-pérdidas)
9. [Reproductor](#reproductor)
10. [Calibración](#calibración)
11. [Visor de tab y exportación aproximada](#visor-de-tab-y-exportación-aproximada)
12. [Persistencia](#persistencia)
13. [Arquitectura](#arquitectura)
14. [Desarrollo y tests](#desarrollo-y-tests)
15. [Problemas frecuentes](#problemas-frecuentes)
16. [Limitaciones actuales](#limitaciones-actuales)
17. [Créditos y contenido](#créditos-y-contenido)

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

La base `/kalimbaka/` se aplica desde `deploy.sh` con `ng build --base-href /kalimbaka/`, pensada para publicar en `https://<usuario>.github.io/kalimbaka/`. La configuración de producción no fija `baseHref`. El directorio `dist` ya no está ignorado, así que puedes subir el contenido de `dist/kalimbapp/browser`.

### PWA

El build de producción incluye `manifest.webmanifest`, iconos y un service worker. En HTTPS se puede **instalar** como app y funciona offline: se cachean el shell de la app, los iconos y las canciones de demo.

- **Chrome/Edge**: icono de instalar en la barra de direcciones, menú → Instalar Kalimbapp, o el botón de instalar que aparece en la cabecera cuando el navegador lo permite.
- **Android**: menú → Instalar aplicación / Añadir a pantalla de inicio.
- **iPhone/iPad**: Compartir → Añadir a pantalla de inicio.

En `npm start` el service worker está desactivado y la instalación no aparece. Para probarla, publica el build de producción en HTTPS (GitHub Pages) o sírvelo desde un servidor estático.

> Los tests usan el builder `@angular/build:unit-test` con Vitest. No uses `npm test -- --run`; el flag correcto es `--watch=false`.

Al cambiar archivos de `public/songs`, `public/songs/index.json` o los propios MIDI/MusicXML, haz una **recarga completa** de la página. El catálogo se carga al iniciar la app y las peticiones llevan cache-busting (`?v=timestamp` + `cache: no-store`).

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
- importar tabs de texto, MIDI o MusicXML con el botón **Importar**;
- calibrar;
- abrir la guía de uso;
- ver el tab con el icono del ojo.

El botón **Importar** acepta `.txt`/`.kalimba` como tab, `.json` como biblioteca, `.mid`/`.midi` como MIDI y `.musicxml`/`.xml`/`.mxl` como partitura. También permite pegar un tab.

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
  "file": "mi_cancion.txt"
}
```

El archivo `.txt` contiene el tab con sus metadatos. El `title`, `artist`, `bpm` y `kalimba` del índice tienen prioridad sobre los del archivo.

### Canción MIDI

```json
{
  "id": "mi-cancion-midi",
  "title": "Mi canción (MIDI)",
  "artist": "Autor",
  "midi": "mi_cancion.mid"
}
```

- `midi`: nombre del archivo dentro de `public/songs/`. También puedes usar `file` con extensión `.mid`/`.midi`.
- La entrada **no fija** pista, tamaño, BPM, transposición ni reducción. La app analiza el archivo y, la primera vez que pulses **Jugar**, abre el diálogo de configuración con el tamaño base del usuario, el BPM original del MIDI y la reducción recomendada (octavas, cromatismos y solo melodía).
- La configuración elegida se guarda por canción y se muestra en **“Listo para tocar”**, donde también se puede cambiar.
- En las demos MIDI, `title` y `artist` del índice siguen teniendo prioridad.

### Canción MusicXML

```json
{
  "id": "mi-partitura",
  "title": "Mi partitura",
  "artist": "Compositor",
  "musicxml": "mi_partitura.mxl"
}
```

- `musicxml`: nombre del archivo dentro de `public/songs/`. También puedes usar `file` con extensión `.musicxml`, `.xml` o `.mxl`.
- La entrada **no fija** pista, tamaño, BPM, transposición ni reducción. Al pulsar **Jugar**, el configurador muestra los pentagramas y, si hay varios, una opción **Ambas manos**.
- La configuración elegida se guarda por demo, igual que en MIDI.
- En las demos MusicXML, `title` y `artist` del índice tienen prioridad sobre los del archivo.

> Si una entrada del índice no existe o falla, se omite sin mostrar error; el resto de demos se carga con normalidad.

### Añadir una canción

1. Copia el `.txt`, `.mid`, `.musicxml`, `.xml` o `.mxl` en `public/songs/`.
2. Añade su entrada a `public/songs/index.json`.
3. Recarga la app.

Los nombres de archivo de las demos deben ser slugs ASCII en minúsculas, con letras, números y `_` (`aerosmith_dream_on.mid`, `monkey_island_theme.mid`). Incluye el grupo/artista real y el título, o solo el título cuando no haya un artista claro. Evita espacios, guiones, apóstrofes, acentos y signos como `?`, `(` o `¿`; los títulos y artistas visibles sí pueden conservarlos. No uses el `artist` del catálogo cuando sea solo el arreglista o subidor.

---

## MIDI

### Importación manual

1. Pulsa **Importar** en la cabecera.
2. Elige un `.mid` o `.midi`.
3. La canción se añade como **MIDI sin configurar**. Se preselecciona la melodía probable; puedes cambiarla.
4. Pulsa **Jugar**. La primera vez se abre el diálogo de configuración:
   - pista/canal (la percusión se ignora);
   - tamaño de kalimba (parte del tamaño base del usuario);
   - BPM de reproducción (parte del BPM original del MIDI);
   - transposición (se calcula con **Auto** con la pista preseleccionada; puedes ajustarla a mano);
   - reducción: octavas, cromatismos y quitar acordes activos por defecto; puedes desactivarlos.
5. Revisa el informe de notas exactas, plegadas, ajustadas y omitidas.
6. Guarda la configuración.

En la primera configuración puedes pulsar **Aplicar recomendados** para restaurar la pista sugerida, el BPM original, el tamaño base, la reducción recomendada (con **quitar acordes**) y la transposición Auto. Después el botón pasa a **Guardar configuración**; si cambias algo respecto a lo recomendado, vuelve a **Aplicar recomendados**. La **X** de al lado cierra y descarta los cambios.

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
- Los JSON de biblioteca se pueden importar desde **Importar**; MIDI y MusicXML incluyen la fuente original si existe.

### Reducción sin pérdidas

Con `foldOctaves` y `snapChromatic` activos:

- **Exacta**: la nota existe en la kalimba.
- **Octava**: misma clase de nota en otra octava.
- **Cromatismo**: se ajusta al semitono más cercano (ej. A#4→A4/B4).
- **Acordes**: se reparten entre teclas sin repetir; si hay colisión se busca otra opción.
- **Quitar acordes**: opcional; conserva la nota más aguda de cada grupo simultáneo.

En la demo de Monkey Island, el diálogo preselecciona la melodía probable. Puedes cambiar la pista: la transposición se calcula con **Auto** y puedes ajustarla o volver a pedir la sugerencia. Revisa el informe antes de guardar; la configuración queda guardada para esa canción.

### Qué se pierde

La reducción no puede conservar el tono exacto de una nota cromática en una kalimba de Do mayor. Siempre hay un compromiso:

- plegar octavas cambia el registro;
- ajustar cromatismos cambia el tono;
- quitar acordes elimina voces;
- si hay más notas simultáneas que teclas, alguna se omite.

La app informa de cada caso.

---

## MusicXML

### Importación manual

1. Pulsa **Importar** y elige un `.musicxml`, `.xml` o `.mxl`.
2. La canción se añade como **partitura pendiente de configurar**.
3. Pulsa **Jugar**. Se abre el mismo configurador que en MIDI:
   - pentagrama o **Ambas manos**;
   - tamaño de kalimba;
   - BPM de reproducción;
   - transposición;
   - reducción (octavas, cromatismos y quitar acordes).
4. Revisa la vista previa y guarda la configuración.

### Pentagramas y fusión

- Cada pentagrama aparece como una pista independiente (“Piano · Pentagrama 1”, etc.).
- Si la parte tiene varios pentagramas, aparece **Piano · Ambas manos**, que fusiona todas las notas y deduplica unísonos.
- La **melodía probable** se calcula solo entre pentagramas individuales, nunca sobre la fusión.
- La fusión es útil cuando la melodía cambia de mano o quieres conservar el acompañamiento. Con **Quitar acordes** se conserva la nota más aguda de cada grupo; sin esa opción pueden omitirse notas si no caben.

### Comportamiento

- Se acepta MusicXML **partwise**; `.mxl` se descomprime automáticamente.
- Se leen `divisions`, tempo inicial, notas, acordes, silencios, `backup`/`forward` y ataduras básicas.
- Se omiten notas de adorno y percusión no afinada.
- Se recorta el silencio inicial de cada pentagrama; la fusión conserva la alineación entre manos.
- Se usa el tempo inicial; los cambios internos de tempo se ignoran, igual que en MIDI.
- La reducción y la transposición son las mismas que en MIDI.

### Fuentes

- **MuseScore** (millones de partituras; exporta MusicXML desde la app o descarga el archivo).
- **OpenScore**, **CPDL** y **Musicalion**, con partituras en MusicXML o exportables.
- Cualquier editor que exporte MusicXML: MuseScore, Sibelius, Finale, Dorico, etc.
- No se importan PDF ni imágenes: requerirían OMR. Tampoco se leen directamente `.mscz` o `.gp*`; expórtalos a MusicXML.

---

## Reproductor

- **Tamaño de kalimba**: en tabs de texto se usa el elegido en la biblioteca. En MIDI o MusicXML configurado se usa el tamaño guardado con esa canción; se puede cambiar desde **Configurar MIDI** / **Configurar partitura** en “Listo para tocar”. Los avisos de notas que no caben siguen disponibles.
- **Pantalla completa / landscape**: se solicita en el primer gesto (los navegadores no permiten pedirla sin interacción). El botón de volver del reproductor lleva a la biblioteca **sin salir** de pantalla completa; el único control de la app para salir es el icono de pantalla completa de la biblioteca. También intenta bloquear la orientación; en portrait muestra “Gira el móvil”.
- **Cuenta atrás**: 4 beats al empezar.
- **Pausa**: el botón de pausa/play congela la pantalla sin abrir modal. Se cortan notas, metrónomo y cuentas atrás.
- **Ajustes**: el engranaje pausa y abre la modal de configuración.
- **Atrás**: durante la partida abre la modal de pausa/opciones.
- **−10 s / +10 s**: barra superior y modal de pausa; también flechas izquierda/derecha.
- **Sonido de notas**: toggle de altavoz. Las notas se sintetizan con WebAudio.
- **Modo colores**: botón **Colores** en pausa. Pausa la guía y permite tocar una tina de la kalimba inferior para abrir una paleta táctil con muestras grandes, controles HSL personalizados y elegir el color individual de esa tecla. Puedes repetir el mismo color en varias.
- **Tocar con teclado**: activa la entrada de teclado y muestra la tecla asignada sobre cada carril.
- **Configurar teclado**: permite reasignar cada nota y restaurar el mapa por defecto. El mapa se comparte entre los tamaños de kalimba.
- **Metrónomo**: opcional, independiente del sonido de notas.
- **Loop**: repite la canción.
- **BPM**: 30–240. El botón de tempo de la cabecera de juego muestra el porcentaje respecto al BPM base y abre un diálogo con el slider y atajos de **0,25× / 0,5× / 0,75× / 1× / 1,25×** calculados sobre ese BPM base. Cambiar el tempo conserva la posición actual y permite continuar desde el mismo punto.
- **Articulación**: 0–40%.
- **Máx. notas visibles**: 3–12 pulsos; en pantallas bajas se muestran menos para que las notas no se solapen.
- **Cuenta atrás al reanudar**: 0–4 pulsos. Al empezar, las notas esperan a que termine la cuenta atrás inicial y después comienzan a caer.
- **HUD inferior**: “Ahora”, barra de avance y “Siguiente”. Durante los silencios “Ahora” queda vacío y “Siguiente” salta al siguiente sonido real.
- **Cabecera oculta y HUD inferior**: durante la reproducción la cabecera desaparece para dejar ver la caída de notas y un botón circular flotante en la parte superior permite mostrarla de nuevo durante unos segundos. Permanece visible durante la cuenta atrás inicial y se pliega al terminar. El tiempo, “Ahora” y “Siguiente” se muestran siempre abajo, con fondo semitransparente.
- **Línea de golpe al 2/3** de la altura (un tercio desde abajo): deja espacio inferior para los dedos y debajo se dibuja una kalimba con cuerpo de madera, puente y tinas de distinta longitud; la central es la más larga y va marcada en ámbar. Toca cualquier punto de la columna visible para tocar esa nota con los dedos, sin kalimba ni teclado físico. Admite varios dedos a la vez. Los carriles y teclas solo se iluminan con la pulsación manual (touch o teclado), no con la reproducción automática; la línea de golpe es fija. El círculo destino de cada carril se ilumina automáticamente cuando la nota entra en él, como guía de timing.
- **Aciertos tipo Guitar Hero**: si tocas la tecla correcta en el momento de la nota aparece un burst de luz y partículas. Perfecto (±60 ms) muestra **PERFECTO** en dorado; bien (±130 ms) muestra **BIEN** en cian. Solo cuenta la primera pulsación manual de cada nota; no hay puntuación ni combo.
- **Wake Lock**: intenta mantener la pantalla encendida.

Atajos:

- `Espacio`: pausa/reanuda.
- `←` / `→`: ±10 s.
- `Esc`: cierra ajustes/calibración o pausa.
- Con el teclado activado, las teclas asignadas reproducen notas manualmente y permiten acordes. No se usan `Esc`, flechas, modificadores ni `F1–F12` porque el navegador o el sistema pueden interceptarlas.

---

## Calibración

- Ancho inicial del **90%**; botones **− / +** para escalarlo.
- Arrastrar para recolocar la guía.
- Botón **Centrar** para resetear al ancho y posición por defecto.
- Es un ajuste **global**: se comparte entre todas las canciones y tamaños de kalimba.
- No hay modo cámara/AR.

La idea es alinear los carriles virtuales con las teclas físicas cuando el móvil está en un soporte delante de la kalimba.

---

## Visor de tab y exportación aproximada

El icono del ojo en cada tarjeta abre el visor:

- **Tabs de texto**: muestra el contenido original y permite copiarlo.
- **MIDI o MusicXML configurado**: muestra resumen y lista de notas; también las estadísticas de reducción.
- **Pista pendiente de configurar**: no tiene visor; pulsa Jugar para configurarla.
- **Exportar tab** (MIDI y MusicXML):
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

- `kalimbapp.songs.v1`: canciones importadas (texto, MIDI y MusicXML, incluida la fuente original si existe).
- `kalimbapp.settings.v1`: tamaño, BPM por defecto, articulación, colores por nota/tecla, metrónomo, sonido, loop, teclado, notas visibles y cuenta atrás al reanudar.
- `kalimbapp.calibration.v1`: calibración global (ancho y offsets), común para todas las canciones y tamaños.
- `kalimbapp.keyboard.v1`: mapa de teclado manual.
- `kalimbapp.builtin-midi.v2`: configuración elegida para las demos MIDI y MusicXML.

Las demos integradas se cargan desde `public/songs/` en cada arranque. Los tabs importados no se envían a ningún servidor.

---

## Arquitectura

```text
src/
  core/
    kalimba/      dominio puro: tipos, layouts, notación, parser, timeline, geometría, seek
    midi/         dominio MIDI: tipos, mapeo/reducción, timeline, exportación a tab
    musicxml/     parser MusicXML/MXL y fusión de pentagramas
  app/
    models/       Song y entradas de importación
    services/     biblioteca, ajustes, calibración, audio, fullscreen, parsers MIDI/MusicXML
    components/   tarjetas, diálogos, canvas, calibración, visor
    pages/        biblioteca y reproductor
    app.*         shell y rutas
public/
  songs/          tabs, MIDI y MusicXML de demo + index.json
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
- `fflate` solo se usa para descomprimir `.mxl`; es MIT y ligera.

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
- parseo MusicXML (notas, acordes, silencios, ataduras, pentagramas, metadatos y MXL);
- fusión de pentagramas y deduplicación de unísonos;
- exportación aproximada a tab.

Estado actual: **120 tests pasando** y build limpio.

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
- que el MIDI o MusicXML sea válido y tenga alguna pista melódica;
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

Abre **Configurar MIDI** o **Configurar partitura** desde **“Listo para tocar”** y activa **Quitar acordes**. Se conserva la nota más aguda de cada acorde.

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
- Los cambios de tempo internos del MIDI o MusicXML no se reflejan en el metrónomo.
- La importación MIDI trabaja con una pista/canal; MusicXML permite elegir pentagrama o fusionar las manos.
- En un 17 en Do mayor, las notas cromáticas no se pueden conservar exactas.
- MusicXML solo se acepta en formato partwise; no se importan PDF, imágenes, `.mscz` ni `.gp*` directamente.
- Las notas de adorno y la percusión no afinada se omiten.

---

## Créditos y contenido

- Layouts basados en la disposición estándar de kalimba en Do mayor.
- Formato de tabs inspirado en KalimbaTabs.net.
- Los tabs, MIDI y MusicXML de demo son ejemplos de uso; los derechos de las canciones pertenecen a sus autores. Úsalos solo si tienes derecho a ello.
- Las **12 variaciones de Twinkle Twinkle Little Star** (Mozart) son de dominio público; el archivo MXL de demo procede de la biblioteca de MuseTrainer.
- MusicXML es un estándar abierto; las partituras de ejemplo deben tener licencia compatible.
- Angular, `@tonejs/midi`, `fflate`, Vitest y el resto de dependencias mantienen sus propias licencias.
