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

if __name__ == "__main__":
    deviations()
    print("wrote", OUT)
