const extent = [2420000, 1030000, 2900000, 1360000];
proj4.defs(
  "EPSG:2056",
  "+proj=somerc +lat_0=46.95240555555556 +lon_0=7.439583333333333 +k_0=1 +x_0=2600000" +
  " +y_0=1200000 +ellps=bessel +towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs"
);
ol.proj.proj4.register(proj4);
const projection = new ol.proj.Projection({ code: "EPSG:2056", extent });

// ── Résolutions WMTS swisstopo (niveaux 0–28) ──
const resolutions = [
  4000, 3750, 3500, 3250, 3000, 2750, 2500, 2250, 2000, 1750,
  1500, 1250, 1000, 750, 650, 500, 250, 100, 50, 20, 10, 5, 2.5,
  2, 1.5, 1, 0.5, 0.25, 0.1,
];
const matrixIds = resolutions.map((_, i) => i);

const swisstopoWMTS = new ol.source.WMTS({
  url: "https://wmts.geo.admin.ch/1.0.0/{Layer}/default/current/2056/{TileMatrix}/{TileCol}/{TileRow}.png",
  layer: "ch.swisstopo.pixelkarte-farbe",
  matrixSet: "2056",
  format: "image/png",
  projection,
  tileGrid: new ol.tilegrid.WMTS({
    origin: [2420000, 1350000],
    resolutions,
    matrixIds,
  }),
  style: "default",
  crossOrigin: "anonymous",
});

const map = new ol.Map({
  target: "map",
  layers: [
    new ol.layer.Tile({ source: swisstopoWMTS }),
  ],
  view: new ol.View({
    projection,                          // EPSG:2056
    center: [2660000, 1190000],
    zoom: 3,
    minZoom: 2,
    maxZoom: 20,
    extent: [2485000, 1075000, 2834000, 1296000], // bloque hors Suisse
    constrainOnlyCenter: true,
  }),
});

// ── Styles normaux ──
const blueStyle = new ol.style.Style({
  image: new ol.style.Circle({ radius: 6, fill: new ol.style.Fill({ color: "blue" }), stroke: new ol.style.Stroke({ color: "white", width: 2 }) }),
});
const greenStyle = new ol.style.Style({
  image: new ol.style.Circle({ radius: 6, fill: new ol.style.Fill({ color: "green" }), stroke: new ol.style.Stroke({ color: "white", width: 2 }) }),
});
const redStyle = new ol.style.Style({
  image: new ol.style.Circle({ radius: 6, fill: new ol.style.Fill({ color: "red" }), stroke: new ol.style.Stroke({ color: "white", width: 2 }) }),
});

// ── Styles sélectionnés ──
const selectedStyleMap = {
  blue:  new ol.style.Style({ image: new ol.style.Circle({ radius: 10, fill: new ol.style.Fill({ color: "blue" }),  stroke: new ol.style.Stroke({ color: "white", width: 3 }) }) }),
  green: new ol.style.Style({ image: new ol.style.Circle({ radius: 10, fill: new ol.style.Fill({ color: "green" }), stroke: new ol.style.Stroke({ color: "white", width: 3 }) }) }),
  red:   new ol.style.Style({ image: new ol.style.Circle({ radius: 10, fill: new ol.style.Fill({ color: "red" }),   stroke: new ol.style.Stroke({ color: "white", width: 3 }) }) }),
};
const defaultStyleMap = { blue: blueStyle, green: greenStyle, red: redStyle };

// ── Métadonnées par type ──
const layerTypeMap = {
  blue:  { label: "Caserne de pompiers", emoji: "🚒", color: "#1a56db" },
  green: { label: "Poste de police",      emoji: "👮", color: "#057a55" },
  red:   { label: "Hôpital",              emoji: "🏥", color: "#e02424" },
};

// ── Références DOM ──
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

// ── Outil coordonnées ──
let coordToolActive = false;

const coordBtn = document.createElement("button");
coordBtn.id = "coord-tool-btn";
coordBtn.title = "Obtenir les coordonnées d'un point";
coordBtn.innerHTML = "📍 Coordonnées";
document.getElementById("map").appendChild(coordBtn);

const coordPanel = document.createElement("div");
coordPanel.id = "coord-panel";
coordPanel.style.display = "none";
coordPanel.innerHTML = `
  <div id="coord-header">
    <span>📍 Coordonnées</span>
    <button id="coord-close" title="Fermer">×</button>
  </div>
  <div id="coord-body">
    <div class="coord-row"><span>LV95 (E / N)</span><span id="coord-lv95">—</span></div>
    <div class="coord-row"><span>WGS84 (lat / lon)</span><span id="coord-wgs84">—</span></div>
    <div class="coord-row"><button id="coord-copy" title="Copier WGS84">📋 Copier WGS84</button></div>
  </div>
`;
document.getElementById("map").appendChild(coordPanel);

