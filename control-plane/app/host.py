"""Host resource utilization (CPU / memory / disk) for the Overview dashboard.

Reads the *node's* /proc and root filesystem, which are bind-mounted read-only
into the pod (see deploy/k8s/50-control-plane.yaml). Falls back to the pod's own
view if those host mounts are absent (e.g. local docker-compose).
"""
import os
import time

PROC = "/host/proc" if os.path.exists("/host/proc/stat") else "/proc"
ROOT = "/host/root" if os.path.isdir("/host/root") else "/"


def _cpu_sample():
    with open(f"{PROC}/stat") as f:
        vals = [int(x) for x in f.readline().split()[1:]]
    idle = vals[3] + (vals[4] if len(vals) > 4 else 0)   # idle + iowait
    return sum(vals), idle


def _cpu_pct():
    t1, i1 = _cpu_sample()
    time.sleep(0.25)
    t2, i2 = _cpu_sample()
    dt = t2 - t1
    return round((1 - (i2 - i1) / dt) * 100, 1) if dt > 0 else 0.0


def _mem():
    info = {}
    with open(f"{PROC}/meminfo") as f:
        for line in f:
            k, _, v = line.partition(":")
            info[k] = int(v.split()[0]) * 1024            # kB → bytes
    total = info.get("MemTotal", 0)
    avail = info.get("MemAvailable", info.get("MemFree", 0))
    used = total - avail
    return {"used": used, "total": total, "pct": round(used / total * 100, 1) if total else 0.0}


def _disk():
    st = os.statvfs(ROOT)
    total = st.f_blocks * st.f_frsize
    used = total - st.f_bavail * st.f_frsize
    return {"used": used, "total": total, "pct": round(used / total * 100, 1) if total else 0.0}


def stats():
    try:
        return {
            "cpu": _cpu_pct(), "mem": _mem(), "disk": _disk(),
            "source": "host" if PROC.startswith("/host") else "pod",
        }
    except Exception as e:
        return {"error": str(e)}
