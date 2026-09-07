#!/usr/bin/env python3
"""
etl_switrs.py — load per-county SWITRS CSVs -> staging -> aggregate -> rollups.

See supabase/README.md and switrs-pull-spec.md for the full workflow. This is a
one-shot bulk loader: export Crashes/Parties/Victims per county from TIMS, drop
them in ./data/, then run this. Rates are derived at render — never stored here.

Usage:
    export SUPABASE_DB_URL="postgresql://...supabase-direct-connection..."
    python supabase/etl_switrs.py            # load ./data/*.csv, then aggregate
    python supabase/etl_switrs.py --agg-only # re-run aggregations on existing staging

Env:
    SUPABASE_DB_URL   direct Postgres connection string (service role / direct).
"""
import glob
import os
import sys

import psycopg2

DSN = os.environ.get("SUPABASE_DB_URL") or os.environ.get("DATABASE_URL")

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get("SWITRS_DATA_DIR", os.path.join(HERE, "data"))

# Native SWITRS column names present in the TIMS CSV exports we load. Import the
# rest if you want the option later — only these feed the rollups.
CRASH_COLS = [
    "case_id", "accident_year", "collision_time", "day_of_week", "city", "county",
    "primary_rd", "secondary_rd", "intersection", "collision_severity",
    "number_killed", "number_injured", "count_severe_inj",
    "count_ped_killed", "count_ped_injured", "count_bicyclist_killed",
    "count_bicyclist_injured", "count_mc_killed", "count_mc_injured",
    "truck_accident", "alcohol_involved", "pcf_viol_category",
]
PARTY_COLS = ["case_id", "party_drug_physical", "inattention", "oaf_1", "oaf_2"]
VICTIM_COLS = ["case_id", "party_number", "victim_age",
               "victim_degree_of_injury", "victim_safety_equip_1"]


def copy_csv(cur, path, table, cols):
    """COPY one CSV into a staging table, treating empty strings as NULL."""
    print(f"  COPY {os.path.basename(path)} -> {table}")
    with open(path, encoding="utf-8-sig") as f:
        cur.copy_expert(
            f"COPY {table} ({','.join(cols)}) FROM STDIN "
            f"WITH (FORMAT csv, HEADER true, FORCE_NULL ({','.join(cols)}))",
            f,
        )


def run_sql_file(cur, path):
    print(f"  RUN {os.path.relpath(path, HERE)}")
    with open(path, encoding="utf-8") as f:
        cur.execute(f.read())


def main():
    if not DSN:
        sys.exit("Set SUPABASE_DB_URL (or DATABASE_URL) to the Postgres connection string.")

    agg_only = "--agg-only" in sys.argv

    with psycopg2.connect(DSN) as conn, conn.cursor() as cur:
        # Ensure schema exists (idempotent).
        run_sql_file(cur, os.path.join(HERE, "migrations", "0001_switrs_accident_data.sql"))

        if not agg_only:
            print("Loading staging tables...")
            cur.execute("truncate switrs_crashes_raw, switrs_parties_raw, switrs_victims_raw")
            for p in sorted(glob.glob(os.path.join(DATA_DIR, "crashes_*.csv"))):
                copy_csv(cur, p, "switrs_crashes_raw", CRASH_COLS)
            for p in sorted(glob.glob(os.path.join(DATA_DIR, "parties_*.csv"))):
                copy_csv(cur, p, "switrs_parties_raw", PARTY_COLS)
            for p in sorted(glob.glob(os.path.join(DATA_DIR, "victims_*.csv"))):
                copy_csv(cur, p, "switrs_victims_raw", VICTIM_COLS)
            conn.commit()

        print("Running aggregations...")
        run_sql_file(cur, os.path.join(HERE, "sql", "aggregations.sql"))
        conn.commit()

    print("Done. Remember to set population (CA DOF / Census) and status "
          "(final/prov) per year — see supabase/README.md.")


if __name__ == "__main__":
    main()
