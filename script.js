// --- Projection LV95 ---
proj4.defs(
  "EPSG:2056",
  "+proj=somerc +lat_0=46.95240555555556 +lon_0=7.439583333333333 +k_0=1 " +
  "+x_0=2600000 +y_0=1200000 +ellps=bessel " +
  "+towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs"
);
ol.proj.proj4.register(proj4);

const projection = new ol.proj.Projection({
  code: "EPSG:2056",
  extent: [2420000, 1030000, 2900000, 1360000]
});

// --- Carte WMTS ---
const wmtsLayer = new ol.layer.Tile({
  source: new ol.source.WMTS({
    url: "https://wmts.geo.admin.ch/1.0.0/{Layer}/default/current/2056/{TileMatrix}/{TileCol}/{TileRow}.jpeg",
    layer: "ch.swisstopo.pixelkarte-farbe",
    matrixSet: "2056",
    format: "image/jpeg",
    style: "default",
    tileGrid: new ol.tilegrid.WMTS({
      origin: [2420000, 1350000],
      resolutions: [
        4000, 3750, 3500, 3250, 3000, 2750, 2500, 2250, 2000,
        1750, 1500, 1250, 1000, 750, 650, 500, 250, 100, 50, 20, 10, 5, 2.5
      ],
      matrixIds: Array.from({ length: 23 }, (_, i) => i.toString())
    })
  })
});

const map = new ol.Map({
  target: "map",
  layers: [wmtsLayer],
  view: new ol.View({
    projection,
    center: [2600000, 1200000],
    zoom: 8
  })
});

// --- Masque : tout sauf la Suisse ---
fetch("https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson")
  .then(r => r.json())
  .then(data => {
    const switzerland = data.features.find(f => f.properties.ISO_A2 === "CH");

    const features = new ol.format.GeoJSON().readFeatures(switzerland, {
      dataProjection: "EPSG:4326",
      featureProjection: "EPSG:2056"
    });

    const swissGeom = features[0].getGeometry();

    // --- Grand polygone couvrant toute la Suisse ---
    const worldExtent = [2420000, 1030000, 2900000, 1360000];
    const worldPoly = ol.geom.Polygon.fromExtent(worldExtent);

    // --- Polygone avec trou = Suisse ---
    const maskGeom = new ol.geom.Polygon(worldPoly.getCoordinates());

    let outerRing;
    if (swissGeom.getType() === "Polygon") {
      outerRing = swissGeom.getLinearRing(0).getCoordinates();
    } else {
      outerRing = swissGeom.getPolygons()[0].getLinearRing(0).getCoordinates();
    }

    maskGeom.appendLinearRing(outerRing);

    const maskFeature = new ol.Feature(maskGeom);

    const maskLayer = new ol.layer.Vector({
      source: new ol.source.Vector({ features: [maskFeature] }),
      style: new ol.style.Style({
        fill: new ol.style.Fill({
          color: "white" // même couleur que le fond → on ne voit que la Suisse
        })
      })
    });

    map.addLayer(maskLayer);

    // --- Contour Suisse ---
    map.addLayer(
      new ol.layer.Vector({
        source: new ol.source.Vector({ features }),
        style: new ol.style.Style({
          stroke: new ol.style.Stroke({ color: "black", width: 2 }),
          fill: null
        })
      })
    );
  });
