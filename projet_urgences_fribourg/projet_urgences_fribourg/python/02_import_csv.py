#!/usr/bin/env python3
"""
02_import_csv.py
Import des fichiers CSV (hospitals_point.csv, police_point.csv)
dans PostgreSQL/PostGIS — tables sources.hopitaux et sources.police

Filtre automatiquement les entrées du canton de Fribourg
(codes postaux 17xx ou ville contenant Frib/Frei)

Dépendances : pandas, geopandas, sqlalchemy, psycopg2, shapely
pip install pandas geopandas sqlalchemy psycopg2-binary shapely
"""

import pandas as pd
import geopandas as gpd
from shapely.wkt import loads as wkt_loads
from sqlalchemy import create_engine, text
import re
import sys
import os

# ── Configuration ─────────────────────────────────────────────
DB_CONFIG = {
    "host":     "localhost",
    "port":     5432,
    "database": "urgences_fribourg",
    "user":     "postgres",
    "password": "votre_mot_de_passe"    # ← À MODIFIER
}

# Chemins vers les CSV
CSV_HOPITAUX = os.path.join(os.path.dirname(__file__), "../data/hospitals_point.csv")
CSV_POLICE   = os.path.join(os.path.dirname(__file__), "../data/police_point.csv")

# Filtres pour le canton de Fribourg
NPA_PREFIX   = "17"          # codes postaux commençant par 17
VILLES_REGEX = r"frib|frei|tafers|bulle|romont|estavayer|murten|moral|plaffeien|chatel"


# ── Connexion ─────────────────────────────────────────────────
def get_engine():
    url = (f"postgresql+psycopg2://{DB_CONFIG['user']}:{DB_CONFIG['password']}"
           f"@{DB_CONFIG['host']}:{DB_CONFIG['port']}/{DB_CONFIG['database']}")
    return create_engine(url)


# ── Lecture et nettoyage d'un CSV ─────────────────────────────
def load_and_filter(csv_path: str, label: str) -> gpd.GeoDataFrame:
    print(f"\n📂 Lecture {label} : {csv_path}")

    df = pd.read_csv(csv_path, low_memory=False)
    print(f"   Colonnes détectées : {list(df.columns)}")
    print(f"   Total lignes : {len(df)}")

    # Normaliser les noms de colonnes (minuscules, remplacer - par _)
    df.columns = [c.strip().lower().replace("-", "_") for c in df.columns]

    # Détecter la colonne géométrie
    geom_col = None
    for candidate in ["the_geom", "geom", "geometry", "wkt"]:
        if candidate in df.columns:
            geom_col = candidate
            break
    if geom_col is None:
        raise ValueError(f"Aucune colonne géométrie trouvée dans {csv_path}")

    # Détecter les colonnes utiles
    col_map = {}
    for key, candidates in {
        "osm_id":      ["osm_id", "id", "fid", "gid"],
        "nom":         ["name", "nom", "label", "title"],
        "ville":       ["addr_city", "city", "ville", "addr-city"],
        "code_postal": ["addr_postcode", "postcode", "npa", "addr-postcode"],
    }.items():
        for c in candidates:
            if c in df.columns:
                col_map[key] = c
                break

    print(f"   Mapping colonnes : {col_map}")
    print(f"   Colonne géométrie : {geom_col}")

    # Parser la géométrie WKT
    def parse_geom(val):
        try:
            if pd.isna(val):
                return None
            return wkt_loads(str(val))
        except Exception:
            return None

    df["_geom"] = df[geom_col].apply(parse_geom)
    df = df[df["_geom"].notna()].copy()

    # Créer GeoDataFrame (SRID source = 2056 CH1903+)
    gdf = gpd.GeoDataFrame(df, geometry="_geom", crs="EPSG:2056")

    # ── Filtrer le canton de Fribourg ─────────────────────────
    mask = pd.Series([False] * len(gdf), index=gdf.index)

    if "addr_postcode" in gdf.columns:
        mask |= gdf["addr_postcode"].astype(str).str.startswith(NPA_PREFIX)
    if "addr_city" in gdf.columns:
        mask |= gdf["addr_city"].astype(str).str.lower().str.contains(
            VILLES_REGEX, na=False, regex=True
        )

    # Si pas de filtre possible, garder tout (bbox approx canton FR)
    if mask.sum() == 0:
        print("   ⚠️  Filtre NPA/ville inefficace — filtrage par bbox géographique")
        # Bbox LV95 du canton de Fribourg
        x_min, x_max = 2545000, 2620000
        y_min, y_max = 1155000, 1215000
        cx = gdf.geometry.x
        cy = gdf.geometry.y
        mask = (cx >= x_min) & (cx <= x_max) & (cy >= y_min) & (cy <= y_max)

    gdf_fr = gdf[mask].copy()
    print(f"   ✅ {len(gdf_fr)} entrées conservées pour le canton de Fribourg")

    if len(gdf_fr) == 0:
        print("   ⚠️  Aucune entrée trouvée ! Vérifiez le fichier CSV.")
        return gdf_fr

    # Construire le GDF final
    result = gpd.GeoDataFrame({
        "osm_id":      gdf_fr[col_map.get("osm_id", gdf_fr.columns[0])].values
                       if "osm_id" in col_map else None,
        "nom":         gdf_fr[col_map["nom"]].values if "nom" in col_map else "Inconnu",
        "ville":       gdf_fr[col_map["ville"]].values if "ville" in col_map else None,
        "code_postal": gdf_fr[col_map["code_postal"]].values if "code_postal" in col_map else None,
    }, geometry=gdf_fr.geometry.values, crs="EPSG:2056")

    # Nettoyage
    result["nom"] = result["nom"].fillna("Inconnu").astype(str).str.strip()
    result["ville"] = result["ville"].fillna("").astype(str).str.strip()

    print(f"\n   Aperçu :")
    print(result[["nom", "ville", "code_postal"]].to_string(index=False))

    return result


