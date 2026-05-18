# Méthode — Calcul des temps d'intervention, Canton de Fribourg

## 1. Principe général

Le projet vise à calculer les **isochrones** — zones géographiques atteignables
en moins de 8, 10 et 15 minutes — depuis chaque service d'urgence
(hôpitaux et postes de police) du canton de Fribourg.

Les zones **non couvertes** par aucun service dans le délai cible sont appelées
**zones blanches**. On y quantifie la population exposée grâce aux données OFS.

---

## 2. Données utilisées

| Source | Contenu | Format | Accès |
|---|---|---|---|
| OpenStreetMap / OSMnx | Réseau routier Fribourg | GraphML → PostGIS | Gratuit |
| `hospitals_point.csv` | Hôpitaux (OSM) | CSV WKT LV95 | Fourni |
| `police_point.csv` | Postes de police (OSM) | CSV WKT LV95 | Fourni |
| OFS STATPOP 2023 | Population 100m × 100m | CSV / GPKG | Gratuit |
| swisstopo swissBOUNDARIES3D | Limites cantonales | GPKG | Gratuit |

---

## 3. Système de coordonnées

Tout le projet utilise **CH1903+ / LV95 (SRID 2056)**.

- Les distances sont en **mètres**
- Les surfaces en **km²**
- Les coordonnées des sources sont en LV95 (X ~ 2 500 000, Y ~ 1 100 000)

---

## 4. Calcul des vitesses

Le coût de chaque arc routier est calculé en **secondes** :

```
coût (s) = longueur (m) / vitesse (m/s)
vitesse (m/s) = vitesse_kmh × 1000 / 3600
```

Vitesses par type de route (valeurs standard Suisse) :

| Type | Vitesse (km/h) |
|---|---|
| Autoroute (motorway) | 110 |
| Route nationale (trunk) | 90 |
| Route principale (primary) | 70 |
| Route secondaire (secondary) | 60 |
| Route cantonale (tertiary) | 50 |
| Zone résidentielle | 30 |
| Zone de rencontre | 20 |

---

## 5. pgr_drivingDistance

La fonction pgRouting utilisée est `pgr_drivingDistance` :

```sql
SELECT node, agg_cost
FROM pgr_drivingDistance(
    'SELECT gid AS id, source, target,
            cost_s AS cost, reverse_cost_s AS reverse_cost
     FROM reseau.ways',
    <nœud_source>,    -- nœud du réseau le plus proche de la caserne
    <seuil_secondes>, -- 8×60=480, 10×60=600, 15×60=900
    directed := TRUE
)
```

Cette fonction retourne tous les **nœuds du graphe** atteignables
depuis la source en moins de `seuil_secondes` secondes.

---

## 6. Construction des isochrones (alpha-shape)

À partir des nœuds atteignables, on construit l'isochrone via
`ST_ConcaveHull` :

```sql
SELECT ST_ConcaveHull(ST_Collect(v.geom), 0.99)
FROM dd JOIN reseau.ways_vertices_pgr v ON dd.node = v.id
```

Le paramètre `0.99` contrôle la concavité :
- `1.0` = enveloppe convexe (hull classique)
- `0.99` = très légèrement concave (résultat réaliste)
- `< 0.90` = très concave (peut créer des artefacts)

---

## 7. Zones blanches

```sql
Zone blanche = ST_Difference(Périmètre_Canton, ST_Union(Isochrones))
```

On soustrait l'union de tous les isochrones (tous services confondus)
du polygone du canton pour obtenir les zones non couvertes.

---

## 8. Population exposée

La grille OFS STATPOP à 100m est intersectée avec les zones blanches :

```sql
SELECT SUM(pop_total)
FROM sources.population_grid
WHERE ST_Within(geom, zone_blanche.geom)
```

---

## 9. Limites et hypothèses

- Les vitesses sont des **valeurs moyennes** ; le trafic réel n'est pas modélisé
- Les sens interdits sont simplifiés (autoroutes = sens unique uniquement)
- Le réseau piéton/cyclable est exclu (`network_type = 'drive'`)
- Le périmètre cantonal utilise initialement une bbox approchée ;
  remplacer par le polygone swisstopo pour des résultats précis
- Les délais d'alerte et de mobilisation ne sont pas inclus

---

## 10. Améliorations possibles

- Intégrer les données de trafic réel (TomTom, Swisstopo)
- Modéliser les délais de mobilisation (+2 à +5 min selon le service)
- Différencier heure de pointe / nuit / week-end
- Simuler la fermeture ou l'ajout d'une caserne
- Interface web interactive (MapLibre GL JS + FastAPI)
