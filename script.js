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
    zoom: 2,
    minZoom: 2,
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
  red:   { label: "Caserne de pompiers", emoji: "🚒", color: "#e02424" },
  blue:  { label: "Poste de police",     emoji: "👮", color: "#1a56db" },
  green: { label: "Hôpital",             emoji: "🏥", color: "#057a55" },
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

// ── Couches itinéraires multiples ──
// Un layer par couleur de service
const routeLayers = { red: null, blue: null, green: null };

function clearRouteForColor(color) {
  if (routeLayers[color]) {
    map.removeLayer(routeLayers[color]);
    routeLayers[color] = null;
  }
}

function clearAllRoutes() {
  Object.keys(routeLayers).forEach(clearRouteForColor);
}

// ── Marqueur point cliqué ──
const clickMarkerSource = new ol.source.Vector();
const clickMarkerLayer = new ol.layer.Vector({
  source: clickMarkerSource,
  zIndex: 700,
  style: new ol.style.Style({
    image: new ol.style.RegularShape({
      points: 4, radius: 12, radius2: 0, angle: Math.PI / 4,
      fill:   new ol.style.Fill({ color: "#ff6600" }),
      stroke: new ol.style.Stroke({ color: "white", width: 2 }),
    }),
  }),
});
map.addLayer(clickMarkerLayer);

// ── Conversion ──
function lv95ToWgs84(coord) { return ol.proj.transform(coord, "EPSG:2056", "EPSG:4326"); }
function wgs84ToLv95(coord) { return ol.proj.transform(coord, "EPSG:4326", "EPSG:2056"); }

// ── POI sources ──
const poiSources = {};
const CANDIDATES = 5;

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

// ── Appel OSRM /route ──
async function getRouteOSRM(fromWgs84, toWgs84) {
  const url = `${OSRM_BASE}/route/v1/driving/` +
    `${fromWgs84[0]},${fromWgs84[1]};${toWgs84[0]},${toWgs84[1]}` +
    `?overview=full&geometries=geojson`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
  const data = await res.json();
  if (data.code !== "Ok" || !data.routes?.length) throw new Error("OSRM: pas d'itinéraire");
  const route = data.routes[0];
  return {
    time:     route.duration,
    distance: route.distance / 1000,
    coords:   route.geometry.coordinates,
  };
}

// ── Trouver le POI le plus rapide parmi les N candidats ──
async function findFastestPOI(fromLv95, color) {
  const candidates = getNearestCandidates(fromLv95, color);
  if (!candidates.length) return null;
  const fromWgs84 = lv95ToWgs84(fromLv95);

  const results = await Promise.all(
    candidates.map(async f => {
      const toWgs84 = lv95ToWgs84(f.getGeometry().getCoordinates());
      try {
        const route = await getRouteOSRM(fromWgs84, toWgs84);
        return { feature: f, route, time: route.time };
      } catch (e) {
        console.warn("OSRM échec pour un candidat :", e.message);
        return { feature: f, route: null, time: Infinity };
      }
    })
  );

  return results.reduce((best, r) => (r.time < best.time ? r : best), results[0]);
}

// ── Afficher un itinéraire pour une couleur ──
function displayRouteForColor(coords, color) {
  clearRouteForColor(color);
  const typeColors = { blue: "#1a56db", green: "#057a55", red: "#e02424" };
  const lineColor  = typeColors[color] || "#ff6600";

  const lv95Coords = coords.map(([lon, lat]) => wgs84ToLv95([lon, lat]));
  const feature    = new ol.Feature({ geometry: new ol.geom.LineString(lv95Coords) });
  feature.setStyle([
    new ol.style.Style({ stroke: new ol.style.Stroke({ color: "white",   width: 7 }) }),
    new ol.style.Style({ stroke: new ol.style.Stroke({ color: lineColor, width: 4, lineDash: [12, 6] }) }),
  ]);

  routeLayers[color] = new ol.layer.Vector({
    source: new ol.source.Vector({ features: [feature] }),
    zIndex: 500,
  });
  map.addLayer(routeLayers[color]);
}

