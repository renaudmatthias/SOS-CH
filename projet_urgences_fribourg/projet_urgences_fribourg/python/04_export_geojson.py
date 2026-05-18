#!/usr/bin/env python3
"""
04_export_geojson.py
Export des résultats (isochrones, zones blanches, sources)
en GeoJSON pour visualisation dans QGIS ou navigateur web.

Génère dans le dossier data/output/ :
  - isochrones_hopitaux.geojson
  - isochrones_police.geojson
  - zones_blanches.geojson
  - sources_urgences.geojson
  - synthese.json (statistiques)

Dépendances : geopandas, sqlalchemy, psycopg2
pip install geopandas sqlalchemy psycopg2-binary
"""

import geopandas as gpd
import pandas as pd
from sqlalchemy import create_engine, text
import json
import os
from datetime import datetime

# ── Configuration ─────────────────────────────────────────────
DB_CONFIG = {
    "host":     "localhost",
    "port":     5432,
    "database": "urgences_fribourg",
    "user":     "postgres",
    "password": "votre_mot_de_passe"    # ← À MODIFIER
}

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "../data/output")

# Couleurs par seuil (pour visualisation)
COULEURS_SEUIL = {
    8:  "#2ecc71",   # vert  — couverture rapide
    10: "#f39c12",   # orange
    15: "#e74c3c",   # rouge — limite acceptable
}


# ── Connexion ─────────────────────────────────────────────────
def get_engine():
    url = (f"postgresql+psycopg2://{DB_CONFIG['user']}:{DB_CONFIG['password']}"
           f"@{DB_CONFIG['host']}:{DB_CONFIG['port']}/{DB_CONFIG['database']}")
    return create_engine(url)


# ── Export GeoJSON générique ───────────────────────────────────
def export_geojson(engine, query: str, filename: str, params=None):
    path = os.path.join(OUTPUT_DIR, filename)

    gdf = gpd.read_postgis(query, con=engine, geom_col="geom",
                            crs="EPSG:2056", params=params)

    # Reprojeter en WGS84 pour compatibilité GeoJSON standard
    gdf = gdf.to_crs(epsg=4326)

    gdf.to_file(path, driver="GeoJSON")
    print(f"   ✅ {filename} — {len(gdf)} entités — {os.path.getsize(path)//1024} Ko")
    return gdf


# ── Export isochrones ─────────────────────────────────────────
def export_isochrones(engine):
    print("\n📤 Export des isochrones...")

    for type_src in ["hopital", "police"]:
        fname = f"isochrones_{type_src}s.geojson"
        query = """
            SELECT
                i.id,
                u.nom,
                u.ville,
                u.type AS type_source,
                i.seuil_min,
                ROUND(ST_Area(i.geom)/1e6, 2) AS surface_km2,
                i.geom
            FROM resultats.isochrones i
            JOIN sources.urgences u ON i.source_id = u.id
            WHERE u.type = %(type)s
            ORDER BY u.nom, i.seuil_min
        """
        export_geojson(engine, query, fname, params={"type": type_src})


# ── Export zones blanches ─────────────────────────────────────
def export_zones_blanches(engine):
    print("\n📤 Export des zones blanches...")

    query = """
        SELECT
            id,
            seuil_min,
            surface_km2,
            COALESCE(pop_exposee, 0) AS pop_exposee,
            geom
        FROM resultats.zones_blanches
        ORDER BY seuil_min
    """
    export_geojson(engine, query, "zones_blanches.geojson")


# ── Export sources d'urgence ──────────────────────────────────
def export_sources(engine):
    print("\n📤 Export des sources d'urgence...")

    query = """
        SELECT
            id,
            type,
            nom,
            ville,
            geom
        FROM sources.urgences
        ORDER BY type, nom
    """
    export_geojson(engine, query, "sources_urgences.geojson")


# ── Export statistiques JSON ──────────────────────────────────
def export_synthese(engine):
    print("\n📤 Export des statistiques...")

    synthese = {
        "date_calcul": datetime.now().isoformat(),
        "canton": "Fribourg",
        "srid": 2056,
        "isochrones": [],
        "zones_blanches": [],
        "sources": {"hopitaux": 0, "police": 0}
    }

    with engine.connect() as conn:
        # Statistiques isochrones
        rows = conn.execute(text("""
            SELECT
                type_source,
                seuil_min,
                COUNT(*) AS nb,
                ROUND(AVG(ST_Area(geom)/1e6)::numeric, 2) AS surface_moy_km2
            FROM resultats.isochrones
            GROUP BY type_source, seuil_min
            ORDER BY type_source, seuil_min
        """)).fetchall()
        for r in rows:
            synthese["isochrones"].append({
                "type": r[0], "seuil_min": r[1],
                "nb": r[2], "surface_moy_km2": float(r[3])
            })

        # Zones blanches
        rows2 = conn.execute(text("""
            SELECT seuil_min, surface_km2, COALESCE(pop_exposee, 0)
            FROM resultats.zones_blanches
            ORDER BY seuil_min
        """)).fetchall()
        for r in rows2:
            synthese["zones_blanches"].append({
                "seuil_min": r[0],
                "surface_km2": float(r[1]),
                "pop_exposee": r[2]
            })

        # Sources
        rows3 = conn.execute(text("""
            SELECT type, COUNT(*) FROM sources.urgences GROUP BY type
        """)).fetchall()
        for r in rows3:
            synthese["sources"][r[0]] = r[1]

    path = os.path.join(OUTPUT_DIR, "synthese.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(synthese, f, indent=2, ensure_ascii=False)

    print(f"   ✅ synthese.json exporté")

    # Affichage résumé
    print("\n" + "=" * 50)
    print("SYNTHÈSE FINALE")
    print("=" * 50)
    print(f"  Hôpitaux     : {synthese['sources'].get('hopital', 0)}")
    print(f"  Postes police: {synthese['sources'].get('police', 0)}")
    print()
    for zb in synthese["zones_blanches"]:
        print(f"  Zone blanche {zb['seuil_min']} min : "
              f"{zb['surface_km2']} km²  |  {zb['pop_exposee']} hab.")
    print("=" * 50)


# ── Main ──────────────────────────────────────────────────────
if __name__ == "__main__":
    print("=" * 60)
    print("EXPORT GEOJSON — Canton de Fribourg")
    print("=" * 60)

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    engine = get_engine()

    export_isochrones(engine)
    export_zones_blanches(engine)
    export_sources(engine)
    export_synthese(engine)

    print(f"\n✅ Tous les fichiers exportés dans : {OUTPUT_DIR}/")
    print("   Fichiers générés :")
    for f in os.listdir(OUTPUT_DIR):
        size = os.path.getsize(os.path.join(OUTPUT_DIR, f)) // 1024
        print(f"   📄 {f}  ({size} Ko)")

    print("\n   → Ouvrez les GeoJSON dans QGIS pour visualisation")
    print("   → Ou utilisez geojson.io pour un aperçu rapide")
