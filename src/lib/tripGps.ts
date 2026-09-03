import { haversine } from "./storage";
import type { GpsPoint, Stop, Trip } from "./types";

export const GPS_SAMPLE_INTERVAL_MS = 3000;

export type GpsFix = Pick<GpsPoint, "lat" | "lng" | "accuracy" | "speed">;

export function gpsPointFromFix(fix: GpsFix, ts = Date.now()): GpsPoint {
  return {
    record_type: "gps_point",
    ts,
    lat: fix.lat,
    lng: fix.lng,
    accuracy: fix.accuracy,
    speed: fix.speed,
  };
}

type GpsPointLike = Omit<GpsPoint, "record_type"> & { record_type?: string };

/** Ensure every stored/uploaded GPS point has record_type. */
export function normalizeGpsPoints(gps: GpsPointLike[]): GpsPoint[] {
  return gps.map((p) =>
    p.record_type === "gps_point" ? (p as GpsPoint) : { ...p, record_type: "gps_point" as const },
  );
}

/** Append a sampled GPS point (throttled to GPS_SAMPLE_INTERVAL_MS). */
export function appendGpsPoint(trip: Trip, fix: GpsFix, ts = Date.now()): Trip {
  const last = trip.gps[trip.gps.length - 1];
  if (last && ts - last.ts < GPS_SAMPLE_INTERVAL_MS - 50) return trip;

  const point = gpsPointFromFix(fix, ts);
  const added = last ? haversine(last, point) : 0;
  return {
    ...trip,
    gps: [...trip.gps, point],
    stops: backfillStopsFromPoint(trip.stops, point),
    distanceMeters: trip.distanceMeters + added,
  };
}

function nearestGpsByTime(gps: GpsPoint[], ts: number): GpsPoint {
  return gps.reduce((best, p) => (Math.abs(p.ts - ts) < Math.abs(best.ts - ts) ? p : best));
}

/** Resolve stop coordinates from stored values or the trip GPS track. */
export function resolveStopCoords(
  stop: Stop,
  gps: GpsPoint[],
): { lat: number; lng: number } | null {
  if (stop.lat != null && stop.lng != null) {
    return { lat: stop.lat, lng: stop.lng };
  }
  if (!gps.length) return null;

  const near = nearestGpsByTime(gps, stop.ts);
  return { lat: near.lat, lng: near.lng };
}

/** Fill missing stop coordinates from GPS; returns counts for UI messages. */
export function backfillTripStops(trip: Trip): {
  trip: Trip;
  filled: number;
  stillMissing: number;
} {
  let filled = 0;
  let stillMissing = 0;

  const stops = trip.stops.map((stop) => {
    if (stop.lat != null && stop.lng != null) return stop;
    const coords = resolveStopCoords(stop, trip.gps);
    if (!coords) {
      stillMissing++;
      return stop;
    }
    filled++;
    return { ...stop, lat: coords.lat, lng: coords.lng };
  });

  return { trip: { ...trip, stops }, filled, stillMissing };
}

export type PreparedTrip = {
  payload: Omit<Trip, "uploaded" | "vehicle" | "routeType"> & {
    vehicleType?: string;
    passengerCapacity?: number;
    routeType?: string;
    status: "ongoing" | "completed";
  };
  repaired: Trip;
  skippedStops: number;
  filled: number;
};

export function prepareTripForUpload(trip: Trip): PreparedTrip {
  const { trip: repaired, filled } = backfillTripStops(trip);
  const stops = repaired.stops.filter(
    (s): s is Stop & { lat: number; lng: number } => s.lat != null && s.lng != null,
  );

  const gps = normalizeGpsPoints(repaired.gps);
  const tripWithGps = { ...repaired, gps, stops };
  const { uploaded: _uploaded, vehicle, routeType, ...rest } = tripWithGps;
  const skippedStops = repaired.stops.length - stops.length;
  return {
    payload: {
      ...rest,
      status: tripWithGps.endedAt ? "completed" : "ongoing",
      vehicleType: vehicle?.code,
      passengerCapacity: vehicle?.capacity,
      routeType: routeType?.code,
      stops,
    },
    repaired: tripWithGps,
    skippedStops,
    filled,
  };
}

export function prepareTripsForUpload(trips: Trip[]) {
  const prepared = trips.map(prepareTripForUpload);
  return {
    payloads: prepared.map((p) => p.payload),
    repaired: prepared.map((p) => p.repaired),
    skippedStops: prepared.reduce((n, p) => n + p.skippedStops, 0),
    filled: prepared.reduce((n, p) => n + p.filled, 0),
  };
}

/** Apply coordinates from a new GPS point to stops that are still missing them. */
export function backfillStopsFromPoint(stops: Stop[], point: GpsPoint): Stop[] {
  return stops.map((s) =>
    s.lat == null || s.lng == null ? { ...s, lat: point.lat, lng: point.lng } : s,
  );
}
