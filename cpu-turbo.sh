#!/usr/bin/env bash
# Intel P-state turbo toggle + useful heat reports.
set -euo pipefail

NO_TURBO="/sys/devices/system/cpu/intel_pstate/no_turbo"
MAX_PERF="/sys/devices/system/cpu/intel_pstate/max_perf_pct"
STATE_DIR="${XDG_RUNTIME_DIR:-/tmp}/cpu-turbo-${USER:-uid}"
BASELINE="$STATE_DIR/baseline.env"
AFTER30="$STATE_DIR/after30.env"
AFTER5M="$STATE_DIR/after5m.env"
DEFAULT_TJMAX=100

JSON_MODE=0

usage() {
  cat <<'EOF'
Usage: cpu-turbo.sh <apply on|apply off|compare 30s|compare 5m|status> [--json]

  apply on|off   Toggle turbo, print Report 1, save baseline
  compare 30s    Report 2: execution vs now (no wait)
  compare 5m     Report 3: execution vs +30s vs +5min (no wait)
  status         Current heat table only
  --json         Machine-readable JSON (status and apply; for the desktop widget)

The agent waits 30s then 5min from apply (two background sleeps).
EOF
}

die() {
  if [[ "${JSON_MODE:-0}" == "1" ]]; then
    python3 -c 'import json,sys; print(json.dumps({"ok":False,"error":sys.argv[1]},ensure_ascii=False))' "$*"
    exit 1
  fi
  echo "error: $*" >&2
  exit 1
}

mkdir -p "$STATE_DIR"

celsius_from_mC() {
  local path="$1"
  [[ -r "$path" ]] || return 1
  awk '{ printf "%.1f", $1 / 1000 }' "$path"
}

find_hwmon() {
  local want="$1" h
  for h in /sys/class/hwmon/hwmon*; do
    [[ -r "$h/name" ]] || continue
    [[ "$(cat "$h/name")" == "$want" ]] || continue
    printf '%s\n' "$h"
    return 0
  done
  return 1
}

find_thermal_zone() {
  local want="$1" z
  for z in /sys/class/thermal/thermal_zone*; do
    [[ -r "$z/type" ]] || continue
    [[ "$(cat "$z/type")" == "$want" ]] || continue
    printf '%s\n' "$z"
    return 0
  done
  return 1
}

mhz_from_khz() { awk -v v="$1" 'BEGIN { printf "%.0f", v / 1000 }'; }

turbo_word() {
  case "${1:-?}" in
    0) echo ON ;;
    1) echo OFF ;;
    *) echo unknown ;;
  esac
}

env_get() {
  local file="$1" key="$2"
  awk -F= -v k="$key" '$1==k {sub(/^[^=]*=/,""); print; exit}' "$file"
}

HELPER_ERROR=""

write_via_helper() {
  local path="$1" value="$2" sock py out rc
  [[ "$path" == "$NO_TURBO" ]] || return 1
  sock="${SNAP_COMMON:-}/turbo.sock"
  [[ -n "${SNAP_COMMON:-}" && -S "$sock" ]] || return 1
  py="${SNAP:-}/usr/bin/python3"
  [[ -x "$py" ]] || py="python3"
  out="$("$py" - "$sock" "no_turbo $value" 2>&1 <<'PYEOF'
import socket, sys
sock_path, msg = sys.argv[1], sys.argv[2]
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.settimeout(5)
try:
    s.connect(sock_path)
    s.sendall(msg.encode())
    reply = s.recv(64).decode("utf-8", "replace").strip()
finally:
    s.close()
if reply != "OK":
    print(reply or "ERR empty reply", file=sys.stderr)
    sys.exit(1)
PYEOF
)"
  rc=$?
  [[ $rc -eq 0 ]] && return 0
  HELPER_ERROR="$out"
  return 1
}

write_sysfs() {
  local path="$1" value="$2"
  [[ -e "$path" ]] || die "missing $path"
  if [[ -w "$path" ]]; then
    printf '%s\n' "$value" >"$path" || die "failed to write $value to $path"
    return 0
  fi
  HELPER_ERROR=""
  if write_via_helper "$path" "$value"; then
    return 0
  fi
  if [[ -n "$HELPER_ERROR" ]]; then
    die "cpu-turbo-widget-helper cannot write $path: $HELPER_ERROR. The cpu-control interface isn't connected yet — run this once:|FIXCMD|sudo snap connect cpu-turbo-widget:cpu-control && sudo snap connect cpu-turbo-widget:hardware-observe && sudo snap connect cpu-turbo-widget:system-observe"
  fi
  if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
    printf '%s\n' "$value" | sudo tee "$path" >/dev/null || die "sudo failed writing $value to $path"
    return 0
  fi
  die "cannot write $path (need passwordless sudo or root, and the cpu-turbo-widget-helper snap service is not running)"
}

