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
        params: {
          LAYERS: "ch.swisstopo.pixelkarte-farbe",
          FORMAT: "image/png",
        },
        serverType: "mapserver",
      }),
    }),
    new ol.layer.Tile({
      source: new ol.source.TileWMS({
        url: "https://wms.geo.admin.ch/de/",
        params: {
          LAYERS: "ch.bazl.spitallandeplaetze",
          FORMAT: "image/png",
        },
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

// --- Styles normaux ---
const redStyle = new ol.style.Style({
  image: new ol.style.Circle({
    radius: 6,
    fill: new ol.style.Fill({ color: "red" }),
    stroke: new ol.style.Stroke({ color: "white", width: 2 }),
  }),
});

const blueStyle = new ol.style.Style({
  image: new ol.style.Circle({
    radius: 6,
    fill: new ol.style.Fill({ color: "blue" }),
    stroke: new ol.style.Stroke({ color: "white", width: 2 }),
  }),
});

const greenStyle = new ol.style.Style({
  image: new ol.style.Circle({
    radius: 6,
    fill: new ol.style.Fill({ color: "green" }),
    stroke: new ol.style.Stroke({ color: "white", width: 2 }),
  }),
});

// --- Styles sélectionnés (plus grands) ---
const selectedRedStyle = new ol.style.Style({
  image: new ol.style.Circle({
    radius: 10,
    fill: new ol.style.Fill({ color: "red" }),
    stroke: new ol.style.Stroke({ color: "white", width: 3 }),
  }),
});

const selectedBlueStyle = new ol.style.Style({
  image: new ol.style.Circle({
    radius: 10,
    fill: new ol.style.Fill({ color: "blue" }),
    stroke: new ol.style.Stroke({ color: "white", width: 3 }),
  }),
});

const selectedGreenStyle = new ol.style.Style({
  image: new ol.style.Circle({
    radius: 10,
    fill: new ol.style.Fill({ color: "green" }),
    stroke: new ol.style.Stroke({ color: "white", width: 3 }),
  }),
});

// Mapping couleur -> style sélectionné
const selectedStyleMap = {
  blue: selectedBlueStyle,
  green: selectedGreenStyle,
  red: selectedRedStyle,
};

// Mapping couleur -> label du type
const layerTypeMap = {
  blue: { label: "Caserne de pompiers", emoji: "🚒", color: "#1a56db" },
  green: { label: "Poste de police", emoji: "👮", color: "#057a55" },
  red: { label: "Hôpital", emoji: "🏥", color: "#e02424" },
};

// --- Création du panneau d'information ---
const panel = document.createElement("div");
panel.id = "poi-panel";
panel.style.cssText = `
  position: absolute;
  top: 12px;
  right: 12px;
  width: 280px;
  background: white;
  border-radius: 10px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.18);
  font-family: 'Segoe UI', Arial, sans-serif;
  overflow: hidden;
  display: none;
  z-index: 1000;
  transition: opacity 0.2s;
`;

panel.innerHTML = `
  <div id="poi-header" style="padding: 14px 16px 10px; border-bottom: 1px solid #f0f0f0; display: flex; align-items: center; gap: 10px;">
    <span id="poi-emoji" style="font-size: 22px;"></span>
    <div>
      <div id="poi-type" style="font-size: 11px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 2px;"></div>
      <div id="poi-name" style="font-size: 15px; font-weight: 600; color: #111;"></div>
    </div>
    <button id="poi-close" style="margin-left: auto; background: none; border: none; cursor: pointer; font-size: 18px; color: #aaa; padding: 0; line-height: 1;" title="Fermer">×</button>
  </div>
  <div id="poi-body" style="padding: 12px 16px;"></div>
`;

// Ajouter le panneau sur la carte
document.getElementById("map").style.position = "relative";
document.getElementById("map").appendChild(panel);

document.getElementById("poi-close").addEventListener("click", () => {
  panel.style.display = "none";
  // Réinitialiser le style de la feature sélectionnée
  if (selectedFeature && originalStyle) {
    selectedFeature.setStyle(originalStyle);
    selectedFeature = null;
    originalStyle = null;
  }
});

let selectedFeature = null;
let originalStyle = null;

// --- Curseur pointeur au survol ---
map.on("pointermove", (e) => {
  const hit = map.hasFeatureAtPixel(e.pixel);
  map.getTargetElement().style.cursor = hit ? "pointer" : "";
});

// --- Clic sur la carte ---
map.on("singleclick", (e) => {
  let found = false;

  map.forEachFeatureAtPixel(e.pixel, (feature, layer) => {
    if (found) return;
    found = true;

    // Réinitialiser l'ancienne sélection
    if (selectedFeature && originalStyle) {
      selectedFeature.setStyle(originalStyle);
    }

    // Mémoriser la feature et son style d'origine
    selectedFeature = feature;
    const layerColor = layer.get("poiColor");
    originalStyle = layerColor === "blue" ? blueStyle
      : layerColor === "green" ? greenStyle
      : redStyle;

    // Appliquer le style sélectionné
    feature.setStyle(selectedStyleMap[layerColor] || redStyle);

    // Récupérer les propriétés
    const props = feature.getProperties();
    const typeInfo = layerTypeMap[layerColor] || { label: "Point d'intérêt", emoji: "📍", color: "#666" };

    // Remplir le panneau
    document.getElementById("poi-emoji").textContent = typeInfo.emoji;
    document.getElementById("poi-type").style.color = typeInfo.color;
    document.getElementById("poi-type").textContent = typeInfo.label;

    // Nom : chercher les champs communs
    const name = props.name || props.Name || props.NAME
      || props.bezeichnung || props.Bezeichnung
      || props.nom || props.Nom
      || "Sans nom";
    document.getElementById("poi-name").textContent = name;

    // Corps : afficher toutes les propriétés utiles
    const excluded = new Set(["geometry", "name", "Name", "NAME"]);
    const bodyEl = document.getElementById("poi-body");
    bodyEl.innerHTML = "";

    const entries = Object.entries(props).filter(
      ([k, v]) => !excluded.has(k) && v !== null && v !== undefined && v !== "" && k !== "geometry"
    );

    if (entries.length === 0) {
      bodyEl.innerHTML = `<p style="color:#888; font-size:13px; margin:0;">Aucune information supplémentaire disponible.</p>`;
    } else {
      const table = document.createElement("table");
      table.style.cssText = "width:100%; border-collapse:collapse; font-size:13px;";
      entries.forEach(([key, value]) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td style="color:#888; padding:4px 8px 4px 0; vertical-align:top; white-space:nowrap; font-size:12px;">${formatKey(key)}</td>
          <td style="color:#111; padding:4px 0; word-break:break-word;">${value}</td>
        `;
        table.appendChild(tr);
      });
      bodyEl.appendChild(table);
    }

    panel.style.display = "block";
  });

  // Clic dans le vide → fermer
  if (!found) {
    panel.style.display = "none";
    if (selectedFeature && originalStyle) {
      selectedFeature.setStyle(originalStyle);
      selectedFeature = null;
      originalStyle = null;
    }
  }
});

// --- Formater la clé de propriété ---
function formatKey(key) {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// --- Fonction générique de chargement ---
function loadGeoJSON(url, style, color) {
  fetch(url)
    .then((response) => response.json())
    .then((geojson) => {
      const features = new ol.format.GeoJSON().readFeatures(geojson, {
        dataProjection: "EPSG:2056",
        featureProjection: "EPSG:2056",
      });

      const layer = new ol.layer.Vector({
        source: new ol.source.Vector({ features }),
        style: style,
      });

      // Stocker la couleur sur le layer pour l'identifier au clic
      layer.set("poiColor", color);

      map.addLayer(layer);
    });
}

loadGeoJSON("./fire_station.geojson", blueStyle, "blue");
loadGeoJSON("./police_v2.geojson", greenStyle, "green");
loadGeoJSON("./hospital.geojson", redStyle, "red");