// ── Toast ──
function showToast(msg, type = "info") {
  const existing = document.getElementById("valhalla-toast");
  if (existing) existing.remove();
  const toast = document.createElement("div");
  toast.id = "valhalla-toast";
  toast.className = `toast-${type}`;
  toast.textContent = msg;
  document.getElementById("map").appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

// ── Barre d'outils ──
const valhallaToolbar = document.createElement("div");
valhallaToolbar.id = "valhalla-toolbar";
valhallaToolbar.innerHTML = `
  <button id="btn-route" class="vtool-btn" title="Calculer les itinéraires vers les services d'urgence">🚨 Itinéraire</button>
  <button id="btn-clear-all" class="vtool-btn vtool-clear" title="Tout effacer">✕ Effacer</button>
`;
document.getElementById("map").appendChild(valhallaToolbar);

// ── Panneau multi-itinéraires ──
const multiRoutePanel = document.createElement("div");
multiRoutePanel.id = "multi-route-panel";
multiRoutePanel.style.display = "none";
multiRoutePanel.innerHTML = `
  <div id="mrp-header">
    <span style="font-size:16px;">🚨</span>
    <div style="font-weight:600; font-size:14px; color:#111;">Services d'urgence</div>
    <button id="mrp-close">×</button>
  </div>
  <div id="mrp-subtext">Cochez les services pour afficher les itinéraires</div>
  <div id="mrp-rows">
    <div class="mrp-row" id="mrp-row-red">
      <label class="mrp-label">
        <input type="checkbox" class="mrp-check" data-color="red" checked>
        <span class="mrp-dot" style="background:#e02424;"></span>
        <span>🚒 Pompiers</span>
      </label>
      <div class="mrp-result" id="mrp-result-red">
        <span class="mrp-loading">Calcul…</span>
      </div>
    </div>
    <div class="mrp-row" id="mrp-row-blue">
      <label class="mrp-label">
        <input type="checkbox" class="mrp-check" data-color="blue" checked>
        <span class="mrp-dot" style="background:#1a56db;"></span>
        <span>👮 Police</span>
      </label>
      <div class="mrp-result" id="mrp-result-blue">
        <span class="mrp-loading">Calcul…</span>
      </div>
    </div>
    <div class="mrp-row" id="mrp-row-green">
      <label class="mrp-label">
        <input type="checkbox" class="mrp-check" data-color="green" checked>
        <span class="mrp-dot" style="background:#057a55;"></span>
        <span>🏥 Hôpital</span>
      </label>
      <div class="mrp-result" id="mrp-result-green">
        <span class="mrp-loading">Calcul…</span>
      </div>
    </div>
  </div>
  <button id="mrp-clear-btn">✕ Effacer les itinéraires</button>
`;
document.getElementById("map").appendChild(multiRoutePanel);

document.getElementById("mrp-close").addEventListener("click", () => {
  multiRoutePanel.style.display = "none";
  clearAllRoutes();
  clickMarkerSource.clear();
  activeValhallaMode = null;
  document.getElementById("btn-route").classList.remove("active");
  map.getTargetElement().style.cursor = "";
});

document.getElementById("mrp-clear-btn").addEventListener("click", () => {
  clearAllRoutes();
  clickMarkerSource.clear();
  // Reset result labels
  ["red","blue","green"].forEach(c => {
    document.getElementById(`mrp-result-${c}`).innerHTML = `<span class="mrp-loading">—</span>`;
  });
  document.getElementById("mrp-subtext").textContent = "Cliquez sur la carte pour calculer";
});

// ── Gestion des cases à cocher ──
// Stocker les derniers résultats de route pour pouvoir re-afficher/masquer
const lastRouteResults = { red: null, blue: null, green: null };

multiRoutePanel.querySelectorAll(".mrp-check").forEach(checkbox => {
  checkbox.addEventListener("change", () => {
    const color = checkbox.dataset.color;
    if (checkbox.checked) {
      if (lastRouteResults[color]) {
        displayRouteForColor(lastRouteResults[color].coords, color);
      }
    } else {
      clearRouteForColor(color);
    }
  });
});

// ── Barre de recherche ──
const searchBar = document.createElement("div");
searchBar.id = "search-bar";
searchBar.innerHTML = `
  <div id="search-input-wrap">
    <span id="search-icon">🔍</span>
    <input id="search-input" type="text" placeholder="Rechercher une adresse en Suisse…" autocomplete="off" />
    <button id="search-clear">×</button>
  </div>
  <ul id="search-results"></ul>
`;
document.getElementById("map").appendChild(searchBar);

// ── Marqueur de recherche ──
const searchMarkerSource = new ol.source.Vector();
const searchMarkerLayer  = new ol.layer.Vector({
  source: searchMarkerSource,
  zIndex: 600,
  style: new ol.style.Style({
    image: new ol.style.RegularShape({
      points: 4, radius: 10, radius2: 0, angle: Math.PI / 4,
      fill:   new ol.style.Fill({ color: "#ff6600" }),
      stroke: new ol.style.Stroke({ color: "white", width: 2 }),
    }),
  }),
});
map.addLayer(searchMarkerLayer);

// ── Logique recherche ──
const searchInput   = document.getElementById("search-input");
const searchClear   = document.getElementById("search-clear");
const searchResults = document.getElementById("search-results");
let searchTimeout   = null;

searchInput.addEventListener("input", () => {
  const q = searchInput.value.trim();
  searchClear.style.display = q ? "flex" : "none";
  clearTimeout(searchTimeout);
  if (q.length < 2) { searchResults.style.display = "none"; return; }
  searchTimeout = setTimeout(() => doSearch(q), 300);
});

searchClear.addEventListener("click", () => {
  searchInput.value = "";
  searchClear.style.display = "none";
  searchResults.style.display = "none";
  searchMarkerSource.clear();
});

document.addEventListener("click", (e) => {
  if (!searchBar.contains(e.target)) searchResults.style.display = "none";
});

async function doSearch(q) {
  searchResults.innerHTML = `<li class="search-loading">Recherche…</li>`;
  searchResults.style.display = "block";
  try {
    const url = `https://api3.geo.admin.ch/rest/services/api/SearchServer?searchText=${encodeURIComponent(q)}&type=locations&sr=2056&limit=6&lang=fr`;
    const res  = await fetch(url);
    const data = await res.json();
    const results = data.results || [];
    if (!results.length) {
      searchResults.innerHTML = `<li class="search-no-result">Aucun résultat</li>`;
      return;
    }
    searchResults.innerHTML = "";
    results.forEach(r => {
      const attrs = r.attrs;
      const li    = document.createElement("li");
      li.innerHTML = `
        <span class="result-icon">📍</span>
        <div class="result-text">
          <span class="result-main">${attrs.label.replace(/<[^>]+>/g, "")}</span>
          <span class="result-sub">${attrs.detail || ""}</span>
        </div>
      `;
      li.addEventListener("click", () => {
        const coord = [attrs.y, attrs.x];
        map.getView().animate({ center: coord, zoom: 14, duration: 600 });
        searchMarkerSource.clear();
        searchMarkerSource.addFeature(new ol.Feature({ geometry: new ol.geom.Point(coord) }));
        searchInput.value = attrs.label.replace(/<[^>]+>/g, "");
        searchClear.style.display = "flex";
        searchResults.style.display = "none";
      });
      searchResults.appendChild(li);
    });
  } catch {
    searchResults.innerHTML = `<li class="search-no-result">Erreur de recherche</li>`;
  }
}

// ── États modes ──
let activeValhallaMode = null;

function setRouteMode() {
  const wasActive = activeValhallaMode === "route";
  activeValhallaMode = wasActive ? null : "route";
  document.getElementById("btn-route").classList.toggle("active", !wasActive);
  map.getTargetElement().style.cursor = activeValhallaMode ? "crosshair" : "";
  if (!wasActive) showToast("Cliquez sur la carte pour calculer les itinéraires", "info");
  else {
    multiRoutePanel.style.display = "none";
    clearAllRoutes();
    clickMarkerSource.clear();
  }
}

document.getElementById("btn-route").addEventListener("click", setRouteMode);
document.getElementById("btn-clear-all").addEventListener("click", () => {
  clearAllRoutes();
  clickMarkerSource.clear();
  activeValhallaMode = null;
  document.getElementById("btn-route").classList.remove("active");
  map.getTargetElement().style.cursor = "";
  multiRoutePanel.style.display = "none";
  closePanel();
});

// ── Calcul multi-itinéraires depuis un point ──
async function computeMultiRoutes(fromLv95) {
  const colors = ["red", "blue", "green"];

  // Réinitialiser le panneau
  colors.forEach(color => {
    const cb = multiRoutePanel.querySelector(`.mrp-check[data-color="${color}"]`);
    cb.checked = true;
    document.getElementById(`mrp-result-${color}`).innerHTML = `<span class="mrp-loading">Calcul…</span>`;
    clearRouteForColor(color);
    lastRouteResults[color] = null;
  });

  // Placer le marqueur
  clickMarkerSource.clear();
  clickMarkerSource.addFeature(new ol.Feature({ geometry: new ol.geom.Point(fromLv95) }));

  // Afficher le panneau
  multiRoutePanel.style.display = "block";
  document.getElementById("mrp-subtext").textContent = "Calcul en cours…";

  // Calculer chaque service en parallèle
  await Promise.all(colors.map(async color => {
    try {
      const candidates = getNearestCandidates(fromLv95, color);
      if (!candidates.length) {
        document.getElementById(`mrp-result-${color}`).innerHTML =
          `<span class="mrp-error">Données non chargées</span>`;
        return;
      }
      const best = await findFastestPOI(fromLv95, color);
      if (!best || !best.route) {
        document.getElementById(`mrp-result-${color}`).innerHTML =
          `<span class="mrp-error">Aucun itinéraire</span>`;
        return;
      }
      // Stocker et afficher
      lastRouteResults[color] = best.route;
      const cb = multiRoutePanel.querySelector(`.mrp-check[data-color="${color}"]`);
      if (cb.checked) displayRouteForColor(best.route.coords, color);

      const mins = Math.round(best.route.time / 60);
      const km   = best.route.distance.toFixed(1);
      const props = best.feature.getProperties();
      const name  = props.name || props.Name || props.NAME ||
                    props.bezeichnung || props.Bezeichnung ||
                    props.nom || props.Nom || "Sans nom";

      document.getElementById(`mrp-result-${color}`).innerHTML = `
        <div class="mrp-time"><strong>${mins} min</strong> · ${km} km</div>
        <div class="mrp-name">${name}</div>
      `;
    } catch (err) {
      document.getElementById(`mrp-result-${color}`).innerHTML =
        `<span class="mrp-error">Erreur : ${err.message}</span>`;
    }
  }));

  document.getElementById("mrp-subtext").textContent = "Cliquez sur la carte pour un nouveau point";
}

// ── Clic carte ──
map.on("singleclick", async (e) => {
  // Mode itinéraire multi
  if (activeValhallaMode === "route") {
    await computeMultiRoutes(e.coordinate);
    return;
  }

  // Clic normal sur un POI
  let found = false;
  map.forEachFeatureAtPixel(e.pixel, (feature, layer) => {
    if (found) return;
    if (layer === searchMarkerLayer || layer === clickMarkerLayer) return;
    found = true;

    if (selectedFeature) selectedFeature.setStyle(defaultStyleMap[selectedColor]);
    selectedFeature = feature;
    selectedColor   = layer.get("poiColor");
    feature.setStyle(selectedStyleMap[selectedColor]);

    const typeInfo = layerTypeMap[selectedColor] || { label: "Point d'intérêt", emoji: "📍", color: "#666" };
    elEmoji.textContent = typeInfo.emoji;
    elType.style.color  = typeInfo.color;
    elType.textContent  = typeInfo.label;

    const props = feature.getProperties();
    elName.textContent =
      props.name || props.Name || props.NAME ||
      props.bezeichnung || props.Bezeichnung ||
      props.nom || props.Nom || "Sans nom";

    const excluded = new Set(["geometry", "name", "Name", "NAME", "nom", "Nom", "bezeichnung", "Bezeichnung"]);
    const entries  = Object.entries(props).filter(([k, v]) => !excluded.has(k) && v !== null && v !== undefined && v !== "");

    elBody.innerHTML = "";
    if (entries.length === 0) {
      elBody.innerHTML = "<p>Aucune information supplémentaire disponible.</p>";
    } else {
      const table = document.createElement("table");
      entries.forEach(([key, value]) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${formatKey(key)}</td><td>${value}</td>`;
        table.appendChild(tr);
      });
      elBody.appendChild(table);
    }
    panel.style.display = "block";
  });

  if (!found) closePanel();
});

function formatKey(key) {
  return key.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\b\w/g, c => c.toUpperCase());
}

// ── Chargement GeoJSON ──
function loadGeoJSON(url, style, color) {
  fetch(url)
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status} pour ${url}`);
      return res.json();
    })
    .then(geojson => {
      const features = new ol.format.GeoJSON().readFeatures(geojson, {
        dataProjection: "EPSG:2056",
        featureProjection: "EPSG:2056",
      });
      const source = new ol.source.Vector({ features });
      poiSources[color] = source;
      const layer = new ol.layer.Vector({ source, style, zIndex: 300 });
      layer.set("poiColor", color);
      map.addLayer(layer);
      console.log(`✓ ${color}: ${features.length} features chargées depuis ${url}`);
    })
    .catch(err => console.error(`✗ Erreur chargement ${url}:`, err));
}

loadGeoJSON("./fire_station.geojson", redStyle,   "red");
loadGeoJSON("./police_v2.geojson",    blueStyle,  "blue");
loadGeoJSON("./hospital.geojson",     greenStyle, "green");
