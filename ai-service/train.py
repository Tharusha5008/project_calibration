"""Trains the drift-risk models and writes model/model.joblib + model/metrics.json.

What the AI predicts (and what it does NOT):
  - It estimates the EXPECTED error_ratio (error / MPE) for an instrument given its history
    (age, days since last calibration, usage, ambient conditions, previous calibration result),
    an 80% prediction interval, and the probability that it is already out of tolerance.
  - It never decides pass/fail. The pass/fail verdict is computed exactly by the backend from the
    real measurement: |measured - nominal| / MPE.

Usage:  python3 train.py [path/to/dataset.csv]
"""
import json, os, sys, time
import numpy as np
import pandas as pd
import joblib
from sklearn.ensemble import HistGradientBoostingRegressor, HistGradientBoostingClassifier
from sklearn.metrics import mean_absolute_error, r2_score, roc_auc_score, brier_score_loss
from sklearn.model_selection import train_test_split

HERE = os.path.dirname(os.path.abspath(__file__))
PREV = {"pass": 0, "adjusted": 1, "fail": 2}
NUM = ["point_rel", "instrument_age_months", "days_since_last_calibration", "usage_hours_since_last_cal",
       "ambient_temperature_c", "ambient_humidity_pct", "prev"]
FEATURES = ["type_code"] + NUM


def build_features(df, type_codes):
    X = pd.DataFrame(index=df.index)
    X["type_code"] = df["equipment_type"].map(type_codes).astype(int)
    span = (df["range_max"] - df["range_min"]).replace(0, 1)
    X["point_rel"] = ((df["nominal_value"] - df["range_min"]) / span).clip(0, 1)
    for c in NUM[1:6]:
        X[c] = df[c]
    X["prev"] = df["previous_calibration_result"].map(PREV).fillna(0).astype(int)
    return X[FEATURES]


def train(csv_path=None):
    csv_path = csv_path or os.path.join(HERE, "data", "calibration_dataset.csv")
    df = pd.read_csv(csv_path)
    needed = {"equipment_type", "nominal_value", "error_ratio", "range_min", "range_max",
              "instrument_age_months", "days_since_last_calibration", "usage_hours_since_last_cal",
              "ambient_temperature_c", "ambient_humidity_pct", "previous_calibration_result"}
    missing = needed - set(df.columns)
    if missing:
        raise ValueError(f"dataset is missing columns: {sorted(missing)}")
    df = df.dropna(subset=list(needed))
    # Guard against corrupted training rows (the root cause of wild predictions): ratios are fractions.
    df = df[(df["error_ratio"] >= 0) & (df["error_ratio"] <= 10)]

    types = sorted(df["equipment_type"].unique())
    type_codes = {t: i for i, t in enumerate(types)}
    X = build_features(df, type_codes)
    y = df["error_ratio"].clip(upper=5.0)
    y_cls = (df["error_ratio"] >= 1.0).astype(int)

    # stratify by type so every instrument appears in both splits
    Xtr, Xte, ytr, yte, ctr, cte = train_test_split(X, y, y_cls, test_size=0.2, random_state=7,
                                                   stratify=df["equipment_type"])
    cat = [True] + [False] * (len(FEATURES) - 1)
    kw = dict(max_iter=250, learning_rate=0.06, max_depth=6, min_samples_leaf=30,
              categorical_features=cat, random_state=0)

    t0 = time.time()
    mid = HistGradientBoostingRegressor(loss="squared_error", **kw).fit(Xtr, ytr)
    lo = HistGradientBoostingRegressor(loss="quantile", quantile=0.10, **kw).fit(Xtr, ytr)
    hi = HistGradientBoostingRegressor(loss="quantile", quantile=0.90, **kw).fit(Xtr, ytr)
    clf = HistGradientBoostingClassifier(**kw).fit(Xtr, ctr)

    p_mid = np.clip(mid.predict(Xte), 0, 5)
    p_lo, p_hi = np.minimum(lo.predict(Xte), p_mid), np.maximum(hi.predict(Xte), p_mid)
    p_cls = clf.predict_proba(Xte)[:, 1]
    base = np.full(len(yte), ytr.mean())

    per_type = {}
    for t in types:
        m = (df.loc[Xte.index, "equipment_type"] == t).values
        per_type[t] = dict(mae=round(float(mean_absolute_error(yte[m], p_mid[m])), 4),
                           samples=int(m.sum()))

    metrics = dict(
        trained_at=time.strftime("%Y-%m-%d %H:%M:%S"),
        dataset=os.path.basename(csv_path), rows=int(len(df)), types=types,
        holdout_rows=int(len(yte)),
        mae_error_ratio=round(float(mean_absolute_error(yte, p_mid)), 4),
        baseline_mae=round(float(mean_absolute_error(yte, base)), 4),
        r2=round(float(r2_score(yte, p_mid)), 4),
        auc_out_of_tolerance=round(float(roc_auc_score(cte, p_cls)), 4),
        brier=round(float(brier_score_loss(cte, p_cls)), 4),
        interval_80_coverage=round(float(((yte >= p_lo) & (yte <= p_hi)).mean()), 4),
        out_of_tolerance_rate=round(float(y_cls.mean()), 4),
        per_type=per_type,
        note=("Metrics are measured on a held-out 20% split. Error is expressed as a fraction of MPE "
              "(0.10 = 10% of tolerance). Dataset is synthetic unless replaced with real lab history."),
        train_seconds=round(time.time() - t0, 1),
    )
    joblib.dump(dict(mid=mid, lo=lo, hi=hi, clf=clf, type_codes=type_codes,
                     ranges={t: (float(df[df.equipment_type == t]["range_min"].iloc[0]),
                                 float(df[df.equipment_type == t]["range_max"].iloc[0])) for t in types},
                     feature_bounds={c: (float(X[c].min()), float(X[c].max())) for c in NUM},
                     metrics=metrics), os.path.join(HERE, "model", "model.joblib"))
    json.dump(metrics, open(os.path.join(HERE, "model", "metrics.json"), "w"), indent=1)
    return metrics


if __name__ == "__main__":
    m = train(sys.argv[1] if len(sys.argv) > 1 else None)
    print(json.dumps({k: v for k, v in m.items() if k != "per_type"}, indent=1))
    print("per-type MAE:", {k: v["mae"] for k, v in m["per_type"].items()})
