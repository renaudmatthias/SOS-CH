-- ============================================================
-- 05_zones_blanches.sql
-- Identification des zones non couvertes par aucun service
-- d'urgence dans le délai cible (8, 10 et 15 minutes)
-- Méthode : territoire cantonal MINUS union des isochrones
-- ============================================================

\connect urgences_fribourg;

-- ── 1. Table du périmètre cantonal Fribourg ───────────────
-- À importer depuis swissBOUNDARIES3D (swisstopo)
-- Ici on utilise une emprise bounding-box approchée du canton
-- Remplacer par le vrai polygone swisstopo pour la production

CREATE TABLE IF NOT EXISTS reseau.canton_fribourg (
    id      SERIAL PRIMARY KEY,
    nom     TEXT,
    geom    GEOMETRY(MultiPolygon, 2056)
);

-- Emprise approximative du canton de Fribourg (LV95)
-- X : 2545000 – 2620000   Y : 1155000 – 1215000
-- À REMPLACER par le polygone réel swisstopo
INSERT INTO reseau.canton_fribourg (nom, geom)
SELECT
    'Canton de Fribourg',
    ST_Multi(
        ST_MakeEnvelope(2545000, 1155000, 2620000, 1215000, 2056)
    )
WHERE NOT EXISTS (SELECT 1 FROM reseau.canton_fribourg LIMIT 1);

-- ── 2. Calcul des zones blanches par seuil ─────────────────

TRUNCATE resultats.zones_blanches RESTART IDENTITY;

DO $$
DECLARE
    seuil       INT;
    union_iso   GEOMETRY;
    canton_geom GEOMETRY;
    zone_blanche GEOMETRY;
BEGIN
    -- Géométrie du canton
    SELECT ST_Union(geom) INTO canton_geom FROM reseau.canton_fribourg;

    FOREACH seuil IN ARRAY ARRAY[8, 10, 15]
    LOOP
        RAISE NOTICE 'Calcul zones blanches — seuil % min', seuil;

        -- Union de tous les isochrones pour ce seuil
        SELECT ST_Union(geom) INTO union_iso
        FROM resultats.isochrones
        WHERE seuil_min = seuil;

        IF union_iso IS NULL THEN
            RAISE WARNING 'Aucun isochrone pour seuil % min', seuil;
            CONTINUE;
        END IF;

        -- Zone blanche = Canton - Union(isochrones)
        zone_blanche := ST_Difference(canton_geom, union_iso);

        IF zone_blanche IS NOT NULL AND NOT ST_IsEmpty(zone_blanche) THEN
            INSERT INTO resultats.zones_blanches (seuil_min, surface_km2, geom)
            VALUES (
                seuil,
                ROUND(ST_Area(zone_blanche) / 1e6, 2),
                ST_Multi(zone_blanche)
            );
        END IF;
    END LOOP;

    RAISE NOTICE '✅ Zones blanches calculées.';
END $$;

-- ── 3. Résumé des zones blanches ──────────────────────────
SELECT
    zb.seuil_min                AS "Seuil (min)",
    zb.surface_km2              AS "Surface non couverte (km²)",
    ROUND(
        zb.surface_km2 * 100.0 /
        (ST_Area(cf.geom) / 1e6), 1
    )                           AS "% du canton non couvert"
FROM resultats.zones_blanches zb
CROSS JOIN (
    SELECT ST_Union(geom) AS geom FROM reseau.canton_fribourg
) cf
ORDER BY zb.seuil_min;

-- ── 4. Vue zones blanches + couverture ────────────────────
CREATE OR REPLACE VIEW resultats.v_couverture AS
WITH canton AS (
    SELECT ST_Union(geom) AS geom, ST_Area(ST_Union(geom))/1e6 AS surface_km2
    FROM reseau.canton_fribourg
),
couverture AS (
    SELECT
        seuil_min,
        ST_Union(geom) AS geom_couverte,
        ST_Area(ST_Union(geom))/1e6 AS surface_couverte
    FROM resultats.isochrones
    GROUP BY seuil_min
)
SELECT
    c.seuil_min,
    ROUND(co.surface_couverte, 1)              AS surface_couverte_km2,
    ROUND(canton.surface_km2 - co.surface_couverte, 1) AS surface_non_couverte_km2,
    ROUND(co.surface_couverte * 100.0 / canton.surface_km2, 1) AS pct_couvert
FROM couverture c
JOIN canton ON TRUE
JOIN couverture co ON co.seuil_min = c.seuil_min
ORDER BY c.seuil_min;

SELECT * FROM resultats.v_couverture;