collect_snapshot() {
  local out="$1"
  local turbo_raw package="" cpu="" ambient="" gpu="" skin="" pch="" tjmax="$DEFAULT_TJMAX"
  local coretemp dell zone i label val hot_core="" hot_temp=""
  local f sum=0 n=0 max=0 cur fan="" profile="n/a" epp="n/a" top=""
  local load1 load5 load15 freq_base="" freq_ceil=""

  turbo_raw="$(cat "$NO_TURBO" 2>/dev/null || echo "?")"

  if coretemp="$(find_hwmon coretemp)"; then
    package="$(celsius_from_mC "$coretemp/temp1_input" || true)"
    tjmax="$(celsius_from_mC "$coretemp/temp1_crit" || true)"
    [[ -n "$tjmax" ]] || tjmax="$DEFAULT_TJMAX"
    for i in 2 3 4 5 6 7 8 9; do
      [[ -r "$coretemp/temp${i}_input" ]] || continue
      label="$(cat "$coretemp/temp${i}_label" 2>/dev/null || echo "Core")"
      val="$(celsius_from_mC "$coretemp/temp${i}_input" || true)"
      [[ -n "$val" ]] || continue
      if [[ -z "$hot_temp" ]] || awk -v a="$val" -v b="$hot_temp" 'BEGIN{exit !(a>b)}'; then
        hot_core="$label"
        hot_temp="$val"
      fi
    done
  fi

  if dell="$(find_hwmon dell_smm)"; then
    for i in 1 2 3 4 5 6; do
      [[ -r "$dell/temp${i}_input" ]] || continue
      label="$(cat "$dell/temp${i}_label" 2>/dev/null || echo "")"
      val="$(celsius_from_mC "$dell/temp${i}_input" || true)"
      case "$label" in
        CPU) cpu="$val" ;;
        Ambient) ambient="$val" ;;
        GPU) gpu="$val" ;;
      esac
    done
    [[ -r "$dell/fan1_input" ]] && fan="$(cat "$dell/fan1_input")"
  fi

  if zone="$(find_thermal_zone TSKN)"; then
    skin="$(celsius_from_mC "$zone/temp" || true)"
  fi
  if zone="$(find_thermal_zone pch_skylake)"; then
    pch="$(celsius_from_mC "$zone/temp" || true)"
  elif zone="$(find_hwmon pch_skylake)"; then
    pch="$(celsius_from_mC "$zone/temp1_input" || true)"
  fi

  for f in /sys/devices/system/cpu/cpu*/cpufreq/scaling_cur_freq; do
    [[ -r "$f" ]] || continue
    cur="$(cat "$f")"
    sum=$((sum + cur))
    n=$((n + 1))
    ((cur > max)) && max=$cur
  done
  if [[ -r /sys/devices/system/cpu/cpu0/cpufreq/base_frequency ]]; then
    freq_base="$(mhz_from_khz "$(cat /sys/devices/system/cpu/cpu0/cpufreq/base_frequency)")"
  fi
  if [[ -r /sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq ]]; then
    freq_ceil="$(mhz_from_khz "$(cat /sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq)")"
  fi

  read -r load1 load5 load15 _ </proc/loadavg
  [[ -r /sys/devices/system/cpu/cpu0/cpufreq/energy_performance_preference ]] && \
    epp="$(cat /sys/devices/system/cpu/cpu0/cpufreq/energy_performance_preference)"
  if command -v busctl >/dev/null 2>&1; then
    profile="$(busctl --system get-property org.freedesktop.UPower.PowerProfiles \
      /org/freedesktop/UPower/PowerProfiles org.freedesktop.UPower.PowerProfiles \
      ActiveProfile 2>/dev/null | cut -d'"' -f2)"
    [[ -z "$profile" ]] && profile="n/a"
  fi
  top="$(ps -eo pcpu,comm --sort=-pcpu --no-headers | awk '
    $2=="ps" {next}
    $1+0>=5 {printf "%s %s%%; ", $2, $1; c++; if(c==4) exit}
  ')"
  top="${top%; }"

  cat >"$out" <<EOF
