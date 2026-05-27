// ── Routing : OSRM public ──
const OSRM_BASE = "https://router.project-osrm.org";

// ── Projection LV95 ──
const extent = [2420000, 1030000, 2900000, 1360000];
proj4.defs(
  "EPSG:2056",
  "+proj=somerc +lat_0=46.95240555555556 +lon_0=7.439583333333333 +k_0=1 +x_0=2600000" +
  " +y_0=1200000 +ellps=bessel +towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs"
);
ol.proj.proj4.register(proj4);
const projection = new ol.proj.Projection({ code: "EPSG:2056", extent });

// ── Carte ──
const map = new ol.Map({
  target: "map",
  layers: [
    new ol.layer.Tile({
      source: new ol.source.TileWMS({
        url: "https://wms.geo.admin.ch/",
        params: { LAYERS: "ch.swisstopo.pixelkarte-farbe", FORMAT: "image/png", VERSION: "1.3.0" },
        serverType: "mapserver",
        projection,
      }),
    }),
  ],
  view: new ol.View({
    projection,
    center: [2660000, 1190000],
    zoom: 2.5,
    minZoom: 2.5,
    extent: [2485000, 1075000, 2834000, 1296000],
    constrainOnlyCenter: true,
  }),
});

// ── Styles POI ──
const blueStyle  = new ol.style.Style({ image: new ol.style.Circle({ radius: 6, fill: new ol.style.Fill({ color: "blue" }),  stroke: new ol.style.Stroke({ color: "white", width: 2 }) }) });
const greenStyle = new ol.style.Style({ image: new ol.style.Circle({ radius: 6, fill: new ol.style.Fill({ color: "green" }), stroke: new ol.style.Stroke({ color: "white", width: 2 }) }) });
const redStyle   = new ol.style.Style({ image: new ol.style.Circle({ radius: 6, fill: new ol.style.Fill({ color: "red" }),   stroke: new ol.style.Stroke({ color: "white", width: 2 }) }) });

const selectedStyleMap = {
  blue:  new ol.style.Style({ image: new ol.style.Circle({ radius: 10, fill: new ol.style.Fill({ color: "blue" }),  stroke: new ol.style.Stroke({ color: "white", width: 3 }) }) }),
  green: new ol.style.Style({ image: new ol.style.Circle({ radius: 10, fill: new ol.style.Fill({ color: "green" }), stroke: new ol.style.Stroke({ color: "white", width: 3 }) }) }),
  red:   new ol.style.Style({ image: new ol.style.Circle({ radius: 10, fill: new ol.style.Fill({ color: "red" }),   stroke: new ol.style.Stroke({ color: "white", width: 3 }) }) }),
};
const defaultStyleMap = { blue: blueStyle, green: greenStyle, red: redStyle };

const layerTypeMap = {
  red:   { label: "Caserne de pompiers",  color: "#e02424" },
  blue:  { label: "Poste de police", color: "#1a56db" },
  green: { label: "Hôpital",color: "#057a55" },
};

// ── DOM panneau POI ──
const panel    = document.getElementById("poi-panel");
const elEmoji  = document.getElementById("poi-emoji");
const elType   = document.getElementById("poi-type");
const elName   = document.getElementById("poi-name");
const elBody   = document.getElementById("poi-body");
const btnClose = document.getElementById("poi-close");

let selectedFeature = null;
let selectedColor   = null;

function closePanel() {
  panel.style.display = "none";
  if (selectedFeature) {
    selectedFeature.setStyle(defaultStyleMap[selectedColor]);
    selectedFeature = null;
    selectedColor   = null;
  }
}
btnClose.addEventListener("click", closePanel);

// ── Couches itinéraires (une par service) ──
const routeLayers      = { red: null, blue: null, green: null };
const lastRouteResults = { red: null, blue: null, green: null };

function clearRouteForColor(color) {
  if (routeLayers[color]) { map.removeLayer(routeLayers[color]); routeLayers[color] = null; }
}
function clearAllRoutes() {
  Object.keys(routeLayers).forEach(clearRouteForColor);
}

// ── Marqueur viseur (croix orange) ──
const crossSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <circle cx="16" cy="16" r="13" fill="none" stroke="white" stroke-width="3"/>
  <circle cx="16" cy="16" r="13" fill="none" stroke="#ff6600" stroke-width="1.5"/>
  <line x1="16" y1="2"  x2="16" y2="10" stroke="white" stroke-width="3" stroke-linecap="round"/>
  <line x1="16" y1="2"  x2="16" y2="10" stroke="#ff6600" stroke-width="1.5" stroke-linecap="round"/>
  <line x1="16" y1="22" x2="16" y2="30" stroke="white" stroke-width="3" stroke-linecap="round"/>
  <line x1="16" y1="22" x2="16" y2="30" stroke="#ff6600" stroke-width="1.5" stroke-linecap="round"/>
  <line x1="2"  y1="16" x2="10" y2="16" stroke="white" stroke-width="3" stroke-linecap="round"/>
  <line x1="2"  y1="16" x2="10" y2="16" stroke="#ff6600" stroke-width="1.5" stroke-linecap="round"/>
  <line x1="22" y1="16" x2="30" y2="16" stroke="white" stroke-width="3" stroke-linecap="round"/>
  <line x1="22" y1="16" x2="30" y2="16" stroke="#ff6600" stroke-width="1.5" stroke-linecap="round"/>
  <circle cx="16" cy="16" r="2.5" fill="#ff6600" stroke="white" stroke-width="1.5"/>