# ── Import dans PostGIS ────────────────────────────────────────
def import_to_postgis(gdf: gpd.GeoDataFrame, table: str, schema: str = "sources"):
    engine = get_engine()

    with engine.connect() as conn:
        conn.execute(text(f"TRUNCATE {schema}.{table} RESTART IDENTITY CASCADE"))
        conn.commit()

    gdf_db = gdf.rename_geometry("geom").copy()

    gdf_db.to_postgis(
        name=table,
        con=engine,
        schema=schema,
        if_exists="append",
        index=False
    )

    with engine.connect() as conn:
        count = conn.execute(
            text(f"SELECT COUNT(*) FROM {schema}.{table}")
        ).scalar()

    print(f"   ✅ {count} lignes importées dans {schema}.{table}")


# ── Table unifiée urgences ─────────────────────────────────────
def build_urgences_table():
    engine = get_engine()
    print("\n🔗 Construction de la table sources.urgences...")

    with engine.connect() as conn:
        conn.execute(text("TRUNCATE sources.urgences RESTART IDENTITY CASCADE"))
        conn.execute(text("""
            INSERT INTO sources.urgences (source_id, type, nom, ville, geom)
            SELECT id, 'hopital', nom, ville, geom FROM sources.hopitaux
            UNION ALL
            SELECT id, 'police', nom, ville, geom FROM sources.police
        """))
        count = conn.execute(
            text("SELECT COUNT(*) FROM sources.urgences")
        ).scalar()
        conn.commit()

    print(f"   ✅ {count} sources d'urgence dans la table unifiée")

    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT type, COUNT(*) AS nb, STRING_AGG(nom, ' | ' ORDER BY nom) AS noms
            FROM sources.urgences
            GROUP BY type
        """)).fetchall()
        for row in rows:
            print(f"   [{row[0]}] {row[1]} entrées : {row[2]}")


# ── Main ──────────────────────────────────────────────────────
if __name__ == "__main__":
    print("=" * 60)
    print("IMPORT CSV — Hôpitaux & Police, Canton de Fribourg")
    print("=" * 60)

    # Vérifier les fichiers
    for path, label in [(CSV_HOPITAUX, "hospitals_point.csv"),
                        (CSV_POLICE,   "police_point.csv")]:
        if not os.path.exists(path):
            print(f"❌ Fichier introuvable : {path}")
            print(f"   Copiez {label} dans le dossier data/")
            sys.exit(1)

    # Hôpitaux
    gdf_hop = load_and_filter(CSV_HOPITAUX, "Hôpitaux")
    if len(gdf_hop) > 0:
        import_to_postgis(gdf_hop, "hopitaux")

    # Police
    gdf_pol = load_and_filter(CSV_POLICE, "Police")
    if len(gdf_pol) > 0:
        import_to_postgis(gdf_pol, "police")

    # Table unifiée
    build_urgences_table()

    print("\n✅ Étape 2 terminée.")
    print("   → Exécuter maintenant : sql/03_import_sources.sql")
    print("   → Puis               : sql/04_isochrones.sql")