timestamp=$(date '+%Y-%m-%d %H:%M:%S')
no_turbo=$turbo_raw
turbo=$(turbo_word "$turbo_raw")
max_perf_pct=$(cat "$MAX_PERF" 2>/dev/null || echo n/a)
tjmax=$tjmax
profile=$profile
epp=$epp
package=$package
cpu=$cpu
ambient=$ambient
skin=$skin
gpu=$gpu
pch=$pch
hot_core=$hot_core
hot_core_temp=$hot_temp
freq_avg=$([[ $n -gt 0 ]] && mhz_from_khz "$((sum / n))" || echo "")
freq_max=$([[ $n -gt 0 ]] && mhz_from_khz "$max" || echo "")
freq_base=$freq_base
freq_ceil=$freq_ceil
fan=$fan
fan_max=$(if [[ -n "${dell:-}" && -r "$dell/fan1_max" ]]; then cat "$dell/fan1_max"; fi)
load1=$load1
load5=$load5
load15=$load15
top_cpu=$top
EOF
}

snapshot_json_obj() {
  local file="$1"
  HEADROOM="$(headroom_note "$(env_get "$file" package)" "$(env_get "$file" tjmax)")" \
  SKIN_NOTE="$(skin_note "$(env_get "$file" skin)")" \
  FAN_NOTE="$(fan_note "$(env_get "$file" fan)" "$(env_get "$file" fan_max)")" \
  python3 - "$file" <<'PY'
import json, os, sys

path = sys.argv[1]
d = {}
with open(path, encoding="utf-8") as fh:
    for line in fh:
        line = line.rstrip("\n")
        if not line or "=" not in line:
            continue
        key, val = line.split("=", 1)
        d[key] = val

num_keys = (
    "package", "cpu", "ambient", "skin", "gpu", "pch", "hot_core_temp", "tjmax",
    "freq_avg", "freq_max", "freq_base", "freq_ceil", "fan", "fan_max",
    "load1", "load5", "load15",
)
for key in num_keys:
    val = d.get(key, "")
    if val in ("", "n/a"):
        d[key] = None
        continue
    try:
        d[key] = float(val) if "." in str(val) else int(val)
    except ValueError:
        pass

mp = d.get("max_perf_pct")
if mp not in (None, "", "n/a"):
    try:
        d["max_perf_pct"] = int(float(mp))
    except ValueError:
        pass
else:
    d["max_perf_pct"] = None

nt = d.get("no_turbo")
if nt in ("0", "1"):
    d["no_turbo"] = int(nt)

d["headroom"] = os.environ.get("HEADROOM", "")
d["skin_note"] = os.environ.get("SKIN_NOTE", "")
d["fan_note"] = os.environ.get("FAN_NOTE", "")
print(json.dumps(d, ensure_ascii=False))
PY
}

status_takeaway_text() {
  local snap="$1"
  printf 'Turbo is %s. CPU package %s (%s). Chassis sensor %s — %s. Fan: %s.' \
    "$(env_get "$snap" turbo)" \
    "$(fmt_temp "$(env_get "$snap" package)")" \
    "$(headroom_note "$(env_get "$snap" package)" "$(env_get "$snap" tjmax)")" \
    "$(fmt_temp "$(env_get "$snap" skin)")" \
    "$(skin_note "$(env_get "$snap" skin)")" \
    "$(fan_note "$(env_get "$snap" fan)" "$(env_get "$snap" fan_max)")"
}

emit_status_json() {
  local snap="$1"
  SNAP_JSON="$(snapshot_json_obj "$snap")" \
  TAKEAWAY="$(status_takeaway_text "$snap")" \
  python3 - <<'PY'
import json, os
print(json.dumps({
    "ok": True,
    "command": "status",
    "snapshot": json.loads(os.environ["SNAP_JSON"]),
    "takeaway": os.environ.get("TAKEAWAY", ""),
}, ensure_ascii=False))
PY
}

emit_apply_json() {
  local pre="$1" now="$2" action="$3" already="$4"
  PRE_JSON="$(snapshot_json_obj "$pre")" \
  NOW_JSON="$(snapshot_json_obj "$now")" \
  ACTION="$action" ALREADY="$already" \
  TAKEAWAY="$(print_takeaway "$pre" "$now" immediate | sed 's/^\*\*Takeaway:\*\* //')" \
  python3 - <<'PY'
import json, os
print(json.dumps({
    "ok": True,
    "command": "apply",
    "action": os.environ.get("ACTION", ""),
    "already": os.environ.get("ALREADY", "0") == "1",
    "before": json.loads(os.environ["PRE_JSON"]),
    "now": json.loads(os.environ["NOW_JSON"]),
    "takeaway": os.environ.get("TAKEAWAY", "").strip(),
}, ensure_ascii=False))
PY
}

fmt_temp() {
  local v="${1:-}"
  [[ -n "$v" ]] && printf '%s°C' "$v" || printf 'n/a'
}

fmt_mhz() {
  local v="${1:-}"
  [[ -n "$v" ]] && printf '%s MHz' "$v" || printf 'n/a'
}

fmt_rpm() {
  local v="${1:-}"
  [[ -n "$v" ]] && printf '%s RPM' "$v" || printf 'n/a'
}

