# Dey Go — Backend Changes for Frontend Integration (v0.3.0)

> **For:** Frontend / mobile client teams
> **Backend version:** 0.3.0 (2026-09-03)
> **Companion to:** [`FRONTEND_INTEGRATION_NOTES.md`](./FRONTEND_INTEGRATION_NOTES.md) (v0.2.0, 2026-08-12).
> This file covers **only the v0.3.0 changes** on top of v0.2.0:
> **Route type** (Fixed-Route / Demand-Responsive) and the **updated CSV export
> columns** (`routes.csv` / `stops.csv`). Existing endpoints and fields remain
> backward compatible unless explicitly marked.

---

## 1. TL;DR — What changed in v0.3.0

| Area | Change |
|------|--------|
| **Route type** | New **Fixed-Route / Demand-Responsive** concept (whether the vehicle runs a fixed route or on demand). |
| **New picker API** | `GET /api/v1/data/route-types` returns the two options; `POST` adds more. |
| **Upload** | Trips may send an optional `routeType` code (chosen on the **start page**). |
| **`routes.csv`** | New columns: `route_type`, `time`, `distance`, `no_of_stops`, `fare`. |
| **`stops.csv`** | `dwell` is reliably populated (falls back to the signal time) and a new **`is_signal_stop`** column shows `True`/`False`. |
| **Export paths** | Identical new column layout on BOTH the collector download and the admin download. |

---

## 2. New endpoints

### 2.1 List route types — `GET /api/v1/data/route-types`
Fixed-Route / Demand-Responsive route operation types. **Use this to drive the
route-type picker on the collector's start page** and send the chosen `code` as
`routeType` on upload.

```json
[
  {"id": 1, "code": "fixed_route", "name": "Fixed-Route", "active": true},
  {"id": 2, "code": "demand_responsive", "name": "Demand-Responsive", "active": true}
]
```

- `code` is the stable value stored on the trip (`fixed_route` / `demand_responsive`).
- `name` is the human-readable label to display ("Fixed-Route" / "Demand-Responsive").

### 2.2 Create a route type — `POST /api/v1/data/route-types`
Body: `{"code": "charter", "name": "Charter"}` → `201`.

---

## 3. Changed endpoint — Upload (`POST /api/v1/data/upload`)

New **optional** top-level field `routeType` (a `code` from
`GET /data/route-types`). Old uploads that omit it still work — the value is
stored as empty.

```json
[
  {
    "id": "trip-abc123",
    "origin": "Main Street",
    "destination": "Market Square",
    "fare": 2.50,
    "initialPassengers": 5,
    "startedAt": 1779803665202,
    "distanceMeters": 4500,
    "endedAt": 1779803691987,
    "endStopId": "stop-004",
    "uploaded": true,
    "vehicleType": "medium_bus",
    "routeType": "fixed_route",
    "gps": [ { "ts": 1779803669208, "lat": 4.981342, "lng": 8.333408, "accuracy": 150, "speed": 8.5 } ],
    "stops": [
      { "type": "regular", "dwellSeconds": 15, "delaySeconds": 3.0,
        "boarding": 3, "alighting": 1, "id": "stop-001",
        "ts": 1779803673554, "lat": 4.981342, "lng": 8.333408 }
    ]
  }
]
```

> **Note:** `routeType` is separate from `vehicleType` (the paratransit vehicle,
> e.g. `small_bus`). A Fixed-Route vs Demand-Responsive service can be operated
> by any vehicle type.

---

## 4. CSV export — updated columns

The new column layout applies to **both**:
- Collector download: `GET /api/v1/data/process/{trip_id}`
- Admin download: `GET /api/v1/admin/trips/{trip_id}/download`

(An existing legacy difference is untouched: the collector export uses the
placeholder `unit_id`/`route_id`, while the admin export writes real values. The
column set is identical.)

### 4.1 `routes.csv`

| Column | Source | Notes |
|--------|--------|-------|
| `unit_id` / `route_id` / `route_name` / `route_description` / `field_notes` | existing | unchanged |
| `vehicle_type` / `vehicle_capacity` | existing | unchanged (v0.2.0 populated them) |
| `start_capture` / `end_capture` | existing | unchanged |
| **`route_type`** 🆕 | `routeType` | `fixed_route` / `demand_responsive`; empty when not provided |
| **`time`** 🆕 | `tripDurationSeconds` | trip duration, seconds (numeric) |
| **`distance`** 🆕 | `tripDistanceKm` | trip distance, km (numeric) |
| **`no_of_stops`** 🆕 | `regularStopCount + signalizedStopCount` | total stops (integer) |
| **`fare`** 🆕 | `fare` | fare amount; empty when the trip had none |

Example header + row:

```csv
"unit_id","route_id","route_name","route_description","field_notes","vehicle_type","vehicle_capacity","start_capture","end_capture","route_type","time","distance","no_of_stops","fare"
"a1b2c3d4","trip-abc123","Main Street -> Market Square","","5","medium_bus","20","2026:05:07:13:29:32","2026:05:07:13:29:52","fixed_route","26.785","4.5","3","25.0"
```

### 4.2 `stops.csv`

| Column | Source | Notes |
|--------|--------|-------|
| `unit_id` / `route_id` / `stop_id` / `stop_sequence` / `lat` / `lon` | existing | unchanged |
| **`dwell`** | `dwellSeconds` | Dwell time, now reliably populated; for **signalized** stops it falls back to `signalDelay` (the signal stop time) when `dwellSeconds` is absent |
| `arrival_time` / `departure_time` / `board` / `alight` / `notes` | existing | unchanged |
| **`is_signal_stop`** 🆕 | `stopType` ∈ {`signal`, `signalized`} | `True` / `False` |

Example header + row:

```csv
"unit_id","route_id","stop_id","stop_sequence","lat","lon","dwell","arrival_time","departure_time","board","alight","notes","is_signal_stop"
"a1b2c3d4","trip-abc123","stop-002","2","4.981442","8.333508","7.0","2026:05:07:13:29:38","2026:05:07:13:29:38","1","0","","True"
```

---

## 5. Data model & terminology notes

- **Route type** lives on the trip summary as `routeType` (code); the display
  names come from the seeded `route_types` lookup table
  (`fixed_route` → "Fixed-Route", `demand_responsive` → "Demand-Responsive").
- **`is_signal_stop`** is derived server-side from the stop's `stopType`
  (`signal` / `signalized` → `True`, `regular` → `False`). No new client input is
  required — keep sending `type: "regular"` / `"signal"` on each stop.
- **Dwell** semantics are unchanged conceptually (time spent at the stop). The
  export now guarantees the column is present and filled, using the signal stop
  time as the fallback value for signalized stops.

---

## 6. Frontend action checklist (v0.3.0)

- [ ] **Route-type picker (start page):** call `GET /api/v1/data/route-types`;
      display `name`. Send the chosen `code` as `routeType` on upload.
- [ ] **Upload payload:** include `routeType` (optional) alongside `vehicleType`.
- [ ] **CSV consumers:** update importers/parsers for `routes.csv`
      (`route_type`, `time`, `distance`, `no_of_stops`, `fare`) and `stops.csv`
      (`is_signal_stop`; `dwell` guaranteed present).

---

## 7. Backward-compatibility guarantees

- `routeType` is **optional** on upload — existing client versions keep working.
- All previously existing `routes.csv` / `stops.csv` columns are unchanged; the
  new columns are **appended**.
- No database reset is required on the client side; the backend auto-migrates
  (Alembic revision `0006` + a guarded startup column add).
- Internal field names (`dwellSeconds`, `signalDelay`, `stopType`) are unchanged.
