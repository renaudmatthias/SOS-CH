-- ============================================================
--  DATABASE SETUP: Servizi di Emergenza (PostgreSQL + PostGIS + pgRouting)
--  CRS sorgente: EPSG:2056 (Swiss LV95)
--  Eseguire come superuser o owner del database
-- ============================================================

-- 1. ESTENSIONI
-- ============================================================
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgrouting;
CREATE EXTENSION IF NOT EXISTS postgis_topology;  -- opzionale ma utile

-- ============================================================
-- 2. TABELLA: ospedali
-- ============================================================
DROP TABLE IF EXISTS ospedali CASCADE;
CREATE TABLE ospedali (
    id                  SERIAL PRIMARY KEY,
    osm_id              BIGINT,
    osm_type            TEXT,
    amenity             TEXT,
    name                TEXT,
    short_name          TEXT,
    official_name       TEXT,
    alt_name            TEXT,
    old_name            TEXT,
    operator            TEXT,
    operator_type       TEXT,   -- 'operator-type' in OSM
    emergency           TEXT,
    capacity            TEXT,
    wheelchair          TEXT,
    healthcare_spec     TEXT,   -- 'healthcare-speciality'
    ref_fr_finess       TEXT,   -- 'ref-FR-FINESS'
    type_fr_finess      TEXT,   -- 'type-FR-FINESS'
    ref_fr_naf          TEXT,   -- 'ref-FR-NAF'
    ref_fr_siret        TEXT,   -- 'ref-FR-SIRET'
    phone               TEXT,
    contact_phone       TEXT,
    fax                 TEXT,
    email               TEXT,
    website             TEXT,
    addr_housenumber    TEXT,
    addr_street         TEXT,
    addr_city           TEXT,
    addr_postcode       TEXT,
    opening_hours       TEXT,
    wikidata            TEXT,
    wikipedia           TEXT,
    description         TEXT,
    source              TEXT,
    note                TEXT,
    osm_version         TEXT,
    osm_timestamp       TIMESTAMPTZ,
    geom                geometry(Point, 2056),  -- coordinate LV95 originali
    geom_wgs84          geometry(Point, 4326)   -- WGS84 per visualizzazione web
);

-- ============================================================
-- 3. TABELLA: stazioni_polizia
--    Fusione di police.geojson e police_v2.geojson (struttura OSM ricca)
-- ============================================================
DROP TABLE IF EXISTS stazioni_polizia CASCADE;
CREATE TABLE stazioni_polizia (
    id                  SERIAL PRIMARY KEY,
    osm_id              BIGINT,
    osm_type            TEXT,
    fid                 TEXT,                   -- presente in police.geojson
    code                TEXT,                   -- presente in police.geojson
    fclass              TEXT,                   -- presente in police.geojson
    amenity             TEXT,
    name                TEXT,
    short_name          TEXT,
    official_name       TEXT,
    alt_name            TEXT,
    old_name            TEXT,
    operator            TEXT,
    operator_type       TEXT,
    police_fr           TEXT,   -- 'police-FR'
    ref_gendarmerie     TEXT,   -- 'ref-FR-GendarmerieNationale'
    emergency           TEXT,
    emergency_phone     TEXT,
    military            TEXT,
    office              TEXT,
    seasonal            TEXT,
    wheelchair          TEXT,
    phone               TEXT,
    contact_phone       TEXT,
    fax                 TEXT,
    email               TEXT,
    website             TEXT,
    addr_housenumber    TEXT,
    addr_street         TEXT,
    addr_city           TEXT,
    addr_postcode       TEXT,
    addr_full           TEXT,
    opening_hours       TEXT,
    wikidata            TEXT,
    wikipedia           TEXT,
    description         TEXT,
    source              TEXT,
    note                TEXT,
    osm_version         TEXT,
    osm_timestamp       TIMESTAMPTZ,
    sorgente            TEXT,   -- 'police_v1' | 'police_v2'
    geom                geometry(Point, 2056),
    geom_wgs84          geometry(Point, 4326)
);