headroom_note() {
  local pkg="$1" limit="${2:-$DEFAULT_TJMAX}"
  [[ -n "$pkg" ]] || { echo "n/a"; return; }
  awk -v p="$pkg" -v t="$limit" 'BEGIN {
    h = t - p
    printf "%.0f° below limit", h
  }'
}

skin_note() {
  local s="$1"
  [[ -n "$s" ]] || { echo "n/a"; return; }
  # Same TSKN bands as the flyout (rounded °C): hot >= 60, warm >= 55.
  awk -v s="$s" 'BEGIN {
    t = int(s + 0.5)
    if (t >= 70) print "hot chassis sensor"
    else if (t >= 60) print "hot chassis sensor"
    else if (t >= 55) print "warm chassis"
    else print "comfortable"
  }'
}

fan_note() {
  local fan="$1" fmax="$2"
  [[ -n "$fan" ]] || { echo "n/a"; return; }
  [[ -n "$fmax" ]] || { echo "RPM (maximum unavailable)"; return; }
  awk -v f="$fan" -v m="$fmax" 'BEGIN {
    pct = (m>0) ? (100*f/m) : 0
    if (pct >= 90) printf "near max (%.0f%%) — limited extra cooling", pct
    else if (pct >= 70) printf "high (%.0f%% of max)", pct
    else printf "%.0f%% of max", pct
  }'
}

delta_num() {
  local a="$1" b="$2" unit="$3"
  if [[ -z "$a" || -z "$b" ]]; then echo "n/a"; return; fi
  awk -v a="$a" -v b="$b" -v u="$unit" 'BEGIN {
    d = b - a
    sign = (d>0) ? "+" : ""
    if (u=="C") printf "%s%.1f°C", sign, d
    else if (u=="MHz") printf "%s%.0f MHz", sign, d
    else if (u=="RPM") printf "%s%.0f RPM", sign, d
    else printf "%s%.2f", sign, d
  }'
}

reading_temp() {
  local metric="$1" before="$2" now="$3"
  if [[ -z "$before" || -z "$now" ]]; then echo "n/a"; return; fi
  awk -v m="$metric" -v a="$before" -v b="$now" 'BEGIN {
    d = b - a
    if (m=="skin") {
      if (d <= -2) print "chassis catching up"
      else if (d >= 2) print "chassis still soaking heat"
      else print "skin lags CPU; slow to change"
      exit
    }
    if (d <= -3) print "cooling"
    else if (d >= 3) print "heating"
    else print "stable"
  }'
}

reading_freq() {
  local want_turbo="$1" d
  d="$(delta_num "$2" "$3" MHz)"
  case "$want_turbo" in
    ON)  echo "boost available ($d)" ;;
    OFF) echo "capped at base ($d)" ;;
    *)   echo "$d" ;;
  esac
}

print_status_table() {
  local snap="$1"
  local pkg skin fan fmax freq_avg freq_max load1 turbo profile epp top hot hot_t cpu gpu ambient pch
  turbo="$(env_get "$snap" turbo)"
  pkg="$(env_get "$snap" package)"
  cpu="$(env_get "$snap" cpu)"
  skin="$(env_get "$snap" skin)"
  ambient="$(env_get "$snap" ambient)"
  gpu="$(env_get "$snap" gpu)"
  pch="$(env_get "$snap" pch)"
  hot="$(env_get "$snap" hot_core)"
  hot_t="$(env_get "$snap" hot_core_temp)"
  fan="$(env_get "$snap" fan)"
  fmax="$(env_get "$snap" fan_max)"
  freq_avg="$(env_get "$snap" freq_avg)"
  freq_max="$(env_get "$snap" freq_max)"
  load1="$(env_get "$snap" load1)"
  profile="$(env_get "$snap" profile)"
  epp="$(env_get "$snap" epp)"
  top="$(env_get "$snap" top_cpu)"

  echo "| Metric | Now | Reading |"
  echo "|---|---|---|"
  echo "| Turbo | **${turbo}** | \`no_turbo=$(env_get "$snap" no_turbo)\` |"
  echo "| Package (CPU die) | $(fmt_temp "$pkg") | $(headroom_note "$pkg" "$(env_get "$snap" tjmax)") |"
  echo "| Hottest core | $(fmt_temp "$hot_t")${hot:+ ($hot)} | peak silicon |"
  echo "| CPU (Dell SMM) | $(fmt_temp "$cpu") | board sensor |"
  echo "| Chassis sensor (TSKN) | $(fmt_temp "$skin") | $(skin_note "$skin") |"
  echo "| Ambient | $(fmt_temp "$ambient") | inside chassis air |"
  echo "| GPU | $(fmt_temp "$gpu") | discrete MX / iGPU path |"
  echo "| PCH | $(fmt_temp "$pch") | chipset |"
  echo "| Frequency request | avg $(fmt_mhz "$freq_avg"), max $(fmt_mhz "$freq_max") | requested clocks |"
  echo "| Fan | $(fmt_rpm "$fan") | $(fan_note "$fan" "$fmax") |"
  echo "| Load (1m) | ${load1:-n/a} | profile \`${profile}\`, EPP \`${epp}\` |"
  if [[ -n "$top" ]]; then
    echo "| CPU hogs (≥5%) | ${top} | still producing heat |"
  fi
}