// Styles du bouton et panneau injectés dynamiquement
const coordStyle = document.createElement("style");
coordStyle.textContent = `
  #coord-tool-btn {
    position: absolute;
    bottom: 24px;
    right: 12px;
    z-index: 1000;
    background: white;
    border: none;
    border-radius: 8px;
    box-shadow: 0 2px 12px rgba(0,0,0,0.18);
    padding: 8px 14px;
    font-size: 13px;
    font-family: 'Segoe UI', Arial, sans-serif;
    cursor: pointer;
    transition: background 0.15s;
  }
  #coord-tool-btn.active {
    background: #1a56db;
    color: white;
  }
  #coord-tool-btn:hover:not(.active) { background: #f0f4ff; }
  #coord-panel {
    position: absolute;
    bottom: 70px;
    right: 12px;
    width: 280px;
    background: white;
    border-radius: 10px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.18);
    font-family: 'Segoe UI', Arial, sans-serif;
    overflow: hidden;
    z-index: 1000;
    animation: panelIn 0.18s ease;
  }
  #coord-header {
    padding: 10px 16px;
    border-bottom: 1px solid #f0f0f0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-weight: 600;
    font-size: 13px;
  }
  #coord-close {
    background: none; border: none; cursor: pointer;
    font-size: 20px; color: #aaa; line-height: 1;
    transition: color 0.15s;
  }
  #coord-close:hover { color: #333; }
  #coord-body { padding: 10px 16px; display: flex; flex-direction: column; gap: 8px; }
  .coord-row { display: flex; flex-direction: column; font-size: 12px; color: #888; gap: 2px; }
  .coord-row span:last-child { font-size: 13px; color: #111; font-weight: 500; }
  #coord-copy {
    margin-top: 4px;
    background: #f0f4ff; border: none; border-radius: 6px;
    padding: 6px 12px; font-size: 12px; cursor: pointer;
    color: #1a56db; font-weight: 600; transition: background 0.15s;
    width: 100%;
  }
  #coord-copy:hover { background: #dce8ff; }
  #coord-crosshair {
    position: absolute;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    pointer-events: none;
    font-size: 28px;
    z-index: 999;
    display: none;
    text-shadow: 0 0 4px white;
  }
`;
document.head.appendChild(coordStyle);

// Croix centrale (indicateur visuel quand l'outil est actif)
const crosshair = document.createElement("div");
crosshair.id = "coord-crosshair";
crosshair.textContent = "✛";
document.getElementById("map").appendChild(crosshair);

coordBtn.addEventListener("click", () => {
  coordToolActive = !coordToolActive;
  coordBtn.classList.toggle("active", coordToolActive);
  crosshair.style.display = coordToolActive ? "block" : "none";
  if (!coordToolActive) coordPanel.style.display = "none";
});

document.getElementById("coord-close").addEventListener("click", () => {
  coordPanel.style.display = "none";
  coordToolActive = false;
  coordBtn.classList.remove("active");
  crosshair.style.display = "none";
});

document.getElementById("coord-copy").addEventListener("click", () => {
  const txt = document.getElementById("coord-wgs84").textContent;
  navigator.clipboard.writeText(txt).then(() => {
    const btn = document.getElementById("coord-copy");
    btn.textContent = "✅ Copié !";
    setTimeout(() => btn.textContent = "📋 Copier WGS84", 1500);
  });
});

// ── Curseur pointeur au survol ──
map.on("pointermove", (e) => {
  if (coordToolActive) {
    map.getTargetElement().style.cursor = "crosshair";
    return;
  }
  map.getTargetElement().style.cursor = map.hasFeatureAtPixel(e.pixel) ? "pointer" : "";
});

// ── Clic sur la carte ──
map.on("singleclick", (e) => {
  // Mode coordonnées
  if (coordToolActive) {
    const lv95 = e.coordinate;
    const wgs84 = ol.proj.transform(lv95, "EPSG:2056", "EPSG:4326");
    document.getElementById("coord-lv95").textContent =
      `E ${Math.round(lv95[0]).toLocaleString("fr-CH")}  /  N ${Math.round(lv95[1]).toLocaleString("fr-CH")}`;
    document.getElementById("coord-wgs84").textContent =
      `${wgs84[1].toFixed(6)}, ${wgs84[0].toFixed(6)}`;
    coordPanel.style.display = "block";
    return;
  }
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
  return key.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Chargement des couches GeoJSON ──
// Vos GeoJSON sont en EPSG:2056, il faut les reprojeter vers EPSG:3857
function loadGeoJSON(url, style, color) {
  fetch(url)
    .then((res) => res.json())
    .then((geojson) => {
      const features = new ol.format.GeoJSON().readFeatures(geojson, {
        dataProjection: "EPSG:2056",
        featureProjection: "EPSG:2056", // même projection que la carte
      });
      const layer = new ol.layer.Vector({ source: new ol.source.Vector({ features }), style });
      layer.set("poiColor", color);
      map.addLayer(layer);
    });
}

loadGeoJSON("./fire_station.geojson", blueStyle,  "blue");
loadGeoJSON("./police_v2.geojson",    greenStyle, "green");
loadGeoJSON("./hospital.geojson",     redStyle,   "red");


// ── Recherche d'adresse (Nominatim) ──
const searchInput   = document.getElementById("search-input");
const searchClear   = document.getElementById("search-clear");
const searchResults = document.getElementById("search-results");

let searchMarkerLayer = null;
let searchDebounce    = null;

searchInput.addEventListener("input", () => {
  searchClear.style.display = searchInput.value.length > 0 ? "flex" : "none";
  clearTimeout(searchDebounce);
  if (searchInput.value.trim().length >= 3) {
    searchDebounce = setTimeout(() => searchAddress(searchInput.value), 350);
  } else {
    searchResults.style.display = "none";
  }
});

searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    clearTimeout(searchDebounce);
    searchAddress(searchInput.value);
  }
  if (e.key === "Escape") closeSearch();
});

