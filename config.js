// Central settings. When a new SPHEREx release appears at IRSA,
// add its SIA collection to `collections` (and move it to the top
// if it should be the default). Nothing else needs to change.

export const CONFIG = {
  siaEndpoint: 'https://irsa.ipac.caltech.edu/SIA',

  // Searched in this order. If the selected collection returns no
  // images for a position, the viewer tries the next ones.
  collections: [
    { id: 'spherex_qr', label: 'Quick Release · Wide Survey' },
    { id: 'spherex_qr2', label: 'Quick Release 2 · Wide Survey' },
    { id: 'spherex_qr_deep', label: 'Quick Release · Deep Fields' }
  ],

  // Optional prefix for every archive request, e.g.
  // 'https://my-proxy.example.org/?url='. Leave empty to call IRSA directly.
  corsProxy: '',

  // Native SPHEREx pixel scale (arcsec) used for the north-up display grid.
  pixelScaleArcsec: 6.2,

  // Images separated by more than this many days start a new epoch.
  epochGapDays: 20,

  // Proper motions of preset targets are propagated to this epoch.
  referenceEpoch: 2026.0,

  maxConcurrentDownloads: 6,
  defaultFovArcmin: 4,
  defaultMaxImages: 60,

  detectors: [
    { id: 1, range: [0.75, 1.09], color: '#3d5a98' },
    { id: 2, range: [1.10, 1.62], color: '#2f9c95' },
    { id: 3, range: [1.63, 2.41], color: '#6a9f3c' },
    { id: 4, range: [2.42, 3.82], color: '#c9971c' },
    { id: 5, range: [3.83, 4.41], color: '#d2652d' },
    { id: 6, range: [4.42, 5.00], color: '#b33a3a' }
  ],

  gaiaVizier: 'I/355/gaiadr3',
  wiseVizier: 'II/328/allwise',
  vizierAsu: 'https://vizier.cds.unistra.fr/viz-bin/asu-tsv',
  sesame: 'https://cds.unistra.fr/cgi-bin/nph-sesame/-ox/SNV?',

  aladinSurveys: [
    { id: 'P/allWISE/color', label: 'AllWISE colour' },
    { id: 'P/2MASS/color', label: '2MASS colour' },
    { id: 'P/DSS2/color', label: 'DSS2 colour' },
    { id: 'P/PanSTARRS/DR1/color-z-zg-g', label: 'Pan-STARRS DR1' }
  ]
};

export function proxied(url) {
  return CONFIG.corsProxy ? CONFIG.corsProxy + encodeURIComponent(url) : url;
}