print_compare_table() {
  local before="$1" now="$2"
  local b_turbo n_turbo
  b_turbo="$(env_get "$before" turbo)"
  n_turbo="$(env_get "$now" turbo)"

  echo "| Metric | Before | Now | Δ | Reading |"
  echo "|---|---|---|---|---|"
  echo "| Turbo | ${b_turbo} | **${n_turbo}** | $([[ "$b_turbo" == "$n_turbo" ]] && echo unchanged || echo "${b_turbo} → ${n_turbo}") | requested state |"
  echo "| Package (CPU die) | $(fmt_temp "$(env_get "$before" package)") | $(fmt_temp "$(env_get "$now" package)") | $(delta_num "$(env_get "$before" package)" "$(env_get "$now" package)" C) | $(reading_temp package "$(env_get "$before" package)" "$(env_get "$now" package)"); $(headroom_note "$(env_get "$now" package)" "$(env_get "$now" tjmax)") |"
  echo "| Hottest core | $(fmt_temp "$(env_get "$before" hot_core_temp)") | $(fmt_temp "$(env_get "$now" hot_core_temp)") | $(delta_num "$(env_get "$before" hot_core_temp)" "$(env_get "$now" hot_core_temp)" C) | $(reading_temp core "$(env_get "$before" hot_core_temp)" "$(env_get "$now" hot_core_temp)") |"
  echo "| CPU (Dell SMM) | $(fmt_temp "$(env_get "$before" cpu)") | $(fmt_temp "$(env_get "$now" cpu)") | $(delta_num "$(env_get "$before" cpu)" "$(env_get "$now" cpu)" C) | $(reading_temp cpu "$(env_get "$before" cpu)" "$(env_get "$now" cpu)") |"
  echo "| Chassis sensor (TSKN) | $(fmt_temp "$(env_get "$before" skin)") | $(fmt_temp "$(env_get "$now" skin)") | $(delta_num "$(env_get "$before" skin)" "$(env_get "$now" skin)" C) | $(reading_temp skin "$(env_get "$before" skin)" "$(env_get "$now" skin)"); $(skin_note "$(env_get "$now" skin)") |"
  echo "| Ambient | $(fmt_temp "$(env_get "$before" ambient)") | $(fmt_temp "$(env_get "$now" ambient)") | $(delta_num "$(env_get "$before" ambient)" "$(env_get "$now" ambient)" C) | inside-chassis air |"
  echo "| GPU | $(fmt_temp "$(env_get "$before" gpu)") | $(fmt_temp "$(env_get "$now" gpu)") | $(delta_num "$(env_get "$before" gpu)" "$(env_get "$now" gpu)" C) | $(reading_temp gpu "$(env_get "$before" gpu)" "$(env_get "$now" gpu)") |"
  echo "| PCH | $(fmt_temp "$(env_get "$before" pch)") | $(fmt_temp "$(env_get "$now" pch)") | $(delta_num "$(env_get "$before" pch)" "$(env_get "$now" pch)" C) | chipset |"
  echo "| Freq avg | $(fmt_mhz "$(env_get "$before" freq_avg)") | $(fmt_mhz "$(env_get "$now" freq_avg)") | $(delta_num "$(env_get "$before" freq_avg)" "$(env_get "$now" freq_avg)" MHz) | $(reading_freq "$n_turbo" "$(env_get "$before" freq_avg)" "$(env_get "$now" freq_avg)") |"
  echo "| Freq max | $(fmt_mhz "$(env_get "$before" freq_max)") | $(fmt_mhz "$(env_get "$now" freq_max)") | $(delta_num "$(env_get "$before" freq_max)" "$(env_get "$now" freq_max)" MHz) | peak boost sample |"
  echo "| Fan | $(fmt_rpm "$(env_get "$before" fan)") | $(fmt_rpm "$(env_get "$now" fan)") | $(delta_num "$(env_get "$before" fan)" "$(env_get "$now" fan)" RPM) | $(fan_note "$(env_get "$now" fan)" "$(env_get "$now" fan_max)") |"
  echo "| Load 1m | $(env_get "$before" load1) | $(env_get "$now" load1) | $(delta_num "$(env_get "$before" load1)" "$(env_get "$now" load1)" load) | hogs: $(env_get "$now" top_cpu) |"
}