searchClear.addEventListener("click", () => {
  searchInput.value = "";
  searchClear.style.display = "none";
  searchResults.style.display = "none";
  if (searchMarkerLayer) {
    map.removeLayer(searchMarkerLayer);
    searchMarkerLayer = null;
  }
  searchInput.focus();
});

async function searchAddress(query) {
  if (!query.trim()) return;
  searchResults.innerHTML = "<li class='search-loading'>Recherche…</li>";
  searchResults.style.display = "block";

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&countrycodes=ch&format=json&limit=6&addressdetails=1`;
    const res  = await fetch(url, { headers: { "Accept-Language": "fr" } });
    const data = await res.json();

    searchResults.innerHTML = "";

    if (data.length === 0) {
      searchResults.innerHTML = "<li class='search-no-result'>Aucun résultat trouvé</li>";
      searchResults.style.display = "block";
      return;
    }

    data.forEach(item => {
      const li = document.createElement("li");
      const icon     = getResultIcon(item.type, item.class);
      const mainText = formatMainText(item);
      const subText  = formatSubText(item);

      li.innerHTML = `
        <span class="result-icon">${icon}</span>
        <span class="result-text">
          <span class="result-main">${mainText}</span>
          ${subText ? `<span class="result-sub">${subText}</span>` : ""}
        </span>
      `;
      li.addEventListener("click", () => {
        goToResult(item);
        searchResults.style.display = "none";
        searchInput.value = mainText;
        searchClear.style.display = "flex";
      });
      searchResults.appendChild(li);
    });

    searchResults.style.display = "block";
  } catch (err) {
    searchResults.innerHTML = "<li class='search-no-result'>Erreur de connexion</li>";
  }
}

function getResultIcon(type, cls) {
  if (cls === "highway" || type === "road" || type === "street") return "🛣️";
  if (cls === "place" && (type === "city" || type === "town")) return "🏙️";
  if (cls === "place" && type === "village") return "🏡";
  if (cls === "amenity" && type === "hospital") return "🏥";
  if (cls === "amenity" && type === "school") return "🏫";
  if (cls === "building") return "🏢";
  if (cls === "boundary" || type === "administrative") return "📍";
  return "📌";
}

function formatMainText(item) {
  const a = item.address || {};
  return a.road || a.pedestrian || a.suburb || a.city || a.town || a.village || item.display_name.split(",")[0];
}

function formatSubText(item) {
  const a = item.address || {};
  const parts = [];
  if (a.house_number && a.road) parts.push(a.house_number);
  if (a.postcode) parts.push(a.postcode);
  if (a.city || a.town || a.village) parts.push(a.city || a.town || a.village);
  if (a.state) parts.push(a.state);
  return parts.join(", ");
}

function goToResult(item) {
  // Convertit WGS84 → EPSG:2056
  const coords = ol.proj.transform(
    [parseFloat(item.lon), parseFloat(item.lat)],
    "EPSG:4326",
    "EPSG:2056"
  );

  if (searchMarkerLayer) map.removeLayer(searchMarkerLayer);

  const marker = new ol.Feature({ geometry: new ol.geom.Point(coords) });
  marker.setStyle(
    new ol.style.Style({
      image: new ol.style.RegularShape({
        points: 4,
        radius: 10,
        radius2: 0,
        angle: Math.PI / 4,
        fill: new ol.style.Fill({ color: "orange" }),
        stroke: new ol.style.Stroke({ color: "white", width: 2 }),
      }),
    })
  );

  searchMarkerLayer = new ol.layer.Vector({
    source: new ol.source.Vector({ features: [marker] }),
    zIndex: 999,
  });
  map.addLayer(searchMarkerLayer);

  map.getView().animate({ center: coords, zoom: 14, duration: 700 });
}

function closeSearch() {
  searchResults.style.display = "none";
}

document.addEventListener("click", (e) => {
  if (!e.target.closest("#search-bar")) closeSearch();
});