-- ============================================================
-- 4. TABELLA: stazioni_pompieri
-- ============================================================
DROP TABLE IF EXISTS stazioni_pompieri CASCADE;
CREATE TABLE stazioni_pompieri (
    id                  SERIAL PRIMARY KEY,
    osm_id              BIGINT,
    fid                 TEXT,
    code                TEXT,
    fclass              TEXT,
    name                TEXT,
    geom                geometry(Point, 2056),
    geom_wgs84          geometry(Point, 4326)
);

-- ============================================================
-- 5. TABELLA: rete_stradale  (per pgRouting)
--    Da popolare con la rete viaria (es. OpenStreetMap via osm2pgrouting
--    o qualsiasi altra fonte line/multilinestring).
--    Struttura compatibile con pgr_dijkstra, pgr_astar, ecc.
-- ============================================================
DROP TABLE IF EXISTS rete_stradale CASCADE;
CREATE TABLE rete_stradale (
    id          BIGSERIAL PRIMARY KEY,
    osm_id      BIGINT,
    name        TEXT,
    highway     TEXT,          -- tipo di strada OSM (motorway, trunk, primary…)
    oneway      TEXT,          -- 'yes' | 'no' | '-1'
    maxspeed    INTEGER,       -- km/h
    length_m    DOUBLE PRECISION,  -- lunghezza in metri (calcolata)
    cost        DOUBLE PRECISION,  -- costo direzionale (es. lunghezza o tempo)
    reverse_cost DOUBLE PRECISION, -- costo inverso (NULL se senso unico)
    source      BIGINT,        -- nodo di partenza (richiesto da pgRouting)
    target      BIGINT,        -- nodo di arrivo   (richiesto da pgRouting)
    geom        geometry(LineString, 2056),
    geom_wgs84  geometry(LineString, 4326)
);

-- ============================================================
-- 6. INDICI SPAZIALI
-- ============================================================
CREATE INDEX idx_ospedali_geom        ON ospedali        USING GIST (geom);
CREATE INDEX idx_ospedali_geom_wgs84  ON ospedali        USING GIST (geom_wgs84);

CREATE INDEX idx_polizia_geom         ON stazioni_polizia USING GIST (geom);
CREATE INDEX idx_polizia_geom_wgs84   ON stazioni_polizia USING GIST (geom_wgs84);

CREATE INDEX idx_pompieri_geom        ON stazioni_pompieri USING GIST (geom);
CREATE INDEX idx_pompieri_geom_wgs84  ON stazioni_pompieri USING GIST (geom_wgs84);

CREATE INDEX idx_rete_geom            ON rete_stradale   USING GIST (geom);
CREATE INDEX idx_rete_source          ON rete_stradale   (source);
CREATE INDEX idx_rete_target          ON rete_stradale   (target);

-- ============================================================
-- 7. CARICAMENTO DATI  (tramite ogr2ogr – eseguire da terminale)
-- ============================================================
-- Sostituire "emergency_db" con il nome del tuo database.
-- Sostituire il path con il percorso reale dei file.
--
-- OSPEDALI (EPSG:2056 → manteniamo 2056, geom_wgs84 sarà aggiornata dopo):
--
--   ogr2ogr -f "PostgreSQL" \
--     PG:"host=localhost dbname=emergency_db user=postgres password=YOUR_PWD" \
--     hospital.geojson \
--     -nln ospedali_tmp \
--     -a_srs EPSG:2056 \
--     -lco GEOMETRY_NAME=geom \
--     -lco FID=ogc_fid \
--     --config PG_USE_COPY YES
--
-- POLIZIA v1:
--   ogr2ogr -f "PostgreSQL" PG:"..." police.geojson     -nln polizia_tmp_v1 ...
--
-- POLIZIA v2:
--   ogr2ogr -f "PostgreSQL" PG:"..." police_v2.geojson  -nln polizia_tmp_v2 ...
--
-- POMPIERI:
--   ogr2ogr -f "PostgreSQL" PG:"..." fire_station.geojson -nln pompieri_tmp ...
--
-- Oppure usare lo script Python allegato (load_data.py) che
-- importa direttamente i GeoJSON nelle tabelle finali.