print_triple_table() {
  local t0="$1" t30="$2" t5="$3"
  local n_turbo
  n_turbo="$(env_get "$t5" turbo)"

  echo "| Metric | Execution | +30s | +5min | Δ (0→5min) | Reading |"
  echo "|---|---|---|---|---|---|"
  echo "| Turbo | $(env_get "$t0" turbo) | $(env_get "$t30" turbo) | **${n_turbo}** | $([[ "$(env_get "$t0" turbo)" == "$n_turbo" ]] && echo unchanged || echo "$(env_get "$t0" turbo) → ${n_turbo}") | requested state |"
  echo "| Package (CPU die) | $(fmt_temp "$(env_get "$t0" package)") | $(fmt_temp "$(env_get "$t30" package)") | $(fmt_temp "$(env_get "$t5" package)") | $(delta_num "$(env_get "$t0" package)" "$(env_get "$t5" package)" C) | $(reading_temp package "$(env_get "$t0" package)" "$(env_get "$t5" package)"); $(headroom_note "$(env_get "$t5" package)" "$(env_get "$t5" tjmax)") |"
  echo "| Hottest core | $(fmt_temp "$(env_get "$t0" hot_core_temp)") | $(fmt_temp "$(env_get "$t30" hot_core_temp)") | $(fmt_temp "$(env_get "$t5" hot_core_temp)") | $(delta_num "$(env_get "$t0" hot_core_temp)" "$(env_get "$t5" hot_core_temp)" C) | $(reading_temp core "$(env_get "$t0" hot_core_temp)" "$(env_get "$t5" hot_core_temp)") |"
  echo "| CPU (Dell SMM) | $(fmt_temp "$(env_get "$t0" cpu)") | $(fmt_temp "$(env_get "$t30" cpu)") | $(fmt_temp "$(env_get "$t5" cpu)") | $(delta_num "$(env_get "$t0" cpu)" "$(env_get "$t5" cpu)" C) | $(reading_temp cpu "$(env_get "$t0" cpu)" "$(env_get "$t5" cpu)") |"
  echo "| Chassis sensor (TSKN) | $(fmt_temp "$(env_get "$t0" skin)") | $(fmt_temp "$(env_get "$t30" skin)") | $(fmt_temp "$(env_get "$t5" skin)") | $(delta_num "$(env_get "$t0" skin)" "$(env_get "$t5" skin)" C) | $(reading_temp skin "$(env_get "$t0" skin)" "$(env_get "$t5" skin)"); $(skin_note "$(env_get "$t5" skin)") |"
  echo "| Ambient | $(fmt_temp "$(env_get "$t0" ambient)") | $(fmt_temp "$(env_get "$t30" ambient)") | $(fmt_temp "$(env_get "$t5" ambient)") | $(delta_num "$(env_get "$t0" ambient)" "$(env_get "$t5" ambient)" C) | chassis air; slow to settle |"
  echo "| GPU | $(fmt_temp "$(env_get "$t0" gpu)") | $(fmt_temp "$(env_get "$t30" gpu)") | $(fmt_temp "$(env_get "$t5" gpu)") | $(delta_num "$(env_get "$t0" gpu)" "$(env_get "$t5" gpu)" C) | $(reading_temp gpu "$(env_get "$t0" gpu)" "$(env_get "$t5" gpu)") |"
  echo "| PCH | $(fmt_temp "$(env_get "$t0" pch)") | $(fmt_temp "$(env_get "$t30" pch)") | $(fmt_temp "$(env_get "$t5" pch)") | $(delta_num "$(env_get "$t0" pch)" "$(env_get "$t5" pch)" C) | chipset |"
  echo "| Freq avg | $(fmt_mhz "$(env_get "$t0" freq_avg)") | $(fmt_mhz "$(env_get "$t30" freq_avg)") | $(fmt_mhz "$(env_get "$t5" freq_avg)") | $(delta_num "$(env_get "$t0" freq_avg)" "$(env_get "$t5" freq_avg)" MHz) | $(reading_freq "$n_turbo" "$(env_get "$t0" freq_avg)" "$(env_get "$t5" freq_avg)") |"
  echo "| Freq max | $(fmt_mhz "$(env_get "$t0" freq_max)") | $(fmt_mhz "$(env_get "$t30" freq_max)") | $(fmt_mhz "$(env_get "$t5" freq_max)") | $(delta_num "$(env_get "$t0" freq_max)" "$(env_get "$t5" freq_max)" MHz) | peak boost sample |"
  echo "| Fan | $(fmt_rpm "$(env_get "$t0" fan)") | $(fmt_rpm "$(env_get "$t30" fan)") | $(fmt_rpm "$(env_get "$t5" fan)") | $(delta_num "$(env_get "$t0" fan)" "$(env_get "$t5" fan)" RPM) | $(fan_note "$(env_get "$t5" fan)" "$(env_get "$t5" fan_max)") |"
  echo "| Load 1m | $(env_get "$t0" load1) | $(env_get "$t30" load1) | $(env_get "$t5" load1) | $(delta_num "$(env_get "$t0" load1)" "$(env_get "$t5" load1)" load) | hogs: $(env_get "$t5" top_cpu) |"
}

