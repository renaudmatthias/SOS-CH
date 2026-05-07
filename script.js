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

// ── Références DOM (déclarés dans index.html) ──
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
