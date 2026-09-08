#!/usr/bin/env python3
"""
seed_to_json.py — convert supabase/seed_real.sql into per-city static JSON files
for the no-database accident-data hub.

Reads the six `insert into ... values (...)` statements in seed_real.sql and
emits data/accident/<stateSlug>/<citySlug>.json in the canonical render-shape
contract (see data/accident/california/downey.json). The app's
lib/get-accident-data.ts reads these directly — no Supabase required.

City files are named by the site's routing slug (from data/states/<state>-cities.json)
so they line up with the [city] route param. Run from the repo root:

    python supabase/seed_to_json.py

Idempotent: overwrites the JSON files each run.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SEED = os.path.join(HERE, "seed_real.sql")
STATE_SLUG = "california"
STATE_ABBR = "CA"
OUT_DIR = os.path.join(ROOT, "data", "accident", STATE_SLUG)
SOURCE = "CCRS via data.ca.gov + CA city population"

CITY_YEAR_COLS = [
    "city", "county", "year", "status", "population", "lat", "lng", "elevation_ft",
    "fatal_crashes", "injury_crashes", "fatalities", "injuries", "serious_injuries",
    "occupant_f", "occupant_i", "ped_f", "ped_i", "bike_f", "bike_i", "moto_f", "moto_i",
    "older_f", "older_i", "unrestrained_f", "unrestrained_i", "alcohol_f", "alcohol_i",
    "drug_f", "drug_i", "distracted_f", "distracted_i", "speeding_f", "speeding_i",
]


def parse_values(section: str):
    """Parse a SQL `values (...),(...)` body into a list of tuples (python values)."""
    rows, i, n = [], 0, len(section)
    while i < n:
        if section[i] != "(":
            i += 1
            continue
        # parse one tuple
        i += 1
        fields, cur, in_str = [], [], False
        while i < n:
            c = section[i]
            if in_str:
                if c == "'":
                    if i + 1 < n and section[i + 1] == "'":  # escaped ''
                        cur.append("'")
                        i += 2
                        continue
                    in_str = False
                    i += 1
                    continue
                cur.append(c)
                i += 1
                continue
            if c == "'":
                in_str = True
                i += 1
                continue
            if c == ",":
                fields.append("".join(cur).strip())
                cur = []
                i += 1
                continue
            if c == ")":
                fields.append("".join(cur).strip())
                i += 1
                break
            cur.append(c)
            i += 1
        rows.append(fields)
    return rows


def coerce(v):
    if v == "" or v.lower() == "null":
        return None
    try:
        if re.fullmatch(r"-?\d+", v):
            return int(v)
        return float(v)
    except ValueError:
        return v


def extract(sql: str, table: str):
    """Return list of field-lists for `insert into <table> values ...;`."""
    m = re.search(r"insert\s+into\s+" + re.escape(table) + r"\s+values\s*(.*?);", sql, re.I | re.S)
    if not m:
        return []
    return [[coerce(x) for x in row] for row in parse_values(m.group(1))]


def fi(row, base):
    return {"f": row.get(base + "_f") or 0, "i": row.get(base + "_i") or 0}


def load_site_slugs():
    """city name -> routing slug, from data/states/<state>-cities.json."""
    path = os.path.join(ROOT, "data", "states", f"{STATE_SLUG}-cities.json")
    with open(path, encoding="utf-8-sig") as f:
        data = json.load(f)
    arr = data if isinstance(data, list) else next(v for v in data.values() if isinstance(v, list))
    out = {}
    for c in arr:
        if c.get("city") and c.get("slug"):
            out[c["city"].strip().lower()] = c["slug"]
    return out


def slugify(s: str) -> str:
    return re.sub(r"^-+|-+$", "", re.sub(r"[^a-z0-9]+", "-", s.lower().strip()))


def main():
    if not os.path.exists(SEED):
        sys.exit(f"Missing {SEED}")
    sql = open(SEED, encoding="utf-8").read()

    city_year = [dict(zip(CITY_YEAR_COLS, r)) for r in extract(sql, "city_year")]
    county_year = extract(sql, "county_year")      # county, year, population, injuries, fatalities
    state_year = extract(sql, "state_year")        # state, year, population, injuries, fatalities
    top_roads = extract(sql, "city_top_roads")     # city, rank, road, crashes, injuries, fatalities
    top_intx = extract(sql, "city_top_intersections")
    time_prof = extract(sql, "city_time_profile")  # city, dim, bucket, crashes

    # index helpers
    county_by = {}
    for county, year, pop, inj, fat in county_year:
        county_by.setdefault(county, []).append({"year": year, "population": pop, "injuries": inj, "fatalities": fat})
    state_rows = sorted(
        ({"year": y, "population": p, "injuries": inj, "fatalities": f} for (_s, y, p, inj, f) in state_year),
        key=lambda r: r["year"],
    )
    roads_by, intx_by = {}, {}
    for city, rank, road, cr, inj, fat in top_roads:
        roads_by.setdefault(city, []).append((rank, {"road": road, "crashes": cr, "injuries": inj, "fatalities": fat}))
    for city, rank, x, cr, inj, fat in top_intx:
        intx_by.setdefault(city, []).append((rank, {"intersection": x, "crashes": cr, "injuries": inj, "fatalities": fat}))
    hours_by, dow_by = {}, {}
    for city, dim, bucket, cr in time_prof:
        (hours_by if dim == "hour" else dow_by).setdefault(city, {})[bucket] = cr

    # group city_year by city
    years_by = {}
    meta_by = {}
    for r in city_year:
        city = r["city"]
        years_by.setdefault(city, []).append(r)
        meta_by[city] = r  # last wins; lat/lng/pop constant per city

    site_slugs = load_site_slugs()
    os.makedirs(OUT_DIR, exist_ok=True)
    written, unmatched = 0, []

    for city, rows in years_by.items():
        rows.sort(key=lambda r: r["year"])
        meta = meta_by[city]
        county = meta["county"]

        city_years = [{
            "year": r["year"], "status": r["status"], "population": r["population"],
            "fatalCrashes": r["fatal_crashes"], "injuryCrashes": r["injury_crashes"],
            "fatalities": r["fatalities"], "injuries": r["injuries"], "seriousInjuries": r["serious_injuries"],
            "occupant": fi(r, "occupant"), "pedestrian": fi(r, "ped"), "bicyclist": fi(r, "bike"),
            "motorcyclist": fi(r, "moto"), "olderAdult": fi(r, "older"), "unrestrained": fi(r, "unrestrained"),
            "alcohol": fi(r, "alcohol"), "drug": fi(r, "drug"), "distracted": fi(r, "distracted"),
            "speeding": fi(r, "speeding"),
        } for r in rows]

        hours = [hours_by.get(city, {}).get(h, 0) for h in range(24)]
        dow = [dow_by.get(city, {}).get(d, 0) for d in range(1, 8)]
        roads = [r[1] for r in sorted(roads_by.get(city, []), key=lambda t: t[0])]
        intx = [r[1] for r in sorted(intx_by.get(city, []), key=lambda t: t[0])]

        payload = {
            "city": city, "county": county, "state": STATE_ABBR, "source": SOURCE,
            "population": meta["population"], "lat": meta["lat"], "lng": meta["lng"],
            "elevation_ft": meta["elevation_ft"],
            "cityYears": city_years,
            "countyYears": sorted(county_by.get(county, []), key=lambda r: r["year"]),
            "stateYears": state_rows,
            "peak": {"hours": hours, "dow": dow},
            "topRoads": roads,
            "topIntersections": intx,
        }

        slug = site_slugs.get(city.strip().lower()) or slugify(city)
        if city.strip().lower() not in site_slugs:
            unmatched.append(city)
        with open(os.path.join(OUT_DIR, f"{slug}.json"), "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        written += 1

    print(f"wrote {written} city files to {os.path.relpath(OUT_DIR, ROOT)}")
    if unmatched:
        print(f"note: {len(unmatched)} seed cities not in the site slug list "
              f"(named by slugify fallback): {', '.join(sorted(unmatched)[:15])}"
              + (" ..." if len(unmatched) > 15 else ""))


if __name__ == "__main__":
    main()
