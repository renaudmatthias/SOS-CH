-- ============================================================
-- 06_population.sql
-- Quantification de la population dans les zones blanches
-- Source : OFS STATPOP — grille de population 100m × 100m
-- ============================================================

\connect urgences_fribourg;

-- ── 1. Table grille population OFS (à importer) ───────────
-- Télécharger depuis : https://www.bfs.admin.ch/
-- Fichier : STATPOP_2023_100m.gpkg ou CSV avec coordonnées LV95

CREATE TABLE IF NOT EXISTS sources.population_grid (
    id          SERIAL PRIMARY KEY,
    x_lv95      FLOAT,      -- coordonnée X centroïde de la cellule
    y_lv95      FLOAT,      -- coordonnée Y centroïde de la cellule
    pop_total   INT,        -- habitants dans la cellule
    geom        GEOMETRY(Point, 2056)
);

CREATE INDEX IF NOT EXISTS idx_pop_geom ON sources.population_grid USING GIST(geom);

-- ── 2. Import depuis CSV OFS ───────────────────────────────
-- Exemple d'import depuis un fichier CSV OFS :
--   COPY sources.population_grid (x_lv95, y_lv95, pop_total)
--   FROM '/chemin/vers/STATPOP_2023.csv' DELIMITER ';' CSV HEADER;
--
-- Puis mettre à jour la géométrie :
--   UPDATE sources.population_grid
--   SET geom = ST_SetSRID(ST_MakePoint(x_lv95, y_lv95), 2056);
--
-- Note : le fichier OFS utilise les colonnes E_KOORD, N_KOORD, B23BTOT

-- ── 3. Population exposée par zone blanche ─────────────────

ALTER TABLE resultats.zones_blanches
    ADD COLUMN IF NOT EXISTS pop_exposee INT DEFAULT 0;

DO $$
DECLARE
    r       RECORD;
    pop_sum INT;
BEGIN
    FOR r IN SELECT id, seuil_min, geom FROM resultats.zones_blanches
    LOOP
        SELECT COALESCE(SUM(pg.pop_total), 0) INTO pop_sum
        FROM sources.population_grid pg
        WHERE ST_Within(pg.geom, r.geom);

        UPDATE resultats.zones_blanches
        SET pop_exposee = pop_sum
        WHERE id = r.id;

        RAISE NOTICE 'Seuil % min : % habitants en zone blanche',
            r.seuil_min, pop_sum;
    END LOOP;
END $$;

-- ── 4. Population totale du canton (référence) ────────────
SELECT
    SUM(pop_total) AS pop_totale_canton
FROM sources.population_grid pg
JOIN reseau.canton_fribourg cf ON ST_Within(pg.geom, cf.geom);

-- ── 5. Tableau de synthèse final ──────────────────────────
SELECT
    zb.seuil_min                AS "Seuil (min)",
    zb.surface_km2              AS "Surface non couverte (km²)",
    zb.pop_exposee              AS "Population en zone blanche",
    ROUND(
        zb.pop_exposee * 100.0 /
        NULLIF((
            SELECT SUM(pop_total)
            FROM sources.population_grid pg
            JOIN reseau.canton_fribourg cf ON ST_Within(pg.geom, cf.geom)
        ), 0), 1
    )                           AS "% pop. non couverte"
FROM resultats.zones_blanches zb
ORDER BY zb.seuil_min;

-- ── 6. Vue complète pour export ───────────────────────────
CREATE OR REPLACE VIEW resultats.v_synthese_finale AS
SELECT
    zb.seuil_min,
    zb.surface_km2              AS surface_non_couverte_km2,
    zb.pop_exposee              AS pop_en_zone_blanche,
    vc.surface_couverte_km2,
    vc.pct_couvert,
    zb.geom
FROM resultats.zones_blanches zb
JOIN resultats.v_couverture vc ON vc.seuil_min = zb.seuil_min;

-- ── 7. Population couverte par type de service ────────────
SELECT
    i.type_source               AS "Type de service",
    i.seuil_min                 AS "Seuil (min)",
    COUNT(DISTINCT i.source_id) AS "Nb de sources",
    COALESCE(SUM(pg.pop_total), 0) AS "Pop. couverte estimée"
FROM resultats.isochrones i
LEFT JOIN sources.population_grid pg
    ON ST_Within(pg.geom, i.geom)
GROUP BY i.type_source, i.seuil_min
ORDER BY i.type_source, i.seuil_min;