print_takeaway() {
  local before="$1" now="$2" phase="$3"
  local n_turbo pkg skin fan fmax freq mid="${4:-}"
  n_turbo="$(env_get "$now" turbo)"
  pkg="$(env_get "$now" package)"
  skin="$(env_get "$now" skin)"
  fan="$(env_get "$now" fan)"
  fmax="$(env_get "$now" fan_max)"
  freq="$(env_get "$now" freq_avg)"

  if [[ "$phase" == immediate ]]; then
  printf '**Takeaway:** Turbo is **%s**. Clock request is %s. CPU package %s, chassis sensor %s. Fan: %s.\n' \
      "$n_turbo" "$(fmt_mhz "$freq")" "$(fmt_temp "$pkg")" "$(fmt_temp "$skin")" "$(fan_note "$fan" "$fmax")"
    return
  fi

  local when_label="30s"
  [[ "$phase" == 5m ]] && when_label="5min"

  awk -v turbo="$n_turbo" -v when="$when_label" \
      -v bpkg="$(env_get "$before" package)" -v npkg="$pkg" \
      -v bskin="$(env_get "$before" skin)" -v nskin="$skin" \
      -v bfreq="$(env_get "$before" freq_avg)" -v nfreq="$freq" \
      -v mpkg="$([[ -n "$mid" ]] && env_get "$mid" package || echo "")" \
      -v mskin="$([[ -n "$mid" ]] && env_get "$mid" skin || echo "")" \
      -v fan="$fan" -v fmax="$fmax" '
    BEGIN {
      dpkg = (bpkg!="" && npkg!="") ? npkg-bpkg : 0
      dskin = (bskin!="" && nskin!="") ? nskin-bskin : 0
        printf "**Takeaway:** After %s with turbo **%s**: CPU package %.1f°C → %.1f°C (%+.1f°C), chassis sensor %.1f°C → %.1f°C (%+.1f°C), avg clock request %.0f → %.0f MHz. ", \
        when, turbo, bpkg+0, npkg+0, dpkg, bskin+0, nskin+0, dskin, bfreq+0, nfreq+0
      if (turbo=="OFF" && dpkg<=-3) printf "CPU is cooling as expected. "
      else if (turbo=="OFF" && dpkg>=3) printf "Still heating — load is winning over the turbo cap. "
      else if (turbo=="ON" && dpkg>=3) printf "Boost is adding heat, as expected. "
      else if (turbo=="ON" && dpkg<=-3) printf "Cooling even with turbo on (load likely dropped). "
      else printf "CPU temperature is roughly stable. "
      if (when=="5min" && mskin!="" && nskin!="") {
        ds30 = nskin - mskin
        if (ds30 <= -1.5) printf "Chassis sensor kept cooling after the 30s mark (%.1f°C → %.1f°C). ", mskin+0, nskin+0
        else if (ds30 >= 1.5) printf "Chassis sensor warmed after the 30s mark. "
        else printf "Chassis sensor mostly settled after 30s. "
      } else if (dskin > -1 && dpkg <= -3) {
        printf "Chassis sensor has not caught up yet. "
      }
      if (fan!="" && fmax!="" && fan+0 >= 0.9*(fmax+0)) printf "Fan is already near max, so extra cooling is limited. "
      if (nskin=="") printf "Chassis sensor unavailable."
      else {
        nskini = int(nskin + 0.5)
        if (nskini >= 60) printf "Chassis sensor is in the hot band."
        else if (nskini >= 55) printf "Chassis sensor is in the warm band."
        else printf "Chassis sensor is in the comfortable band."
      }
      printf "\n"
    }'
}

