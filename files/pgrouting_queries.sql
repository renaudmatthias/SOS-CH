-- ============================================================
--  QUERY pgROUTING — Esempi pratici per servizi di emergenza
--  Prerequisiti: rete_stradale popolata e topologia creata
--  (pgr_createTopology già eseguito su rete_stradale)
-- ============================================================


-- ============================================================
-- A.  PERCORSO PIÙ BREVE  (Dijkstra)
--     Da un punto generico all'ospedale più vicino
-- ============================================================
WITH
  punto_partenza AS (
    -- Sostituire con le coordinate reali in EPSG:2056
    SELECT ST_GeomFromText('POINT(2601000 1119000)', 2056) AS geom
  ),
  -- Nodo della rete più vicino al punto di partenza
  nodo_start AS (
    SELECT id FROM rete_stradale_vertices_pgr
    ORDER BY geom <-> (SELECT geom FROM punto_partenza)
    LIMIT 1
  ),
  -- 5 ospedali più vicini in linea d'aria (candidati)
  ospedali_vicini AS (
    SELECT id, name, geom,
           nearest_vertex(geom) AS nodo_target
    FROM ospedali
    ORDER BY geom <-> (SELECT geom FROM punto_partenza)
    LIMIT 5
  ),
  -- Calcola costo Dijkstra verso ciascun candidato
  percorsi AS (
    SELECT
      o.id, o.name,
      (SELECT SUM(e.cost)
       FROM pgr_dijkstra(
              'SELECT id, source, target, cost, reverse_cost FROM rete_stradale',
              (SELECT id FROM nodo_start),
              o.nodo_target,
              directed := true
            ) e
      ) AS costo_totale
    FROM ospedali_vicini o
  )
SELECT *
FROM percorsi
WHERE costo_totale IS NOT NULL
ORDER BY costo_totale
LIMIT 1;


-- ============================================================
-- B.  GEOMETRIA DEL PERCORSO  (con linea del tragitto)
--     Restituisce il percorso come LineString unificata
-- ============================================================
WITH
  punto_partenza AS (
    SELECT ST_GeomFromText('POINT(2601000 1119000)', 2056) AS geom
  ),
  nodo_start AS (
    SELECT id FROM rete_stradale_vertices_pgr
    ORDER BY geom <-> (SELECT geom FROM punto_partenza) LIMIT 1
  ),
  nodo_end AS (
    -- Nodo più vicino all'ospedale scelto (inserire osm_id o id specifico)
    SELECT nearest_vertex(geom) AS id
    FROM ospedali
    ORDER BY geom <-> (SELECT geom FROM punto_partenza)
    LIMIT 1
  ),
  route AS (
    SELECT r.seq, r.node, r.edge, r.cost,
           s.geom AS edge_geom
    FROM pgr_dijkstra(
           'SELECT id, source, target, cost, reverse_cost FROM rete_stradale',
           (SELECT id FROM nodo_start),
           (SELECT id FROM nodo_end),
           directed := true
         ) r
    JOIN rete_stradale s ON r.edge = s.id
  )
SELECT
  ST_Union(edge_geom)                    AS percorso_geom,
  ST_Transform(ST_Union(edge_geom),4326) AS percorso_wgs84,
  SUM(cost)                              AS lunghezza_m,
  COUNT(*)                               AS n_segmenti
FROM route;


-- ============================================================
-- C.  ISOCRONE  (area raggiungibile in N minuti)
--     Richiede calcolo del costo in secondi (o minuti) su cost/reverse_cost
-- ============================================================
-- Assumendo che cost = tempo_percorrenza_in_secondi

-- Aggiorna il costo in base alla velocità (esempio: 50 km/h in aree urbane)
UPDATE rete_stradale
SET
  cost         = (length_m / 1000.0) / 50.0 * 3600,   -- secondi
  reverse_cost = CASE WHEN oneway = 'yes' THEN 1e10
                      ELSE (length_m / 1000.0) / 50.0 * 3600
                 END
WHERE length_m IS NOT NULL;

-- Isocrona a 10 minuti (600 secondi) da un ospedale
SELECT
  o.name AS ospedale,
  ST_ConvexHull(
    ST_Collect(v.geom)
  ) AS isocrona_10min
