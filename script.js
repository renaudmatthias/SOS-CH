// ── Configuration Valhalla ──
const VALHALLA_BASE = "https://valhalla1.openstreetmap.de";
const VALHALLA_COSTING = "auto";
const VALHALLA_COSTING_OPTIONS = {
  auto: { use_highways: 1.0, use_tolls: 1.0, top_speed: 130 }
};

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

// ── Couches Valhalla ──
let routeLayer     = null;
let isochroneLayer = null;

function clearRoute() {
  if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
  const rs = document.getElementById("route-summary");
  if (rs) rs.remove();
}
function clearIsochrones() {
  if (isochroneLayer) { map.removeLayer(isochroneLayer); isochroneLayer = null; }
}

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

async function findFastestPOI(fromLv95, color) {
  const candidates = getNearestCandidates(fromLv95, color);
  if (!candidates.length) return null;
  const fromWgs84 = lv95ToWgs84(fromLv95);
  const results = await Promise.all(
    candidates.map(async f => {
      const toWgs84 = lv95ToWgs84(f.getGeometry().getCoordinates());
      try {
        const data = await getRoute(fromWgs84, toWgs84);
        const time = data.trip?.summary?.time ?? Infinity;
        return { feature: f, data, time };
      } catch {
        return { feature: f, data: null, time: Infinity };
      }
    })
  );
  return results.reduce((best, r) => (r.time < best.time ? r : best), results[0]);
}

// ── Décoder polyline Valhalla (precision=6) ──
function decodePolyline(encoded, precision = 6) {
  const factor = Math.pow(10, precision);
  const coords = [];
  let i = 0, lat = 0, lng = 0;
  while (i < encoded.length) {
    let b, shift = 0, result = 0;
    do { b = encoded.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    coords.push([lng / factor, lat / factor]);
  }
  return coords;
}

// ── Appel Valhalla /route ──
async function getRoute(fromWgs84, toWgs84) {
  const res = await fetch(`${VALHALLA_BASE}/route`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      locations: [
        { lon: fromWgs84[0], lat: fromWgs84[1] },
        { lon: toWgs84[0],   lat: toWgs84[1] },
      ],
      costing: VALHALLA_COSTING,
      costing_options: VALHALLA_COSTING_OPTIONS,
      units: "km",
    }),
  });
  if (!res.ok) throw new Error(`Valhalla /route HTTP ${res.status}`);
  return res.json();
}

// ── Appel Valhalla /isochrone ──
async function getIsochrone(fromWgs84) {
  const res = await fetch(`${VALHALLA_BASE}/isochrone`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      locations: [{ lon: fromWgs84[0], lat: fromWgs84[1] }],
      costing: VALHALLA_COSTING,
      contours: [
        { time: 5,  color: "ff0000" },
        { time: 10, color: "ffaa00" },
        { time: 15, color: "00aa00" },
      ],
      polygons: true,
    }),
  });
  if (!res.ok) throw new Error(`Valhalla /isochrone HTTP ${res.status}`);
  return res.json();
}

// ── Afficher l'itinéraire ──
function displayRoute(data, color) {
  clearRoute();
  const shape = data.trip?.legs?.[0]?.shape;
  if (!shape) return;
  const typeColors = { blue: "#1a56db", green: "#057a55", red: "#e02424" };
  const lineColor  = typeColors[color] || "#ff6600";
  const wgs84Coords = decodePolyline(shape);
  const lv95Coords  = wgs84Coords.map(([lon, lat]) => wgs84ToLv95([lon, lat]));
  const feature = new ol.Feature({ geometry: new ol.geom.LineString(lv95Coords) });
  feature.setStyle([
    new ol.style.Style({ stroke: new ol.style.Stroke({ color: "white",   width: 7 }) }),
    new ol.style.Style({ stroke: new ol.style.Stroke({ color: lineColor, width: 4, lineDash: [12, 6] }) }),
  ]);
  routeLayer = new ol.layer.Vector({ source: new ol.source.Vector({ features: [feature] }), zIndex: 500 });
  map.addLayer(routeLayer);
}

