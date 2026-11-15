"""AI service (Flask). Endpoints: GET /health, GET /status, POST /train, POST /predict.
Run:  python3 app.py   (default port 5001)
"""
import os, threading
import joblib
import numpy as np
import pandas as pd
from flask import Flask, jsonify, request

import train as trainer

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(HERE, "model", "model.joblib")
app = Flask(__name__)
_lock = threading.Lock()
_bundle = None


def load_bundle():
    global _bundle
    if os.path.exists(MODEL_PATH):
        _bundle = joblib.load(MODEL_PATH)
    return _bundle


def risk_band(prob, expected):
    if prob >= 0.5 or expected >= 0.9:
        return "high"
    if prob >= 0.2 or expected >= 0.6:
        return "medium"
    return "low"


@app.get("/health")
def health():
    return jsonify(ok=True, model_loaded=_bundle is not None)


@app.get("/status")
def status():
    if _bundle is None:
        return jsonify(trained=False, message="Model not trained yet. POST /train or run train.py"), 200
    return jsonify(trained=True, **_bundle["metrics"])


@app.post("/train")
def train_route():
    body = request.get_json(silent=True) or {}
    try:
        with _lock:
            csv = body.get("datasetPath")
            if body.get("rows"):                        # train from rows posted by the backend
                tmp = os.path.join(HERE, "data", "_uploaded.csv")
                pd.DataFrame(body["rows"]).to_csv(tmp, index=False)
                csv = tmp
            metrics = trainer.train(csv)
            load_bundle()
        return jsonify(message="Model trained", metrics=metrics)
    except Exception as e:  # noqa: BLE001
        return jsonify(message="Training failed", detail=str(e)), 400


@app.post("/predict")
def predict():
    if _bundle is None:
        return jsonify(supported=False, reason="model_not_trained"), 200
    b = _bundle
    d = request.get_json(silent=True) or {}
    key = d.get("equipmentKey")
    if key not in b["type_codes"]:
        return jsonify(supported=False, reason="equipment_type_not_in_training_data"), 200

    try:
        nominal = float(d["pointValue"])
        row = dict(
            instrument_age_months=float(d.get("ageMonths", 24)),
            days_since_last_calibration=float(d.get("daysSinceCal", 180)),
            usage_hours_since_last_cal=float(d.get("usageHours", 500)),
            ambient_temperature_c=float(d.get("ambientTempC", 22)),
            ambient_humidity_pct=float(d.get("humidityPct", 50)),
            previous_calibration_result=str(d.get("previousResult", "pass")),
        )
    except (KeyError, TypeError, ValueError):
        return jsonify(message="pointValue and numeric context fields are required"), 400

    lo_r, hi_r = b["ranges"][key]
    df = pd.DataFrame([dict(equipment_type=key, nominal_value=nominal, range_min=lo_r, range_max=hi_r, **row)])
    X = trainer.build_features(df, b["type_codes"])

    # Clamp inputs to the range the model was trained on and tell the caller if we had to.
    extrapolated = []
    for c, (mn, mx) in b["feature_bounds"].items():
        v = float(X[c].iloc[0])
        if v < mn or v > mx:
            extrapolated.append(c)
            X[c] = min(max(v, mn), mx)

    mid = float(np.clip(b["mid"].predict(X)[0], 0, 5))
    lo = float(min(np.clip(b["lo"].predict(X)[0], 0, 5), mid))
    hi = float(max(np.clip(b["hi"].predict(X)[0], 0, 5), mid))
    prob = float(b["clf"].predict_proba(X)[0, 1])

    out = dict(
        supported=True,
        expected_error_ratio=round(mid, 3),
        interval_80=[round(lo, 3), round(hi, 3)],
        prob_out_of_tolerance=round(prob, 3),
        risk_band=risk_band(prob, mid),
        inputs_clamped=extrapolated,
        model_trained_at=b["metrics"]["trained_at"],
        model_mae=b["metrics"]["mae_error_ratio"],
    )

    # Optional consistency check of the actual reading against the model's expectation
    if d.get("observedErrorRatio") is not None:
        obs = float(d["observedErrorRatio"])
        if obs > 5 * max(hi, 0.5):
            out["consistency"] = "implausible"
        elif obs > hi * 1.5 + 0.25:
            out["consistency"] = "unusual"
        else:
            out["consistency"] = "typical"
    return jsonify(out)


load_bundle()
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5001)))
