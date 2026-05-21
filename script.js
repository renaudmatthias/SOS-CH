// ── Routing : OSRM public (fallback: valhalla2) ──
// OSRM : router.project-osrm.org — format /route/v1/driving/lon1,lat1;lon2,lat2
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

// ── Couche itinéraire ──
let routeLayer = null;

function clearRoute() {
  if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
  const rs = document.getElementById("route-summary");
  if (rs) rs.remove();
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

// ── Appel OSRM /route ──
// Retourne { time (secondes), distance (km), geometry (coordonnées WGS84 [[lon,lat]...]) }
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
    time:     route.duration,                         // secondes
    distance: route.distance / 1000,                 // km
    coords:   route.geometry.coordinates,            // [[lon, lat], ...]
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

// ── Afficher l'itinéraire ──
function displayRoute(coords, color) {
  clearRoute();
  const typeColors = { blue: "#1a56db", green: "#057a55", red: "#e02424" };
  const lineColor  = typeColors[color] || "#ff6600";

  const lv95Coords = coords.map(([lon, lat]) => wgs84ToLv95([lon, lat]));
  const feature    = new ol.Feature({ geometry: new ol.geom.LineString(lv95Coords) });
  feature.setStyle([
    new ol.style.Style({ stroke: new ol.style.Stroke({ color: "white",   width: 7 }) }),
    new ol.style.Style({ stroke: new ol.style.Stroke({ color: lineColor, width: 4, lineDash: [12, 6] }) }),
  ]);

  routeLayer = new ol.layer.Vector({
    source: new ol.source.Vector({ features: [feature] }),
    zIndex: 500,
  });
  map.addLayer(routeLayer);
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
  <button id="btn-route" class="vtool-btn" title="Calculer l'itinéraire vers le service le plus proche">🚨 Itinéraire</button>
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
        const coord = [attrs.y, attrs.x]; // geo.admin: y=Est, x=Nord
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
let selectedRouteColor = "green";
let coordToolActive    = false;

function setRouteMode() {
  const wasActive = activeValhallaMode === "route";
  activeValhallaMode = wasActive ? null : "route";
  coordToolActive    = false;
  document.getElementById("btn-route").classList.toggle("active", !wasActive);
  document.getElementById("btn-coord").classList.remove("active");
  routeTypeSelector.style.display = activeValhallaMode === "route" ? "flex" : "none";
  map.getTargetElement().style.cursor = activeValhallaMode ? "crosshair" : "";
  if (!wasActive) showToast("Cliquez sur la carte pour calculer l'itinéraire", "info");
}

function setCoordMode() {
  coordToolActive    = !coordToolActive;
  activeValhallaMode = null;
  document.getElementById("btn-coord").classList.toggle("active", coordToolActive);
  document.getElementById("btn-route").classList.remove("active");
  routeTypeSelector.style.display = "none";
  map.getTargetElement().style.cursor = coordToolActive ? "crosshair" : "";
  if (coordToolActive) showToast("Cliquez sur la carte pour voir les coordonnées", "info");
}

document.getElementById("btn-route").addEventListener("click", setRouteMode);
document.getElementById("btn-coord").addEventListener("click", setCoordMode);
document.getElementById("btn-clear-all").addEventListener("click", () => {
  clearRoute();
  activeValhallaMode = null;
  coordToolActive    = false;
  document.getElementById("btn-route").classList.remove("active");
  document.getElementById("btn-coord").classList.remove("active");
  routeTypeSelector.style.display = "none";
  map.getTargetElement().style.cursor = "";
  coordPanel.style.display = "none";
  closePanel();
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
    if (!candidates.length) {
      showToast("Données pas encore chargées, réessaie dans un instant.", "error");
      return;
    }
    showToast(`Calcul de l'itinéraire…`, "info");
    try {
      const best = await findFastestPOI(fromLv95, selectedRouteColor);
      if (!best || !best.route) {
        showToast("Aucun itinéraire trouvé. Vérifiez votre connexion.", "error");
        return;
      }

      displayRoute(best.route.coords, selectedRouteColor);

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
      const mins = Math.round(best.route.time / 60);
      const km   = best.route.distance.toFixed(1);
      const routeInfo = document.createElement("div");
      routeInfo.id = "route-summary";
      routeInfo.innerHTML = `
        <div class="route-row">🚨 <strong>${mins} min</strong> &nbsp;·&nbsp; ${km} km</div>
        <div class="route-note">✓ Le plus rapide parmi ${candidates.length} candidats</div>
        <button id="clear-route-btn">✕ Effacer l'itinéraire</button>
      `;
      elBody.prepend(routeInfo);
      document.getElementById("clear-route-btn").addEventListener("click", clearRoute);
      panel.style.display = "block";
      showToast(`Itinéraire calculé ✓  — ${mins} min · ${km} km`, "success");
    } catch (err) {
      console.error(err);
      showToast("Erreur de routage : " + err.message, "error");
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
