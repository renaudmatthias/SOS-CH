-- ============================================================
-- 04_isochrones.sql
-- Calcul des isochrones (8, 10, 15 minutes) pour chaque source
-- d'urgence (hôpitaux + police) avec pgRouting pgr_drivingDistance
-- ============================================================

\connect urgences_fribourg;

-- ── Fonction principale : isochrone depuis un point source ─
-- Retourne un polygone convexe (puis concave) des zones atteignables
-- en moins de X minutes depuis une source d'urgence.

CREATE OR REPLACE FUNCTION resultats.calc_isochrone(
    p_source_id   INT,       -- ID dans sources.urgences
    p_seuil_min   INT        -- seuil en minutes (8, 10, 15)
)
RETURNS GEOMETRY AS $$
DECLARE
    v_geom_source   GEOMETRY;
    v_node_source   BIGINT;
    v_seuil_s       FLOAT;
    v_result_geom   GEOMETRY;
BEGIN
    -- 1. Récupérer la géométrie de la source
    SELECT geom INTO v_geom_source
    FROM sources.urgences WHERE id = p_source_id;

    IF v_geom_source IS NULL THEN
        RAISE WARNING 'Source ID % introuvable', p_source_id;
        RETURN NULL;
    END IF;

    -- 2. Trouver le nœud du réseau le plus proche de la source
    SELECT id INTO v_node_source
    FROM reseau.ways_vertices_pgr
    ORDER BY geom <-> v_geom_source
    LIMIT 1;

    -- 3. Convertir le seuil en secondes
    v_seuil_s := p_seuil_min * 60.0;

    -- 4. pgr_drivingDistance : tous les nœuds atteignables en <= seuil
    -- On récupère les nœuds et on fait un alpha-shape (enveloppe concave)
    SELECT
        ST_ConcaveHull(
            ST_Collect(v.geom),
            0.99    -- paramètre de concavité (0=convexe, 1=très concave)
        )
    INTO v_result_geom
    FROM pgr_drivingDistance(
        'SELECT gid AS id, source, target, cost_s AS cost, reverse_cost_s AS reverse_cost
         FROM reseau.ways
         WHERE cost_s < ' || (v_seuil_s * 1.5)::TEXT || '  -- pré-filtre pour performances',
        v_node_source,
        v_seuil_s,
        directed := TRUE
    ) AS dd
    JOIN reseau.ways_vertices_pgr v ON dd.node = v.id;

    RETURN v_result_geom;
END;
$$ LANGUAGE plpgsql;

-- ── Calcul pour toutes les sources et tous les seuils ──────

TRUNCATE resultats.isochrones RESTART IDENTITY;

DO $$
DECLARE
    r           RECORD;
    seuil       INT;
    iso_geom    GEOMETRY;
    cnt         INT := 0;
BEGIN
    FOR r IN SELECT id, type, nom, ville FROM sources.urgences ORDER BY id
    LOOP
        FOREACH seuil IN ARRAY ARRAY[8, 10, 15]
        LOOP
            RAISE NOTICE 'Calcul isochrone % min — % (%)', seuil, r.nom, r.type;

            iso_geom := resultats.calc_isochrone(r.id, seuil);

            IF iso_geom IS NOT NULL AND NOT ST_IsEmpty(iso_geom) THEN
                INSERT INTO resultats.isochrones (source_id, type_source, seuil_min, geom)
                VALUES (r.id, r.type, seuil, iso_geom);
                cnt := cnt + 1;
            ELSE
                RAISE WARNING 'Isochrone vide pour source % seuil %', r.id, seuil;
            END IF;
        END LOOP;
    END LOOP;

    RAISE NOTICE '✅ % isochrones calculés.', cnt;
END $$;

-- ── Vue synthétique des isochrones ─────────────────────────
CREATE OR REPLACE VIEW resultats.v_isochrones AS
SELECT
    i.id,
    u.nom,
    u.ville,
    u.type AS type_source,
    i.seuil_min,
    ROUND(ST_Area(i.geom) / 1e6, 2)    AS surface_km2,
    i.geom
FROM resultats.isochrones i
JOIN sources.urgences u ON i.source_id = u.id;

-- ── Statistiques ──────────────────────────────────────────
SELECT
    type_source,
    seuil_min,
    COUNT(*)                            AS nb_isochrones,
    ROUND(AVG(ST_Area(geom)/1e6), 2)    AS surface_moy_km2,
    ROUND(MAX(ST_Area(geom)/1e6), 2)    AS surface_max_km2
FROM resultats.isochrones
GROUP BY type_source, seuil_min
ORDER BY type_source, seuil_min;
