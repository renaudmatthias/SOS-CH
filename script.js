import proj4 from "proj4";
import "style.css";
import { Projection } from "ol/proj";
/* Et autre imports .... */

const extent = [2420000, 1030000, 2900000, 1360000];
proj4.defs(
    crs,
    "+proj=somerc +lat_0=46.95240555555556 +lon_0=7.439583333333333 +k_0=1 +x_0=2600000" +
    " +y_0=1200000 +ellps=bessel +towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs",
);register(proj4);
const projection = new Projection({code: "EPSG:2056", extent: extent});

new Map({
  target: "map",
  layers: [
    new ImageLayer({ 
      extent,
      source: new ImageWMS({
        url: "https://sitn.ne.ch/services/wms",
        params: { LAYERS: "ag10_surface_agricole_utile" },
        serverType: "mapserver",
      }),
    }),
  ],
  view: new View({projection, center: [2550000, 1207000], zoom: 5}),
});