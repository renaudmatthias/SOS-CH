# Projet — Temps d'intervention des services d'urgence, Canton de Fribourg
## HEIG-VD | Cours de géoinformatique 2024–2025

---

## Structure du projet

```
projet_urgences_fribourg/
│
├── README.md                        ← Ce fichier
│
├── sql/
│   ├── 01_setup_database.sql        ← Création DB + extensions
│   ├── 02_import_osm_network.sql    ← Import réseau routier OSM
│   ├── 03_import_sources.sql        ← Import hôpitaux + police Fribourg
│   ├── 04_isochrones.sql            ← Calcul isochrones pgRouting
│   ├── 05_zones_blanches.sql        ← Zones non couvertes
│   └── 06_population.sql            ← Jointure population OFS
│
├── python/
│   ├── 01_download_osm.py           ← Téléchargement réseau OSM (OSMnx)
│   ├── 02_import_csv.py             ← Import CSV hôpitaux + police → PostGIS
│   ├── 03_run_isochrones.py         ← Lance le calcul via psycopg2
│   └── 04_export_geojson.py         ← Export résultats en GeoJSON
│
├── data/
│   ├── hospitals_point.csv          ← (mettre ici votre fichier)
│   └── police_point.csv             ← (mettre ici votre fichier)
│
└── docs/
    └── methode.md                   ← Explications méthodologiques
```

---

## Prérequis

| Logiciel | Version recommandée |
|---|---|
| PostgreSQL | 15+ |
| PostGIS | 3.3+ |
| pgRouting | 3.5+ |
| Python | 3.10+ |
| osmnx | 1.9+ |
| psycopg2 | 2.9+ |
| geopandas | 0.14+ |

---

## Installation des extensions PostgreSQL

```sql
CREATE EXTENSION postgis;
CREATE EXTENSION pgrouting;
CREATE EXTENSION postgis_topology;
```

---

## Ordre d'exécution

1. `sql/01_setup_database.sql`      → Créer la base et les extensions
2. `python/01_download_osm.py`      → Télécharger le réseau routier
3. `python/02_import_csv.py`        → Importer hôpitaux et police
4. `sql/02_import_osm_network.sql`  → Préparer le graphe routier
5. `sql/03_import_sources.sql`      → Nettoyer et projeter les sources
6. `sql/04_isochrones.sql`          → Calculer les isochrones (8, 10, 15 min)
7. `sql/05_zones_blanches.sql`      → Identifier les zones non couvertes
8. `sql/06_population.sql`          → Quantifier la population exposée
9. `python/04_export_geojson.py`    → Exporter pour visualisation

---

## Paramètres configurables

| Paramètre | Valeur par défaut | Description |
|---|---|---|
| `seuil_8min` | 8 | Isochrone rapide (min) |
| `seuil_10min` | 10 | Isochrone standard (min) |
| `seuil_15min` | 15 | Isochrone limite (min) |
| `vitesse_route` | 50 km/h | Vitesse en agglomération |
| `vitesse_autoroute` | 100 km/h | Vitesse sur autoroute |
| `SRID` | 2056 | CH1903+/LV95 (Suisse) |

---

## Sources de données

- **Réseau routier** : OpenStreetMap / Geofabrik (canton Fribourg)
- **Hôpitaux** : `hospitals_point.csv` (OSM)
- **Police** : `police_point.csv` (OSM)
- **Population** : OFS — grille 100m (STATPOP)
- **Limites communales** : swisstopo swissBOUNDARIES3D
