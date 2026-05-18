#!/usr/bin/env python3
"""
03_run_isochrones.py
Lance le calcul des isochrones et zones blanches
directement depuis Python via psycopg2.

Alternative à l'exécution manuelle des fichiers SQL.
Affiche une barre de progression et des statistiques.

Dépendances : psycopg2, tabulate
pip install psycopg2-binary tabulate
"""

import psycopg2
import psycopg2.extras
from tabulate import tabulate
import time
import sys

# ── Configuration ─────────────────────────────────────────────
DB_CONFIG = {
    "host":     "localhost",
    "port":     5432,
    "dbname":   "urgences_fribourg",
    "user":     "postgres",
    "password": "votre_mot_de_passe"    # ← À MODIFIER
}

SEUILS_MIN = [8, 10, 15]


# ── Connexion ─────────────────────────────────────────────────
def get_conn():
    return psycopg2.connect(**DB_CONFIG)


# ── Vérification pré-requis ───────────────────────────────────
def check_prerequisites(conn):
    print("🔍 Vérification des pré-requis...")
    cur = conn.cursor()

    checks = [
        ("Extension PostGIS",
         "SELECT COUNT(*) FROM pg_extension WHERE extname='postgis'"),
        ("Extension pgRouting",
         "SELECT COUNT(*) FROM pg_extension WHERE extname='pgrouting'"),
        ("Table reseau.ways",
         "SELECT COUNT(*) FROM reseau.ways"),
        ("Table sources.urgences",
         "SELECT COUNT(*) FROM sources.urgences"),
        ("Nœuds pgRouting",
         "SELECT COUNT(*) FROM reseau.ways_vertices_pgr"),
    ]

    ok = True
    for label, query in checks:
        try:
            cur.execute(query)
            count = cur.fetchone()[0]
            status = "✅" if count > 0 else "❌"
            print(f"   {status} {label} : {count} entrées")
            if count == 0:
                ok = False
        except Exception as e:
            print(f"   ❌ {label} : ERREUR — {e}")
            ok = False

    cur.close()
    return ok


# ── Calcul d'un isochrone ─────────────────────────────────────
def calc_isochrone_python(conn, source_id: int, seuil_min: int):
    """
    Calcule l'isochrone pour une source et un seuil donné
    directement via pgr_drivingDistance.
    Retourne le nombre de nœuds atteignables.
    """
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

    seuil_s = seuil_min * 60.0

    # 1. Nœud source le plus proche
    cur.execute("""
        SELECT v.id
        FROM reseau.ways_vertices_pgr v
        ORDER BY v.geom <-> (
            SELECT geom FROM sources.urgences WHERE id = %s
        )
        LIMIT 1
    """, (source_id,))
    row = cur.fetchone()
    if not row:
        cur.close()
        return 0
    node_source = row[0]

    # 2. pgr_drivingDistance + alpha shape → insert dans resultats.isochrones
    cur.execute("""
        WITH dd AS (
            SELECT node, agg_cost
            FROM pgr_drivingDistance(
                'SELECT gid AS id, source, target, cost_s AS cost,
                        reverse_cost_s AS reverse_cost FROM reseau.ways',
                %s,
                %s,
                directed := TRUE
            )
        ),
        pts AS (
            SELECT v.geom
            FROM dd
            JOIN reseau.ways_vertices_pgr v ON dd.node = v.id
        ),
        hull AS (
            SELECT ST_ConcaveHull(ST_Collect(geom), 0.99) AS geom
            FROM pts
        )
        INSERT INTO resultats.isochrones (source_id, type_source, seuil_min, geom)
        SELECT
            %s,
            u.type,
            %s,
            hull.geom
        FROM hull
        CROSS JOIN sources.urgences u
        WHERE u.id = %s
          AND hull.geom IS NOT NULL
          AND NOT ST_IsEmpty(hull.geom)
        RETURNING id
    """, (node_source, seuil_s, source_id, seuil_min, source_id))

    inserted = cur.rowcount
    conn.commit()
    cur.close()
    return inserted


