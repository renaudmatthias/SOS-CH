const extent = [2420000, 1030000, 2900000, 1360000];
proj4.defs(
  "EPSG:2056",
  "+proj=somerc +lat_0=46.95240555555556 +lon_0=7.439583333333333 +k_0=1 +x_0=2600000" +
  " +y_0=1200000 +ellps=bessel +towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs"
);
ol.proj.proj4.register(proj4);
const projection = new ol.proj.Projection({ code: "EPSG:2056", extent });

const map = new ol.Map({
  target: "map",
  layers: [
    new ol.layer.Tile({
      source: new ol.source.TileWMS({
        url: "https://wms.geo.admin.ch/de/",
        params: { LAYERS: "ch.swisstopo.pixelkarte-farbe", FORMAT: "image/png" },
        serverType: "mapserver",
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

// ── Curseur pointeur au survol ──
map.on("pointermove", (e) => {
  map.getTargetElement().style.cursor = map.hasFeatureAtPixel(e.pixel) ? "pointer" : "";
});

// ── Clic sur la carte ──
map.on("singleclick", (e) => {
  let found = false;

  map.forEachFeatureAtPixel(e.pixel, (feature, layer) => {
    if (found) return;
    // Ignorer le marqueur de recherche
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
function loadGeoJSON(url, style, color) {
  fetch(url)
    .then((res) => res.json())
    .then((geojson) => {
      const features = new ol.format.GeoJSON().readFeatures(geojson, {
        dataProjection: "EPSG:2056",
        featureProjection: "EPSG:2056",
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

// Affiche/masque le bouton effacer
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
  if (e.key === "Escape") {
    closeSearch();
  }
});

searchClear.addEventListener("click", () => {
  searchInput.value = "";
  searchClear.style.display = "none";
  searchResults.style.display = "none";
  // Supprime le marqueur
  if (searchMarkerLayer) {
    map.removeLayer(searchMarkerLayer);
    searchMarkerLayer = null;
  }
  searchInput.focus();
});

async function searchAddress(query) {
  if (!query.trim()) return;

  // Indicateur de chargement
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

      // Icône selon le type
      const icon = getResultIcon(item.type, item.class);
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

  // Supprime l'ancien marqueur
  if (searchMarkerLayer) map.removeLayer(searchMarkerLayer);

  // Crée le marqueur (épingle orange)
  const marker = new ol.Feature({ geometry: new ol.geom.Point(coords) });
  marker.setStyle(
    new ol.style.Style({
      image: new ol.style.RegularShape({
        points: 4,
        radius: 10,
        radius2: 0,
        angle: Math.PI / 4,
        fill: new ol.style.Fill({ color: "#f97316" }),
        stroke: new ol.style.Stroke({ color: "white", width: 2 }),
      }),
    })
  );

  searchMarkerLayer = new ol.layer.Vector({
    source: new ol.source.Vector({ features: [marker] }),
    zIndex: 999,
  });
  map.addLayer(searchMarkerLayer);

  // Zoom animé
  map.getView().animate({ center: coords, zoom: 7, duration: 700 });
}

function closeSearch() {
  searchResults.style.display = "none";
}

// Ferme les résultats si clic ailleurs
document.addEventListener("click", (e) => {
  if (!e.target.closest("#search-bar")) closeSearch();
});