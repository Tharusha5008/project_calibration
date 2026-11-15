"""Generates a SAMPLE calibration dataset for the 10 instrument types in shared/equipment-catalog.json.

IMPORTANT - this is synthetic data. It encodes plausible metrology behaviour (instruments drift with
time since calibration, usage, age, temperature stress and a previous failed calibration) so the
pipeline can be demonstrated end to end. Replace data/calibration_dataset.csv with your lab's real
historical readings (same columns) and re-run train.py - nothing else needs to change.

Column notes
  nominal_value     the reference (standard) value applied to the instrument
  measured_value    what the instrument displayed
  measured_error    measured_value - nominal_value
  mpe               Maximum Permissible Error at that point (same unit)
  error_ratio       |measured_error| / mpe   (a FRACTION: 1.0 == exactly at the limit; 0.5 == half the limit)
  needs_calibration 1 when error_ratio >= 1
"""
import json, os
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
CATALOG = json.load(open(os.path.join(HERE, "..", "shared", "equipment-catalog.json")))
ROWS_PER_TYPE = 1500
rng = np.random.default_rng(42)

# Per-type behaviour: stability (lower = more stable), temperature sensitivity, usage sensitivity, resolution
PROFILE = {
    "vernier_caliper": dict(stab=0.9, temp=0.10, use=0.9, res=0.01),
    "micrometer":      dict(stab=0.8, temp=0.20, use=0.8, res=0.001),
    "pressure_gauge":  dict(stab=1.0, temp=0.15, use=1.2, res=0.01),
    "thermometer":     dict(stab=0.9, temp=0.10, use=0.6, res=0.1),
    "digital_scale":   dict(stab=1.0, temp=0.35, use=1.1, res=0.1),
    "torque_wrench":   dict(stab=1.2, temp=0.05, use=1.5, res=0.1),
    "multimeter":      dict(stab=0.7, temp=0.25, use=0.5, res=0.001),
    "ph_meter":        dict(stab=1.6, temp=0.45, use=1.0, res=0.01),
    "flow_meter":      dict(stab=1.1, temp=0.10, use=1.3, res=0.01),
    "strain_gauge":    dict(stab=1.3, temp=0.50, use=0.9, res=0.1),
}

rows = []
for eq in CATALOG:
    p = PROFILE[eq["key"]]
    lo, hi = eq["range"]
    n = ROWS_PER_TYPE
    pt_idx = rng.integers(0, len(eq["points"]), n)
    age = rng.integers(1, 121, n)
    days = rng.integers(5, 721, n)
    usage = np.round(days * rng.uniform(0.4, 7.0, n), 0)
    temp = np.clip(rng.normal(22, 5, n), 8, 40)
    hum = np.clip(rng.normal(50, 14, n), 15, 90)
    # previous result gets worse for old instruments
    pf = 0.04 + 0.12 * (age / 120)
    pa = 0.18
    u = rng.random(n)
    prev = np.where(u < pf, "fail", np.where(u < pf + pa, "adjusted", "pass"))
    prev_w = np.where(prev == "fail", 0.30, np.where(prev == "adjusted", 0.10, 0.0))

    expected = (0.10
                + p["stab"] * 0.34 * (days / 365)
                + p["use"] * 0.20 * (usage / 3000)
                + 0.12 * (age / 60)
                + p["temp"] * np.abs(temp - 20) / 10
                + 0.0015 * np.maximum(hum - 65, 0)
                + prev_w)
    # per-reading noise: multiplicative, so unstable instruments scatter more
    ratio_mag = 0.64 * expected * rng.lognormal(0, 0.40, n)
    sign = np.where(rng.random(n) < 0.62, 1.0, -1.0)   # drift tends to go one way

    for i in range(n):
        pt = eq["points"][pt_idx[i]]
        nominal, mpe = pt["value"], pt["mpe"]
        err = sign[i] * ratio_mag[i] * mpe
        measured = round(round((nominal + err) / p["res"]) * p["res"], 4)
        err_q = round(measured - nominal, 5)
        ratio = round(abs(err_q) / mpe, 4)
        rows.append(dict(
            equipment_type=eq["key"], unit=eq["unit"], standard_reference=eq["standard"],
            nominal_value=nominal, measured_value=measured, measured_error=err_q, mpe=mpe,
            error_ratio=ratio, needs_calibration=int(ratio >= 1.0),
            instrument_age_months=int(age[i]), days_since_last_calibration=int(days[i]),
            usage_hours_since_last_cal=float(usage[i]), ambient_temperature_c=round(float(temp[i]), 1),
            ambient_humidity_pct=round(float(hum[i]), 1), previous_calibration_result=prev[i],
            range_min=lo, range_max=hi,
        ))

df = pd.DataFrame(rows).sample(frac=1, random_state=1).reset_index(drop=True)
out = os.path.join(HERE, "data", "calibration_dataset.csv")
df.to_csv(out, index=False)
print(f"{len(df)} rows -> {out}")
print(df.groupby("equipment_type").agg(rows=("error_ratio", "size"),
      mean_ratio=("error_ratio", "mean"), out_of_tol=("needs_calibration", "mean")).round(3))