# ── Calcul zones blanches ─────────────────────────────────────
def calc_zones_blanches(conn):
    print("\n🗺️  Calcul des zones blanches...")
    cur = conn.cursor()

    cur.execute("TRUNCATE resultats.zones_blanches RESTART IDENTITY")

    for seuil in SEUILS_MIN:
        cur.execute("""
            WITH canton AS (
                SELECT ST_Union(geom) AS geom FROM reseau.canton_fribourg
            ),
            iso_union AS (
                SELECT ST_Union(geom) AS geom
                FROM resultats.isochrones
                WHERE seuil_min = %s
            ),
            zone AS (
                SELECT ST_Difference(canton.geom, iso_union.geom) AS geom
                FROM canton, iso_union
                WHERE iso_union.geom IS NOT NULL
            )
            INSERT INTO resultats.zones_blanches (seuil_min, surface_km2, geom)
            SELECT
                %s,
                ROUND(ST_Area(zone.geom) / 1e6, 2),
                ST_Multi(zone.geom)
            FROM zone
            WHERE zone.geom IS NOT NULL AND NOT ST_IsEmpty(zone.geom)
        """, (seuil, seuil))

        conn.commit()

        cur.execute("""
            SELECT surface_km2 FROM resultats.zones_blanches WHERE seuil_min = %s
        """, (seuil,))
        row = cur.fetchone()
        surface = row[0] if row else "N/A"
        print(f"   Seuil {seuil} min → zone blanche : {surface} km²")

    cur.close()


# ── Affichage des résultats ───────────────────────────────────
def print_results(conn):
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

    print("\n" + "=" * 60)
    print("RÉSULTATS — ISOCHRONES PAR TYPE DE SERVICE")
    print("=" * 60)

    cur.execute("""
        SELECT
            u.type                          AS type_service,
            u.nom,
            u.ville,
            i.seuil_min                     AS seuil_min,
            ROUND(ST_Area(i.geom)/1e6, 2)   AS surface_km2
        FROM resultats.isochrones i
        JOIN sources.urgences u ON i.source_id = u.id
        ORDER BY u.type, u.nom, i.seuil_min
    """)
    rows = [dict(r) for r in cur.fetchall()]

    if rows:
        print(tabulate(rows, headers="keys", tablefmt="rounded_outline",
                       floatfmt=".2f"))

    print("\n" + "=" * 60)
    print("ZONES BLANCHES (non couvertes)")
    print("=" * 60)

    cur.execute("""
        SELECT
            seuil_min   AS "Seuil (min)",
            surface_km2 AS "Surface non couverte (km²)",
            pop_exposee AS "Population exposée"
        FROM resultats.zones_blanches
        ORDER BY seuil_min
    """)
    rows2 = cur.fetchall()
    if rows2:
        print(tabulate(rows2,
                       headers=["Seuil (min)", "Surface non couverte (km²)", "Pop. exposée"],
                       tablefmt="rounded_outline"))

    cur.close()


# ── Main ──────────────────────────────────────────────────────
if __name__ == "__main__":
    print("=" * 60)
    print("CALCUL ISOCHRONES — Canton de Fribourg")
    print("=" * 60)

    conn = get_conn()

    if not check_prerequisites(conn):
        print("\n❌ Pré-requis manquants. Exécutez d'abord les étapes 1 et 2.")
        conn.close()
        sys.exit(1)

    # Récupérer toutes les sources
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
    cur.execute("SELECT id, type, nom, ville FROM sources.urgences ORDER BY type, id")
    sources = cur.fetchall()
    cur.close()

    print(f"\n⚙️  Calcul pour {len(sources)} sources × {len(SEUILS_MIN)} seuils "
          f"= {len(sources) * len(SEUILS_MIN)} isochrones")

    # Vider la table isochrones
    with conn.cursor() as cur:
        cur.execute("TRUNCATE resultats.isochrones RESTART IDENTITY")
        conn.commit()

    total = len(sources) * len(SEUILS_MIN)
    done  = 0
    t0    = time.time()

    for src in sources:
        for seuil in SEUILS_MIN:
            done += 1
            pct = done * 100 // total
            bar = "█" * (pct // 5) + "░" * (20 - pct // 5)
            elapsed = time.time() - t0
            print(f"\r   [{bar}] {pct:3d}% | {src['type']:8s} | {src['nom'][:30]:30s} | {seuil} min",
                  end="", flush=True)

            n = calc_isochrone_python(conn, src['id'], seuil)

    print(f"\n\n✅ Calcul terminé en {time.time()-t0:.1f}s")

    calc_zones_blanches(conn)
    print_results(conn)

    conn.close()

    print("\n✅ Étape 3 terminée.")
    print("   → Exécuter maintenant : python/04_export_geojson.py")
