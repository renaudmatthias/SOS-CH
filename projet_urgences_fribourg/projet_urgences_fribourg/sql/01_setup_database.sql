-- ============================================================
-- 01_setup_database.sql
-- Création de la base de données et des extensions nécessaires
-- Projet urgences Fribourg | HEIG-VD 2024-2025
-- ============================================================

-- Créer la base (à exécuter depuis psql en tant que superuser)
-- psql -U postgres -c "CREATE DATABASE urgences_fribourg;"

\connect urgences_fribourg;

-- Extensions spatiales
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;
CREATE EXTENSION IF NOT EXISTS pgrouting;

-- Vérification
SELECT postgis_version();
SELECT pgr_version();

-- Schémas de travail
CREATE SCHEMA IF NOT EXISTS reseau;
CREATE SCHEMA IF NOT EXISTS sources;
CREATE SCHEMA IF NOT EXISTS resultats;

-- ── Table hôpitaux ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sources.hopitaux (
    id          SERIAL PRIMARY KEY,
    osm_id      BIGINT,
    nom         TEXT,
    ville       TEXT,
    code_postal TEXT,
    type        TEXT DEFAULT 'hopital',
    geom        GEOMETRY(Point, 2056)   -- CH1903+ LV95
);

-- ── Table police ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sources.police (
    id          SERIAL PRIMARY KEY,
    osm_id      BIGINT,
    nom         TEXT,
    ville       TEXT,
    code_postal TEXT,
    type        TEXT DEFAULT 'police',
    geom        GEOMETRY(Point, 2056)
);

-- ── Table unifiée des sources d'urgence ────────────────────
CREATE TABLE IF NOT EXISTS sources.urgences (
    id          SERIAL PRIMARY KEY,
    source_id   INT,
    type        TEXT,   -- 'hopital' ou 'police'
    nom         TEXT,
    ville       TEXT,
    geom        GEOMETRY(Point, 2056)
);

-- ── Table réseau routier (remplie par pgRouting/OSMnx) ─────
CREATE TABLE IF NOT EXISTS reseau.ways (
    gid         BIGSERIAL PRIMARY KEY,
    osm_id      BIGINT,
    name        TEXT,
    highway     TEXT,
    length_m    FLOAT,
    cost_s      FLOAT,      -- coût en secondes (sens normal)
    reverse_cost_s FLOAT,   -- coût en secondes (sens inverse)
    source      BIGINT,     -- nœud source pgRouting
    target      BIGINT,     -- nœud target pgRouting
    geom        GEOMETRY(LineString, 2056)
);

CREATE TABLE IF NOT EXISTS reseau.ways_vertices_pgr (
    id          BIGSERIAL PRIMARY KEY,
    cnt         INT,
    chk         INT,
    ein         INT,
    eout        INT,
    geom        GEOMETRY(Point, 2056)
);

-- ── Table isochrones ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS resultats.isochrones (
    id          SERIAL PRIMARY KEY,
    source_id   INT REFERENCES sources.urgences(id),
    type_source TEXT,
    seuil_min   INT,        -- 8, 10, ou 15 minutes
    geom        GEOMETRY(Polygon, 2056)
);

-- ── Table zones blanches ───────────────────────────────────
CREATE TABLE IF NOT EXISTS resultats.zones_blanches (
    id              SERIAL PRIMARY KEY,
    seuil_min       INT,
    pop_exposee     INT,
    surface_km2     FLOAT,
    geom            GEOMETRY(MultiPolygon, 2056)
);

-- Index spatiaux
CREATE INDEX IF NOT EXISTS idx_hopitaux_geom    ON sources.hopitaux    USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_police_geom      ON sources.police      USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_urgences_geom    ON sources.urgences    USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_ways_geom        ON reseau.ways         USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_isochrones_geom  ON resultats.isochrones USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_zones_geom       ON resultats.zones_blanches USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_ways_source      ON reseau.ways (source);
CREATE INDEX IF NOT EXISTS idx_ways_target      ON reseau.ways (target);

RAISE NOTICE '✅ Base de données configurée avec succès.';