</svg>`;
const crossIcon = new ol.style.Icon({ src: `data:image/svg+xml;utf8,${encodeURIComponent(crossSVG)}`, anchor: [0.5, 0.5] });

const clickMarkerSource = new ol.source.Vector();
const clickMarkerLayer  = new ol.layer.Vector({
  source: clickMarkerSource,
  zIndex: 700,
  style: new ol.style.Style({ image: crossIcon }),
});
map.addLayer(clickMarkerLayer);

// ── Conversion de coordonnées ──
function lv95ToWgs84(coord) { return ol.proj.transform(coord, "EPSG:2056", "EPSG:4326"); }
function wgs84ToLv95(coord) { return ol.proj.transform(coord, "EPSG:4326", "EPSG:2056"); }

// ── POI sources ──
const poiSources = {};
const CANDIDATES = 1;

function getNearestCandidates(lv95Coord, color, n = CANDIDATES) {
  const source = poiSources[color];
  if (!source) return [];
  return source.getFeatures()
    .filter(f => f.getGeometry())
    .map(f => {
      const c = f.getGeometry().getCoordinates();
      return { feature: f, dist: Math.hypot(c[0] - lv95Coord[0], c[1] - lv95Coord[1]) };
    })
    .sort((a, b) => a.dist - b.dist)
    .slice(0, n)
    .map(x => x.feature);
}

// ── OSRM : calcul d'itinéraire ──
async function fetchRouteOSRM(fromWgs84, toWgs84) {
  const url = `${OSRM_BASE}/route/v1/driving/` +
    `${fromWgs84[0]},${fromWgs84[1]};${toWgs84[0]},${toWgs84[1]}` +
    `?overview=full&geometries=geojson`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
  const data = await res.json();
  if (data.code !== "Ok" || !data.routes?.length) throw new Error("pas d'itinéraire");
  const route = data.routes[0];
  return { time: route.duration, distance: route.distance / 1000, coords: route.geometry.coordinates };
}

// ── OSRM : trouver le POI le plus rapide parmi les candidats ──
async function findFastestPOI(fromLv95, color) {
  const candidates = getNearestCandidates(fromLv95, color);
  if (!candidates.length) return null;
  const fromWgs84 = lv95ToWgs84(fromLv95);
  const results = await Promise.all(candidates.map(async f => {
    try {
      const route = await fetchRouteOSRM(fromWgs84, lv95ToWgs84(f.getGeometry().getCoordinates()));
      return { feature: f, route, time: route.time };
    } catch { return { feature: f, route: null, time: Infinity }; }
  }));
  return results.reduce((best, r) => r.time < best.time ? r : best, results[0]);
}

// ── Affichage d'un itinéraire sur la carte ──
function displayRouteOnMap(coords, color) {
  clearRouteForColor(color);
  const lineColors = { blue: "#1a56db", green: "#057a55", red: "#e02424" };
  const lv95Coords = coords.map(([lon, lat]) => wgs84ToLv95([lon, lat]));
  const feature    = new ol.Feature({ geometry: new ol.geom.LineString(lv95Coords) });
  feature.setStyle([
    new ol.style.Style({ stroke: new ol.style.Stroke({ color: "white", width: 7 }) }),
    new ol.style.Style({ stroke: new ol.style.Stroke({ color: lineColors[color], width: 4, lineDash: [12, 6] }) }),
  ]);
  routeLayers[color] = new ol.layer.Vector({ source: new ol.source.Vector({ features: [feature] }), zIndex: 500 });
  map.addLayer(routeLayers[color]);
}

// ── Toast notifications ──
let toastTimer = null;
function showToast(msg, type = "info") {
  const toast = document.getElementById("routing-toast");
  if (toastTimer) clearTimeout(toastTimer);
  toast.textContent  = msg;
  toast.className    = `toast-${type}`;
  toastTimer = setTimeout(() => {
    toast.className = "toast-hidden";
  }, 3200);
}

// ── Logique toolbar ──

// Le mode itinéraire est toujours actif — curseur crosshair permanent
map.once("rendercomplete", () => {
  map.getTargetElement().style.cursor = "crosshair";
});

function getSelectedColors() {
  return [...document.querySelectorAll(".svc-check:checked")].map(cb => cb.dataset.color);
}

document.getElementById("btn-clear-all").addEventListener("click", () => {
  clearAllRoutes();
  clickMarkerSource.clear();
  document.getElementById("multi-route-panel").style.display = "none";
  closePanel();
});

document.getElementById("mrp-close").addEventListener("click", () => {
  document.getElementById("multi-route-panel").style.display = "none";
  clearAllRoutes();
  clickMarkerSource.clear();
});

// Re-afficher/masquer les routes au changement de case (depuis la toolbar)
document.querySelectorAll(".svc-check").forEach(cb => {
  cb.addEventListener("change", () => {
    const color = cb.dataset.color;
    const row   = document.getElementById(`mrp-row-${color}`);
    if (row) row.style.opacity = cb.checked ? "1" : "0.35";

    if (cb.checked) {
      if (lastRouteResults[color]) displayRouteOnMap(lastRouteResults[color].coords, color);
    } else {
      clearRouteForColor(color);
    }
  });
});

// ── Calcul multi-itinéraires ──
async function computeMultiRoutes(fromLv95) {
  const selected = getSelectedColors();
  if (!selected.length) {
    showToast("Cochez au moins un service d'urgence", "error");
    return;
  }

  // Marqueur viseur
  clickMarkerSource.clear();
  clickMarkerSource.addFeature(new ol.Feature({ geometry: new ol.geom.Point(fromLv95) }));

  const multiRoutePanel = document.getElementById("multi-route-panel");

  // Reset panneau
  ["red", "blue", "green"].forEach(color => {
    clearRouteForColor(color);
    lastRouteResults[color] = null;
    const row = document.getElementById(`mrp-row-${color}`);
    const res = document.getElementById(`mrp-result-${color}`);
    if (selected.includes(color)) {
      row.style.display = "flex";
      row.style.opacity = "1";
      res.innerHTML = `<span class="mrp-loading">Calcul…</span>`;
    } else {
      row.style.display = "none";
    }
  });
  multiRoutePanel.style.display = "block";

  const nSelected = selected.length;
  let   nDone     = 0;

  await Promise.all(selected.map(async color => {
    try {
      const candidates = getNearestCandidates(fromLv95, color);
      if (!candidates.length) {
        document.getElementById(`mrp-result-${color}`).innerHTML =
          `<span class="mrp-error">Données non chargées</span>`;
        return;
      }
      const best = await findFastestPOI(fromLv95, color);
      if (!best?.route) {
        document.getElementById(`mrp-result-${color}`).innerHTML =
          `<span class="mrp-error">Aucun itinéraire</span>`;
        return;
      }
      lastRouteResults[color] = best.route;

      // Afficher la route seulement si la case est toujours cochée
      const cb = document.querySelector(`.svc-check[data-color="${color}"]`);
      if (cb?.checked) displayRouteOnMap(best.route.coords, color);

      const mins  = Math.round(best.route.time / 60);
      const km    = best.route.distance.toFixed(1);
      const props = best.feature.getProperties();
      const name  = props.name || props.Name || props.NAME ||
                    props.bezeichnung || props.Bezeichnung ||
                    props.nom || props.Nom || "Sans nom";

      document.getElementById(`mrp-result-${color}`).innerHTML = `
        <div class="mrp-time"><strong>${mins} min</strong><span class="mrp-km"> · ${km} km</span></div>
        <div class="mrp-name">${name}</div>
      `;
    } catch (err) {
      document.getElementById(`mrp-result-${color}`).innerHTML =
        `<span class="mrp-error">Erreur</span>`;
      console.error(err);
    }
    nDone++;
    if (nDone === nSelected) showToast("Itinéraires calculés ✓", "success");
  }));
}

// ── Clic carte ──
map.on("singleclick", async e => {
  await computeMultiRoutes(e.coordinate);
});

// ── Utilitaire formatage clé ──
function formatKey(key) {
  return key.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\b\w/g, c => c.toUpperCase());
}

// ── Chargement GeoJSON ──
function loadGeoJSON(url, style, color) {
  fetch(url)
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(geojson => {
      const features = new ol.format.GeoJSON().readFeatures(geojson, {
        dataProjection: "EPSG:2056", featureProjection: "EPSG:2056",
      });
      const source = new ol.source.Vector({ features });
      poiSources[color] = source;
      const layer = new ol.layer.Vector({ source, style, zIndex: 300 });
      layer.set("poiColor", color);
      map.addLayer(layer);
    })
    .catch(err => console.error(`✗ ${url}:`, err));
}

loadGeoJSON("./fire_station.geojson", redStyle,   "red");
loadGeoJSON("./police_v2.geojson",    blueStyle,  "blue");
loadGeoJSON("./hospital.geojson",     greenStyle, "green");
