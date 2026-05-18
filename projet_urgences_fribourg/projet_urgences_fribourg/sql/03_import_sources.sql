-- ============================================================
-- 03_import_sources.sql
-- Nettoyage et insertion des sources d'urgence (hôpitaux + police)
-- Les données brutes sont importées par python/02_import_csv.py
-- Ce script les nettoie et les reprojette en CH1903+ (SRID 2056)
-- ============================================================

\connect urgences_fribourg;

-- ── 1. Hôpitaux du canton de Fribourg ─────────────────────
-- Les coordonnées dans le CSV sont en SRID 2056 (CH1903+/LV95)
-- Format : POINT (2577029.97 1183467.80)

TRUNCATE sources.hopitaux RESTART IDENTITY;

INSERT INTO sources.hopitaux (osm_id, nom, ville, code_postal, geom)
VALUES
    (-20291030 * -1,
     'HFR Fribourg – Hôpital cantonal',
     'Villars-sur-Glâne', '1752',
     ST_SetSRID(ST_MakePoint(2577029.98, 1183467.80), 2056)),

    (-18877963 * -1,
     'Hôpital Daler',
     'Fribourg', '1700',
     ST_SetSRID(ST_MakePoint(2577254.40, 1183341.61), 2056)),

    (-18585173 * -1,
     'Clinique Générale Ste-Anne',
     'Fribourg', '1700',
     ST_SetSRID(ST_MakePoint(2578306.67, 1183215.58), 2056)),

    (-18380217 * -1,
     'HFR Spital Tafers',
     'Tafers', '1712',
     ST_SetSRID(ST_MakePoint(2582708.26, 1184368.98), 2056));

-- ── 2. Postes de police du canton de Fribourg ─────────────

TRUNCATE sources.police RESTART IDENTITY;

INSERT INTO sources.police (osm_id, nom, ville, code_postal, geom)
VALUES
    (1, 'Poste de police (Fribourg centre)',
     'Fribourg', '1700',
     ST_SetSRID(ST_MakePoint(2579045.28, 1183897.94), 2056)),

    (2, 'Poste de police (Tafers)',
     'Tafers', '1712',
     ST_SetSRID(ST_MakePoint(2583002.17, 1184966.18), 2056)),

    (3, 'Polizeiposten Oberschrot',
     'Plaffeien', '1716',
     ST_SetSRID(ST_MakePoint(2588004.32, 1176865.24), 2056)),

    (4, 'Gendarmerie du Mouret',
     'Le Mouret', '1724',
     ST_SetSRID(ST_MakePoint(2579623.16, 1177170.17), 2056)),

    (5, 'Police cantonale / Kantonspolizei',
     'Fribourg', '1700',
     ST_SetSRID(ST_MakePoint(2578920.90, 1183977.55), 2056)),

    (6, 'Poste de police (Sugiez)',
     'Sugiez', '1786',
     ST_SetSRID(ST_MakePoint(2575630.77, 1201605.56), 2056)),

    (7, 'Poste de police (Fribourg nord)',
     'Fribourg', '1700',
     ST_SetSRID(ST_MakePoint(2579746.37, 1184203.26), 2056)),

    (8, 'Police intercommunale',
     'Villars-sur-Glâne', '1752',
     ST_SetSRID(ST_MakePoint(2575655.996, 1183094.05), 2056)),

    (9, 'Kommando Kantonspolizei Fribourg',
     'Granges-Paccot', '1763',
     ST_SetSRID(ST_MakePoint(2577825.33, 1186289.95), 2056));

-- ── 3. Table unifiée sources.urgences ─────────────────────
TRUNCATE resultats.isochrones RESTART IDENTITY;
TRUNCATE sources.urgences RESTART IDENTITY;

INSERT INTO sources.urgences (source_id, type, nom, ville, geom)
SELECT id, 'hopital', nom, ville, geom FROM sources.hopitaux;

INSERT INTO sources.urgences (source_id, type, nom, ville, geom)
SELECT id, 'police', nom, ville, geom FROM sources.police;

-- ── 4. Vérification ───────────────────────────────────────
SELECT type, COUNT(*) AS nb, STRING_AGG(nom, ' | ') AS noms
FROM sources.urgences
GROUP BY type;

SELECT
    u.id,
    u.type,
    u.nom,
    u.ville,
    ST_AsText(u.geom) AS coordonnees_lv95
FROM sources.urgences u
ORDER BY u.type, u.ville;
