const extent = [2420000, 1030000, 2900000, 1360000];
proj4.defs(
  "EPSG:2056",
  "+proj=somerc +lat_0=46.95240555555556 +lon_0=7.439583333333333 +k_0=1 +x_0=2600000" +
  " +y_0=1200000 +ellps=bessel +towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs"
);
ol.proj.proj4.register(proj4);
const projection = new ol.proj.Projection({ code: "EPSG:2056", extent });

let pointLayer;

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
  ],
  view: new ol.View({
    projection,
    center: [2550000, 1207000],
    zoom: 5,
    extent: [2485000, 1075000, 2834000, 1296000],
    constrainOnlyCenter: true,
  }),
});

fetch("./police.geojson")
  .then(response => response.json())
  .then(geojson => {
    const features = new ol.format.GeoJSON().readFeatures(geojson, {
      dataProjection: "EPSG:2056",
      featureProjection: "EPSG:2056",
    });
    pointLayer = new ol.layer.Vector({
      source: new ol.source.Vector({ features }),
      style: new ol.style.Style({
        image: new ol.style.Circle({
          radius: 6,
          fill: new ol.style.Fill({ color: "red" }),
        }),
      }),
    });
    map.addLayer(pointLayer);
  });

fetch("https://raw.githubusercontent.com/interactivethings/swiss-maps/master/topo/ch.json")
  .then(r => r.json())
  .then(geojson => {
    const features = new ol.format.GeoJSON().readFeatures(geojson, {
      dataProjection: "EPSG:2056",
      featureProjection: "EPSG:2056",
    });
    const switzerlandGeom = features[0].getGeometry();
    const wmsLayer = map.getLayers().item(0);

    const applyClip = (event) => {
      const ctx = event.context;
      const pixelRatio = event.frameState.pixelRatio;
      ctx.save();
      ctx.beginPath();

      const polygons = switzerlandGeom.getType() === "MultiPolygon"
        ? switzerlandGeom.getPolygons()
        : [switzerlandGeom];

      polygons.forEach(polygon => {
        polygon.getCoordinates()[0].forEach((coords, i) => {
          const pixel = map.getPixelFromCoordinate(coords);
          if (i === 0) ctx.moveTo(pixel[0] * pixelRatio, pixel[1] * pixelRatio);
          else ctx.lineTo(pixel[0] * pixelRatio, pixel[1] * pixelRatio);
        });
        ctx.closePath();
      });

      ctx.clip();
    };

    const removeClip = (event) => {
      event.context.restore();
    };

    // Clip sur le WMS
    wmsLayer.on("prerender", applyClip);
    wmsLayer.on("postrender", removeClip);

    // Clip sur les points — attend que pointLayer soit prêt
    const applyClipToPoints = () => {
      if (pointLayer) {
        pointLayer.on("prerender", applyClip);
        pointLayer.on("postrender", removeClip);
        map.render();
      } else {
        setTimeout(applyClipToPoints, 100); // réessaie si pas encore chargé
      }
    };
    applyClipToPoints();

    // Contour visible par dessus
    map.addLayer(new ol.layer.Vector({
      source: new ol.source.Vector({ features }),
      style: new ol.style.Style({
        stroke: new ol.style.Stroke({ color: "blue", width: 2 }),
        fill: new ol.style.Fill({ color: "rgba(0,0,0,0)" }),
      }),
    }));
  });