# SPHEREx Time Lab

**A project folder for finding what moves in the infrared sky.**

SPHEREx Time Lab is our project for the 2026 NASA Space Apps Challenge, presented as one folder: an overview, a live viewer, five test case files, a field guide, data notes and the story behind the project. Each tab of the site is a divider in that folder.

At its heart is a public web tool for blinking images from NASA's SPHEREx mission. Enter the coordinates of any patch of sky and it plays every SPHEREx image of that patch as a short animation, so moving objects (nearby stars, brown dwarfs, asteroids, comets) and variable stars are easy to spot.

Built for the **“Planet X and SPHEREx”** challenge of the 2026 NASA Space Apps Challenge.

## Features

- **Search by position or name.** RA/Dec in decimal degrees or sexagesimal, or an object name resolved through CDS Sesame. Proper motion is applied automatically when known.
- **Blink comparator.** Frames sorted by date, aligned on a common north-up grid at the native 6.2″ SPHEREx pixel scale, with play/pause, frame slider, adjustable speed and keyboard control.
- **Epoch stacks.** Images from each six-monthly visit are combined to improve signal-to-noise, either across all six detectors or one detector at a time.
- **Difference imaging.** Subtract the median sky, the first epoch or the previous frame so that static sources disappear and movers stand out.
- **Spectra on the fly.** Click any pixel to measure its brightness in every image and plot it against wavelength, optionally using each image's exact per-pixel wavelength map (`WCS-WAVE`).
- **Light curves.** The same measurements plotted against time, coloured by detector.
- **Overlays.** Gaia DR3 stars propagated to each frame's date with their proper motions, quality-flag maps, compass and scale bar, plus an Aladin Lite atlas with AllWISE, 2MASS, DSS and Pan-STARRS images and Gaia DR3 / AllWISE catalogues.
- **Selectable field of view** from 2′ to 30′.
- **Metadata.** Observation dates, epochs, detectors, wavelengths, flagged-pixel fractions and per-pixel flag bits, with links to every FITS cutout.
- **Shareable and embeddable.** All settings live in the URL; copy a link, an `<iframe>` embed code, or a PNG of the current frame.

## Folder contents

| Page | Purpose |
| --- | --- |
| No. | Section | File | Contents |
| --- | --- | --- | --- |
| 01 | Overview | `index.html` | What the project is, folder contents |
| 02 | Viewer | `viewer.html` | The tool itself |
| 03 | Test targets | `targets.html` | The five challenge test targets, one click each |
| 04 | Field guide | `guide.html` | How to use the viewer, URL parameters, troubleshooting |
| 05 | Data notes | `data.html` | Data sources, processing, adding new releases, resources |
| 06 | About | `about.html` | Project background and how the brief is covered |

## Running locally

The site is static: HTML, CSS and JavaScript modules, no build step and no dependencies to install. Because it uses ES modules, open it through a local web server rather than as a `file://` page:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploying to GitHub Pages

1. Push this repository to GitHub.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, select `main` and the `/ (root)` folder, and save.
4. After a minute the site is live at `https://<your-user>.github.io/<repository>/`.

The empty `.nojekyll` file makes GitHub serve the files exactly as they are.

## Configuration

Everything that may change lives in [`config.js`](config.js).

**New data releases.** Add the new IRSA SIA collection to the top of `collections`:

```js
collections: [
  { id: 'spherex_dr1', label: 'Data Release 1' },
  { id: 'spherex_qr', label: 'Quick Release · Wide Survey' },
  // ...
]
```

The first entry is the default. If a collection has no images at a position, the viewer falls back to the next one.

**Proxy.** The viewer calls the IRSA archive straight from the browser. If your network or hosting blocks those cross-origin requests, put a small proxy that you control in front of IRSA and set:

```js
corsProxy: 'https://your-proxy.example.org/?url='
```

Every archive URL is URL-encoded and appended to this prefix.

Other options: display pixel scale, gap that separates epochs, reference epoch for proper-motion correction, download concurrency, default field of view and image count, detector colours, catalogues and background surveys.

## URL parameters

```
viewer.html?ra=133.795&dec=-7.245&fov=6&mode=epochs&det=6&diff=median
viewer.html?target=barnard
viewer.html?target=r-dra&precise=1
```

| Parameter | Values |
| --- | --- |
| `ra`, `dec` | Decimal degrees or sexagesimal (`08h55m10.8s`, `-07:14:42.5`) |
| `target` | `barnard`, `eps-indi-b`, `wise0855`, `rw-aur`, `r-dra` |
| `fov` | Field of view in arcminutes |
| `mode` | `epochs` or `frames` |
| `det` | `1`–`6` |
| `diff` | `median`, `first`, `prev` |
| `max` | Maximum number of images to load |
| `coll` | IRSA collection id |
| `precise` | `1` to read exact per-pixel wavelengths |
| `embed` | `1` for a compact layout inside an iframe |

## How it works

1. **Search**: an SIA v2 query to `https://irsa.ipac.caltech.edu/SIA` lists all SPHEREx spectral images containing the position.
2. **Cutouts**: `?center=RA,Dec&size=…` is appended to each image URL so IRSA returns only a small multi-extension FITS cutout.
3. **FITS reading**: [`fits.js`](fits.js) streams the response, decodes the `IMAGE`, `FLAGS` and (optionally) `WCS-WAVE` extensions, and cancels the download once they have arrived.
4. **Alignment**: [`wcs.js`](wcs.js) implements the TAN projection with SIP distortion and resamples every cutout onto a shared north-up grid.
5. **Display**: frames are normalised by their robust noise, stacked per epoch, optionally differenced, stretched and drawn to a canvas. Photometry uses a 1.5-pixel aperture with a local sky annulus.

```
(all files sit in the repository root)
  style.css           layout and folder-tab design
  config.js       settings and data releases
  fits.js         streaming FITS reader
  wcs.js          TAN-SIP WCS and wavelength lookup
  sky.js          coordinates, proper motion, name lookup, test targets
  plot.js         canvas charts
  viewer.js       the viewer
  common.js       shared page behaviour
```

## Data and credits

- SPHEREx data: NASA/IPAC Infrared Science Archive (IRSA). Please follow IRSA's citation and acknowledgement guidance for the release you use.
- Gaia DR3 (ESA) and AllWISE catalogues via VizieR, CDS Strasbourg.
- Aladin Lite and Sesame name resolver: CDS Strasbourg.
- Fonts: Montserrat and JetBrains Mono via Google Fonts.

SPHEREx Time Lab is an independent project and is not endorsed by NASA.

## License

[MIT](LICENSE)