FROM ospedali o
CROSS JOIN pgr_drivingDistance(
  'SELECT id, source, target, cost, reverse_cost FROM rete_stradale',
  nearest_vertex(o.geom),
  600,       -- 600 secondi = 10 minuti
  directed := true
) dd
JOIN rete_stradale_vertices_pgr v ON dd.node = v.id
WHERE o.id = 1   -- ← id dell'ospedale scelto
GROUP BY o.name;


-- ============================================================
-- D.  SERVIZIO PIÙ VICINO per ogni feature  (proximity analysis)
--     Per ogni stazione di polizia, trova l'ospedale più vicino
--     su rete stradale (solo top-5 in linea d'aria come candidati)
-- ============================================================
SELECT
  p.id          AS polizia_id,
  p.name        AS polizia_nome,
  best.name     AS ospedale_vicino,
  best.costo_m  AS distanza_m
FROM stazioni_polizia p
CROSS JOIN LATERAL (
  SELECT
    o.name,
    (SELECT SUM(e.cost)
     FROM pgr_dijkstra(
            'SELECT id, source, target, cost, reverse_cost FROM rete_stradale',
            nearest_vertex(p.geom),
            nearest_vertex(o.geom),
            directed := true
          ) e
    ) AS costo_m
  FROM ospedali o
  ORDER BY o.geom <-> p.geom   -- pre-filtro spaziale
  LIMIT 5
  ORDER BY costo_m
  LIMIT 1
) best
WHERE p.geom IS NOT NULL;


-- ============================================================
-- E.  COPERTURA: stazioni pompieri senza ospedale a < 15 min
-- ============================================================
SELECT
  f.id, f.name,
  MIN(
    (SELECT SUM(e.cost)
     FROM pgr_dijkstra(
            'SELECT id, source, target, cost, reverse_cost FROM rete_stradale',
            nearest_vertex(f.geom),
            nearest_vertex(o.geom),
            directed := true
          ) e
    )
  ) AS tempo_ospedale_piu_vicino_s
FROM stazioni_pompieri f
JOIN ospedali o ON TRUE
GROUP BY f.id, f.name
HAVING MIN(
    (SELECT SUM(e.cost)
     FROM pgr_dijkstra(
            'SELECT id, source, target, cost, reverse_cost FROM rete_stradale',
            nearest_vertex(f.geom),
            nearest_vertex(o.geom),
            directed := true
          ) e
    )
  ) > 900   -- > 15 minuti (900 secondi)
ORDER BY tempo_ospedale_piu_vicino_s DESC;


-- ============================================================
-- F.  AGGIORNAMENTO COSTI per tipo di strada (highway)
--     Velocità medie di riferimento in km/h
-- ============================================================
UPDATE rete_stradale
SET cost = (length_m / 1000.0) /
    CASE highway
        WHEN 'motorway'       THEN 120
        WHEN 'motorway_link'  THEN  80
        WHEN 'trunk'          THEN 100
        WHEN 'trunk_link'     THEN  70
        WHEN 'primary'        THEN  80
        WHEN 'primary_link'   THEN  60
        WHEN 'secondary'      THEN  70
        WHEN 'secondary_link' THEN  50
        WHEN 'tertiary'       THEN  60
        WHEN 'tertiary_link'  THEN  40
        WHEN 'residential'    THEN  30
        WHEN 'living_street'  THEN  10
        WHEN 'service'        THEN  20
        WHEN 'unclassified'   THEN  40
        ELSE 50
    END * 3600,   -- conversione in secondi
    reverse_cost = (length_m / 1000.0) /
    CASE highway
        WHEN 'motorway'       THEN 120
        WHEN 'motorway_link'  THEN  80
        WHEN 'trunk'          THEN 100
        WHEN 'trunk_link'     THEN  70
        WHEN 'primary'        THEN  80
        WHEN 'primary_link'   THEN  60
        WHEN 'secondary'      THEN  70
        WHEN 'secondary_link' THEN  50
        WHEN 'tertiary'       THEN  60
        WHEN 'tertiary_link'  THEN  40
        WHEN 'residential'    THEN  30
        WHEN 'living_street'  THEN  10
        WHEN 'service'        THEN  20
        WHEN 'unclassified'   THEN  40
        ELSE 50
    END * 3600
WHERE oneway <> 'yes' OR oneway IS NULL;

-- Per strade a senso unico: reverse_cost altissimo
UPDATE rete_stradale
SET reverse_cost = 1e15
WHERE oneway = 'yes';

-- ============================================================
-- Fine script query pgRouting
-- ============================================================
