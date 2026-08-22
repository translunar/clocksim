#!/usr/bin/env python3
"""Generate committed test fixtures from allantools. Run from repo root:
    python3 -m venv .venv && .venv/bin/pip install -r tools/requirements.txt && .venv/bin/python tools/gen_fixtures.py
"""
import json, pathlib
import numpy as np
import allantools

OUT = pathlib.Path(__file__).resolve().parent.parent / "fixtures"
OUT.mkdir(exist_ok=True)

def deviations():
    rng = np.random.default_rng(12345)
    n, dt = 4096, 0.5
    y = 1e-3 * rng.standard_normal(n) + 2e-5 * np.cumsum(rng.standard_normal(n))
    x = np.concatenate([[0.0], np.cumsum(y) * dt])       # phase, length n+1
    ms = [1, 2, 4, 8, 16, 32, 64, 128, 256]
    taus = [m * dt for m in ms]
    out = {"dt": dt, "ms": ms, "y": y.tolist(), "x": x.tolist()}
    for name, fn in [("oadev", allantools.oadev), ("mdev", allantools.mdev), ("ohdev", allantools.ohdev)]:
        t, d, _, nn = fn(x, rate=1.0 / dt, data_type="phase", taus=taus)
        out[name] = {"tau": t.tolist(), "dev": d.tolist(), "n": [int(v) for v in nn]}
    (OUT / "deviations.json").write_text(json.dumps(out))

def bayard():
    """Direct transcription of translunar/bayard references/bayard_calc.m for jpl_mimu + BCT tracker."""
    d2r = np.pi / 180; as2d = 1 / 3600
    random_walk = 0.025 / 3 * (1 / 60) * d2r          # rad/sqrt(s)
    bias_stability = 0.05 / 3 * as2d * d2r             # rad/s
    q1 = random_walk ** 2
    q2 = bias_stability ** 2 / 3600                    # the 1-hour fudge
    nea = 333e-6; delta = 0.2; b = 60 * as2d * d2r
    r = delta * nea ** 2
    l = np.sqrt(q1 + 2 * np.sqrt(r * q2))
    p11 = np.sqrt(r) * l; p12 = np.sqrt(r * q2); p22 = np.sqrt(q2) * l
    ts = [1.0, 60.0, 600.0, 3600.0, 36000.0]
    p = [q2 / 3 * t ** 3 + p22 * t ** 2 + (2 * p12 + q1) * t + p11 + b ** 2 for t in ts]
    (OUT / "bayard.json").write_text(json.dumps({
        "N": random_walk, "B": bias_stability, "Tfudge": 3600.0, "nea": nea, "delta": delta, "b": b,
        "p11": p11, "p12": p12, "p22": p22, "t": ts, "sigma": [float(np.sqrt(v)) for v in p]}))


if __name__ == "__main__":
    deviations()
    bayard()
    print("wrote", OUT)
