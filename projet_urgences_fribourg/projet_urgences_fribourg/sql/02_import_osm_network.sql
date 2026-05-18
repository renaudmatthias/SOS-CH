-- ============================================================
-- 02_import_osm_network.sql
-- Préparation du graphe routier pour pgRouting
-- Le réseau est d'abord téléchargé par python/01_download_osm.py
-- Ce script finalise la topologie et calcule les coûts en secondes
-- ============================================================

\connect urgences_fribourg;

-- ── 1. Vérification que la table ways existe ───────────────
-- (créée par python/01_download_osm.py via osmnx + geopandas)

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'reseau' AND table_name = 'ways'
    ) THEN
        RAISE EXCEPTION 'La table reseau.ways n''existe pas. Exécutez d''abord python/01_download_osm.py';
    END IF;
END $$;

-- ── 2. Vitesses par type de route (km/h) ──────────────────
-- Utilisées pour convertir la longueur en temps de parcours

CREATE TABLE IF NOT EXISTS reseau.vitesses (
    highway     TEXT PRIMARY KEY,
    vitesse_kmh INT
);

TRUNCATE reseau.vitesses;

INSERT INTO reseau.vitesses (highway, vitesse_kmh) VALUES
    ('motorway',        110),
    ('motorway_link',    80),
    ('trunk',            90),
    ('trunk_link',       70),
    ('primary',          70),
    ('primary_link',     50),
    ('secondary',        60),
    ('secondary_link',   50),
    ('tertiary',         50),
    ('tertiary_link',    40),
    ('residential',      30),
    ('living_street',    20),
    ('unclassified',     40),
    ('service',          20),
    ('track',            20),
    ('path',             10),
    ('footway',          10),
    ('cycleway',         20),
    ('road',             40);

-- ── 3. Calcul des coûts en secondes ───────────────────────
-- cost_s = longueur (m) / vitesse (m/s)

ALTER TABLE reseau.ways
    ADD COLUMN IF NOT EXISTS cost_s        FLOAT,
    ADD COLUMN IF NOT EXISTS reverse_cost_s FLOAT;

UPDATE reseau.ways w
SET
    cost_s = CASE
        WHEN v.vitesse_kmh IS NOT NULL
        THEN w.length_m / (v.vitesse_kmh::FLOAT * 1000.0 / 3600.0)
        ELSE w.length_m / (40.0 * 1000.0 / 3600.0)  -- défaut 40 km/h
    END,
    reverse_cost_s = CASE
        -- Sens interdit sur autoroutes (one-way)
        WHEN w.highway IN ('motorway','motorway_link','trunk','trunk_link')
        THEN 1e9
        WHEN v.vitesse_kmh IS NOT NULL
        THEN w.length_m / (v.vitesse_kmh::FLOAT * 1000.0 / 3600.0)
        ELSE w.length_m / (40.0 * 1000.0 / 3600.0)
    END
FROM reseau.vitesses v
WHERE v.highway = w.highway;

-- Mettre à jour les arcs sans correspondance (vitesse par défaut)
UPDATE reseau.ways
SET cost_s = length_m / (40.0 * 1000.0 / 3600.0),
    reverse_cost_s = length_m / (40.0 * 1000.0 / 3600.0)
WHERE cost_s IS NULL;

-- ── 4. Construction de la topologie pgRouting ─────────────
-- pgr_createTopology crée les nœuds source/target sur les arcs

SELECT pgr_createTopology(
    'reseau.ways',
    0.001,           -- tolérance de snapping en mètres (LV95)
    'geom',
    'gid',
    'source',
    'target',
    clean := TRUE
);

-- ── 5. Analyse de la topologie ────────────────────────────
SELECT pgr_analyzeGraph(
    'reseau.ways',
    0.001,
    'geom',
    'gid',
    'source',
    'target'
);

-- ── 6. Index pour accélérer pgRouting ─────────────────────
CREATE INDEX IF NOT EXISTS idx_ways_source_target
    ON reseau.ways (source, target);

CREATE INDEX IF NOT EXISTS idx_ways_cost
    ON reseau.ways (cost_s);

-- ── 7. Statistiques du réseau ─────────────────────────────
SELECT
    highway,
    COUNT(*)                        AS nb_arcs,
    ROUND(SUM(length_m)/1000, 1)    AS km_total,
    ROUND(AVG(cost_s)/60, 2)        AS cout_moyen_min
FROM reseau.ways
GROUP BY highway
ORDER BY km_total DESC
LIMIT 15;

SELECT
    COUNT(*)                            AS total_arcs,
    ROUND(SUM(length_m)/1000, 1)        AS km_reseau_total,
    COUNT(DISTINCT source)              AS nb_noeuds
FROM reseau.ways;