-- ============================================================
-- 8. POPOLAMENTO geom_wgs84  (da eseguire DOPO il caricamento)
-- ============================================================
UPDATE ospedali
   SET geom_wgs84 = ST_Transform(geom, 4326)
 WHERE geom IS NOT NULL;

UPDATE stazioni_polizia
   SET geom_wgs84 = ST_Transform(geom, 4326)
 WHERE geom IS NOT NULL;

UPDATE stazioni_pompieri
   SET geom_wgs84 = ST_Transform(geom, 4326)
 WHERE geom IS NOT NULL;

UPDATE rete_stradale
   SET length_m = ST_Length(geom),
       geom_wgs84 = ST_Transform(geom, 4326)
 WHERE geom IS NOT NULL;

-- ============================================================
-- 9. TOPOLOGIA pgRouting  (dopo aver caricato la rete stradale)
-- ============================================================
-- Calcola automaticamente source e target da ogni segmento:
SELECT pgr_createTopology(
    'rete_stradale',   -- tabella
    0.001,             -- tolleranza in unità mappa (m in EPSG:2056)
    'geom',            -- colonna geometria
    'id'               -- colonna id
);

-- Analisi della topologia (opzionale, per trovare errori):
SELECT pgr_analyzeGraph('rete_stradale', 0.001, 'geom', 'id');

-- ============================================================
-- 10. ESEMPIO: percorso più breve verso l'ospedale più vicino
--     (pgr_dijkstra con near-point matching)
-- ============================================================

-- 10a. Funzione helper: nodo della rete più vicino a un punto
CREATE OR REPLACE FUNCTION nearest_vertex(pt geometry)
RETURNS BIGINT AS $$
    SELECT id
    FROM rete_stradale_vertices_pgr
    ORDER BY geom <-> pt
    LIMIT 1;
$$ LANGUAGE SQL STABLE;

-- 10b. Query di esempio: da un punto di partenza, trova il percorso
--      verso l'ospedale più vicino (Dijkstra).
--      Sostituire ST_GeomFromText(...) con il punto reale.
WITH
  start_pt AS (
    SELECT ST_GeomFromText('POINT(2601000 1119000)', 2056) AS geom
  ),
  -- Trova i 3 ospedali più vicini in linea d'aria
  candidate_hospitals AS (
    SELECT id, name, geom
    FROM ospedali
    ORDER BY geom <-> (SELECT geom FROM start_pt)
    LIMIT 3
  ),
  -- Calcola il percorso pgRouting verso ciascun candidato
  routes AS (
    SELECT
      h.id   AS hospital_id,
      h.name AS hospital_name,
      (SELECT SUM(r.cost)
       FROM pgr_dijkstra(
              'SELECT id, source, target, cost, reverse_cost FROM rete_stradale',
              nearest_vertex((SELECT geom FROM start_pt)),
              nearest_vertex(h.geom),
              directed := true
            ) r
      ) AS total_cost
    FROM candidate_hospitals h
  )
SELECT *
FROM routes
ORDER BY total_cost
LIMIT 1;

-- ============================================================
-- 11. VISTA UNIFICATA: tutti i servizi di emergenza
-- ============================================================
CREATE OR REPLACE VIEW v_servizi_emergenza AS
    SELECT 'ospedale'   AS tipo, id, name, geom, geom_wgs84 FROM ospedali
    UNION ALL
    SELECT 'polizia'    AS tipo, id, name, geom, geom_wgs84 FROM stazioni_polizia
    UNION ALL
    SELECT 'pompieri'   AS tipo, id, name, geom, geom_wgs84 FROM stazioni_pompieri;

-- ============================================================
-- Fine script
-- ============================================================
