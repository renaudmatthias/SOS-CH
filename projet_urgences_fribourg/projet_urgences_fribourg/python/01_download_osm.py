#!/usr/bin/env python3
"""
01_download_osm.py
Téléchargement du réseau routier du canton de Fribourg via OSMnx
et import dans PostgreSQL/PostGIS (table reseau.ways)

Dépendances : osmnx, geopandas, sqlalchemy, psycopg2
pip install osmnx geopandas sqlalchemy psycopg2-binary
"""

import osmnx as ox
import geopandas as gpd
import pandas as pd
from sqlalchemy import create_engine, text
import numpy as np
import warnings
warnings.filterwarnings('ignore')

# ── Configuration ─────────────────────────────────────────────
DB_CONFIG = {
    "host":     "localhost",
    "port":     5432,
    "database": "urgences_fribourg",
    "user":     "postgres",
    "password": "votre_mot_de_passe"   # ← À MODIFIER
}

# Bounding box du canton de Fribourg (WGS84 lat/lon)
# Sud, Ouest, Nord, Est
BBOX_FRIBOURG = (46.40, 6.75, 47.00, 7.75)

# Types de routes à inclure
NETWORK_TYPE = "drive"   # 'drive' = réseau carrossable uniquement

# ── Connexion PostgreSQL ───────────────────────────────────────
def get_engine():
    url = (f"postgresql+psycopg2://{DB_CONFIG['user']}:{DB_CONFIG['password']}"
           f"@{DB_CONFIG['host']}:{DB_CONFIG['port']}/{DB_CONFIG['database']}")
    return create_engine(url)


# ── Téléchargement du réseau OSM ──────────────────────────────
def download_network():
    print("📥 Téléchargement du réseau routier OSM — Canton de Fribourg...")
    print(f"   Bounding box : {BBOX_FRIBOURG}")

    # Télécharger le graphe routier
    G = ox.graph_from_bbox(
        bbox=BBOX_FRIBOURG,
        network_type=NETWORK_TYPE,
        simplify=True,
        retain_all=False
    )

    print(f"   ✅ Graphe téléchargé : {len(G.nodes)} nœuds, {len(G.edges)} arcs")
    return G


# ── Conversion en GeoDataFrame et reprojection ────────────────
def prepare_edges(G):
    print("🔄 Conversion et reprojection en CH1903+ (SRID 2056)...")

    # Convertir en GeoDataFrame
    nodes, edges = ox.graph_to_gdfs(G, nodes=True, edges=True)

    # Reprojeter de WGS84 (4326) vers CH1903+ LV95 (2056)
    edges = edges.to_crs(epsg=2056)
    nodes = nodes.to_crs(epsg=2056)

    # Garder les colonnes utiles pour pgRouting
    edges = edges.reset_index()

    # Longueur en mètres (calculée après reprojection)
    edges['length_m'] = edges.geometry.length

    # Colonnes pour pgRouting (source/target remplis par pgr_createTopology)
    edges['source'] = None
    edges['target'] = None
    edges['cost_s'] = None
    edges['reverse_cost_s'] = None

    # Sélection et renommage des colonnes
    cols_keep = ['osmid', 'name', 'highway', 'length_m',
                 'source', 'target', 'cost_s', 'reverse_cost_s', 'geometry']
    edges = edges[[c for c in cols_keep if c in edges.columns]]
    edges = edges.rename(columns={'osmid': 'osm_id', 'geometry': 'geom'})
    edges = edges.set_geometry('geom')

    # Convertir highway en string (peut être liste)
    edges['highway'] = edges['highway'].apply(
        lambda x: x[0] if isinstance(x, list) else str(x) if x else 'unclassified'
    )

    # Convertir name en string
    edges['name'] = edges['name'].apply(
        lambda x: x[0] if isinstance(x, list) else str(x) if pd.notna(x) else None
    )

    print(f"   ✅ {len(edges)} arcs préparés")
    print(f"   Types de routes : {edges['highway'].value_counts().head(8).to_dict()}")

    return edges, nodes


# ── Import dans PostgreSQL ─────────────────────────────────────
def import_to_postgis(edges, nodes):
    engine = get_engine()
    print("📤 Import dans PostgreSQL/PostGIS...")

    with engine.connect() as conn:
        conn.execute(text("TRUNCATE reseau.ways RESTART IDENTITY CASCADE"))
        conn.execute(text("TRUNCATE reseau.ways_vertices_pgr RESTART IDENTITY CASCADE"))
        conn.commit()

    # Import des arcs
    edges.to_postgis(
        name='ways',
        con=engine,
        schema='reseau',
        if_exists='append',
        index=False,
        chunksize=5000
    )

    print(f"   ✅ {len(edges)} arcs importés dans reseau.ways")

    # Statistiques
    with engine.connect() as conn:
        result = conn.execute(text(
            "SELECT COUNT(*), ROUND(SUM(length_m)/1000, 1) FROM reseau.ways"
        ))
        row = result.fetchone()
        print(f"   📊 Réseau : {row[0]} arcs, {row[1]} km total")


# ── Main ──────────────────────────────────────────────────────
if __name__ == "__main__":
    print("=" * 60)
    print("IMPORT RÉSEAU OSM — Canton de Fribourg")
    print("=" * 60)

    G = download_network()
    edges, nodes = prepare_edges(G)
    import_to_postgis(edges, nodes)

    print("\n✅ Étape 1 terminée.")
    print("   → Exécuter maintenant : sql/02_import_osm_network.sql")
