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

// --- Styles ---
const redStyle = new ol.style.Style({
  image: new ol.style.Circle({
    radius: 6,
    fill: new ol.style.Fill({ color: "red" }),
    stroke: new ol.style.Stroke({ color: "white", width: 2 })
  }),
});

const blueStyle = new ol.style.Style({
  image: new ol.style.Circle({
    radius: 6,
    fill: new ol.style.Fill({ color: "blue" }),
    stroke: new ol.style.Stroke({ color: "white", width: 2 })
  }),
});

const greenStyle = new ol.style.Style({
  image: new ol.style.Circle({
    radius: 6,
    fill: new ol.style.Fill({ color: "green" }),
    stroke: new ol.style.Stroke({ color: "white", width: 2 })
  }),
});

// --- Fonction générique ---
function loadGeoJSON(url, style) {
  fetch(url)
    .then(response => response.json())
    .then(geojson => {
      const features = new ol.format.GeoJSON().readFeatures(geojson, {
        dataProjection: "EPSG:2056",
        featureProjection: "EPSG:2056",
      });

      const layer = new ol.layer.Vector({
        source: new ol.source.Vector({ features }),
        style: style,
      });

      map.addLayer(layer);
    });
}

// --- Chargement des 3 couches avec couleurs différentes ---
loadGeoJSON("./police.geojson", redStyle);        // rouge
loadGeoJSON("./fire_station.geojson", blueStyle); // bleu
loadGeoJSON("./police_v2.geojson", greenStyle);   // vert
