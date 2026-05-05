const extent = [2420000, 1030000, 2900000, 1360000];

proj4.defs(
  "EPSG:2056",
  "+proj=somerc +lat_0=46.95240555555556 +lon_0=7.439583333333333 +k_0=1 +x_0=2600000" +
  " +y_0=1200000 +ellps=bessel +towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs"
);
ol.proj.proj4.register(proj4);

const projection = new ol.proj.Projection({ code: "EPSG:2056", extent });

// 1. Créer la carte
const map = new ol.Map({
  target: "map",
  layers: [
    new ol.layer.Image({
      extent,
      source: new ol.source.ImageWMS({
        url: "https://wms.geo.admin.ch/de/",
        params: { LAYERS: "ch.swisstopo.landeskarte-farbe-10" },
        serverType: "mapserver",
      }),
    }),
  ],
  view: new ol.View({ projection, center: [2550000, 1207000], zoom: 5 }),
});

// 2. Charger le fichier et ajouter les points
fetch("./police.geojson")
  .then(response => response.json())
  .then(geojson => {
    const features = new ol.format.GeoJSON().readFeatures(geojson);
    map.addLayer(new ol.layer.Vector({
      source: new ol.source.Vector({ features }),
      style: new ol.style.Style({
        image: new ol.style.Circle({
          radius: 6,
          fill: new ol.style.Fill({ color: "red" }),
        })
      })
    }));
  });