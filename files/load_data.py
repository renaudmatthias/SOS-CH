#!/usr/bin/env python3
"""
load_data.py
Carica i GeoJSON dei servizi di emergenza nel database PostgreSQL.

Requisiti:
    pip install psycopg2-binary

Uso:
    python3 load_data.py

Modificare le variabili DB_CONFIG e FILE_PATHS in base al proprio ambiente.
"""

import json
import psycopg2
from datetime import datetime

# ----------------------------------------------------------------
# CONFIGURAZIONE — modifica questi valori
# ----------------------------------------------------------------
DB_CONFIG = {
    "host":     "localhost",
    "port":     5432,
    "dbname":   "emergency_db",   # nome del database
    "user":     "postgres",
    "password": "postgres",
}

FILE_PATHS = {
    "hospital":     "hospital.geojson",
    "police":       "police.geojson",
    "police_v2":    "police_v2.geojson",
    "fire_station": "fire_station.geojson",
}
# ----------------------------------------------------------------


def load_json(path: str) -> list:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return data.get("features", [])


def get(props: dict, *keys, default=None):
    """Ritorna il primo valore non-None tra le chiavi date."""
    for k in keys:
        v = props.get(k)
        if v is not None:
            return v
    return default


def parse_ts(val):
    if not val:
        return None
    try:
        return datetime.fromisoformat(val.replace("Z", "+00:00"))
    except Exception:
        return None


def point_wkt(coords):
    """Converte [x, y] in WKT POINT per EPSG:2056."""
    return f"SRID=2056;POINT({coords[0]} {coords[1]})"


def load_ospedali(cur, features):
    sql = """
        INSERT INTO ospedali (
            osm_id, osm_type, amenity, name, short_name, official_name,
            alt_name, old_name, operator, operator_type, emergency, capacity,
            wheelchair, healthcare_spec, ref_fr_finess, type_fr_finess,
            ref_fr_naf, ref_fr_siret, phone, contact_phone, fax, email,
            website, addr_housenumber, addr_street, addr_city, addr_postcode,
            opening_hours, wikidata, wikipedia, description, source, note,
            osm_version, osm_timestamp, geom, geom_wgs84
        ) VALUES (
            %s,%s,%s,%s,%s,%s,
            %s,%s,%s,%s,%s,%s,
            %s,%s,%s,%s,
            %s,%s,%s,%s,%s,%s,
            %s,%s,%s,%s,%s,
            %s,%s,%s,%s,%s,%s,
            %s,%s,
            ST_GeomFromEWKT(%s),
            ST_Transform(ST_GeomFromEWKT(%s), 4326)
        )
    """
    rows = 0
    for feat in features:
        p = feat.get("properties", {})
        coords = feat["geometry"]["coordinates"]
        wkt = point_wkt(coords)
        cur.execute(sql, (
            p.get("osm_id"), p.get("osm_type"), p.get("amenity"),
            p.get("name"), p.get("short_name"), p.get("official_name"),
            p.get("alt_name"), p.get("old_name"), p.get("operator"),
            p.get("operator-type"), p.get("emergency"), p.get("capacity"),
            p.get("wheelchair"), p.get("healthcare-speciality"),
            p.get("ref-FR-FINESS"), p.get("type-FR-FINESS"),
            p.get("ref-FR-NAF"), p.get("ref-FR-SIRET"),
            get(p, "phone", "contact-phone"),
            p.get("contact-phone"), p.get("fax"),
            get(p, "email", "contact-email"),
            get(p, "contact-website", "url"),
            p.get("addr-housenumber"), p.get("addr-street"),
            p.get("addr-city"), p.get("addr-postcode"),
            p.get("opening_hours"), p.get("wikidata"), p.get("wikipedia"),
            p.get("description"), p.get("source"), p.get("note"),
            p.get("osm_version"), parse_ts(p.get("osm_timestamp")),
            wkt, wkt
        ))
        rows += 1
    return rows