cmd_status() {
  local snap="$STATE_DIR/status.env"
  [[ -e "$NO_TURBO" ]] || die "intel_pstate not available ($NO_TURBO missing)"
  collect_snapshot "$snap"
  if [[ "$JSON_MODE" == "1" ]]; then
    emit_status_json "$snap"
    return
  fi
  echo "## CPU turbo status ($(env_get "$snap" timestamp))"
  echo
  print_status_table "$snap"
  echo
  printf '**Takeaway:** Turbo is **%s**. Die %s (%s). Chassis %s — %s. Fan: %s.\n' \
    "$(env_get "$snap" turbo)" \
    "$(fmt_temp "$(env_get "$snap" package)")" \
    "$(headroom_note "$(env_get "$snap" package)" "$(env_get "$snap" tjmax)")" \
    "$(fmt_temp "$(env_get "$snap" skin)")" \
    "$(skin_note "$(env_get "$snap" skin)")" \
    "$(fan_note "$(env_get "$snap" fan)" "$(env_get "$snap" fan_max)")"
}

cmd_apply() {
  local mode="$1" target action pre now already
  [[ -e "$NO_TURBO" ]] || die "intel_pstate not available ($NO_TURBO missing)"
  case "$mode" in
    on|enable|enabled) target=0; action="Enable CPU turbo" ;;
    off|disable|disabled) target=1; action="Disable CPU turbo" ;;
    *) die "apply expects on or off" ;;
  esac

  pre="$STATE_DIR/pre.env"
  now="$STATE_DIR/now.env"
  collect_snapshot "$pre"
  already="$(env_get "$pre" no_turbo)"
  if [[ "$already" == "$target" ]]; then
    action="${action} (already in this state — no sysfs write)"
  else
    write_sysfs "$NO_TURBO" "$target"
    [[ "$(cat "$NO_TURBO")" == "$target" ]] || die "no_turbo write did not stick"
  fi
  collect_snapshot "$now"
  cp "$now" "$BASELINE"
  rm -f "$AFTER30" "$AFTER5M"

  if [[ "$JSON_MODE" == "1" ]]; then
    local already_flag=0
    [[ "$already" == "$target" ]] && already_flag=1
    emit_apply_json "$pre" "$now" "$action" "$already_flag"
    return
  fi

  echo "## Report 1 — on execution ($(env_get "$now" timestamp))"
  echo
  echo "**Action:** ${action}."
  echo
  echo "Pre-apply vs immediately after:"
  echo
  print_compare_table "$pre" "$now"
  echo
  print_takeaway "$pre" "$now" immediate
  echo
  echo "_Baseline saved. Next: Report 2 at 30s, Report 3 at 5min._"
}

cmd_compare() {
  local phase="${1:-30s}" now
  [[ -f "$BASELINE" ]] || die "no baseline — run apply on|off first"
  [[ -e "$NO_TURBO" ]] || die "intel_pstate not available ($NO_TURBO missing)"

  case "$phase" in
    30s|30|later|"")
      now="$AFTER30"
      collect_snapshot "$now"
      echo "## Report 2 — 30s later ($(env_get "$now" timestamp))"
      echo
      echo "Comparing execution baseline ($(env_get "$BASELINE" timestamp)) → now."
      echo
      print_compare_table "$BASELINE" "$now"
      echo
      print_takeaway "$BASELINE" "$now" 30s
      echo
      echo "_Report 3 at 5 minutes from execution._"
      ;;
    5m|5min|300)
      now="$AFTER5M"
      collect_snapshot "$now"
      echo "## Report 3 — 5min later ($(env_get "$now" timestamp))"
      echo
      if [[ -f "$AFTER30" ]]; then
        echo "Execution ($(env_get "$BASELINE" timestamp)) → +30s ($(env_get "$AFTER30" timestamp)) → +5min."
        echo
        print_triple_table "$BASELINE" "$AFTER30" "$now"
        echo
        print_takeaway "$BASELINE" "$now" 5m "$AFTER30"
      else
        echo "Comparing execution baseline ($(env_get "$BASELINE" timestamp)) → now (no 30s snapshot)."
        echo
        print_compare_table "$BASELINE" "$now"
        echo
        print_takeaway "$BASELINE" "$now" 5m
      fi
      ;;
    *)
      die "compare expects 30s or 5m"
      ;;
  esac
}

filtered=()
for arg in "$@"; do
  case "$arg" in
    --json) JSON_MODE=1 ;;
    *) filtered+=("$arg") ;;
  esac
done
set -- "${filtered[@]}"

[[ $# -ge 1 ]] || { usage >&2; exit 2; }
case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
  apply)
    [[ $# -ge 2 ]] || die "apply requires on or off"
    cmd_apply "$2"
    ;;
  compare)
    cmd_compare "${2:-30s}"
    ;;
  status) cmd_status ;;
  on|enable|enabled) cmd_apply on ;;
  off|disable|disabled) cmd_apply off ;;
  -h|--help|help) usage ;;
  *) usage >&2; die "unknown command: $1" ;;
esac
