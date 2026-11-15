"""Builds shared/equipment-catalog.json - the single source of truth for the 10 instrument
types, their standard (reference) test points and per-point Maximum Permissible Error (MPE).
Run:  python3 shared/build_catalog.py
"""
import json, os

def pts(values, mpe):
    f = mpe if callable(mpe) else (lambda v: mpe)
    return [{"value": v, "mpe": round(f(v), 4)} for v in values]

C = [
 dict(key="vernier_caliper", name="Vernier Caliper", unit="mm", decimals=2, range=[0, 150],
  standard="ISO 13385-1 / DIN 862", reference_tool="Grade 1 steel gauge blocks (ISO 3650)",
  points=pts([10, 25, 50, 100, 150], lambda v: 0.02 if v <= 100 else 0.03),
  read_label="Jaw scale / digital display reading",
  steps=["Clean the measuring faces and the gauge block with a lint-free cloth.",
         "Close the jaws gently on the reference gauge block (do not force).",
         "Lock the slider screw, then read the scale at the highlighted marker.",
         "Enter the displayed length below."]),
 dict(key="micrometer", name="Outside Micrometer", unit="mm", decimals=3, range=[0, 25],
  standard="ISO 3611 / DIN 863-1", reference_tool="Grade 0 gauge blocks (ISO 3650)",
  points=pts([5, 10, 15, 20, 25], 0.004),
  read_label="Barrel + thimble reading",
  steps=["Wipe the anvil and spindle faces; check zero at 0 mm.",
         "Place the gauge block between anvil and spindle.",
         "Turn the ratchet until it clicks 3 times - never turn the thimble directly.",
         "Read the barrel and thimble at the highlighted marker and enter the value."]),
 dict(key="pressure_gauge", name="Pressure Gauge (0-10 bar)", unit="bar", decimals=2, range=[0, 10],
  standard="EN 837-1 (Class 1.0)", reference_tool="Deadweight tester / digital pressure calibrator",
  points=pts([0, 2.5, 5, 7.5, 10], 0.1),
  read_label="Needle position on the dial",
  steps=["Connect the gauge to the pressure source with the correct fitting.",
         "Raise pressure slowly to the target point and tap the case lightly.",
         "Wait 30 s for the needle to settle.",
         "Read the needle against the dial scale at the highlighted marker."]),
 dict(key="thermometer", name="Digital Thermometer", unit="C", decimals=1, range=[0, 100],
  standard="IEC 60751 / ASTM E1", reference_tool="Dry-block calibrator with reference PRT",
  points=pts([0, 25, 50, 75, 100], 0.5),
  read_label="Stabilised temperature display",
  steps=["Insert the probe fully into the reference bath or dry-block well.",
         "Allow at least 3 minutes for thermal stabilisation.",
         "Read the value only when it changes less than 0.1 C per minute.",
         "Enter the displayed temperature."]),
 dict(key="digital_scale", name="Digital Weighing Scale", unit="g", decimals=1, range=[0, 5000],
  standard="OIML R76-1 (Class II)", reference_tool="Class F1 calibration weights (OIML R111)",
  points=pts([100, 500, 1000, 2000, 5000], lambda v: 0.1 if v <= 500 else (0.2 if v <= 2000 else 0.3)),
  read_label="Weight shown on the display",
  steps=["Level the scale and warm it up for 15 minutes; tare with an empty pan.",
         "Place the calibration weight in the centre of the pan using forceps.",
         "Wait for the stable indicator.",
         "Enter the displayed mass."]),
 dict(key="torque_wrench", name="Torque Wrench", unit="N.m", decimals=1, range=[20, 100],
  standard="ISO 6789-1:2017", reference_tool="Torque transducer / torque tester",
  points=pts([20, 40, 60, 80, 100], lambda v: v * 0.04),
  read_label="Torque at the click / display",
  steps=["Mount the wrench square drive on the torque tester.",
         "Pull smoothly and steadily at 90 degrees to the handle.",
         "Stop at the click (or when the display peaks).",
         "Enter the peak torque shown by the tester."]),
 dict(key="multimeter", name="Digital Multimeter (DC V)", unit="V", decimals=3, range=[0, 50],
  standard="IEC 61010-1 / manufacturer spec", reference_tool="Multi-product calibrator (5522A class)",
  points=pts([1, 5, 10, 20, 50], lambda v: v * 0.005 + 0.002),
  read_label="Main LCD display",
  steps=["Select the DC voltage range closest above the test point.",
         "Connect the test leads to the calibrator output (observe polarity).",
         "Apply the reference voltage and wait for the reading to settle.",
         "Enter the value on the multimeter display."]),
 dict(key="ph_meter", name="pH Meter", unit="pH", decimals=2, range=[2, 12],
  standard="IUPAC / NIST-traceable buffers", reference_tool="Certified buffer solutions at 25 C",
  points=pts([4.01, 7.00, 10.01], 0.05),
  read_label="pH display",
  steps=["Rinse the electrode with deionised water and blot dry.",
         "Immerse it in the certified buffer at 25 C.",
         "Wait until the stable icon appears.",
         "Enter the pH value shown."]),
 dict(key="flow_meter", name="Flow Meter", unit="L/min", decimals=2, range=[0, 60],
  standard="ISO 4185 / OIML R117", reference_tool="Gravimetric flow rig / master meter",
  points=pts([5, 10, 20, 40, 60], lambda v: v * 0.02),
  read_label="Instantaneous flow-rate display",
  steps=["Run the flow rig until the line is fully primed (no air).",
         "Set the reference flow and wait 60 s for it to stabilise.",
         "Read the flow rate on the meter display.",
         "Enter the displayed flow rate."]),
 dict(key="strain_gauge", name="Strain Gauge Bridge", unit="ue", decimals=1, range=[0, 2000],
  standard="ASTM E251 / OIML R60", reference_tool="Shunt-calibration resistor + strain simulator",
  points=pts([250, 500, 1000, 1500, 2000], lambda v: 2 + v * 0.01),
  read_label="Strain indicator reading (microstrain)",
  steps=["Balance (zero) the Wheatstone bridge with no load applied.",
         "Apply the reference strain with the simulator or shunt resistor.",
         "Allow the amplifier to settle for 20 seconds.",
         "Enter the indicated microstrain (ue)."]),
]
for c in C:
    c["model3d"] = c["key"]
    for p in c["points"]:
        p["label"] = f"{p['value']:g} {c['unit']}"

out = os.path.join(os.path.dirname(__file__), "equipment-catalog.json")
json.dump(C, open(out, "w"), indent=1)
print(len(C), "instrument types written to", out)