def load_polizia(cur, features, sorgente):
    sql = """
        INSERT INTO stazioni_polizia (
            osm_id, osm_type, fid, code, fclass, amenity, name,
            short_name, official_name, alt_name, old_name, operator,
            operator_type, police_fr, ref_gendarmerie, emergency,
            emergency_phone, military, office, seasonal, wheelchair,
            phone, contact_phone, fax, email, website,
            addr_housenumber, addr_street, addr_city, addr_postcode, addr_full,
            opening_hours, wikidata, wikipedia, description, source, note,
            osm_version, osm_timestamp, sorgente, geom, geom_wgs84
        ) VALUES (
            %s,%s,%s,%s,%s,%s,%s,
            %s,%s,%s,%s,%s,
            %s,%s,%s,%s,
            %s,%s,%s,%s,%s,
            %s,%s,%s,%s,%s,
            %s,%s,%s,%s,%s,
            %s,%s,%s,%s,%s,%s,
            %s,%s,%s,
            ST_GeomFromEWKT(%s),
            ST_Transform(ST_GeomFromEWKT(%s), 4326)
        )
    """
    rows = 0
    for feat in features:
        p = feat.get("properties", {})
        coords = feat["geometry"]["coordinates"]
        wkt = point_wkt(coords)
        cur.execute(sql, (
            p.get("osm_id"), p.get("osm_type"),
            str(p.get("fid", "")), str(p.get("code", "")), p.get("fclass"),
            p.get("amenity"), p.get("name"),
            p.get("short_name"), p.get("official_name"),
            p.get("alt_name"), p.get("old_name"), p.get("operator"),
            p.get("operator-type"), p.get("police-FR"),
            p.get("ref-FR-GendarmerieNationale"), p.get("emergency"),
            p.get("emergency_phone"), p.get("military"), p.get("office"),
            p.get("seasonal"), p.get("wheelchair"),
            get(p, "phone", "contact-phone"), p.get("contact-phone"),
            p.get("fax"),
            get(p, "email", "contact-email"),
            get(p, "website", "contact-website", "url"),
            p.get("addr-housenumber"), p.get("addr-street"),
            p.get("addr-city"), p.get("addr-postcode"), p.get("addr-full"),
            p.get("opening_hours"), p.get("wikidata"), p.get("wikipedia"),
            p.get("description"), p.get("source"), p.get("note"),
            p.get("osm_version"), parse_ts(p.get("osm_timestamp")),
            sorgente, wkt, wkt
        ))
        rows += 1
    return rows


def load_pompieri(cur, features):
    sql = """
        INSERT INTO stazioni_pompieri (
            osm_id, fid, code, fclass, name, geom, geom_wgs84
        ) VALUES (
            %s,%s,%s,%s,%s,
            ST_GeomFromEWKT(%s),
            ST_Transform(ST_GeomFromEWKT(%s), 4326)
        )
    """
    rows = 0
    for feat in features:
        p = feat.get("properties", {})
        coords = feat["geometry"]["coordinates"]
        wkt = point_wkt(coords)
        cur.execute(sql, (
            p.get("osm_id"), str(p.get("fid", "")),
            str(p.get("code", "")), p.get("fclass"), p.get("name"),
            wkt, wkt
        ))
        rows += 1
    return rows


def main():
    print("Connessione al database...")
    conn = psycopg2.connect(**DB_CONFIG)
    conn.autocommit = False
    cur = conn.cursor()

    try:
        print("Caricamento ospedali...")
        features = load_json(FILE_PATHS["hospital"])
        n = load_ospedali(cur, features)
        print(f"  → {n} ospedali inseriti")

        print("Caricamento polizia (v1)...")
        features = load_json(FILE_PATHS["police"])
        n = load_polizia(cur, features, "police_v1")
        print(f"  → {n} stazioni polizia (v1) inserite")

        print("Caricamento polizia (v2)...")
        features = load_json(FILE_PATHS["police_v2"])
        n = load_polizia(cur, features, "police_v2")
        print(f"  → {n} stazioni polizia (v2) inserite")

        print("Caricamento stazioni pompieri...")
        features = load_json(FILE_PATHS["fire_station"])
        n = load_pompieri(cur, features)
        print(f"  → {n} stazioni pompieri inserite")

        conn.commit()
        print("\n Caricamento completato con successo!")

    except Exception as e:
        conn.rollback()
        print(f"\n Errore: {e}")
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    main()