// ── Afficher les isochrones ──
function displayIsochrones(geojson) {
  clearIsochrones();
  const isoColors = [
    { fill: "rgba(255,0,0,0.12)",    stroke: "#e02424" },
    { fill: "rgba(255,170,0,0.12)",  stroke: "#d97706" },
    { fill: "rgba(0,170,0,0.12)",    stroke: "#057a55" },
  ];
  const features = new ol.format.GeoJSON().readFeatures(geojson, {
    dataProjection: "EPSG:4326",
    featureProjection: "EPSG:2056",
  });
  features.forEach((f, i) => {
    const c = isoColors[i] || isoColors[isoColors.length - 1];
    f.setStyle(new ol.style.Style({
      fill:   new ol.style.Fill({ color: c.fill }),
      stroke: new ol.style.Stroke({ color: c.stroke, width: 2 }),
    }));
  });
  isochroneLayer = new ol.layer.Vector({
    source: new ol.source.Vector({ features }),
    zIndex: 400,
  });
  map.addLayer(isochroneLayer);
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

// ── Barre d'outils Valhalla ──
const valhallaToolbar = document.createElement("div");
valhallaToolbar.id = "valhalla-toolbar";
valhallaToolbar.innerHTML = `
  <button id="btn-route" class="vtool-btn" title="Calculer l'itinéraire vers le service le plus proche">🚨 Itinéraire</button>
  <button id="btn-iso"   class="vtool-btn" title="Afficher les isochrones 5/10/15 min">🕐 Isochrones</button>
  <button id="btn-coord" class="vtool-btn" title="Afficher les coordonnées d'un point">📍 Coordonnées</button>
  <button id="btn-clear-all" class="vtool-btn vtool-clear" title="Tout effacer">✕ Effacer</button>
`;
document.getElementById("map").appendChild(valhallaToolbar);

// ── Sélecteur type POI ──
const routeTypeSelector = document.createElement("div");
routeTypeSelector.id = "route-type-selector";
routeTypeSelector.style.display = "none";
routeTypeSelector.innerHTML = `
  <span class="rts-label">Vers :</span>
  <button class="rts-btn" data-color="red">🚒 Pompiers</button>
  <button class="rts-btn" data-color="blue">👮 Police</button>
  <button class="rts-btn selected" data-color="green">🏥 Hôpital</button>
`;
document.getElementById("map").appendChild(routeTypeSelector);

// ── Panneau coordonnées ──
const coordPanel = document.createElement("div");
coordPanel.id = "coord-panel";
coordPanel.style.cssText = `
  position:absolute; top:12px; right:12px; width:260px;
  background:white; border-radius:10px;
  box-shadow:0 4px 20px rgba(0,0,0,0.18);
  font-family:'Segoe UI',Arial,sans-serif; overflow:hidden;
  display:none; z-index:1000;
`;
coordPanel.innerHTML = `
  <div style="padding:12px 16px 8px; border-bottom:1px solid #f0f0f0; display:flex; align-items:center; gap:8px;">
    <span style="font-size:18px;">📍</span>
    <div style="font-size:13px; font-weight:600; color:#111;">Coordonnées du point</div>
    <button id="coord-close" style="margin-left:auto;background:none;border:none;cursor:pointer;font-size:18px;color:#aaa;padding:0;line-height:1;">×</button>
  </div>
  <div style="padding:12px 16px; font-size:13px;">
    <div style="color:#888; font-size:11px; margin-bottom:2px;">LV95 (EPSG:2056)</div>
    <div id="coord-lv95" style="font-weight:600; color:#111; margin-bottom:8px;">—</div>
    <div style="color:#888; font-size:11px; margin-bottom:2px;">WGS 84 (lat, lon)</div>
    <div id="coord-wgs84" style="font-weight:600; color:#111;">—</div>
  </div>
`;
document.getElementById("map").appendChild(coordPanel);
document.getElementById("coord-close").addEventListener("click", () => {
  coordPanel.style.display = "none";
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

// ── Logique recherche (geo.admin.ch) ──
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
        const x = attrs.y, y = attrs.x; // geo.admin retourne y=Est, x=Nord en LV95
        const coord = [x, y];
        map.getView().animate({ center: coord, zoom: 14, duration: 600 });
        searchMarkerSource.clear();
        const marker = new ol.Feature({ geometry: new ol.geom.Point(coord) });
        searchMarkerSource.addFeature(marker);
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
let selectedRouteColor = "green";
let coordToolActive    = false;

function setValhallaMode(mode) {
  activeValhallaMode = activeValhallaMode === mode ? null : mode;
  coordToolActive    = false;
  document.getElementById("btn-route").classList.toggle("active", activeValhallaMode === "route");
  document.getElementById("btn-iso").classList.toggle("active",   activeValhallaMode === "iso");
  document.getElementById("btn-coord").classList.remove("active");
  routeTypeSelector.style.display = activeValhallaMode === "route" ? "flex" : "none";
  map.getTargetElement().style.cursor = activeValhallaMode ? "crosshair" : "";
  if (activeValhallaMode === "route") showToast("Cliquez sur la carte pour calculer l'itinéraire", "info");
  if (activeValhallaMode === "iso")   showToast("Cliquez sur la carte pour afficher les isochrones 5/10/15 min", "info");
}

function setCoordMode() {
  coordToolActive    = !coordToolActive;
  activeValhallaMode = null;
  document.getElementById("btn-route").classList.remove("active");
  document.getElementById("btn-iso").classList.remove("active");
  document.getElementById("btn-coord").classList.toggle("active", coordToolActive);
  routeTypeSelector.style.display = "none";
  map.getTargetElement().style.cursor = coordToolActive ? "crosshair" : "";
  if (coordToolActive) showToast("Cliquez sur la carte pour voir les coordonnées", "info");
}

document.getElementById("btn-route").addEventListener("click", () => setValhallaMode("route"));
document.getElementById("btn-iso").addEventListener("click",   () => setValhallaMode("iso"));
document.getElementById("btn-coord").addEventListener("click", setCoordMode);
document.getElementById("btn-clear-all").addEventListener("click", () => {
  clearRoute();
  clearIsochrones();
  activeValhallaMode = null;
  coordToolActive    = false;
  document.getElementById("btn-route").classList.remove("active");
  document.getElementById("btn-iso").classList.remove("active");
  document.getElementById("btn-coord").classList.remove("active");
  routeTypeSelector.style.display = "none";
  map.getTargetElement().style.cursor = "";
  coordPanel.style.display = "none";
});

routeTypeSelector.querySelectorAll(".rts-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    selectedRouteColor = btn.dataset.color;
    routeTypeSelector.querySelectorAll(".rts-btn").forEach(b => b.classList.remove("selected"));
    btn.classList.add("selected");
  });
});

