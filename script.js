// --- Définition de la projection LV95 ---
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

// --- Carte avec WMTS swisstopo ---
const map = new ol.Map({
  target: "map",
  layers: [
    new ol.layer.Tile({
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
    })
  ],
  view: new ol.View({
    projection,
    center: [2600000, 1200000],
    zoom: 8
  })
});

// --- Masque Suisse (sans rectangle visible) ---
fetch("https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson")
  .then(r => r.json())
  .then(data => {
    const switzerland = data.features.find(f => f.properties.ISO_A2 === "CH");

    const features = new ol.format.GeoJSON().readFeatures(switzerland, {
      dataProjection: "EPSG:4326",
      featureProjection: "EPSG:2056"
    });

    const swissGeom = features[0].getGeometry();

    // --- Style spécial : n'affiche que la Suisse ---
    const clipStyle = new ol.style.Style({
      fill: new ol.style.Fill({
        color: "rgba(255,255,255,1)" // opaque → masque
      })
    });

    const clipLayer = new ol.layer.Vector({
      source: new ol.source.Vector({ features }),
      style: clipStyle
    });

    clipLayer.on("prerender", (e) => {
      const ctx = e.context;
      const ratio = e.frameState.pixelRatio;

      ctx.save();
      ctx.beginPath();

      // On dessine TOUT l'écran
      ctx.rect(0, 0, ctx.canvas.width, ctx.canvas.height);

      // On découpe la Suisse
      const coords = swissGeom.getCoordinates()[0];
      ctx.moveTo(
        ...map.getPixelFromCoordinate(coords[0]).map(v => v * ratio)
      );

      coords.forEach((c) => {
        const p = map.getPixelFromCoordinate(c);
        ctx.lineTo(p[0] * ratio, p[1] * ratio);
      });

      ctx.closePath();

      // On inverse le masque → seule la Suisse reste visible
      ctx.clip("evenodd");
    });

    clipLayer.on("postrender", (e) => {
      e.context.restore();
    });

    map.addLayer(clipLayer);

    // --- Contour Suisse ---
    map.addLayer(
      new ol.layer.Vector({
        source: new ol.source.Vector({ features }),
        style: new ol.style.Style({
          stroke: new ol.style.Stroke({ color: "blue", width: 2 }),
          fill: null
        })
      })
    );
  });