// ── Clic carte ──
map.on("singleclick", async (e) => {

  // Mode coordonnées
  if (coordToolActive) {
    const lv95  = e.coordinate;
    const wgs84 = lv95ToWgs84(lv95);
    document.getElementById("coord-lv95").textContent =
      `E ${Math.round(lv95[0]).toLocaleString("fr-CH")}  /  N ${Math.round(lv95[1]).toLocaleString("fr-CH")}`;
    document.getElementById("coord-wgs84").textContent =
      `${wgs84[1].toFixed(6)}, ${wgs84[0].toFixed(6)}`;
    coordPanel.style.display = "block";
    return;
  }

  // Mode itinéraire
  if (activeValhallaMode === "route") {
    const fromLv95   = e.coordinate;
    const candidates = getNearestCandidates(fromLv95, selectedRouteColor);
    if (!candidates.length) { showToast("Données pas encore chargées, réessaie dans un instant.", "error"); return; }
    showToast(`Comparaison de ${candidates.length} candidats en parallèle…`, "info");
    try {
      const best = await findFastestPOI(fromLv95, selectedRouteColor);
      if (!best || !best.data) { showToast("Aucun itinéraire trouvé.", "error"); return; }
      displayRoute(best.data, selectedRouteColor);
      const typeInfo = layerTypeMap[selectedRouteColor];
      elEmoji.textContent = typeInfo.emoji;
      elType.style.color  = typeInfo.color;
      elType.textContent  = typeInfo.label;
      const props = best.feature.getProperties();
      elName.textContent  =
        props.name || props.Name || props.NAME ||
        props.bezeichnung || props.Bezeichnung ||
        props.nom || props.Nom || "Sans nom";
      elBody.innerHTML = "";
      const summary = best.data.trip?.summary;
      if (summary) {
        const mins = Math.round(summary.time / 60);
        const km   = summary.length.toFixed(1);
        const routeInfo = document.createElement("div");
        routeInfo.id = "route-summary";
        routeInfo.innerHTML = `
          <div class="route-row">🚨 <strong>${mins} min</strong> &nbsp;·&nbsp; ${km} km</div>
          <div class="route-note">✓ Le plus rapide parmi ${candidates.length} candidats</div>
          <button id="clear-route-btn">✕ Effacer l'itinéraire</button>
        `;
        elBody.prepend(routeInfo);
        document.getElementById("clear-route-btn").addEventListener("click", clearRoute);
      }
      panel.style.display = "block";
      showToast(`Itinéraire calculé ✓  — ${Math.round(best.time / 60)} min`, "success");
    } catch (err) {
      console.error(err);
      showToast("Erreur Valhalla : " + err.message, "error");
    }
    return;
  }

  // Mode isochrones
  if (activeValhallaMode === "iso") {
    const fromLv95  = e.coordinate;
    const fromWgs84 = lv95ToWgs84(fromLv95);
    showToast("Calcul des isochrones…", "info");
    try {
      const data = await getIsochrone(fromWgs84);
      displayIsochrones(data);
      showToast("Isochrones affichées ✓  (5 / 10 / 15 min)", "success");
    } catch (err) {
      console.error(err);
      showToast("Erreur isochrones : " + err.message, "error");
    }
    return;
  }

  // Clic normal sur un POI
  let found = false;
  map.forEachFeatureAtPixel(e.pixel, (feature, layer) => {
    if (found) return;
    if (layer === searchMarkerLayer) return;
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
