import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { requireAuth } from "@/lib/auth-guard";
import {
  ApiError,
  fetchAdminUsers,
  fetchRouteTypes,
  getMe,
  loadToken,
  saveToken,
  uploadTrips,
  type User,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
  DrawerClose,
} from "@/components/ui/drawer";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import {
  Navigation,
  Square,
  Plus,
  Pause,
  Route as RouteIcon,
  Upload,
  Trash2,
  Wifi,
  WifiOff,
  LogOut,
  Menu,
  Database,
  Shield,
  ArrowDownToLine,
  ArrowUpFromLine,
} from "lucide-react";
import { useGps } from "@/hooks/use-gps";
import { useOnline } from "@/hooks/use-online";
import { loadActive, loadTrips, saveActive, saveTrips } from "@/lib/storage";
import { appendGpsPoint, GPS_SAMPLE_INTERVAL_MS } from "@/lib/tripGps";
import type { RouteType, Stop, StopType, Trip, VehicleType } from "@/lib/types";
import { TripStatBadge } from "@/components/TripStatBadge";
import { MyDataSheet } from "@/components/MyDataSheet";

export const Route = createFileRoute("/app")({
  beforeLoad: requireAuth,
  component: App,
});

const uid = () => Math.random().toString(36).slice(2, 10);

/** Route operation types shown on the start page; refreshed from the API when online. */
const DEFAULT_ROUTE_TYPES: RouteType[] = [
  { id: "fixed_route", code: "fixed_route", name: "Fixed-Route", active: true },
  { id: "demand_responsive", code: "demand_responsive", name: "Demand-Responsive", active: true },
];

function fmtDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

function fmtKm(m: number) {
  return `${(m / 1000).toFixed(2)} km`;
}

function App() {
  const navigate = useNavigate();
  const [active, setActive] = useState<Trip | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [now, setNow] = useState(Date.now());
  const online = useOnline();
  const [user, setUser] = useState<User | null>(null);
  const [routeTypes, setRouteTypes] = useState<RouteType[]>(DEFAULT_ROUTE_TYPES);
  const [uploading, setUploading] = useState(false);
  const [myDataOpen, setMyDataOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!loadToken()) {
      navigate({ to: "/" });
      return;
    }
    setActive(loadActive());
    setTrips(loadTrips());
    const token = loadToken();
    if (token) {
      getMe(token)
        .then(setUser)
        .catch((err) => {
          if (err instanceof ApiError && err.status === 401) {
            saveToken(null);
            navigate({ to: "/" });
          }
        });
      // Only admins/superadmins can use the admin console. Probe access so the
      // Admin button only appears for them (403 = regular user, keep it hidden).
      fetchAdminUsers(token, { limit: 1 })
        .then(() => setIsAdmin(true))
        .catch((err) => {
          if (err instanceof ApiError && err.status === 401) {
            saveToken(null);
            navigate({ to: "/" });
          }
        });
      // Drive the route-type picker from the server; keep the built-in defaults
      // when offline or the request fails.
      fetchRouteTypes(token)
        .then((list) => {
          if (list.length) setRouteTypes(list);
        })
        .catch(() => {});
    }
  }, [navigate]);

  const signOut = () => {
    saveToken(null);
    navigate({ to: "/" });
  };

  const handleSessionExpired = () => {
    saveToken(null);
    navigate({ to: "/" });
  };

  // ticker
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);

  // persist active
  useEffect(() => {
    saveActive(active);
  }, [active]);

  const gpsActive = !!active && !active.endedAt;
  const {
    status: gpsStatus,
    last: lastPoint,
    best: bestPoint,
    accuracy: gpsAccuracy,
  } = useGps(gpsActive);
  const lastFixRef = useRef(lastPoint);
  lastFixRef.current = lastPoint;
  const bestFixRef = useRef(bestPoint);
  bestFixRef.current = bestPoint;

  // Sample current position every 3s into trip.gps with record_type gps_point
  useEffect(() => {
    if (!gpsActive) return;

    const sample = () => {
      // Prefer the most accurate fix from the recent window, fall back to the
      // latest raw fix when none is available yet.
      const fix = bestFixRef.current ?? lastFixRef.current;
      if (!fix) return;
      setActive((prev) => (prev ? appendGpsPoint(prev, fix) : prev));
    };

    sample();
    const t = setInterval(sample, GPS_SAMPLE_INTERVAL_MS);
    return () => clearInterval(t);
  }, [gpsActive, active?.id]);

  const startTrip = (data: {
    origin: string;
    destination: string;
    initialPassengers: number;
    vehicle?: VehicleType;
    routeType?: RouteType;
  }) => {
    const trip: Trip = {
      id: uid(),
      origin: data.origin,
      destination: data.destination,
      fare: null,
      vehicle: data.vehicle,
      routeType: data.routeType,
      initialPassengers: data.initialPassengers,
      startedAt: Date.now(),
      distanceMeters: 0,
      gps: [],
      stops: [],
      status: "ongoing",
    };
    setActive(trip);
    toast.success("Trip started — GPS tracking on");
  };

  const stopCoords = () => {
    if (bestPoint) return { lat: bestPoint.lat, lng: bestPoint.lng };
    if (lastPoint) return { lat: lastPoint.lat, lng: lastPoint.lng };
    const last = active?.gps[active.gps.length - 1];
    if (last) return { lat: last.lat, lng: last.lng };
    return { lat: null, lng: null };
  };

  const addStop = (stop: Omit<Stop, "id" | "ts" | "lat" | "lng">) => {
    if (!active) return;
    const { lat, lng } = stopCoords();
    if (lat == null || lng == null) {
      toast.warning("GPS not ready — stop saved; coordinates will fill in when GPS is available");
    }
    const s: Stop = {
      ...stop,
      id: uid(),
      ts: Date.now(),
      lat,
      lng,
    };
    setActive({ ...active, stops: [...active.stops, s] });
    toast.success("Stop logged");
  };

  const endTrip = (stop: Omit<Stop, "id" | "ts" | "lat" | "lng">, fare?: number) => {
    if (!active) return;
    const { lat, lng } = stopCoords();
    if (lat == null || lng == null) {
      toast.warning("GPS not ready — trip saved; coordinates will fill in when GPS is available");
    }
    const s: Stop = {
      ...stop,
      id: uid(),
      ts: Date.now(),
      lat,
      lng,
    };
    const ended: Trip = {
      ...active,
      stops: [...active.stops, s],
      endedAt: Date.now(),
      endStopId: s.id,
      fare: fare ?? active.fare,
      status: "completed",
    };
    const next = [ended, ...trips];
    setTrips(next);
    saveTrips(next);
    setActive(null);
    toast.success("Trip ended & saved to phone");
  };

  const deleteTrip = (id: string) => {
    const next = trips.filter((t) => t.id !== id);
    setTrips(next);
    saveTrips(next);
    toast.success("Trip deleted");
  };

  const uploadAll = async () => {
    if (!online) {
      toast.error("You're offline — try again when connected");
      return;
    }
    const token = loadToken();
    if (!token) {
      navigate({ to: "/" });
      return;
    }
    const pending = trips.filter((t) => !t.uploaded);
    if (!pending.length) {
      toast.info("Nothing to upload");
      return;
    }
    setUploading(true);
    toast.loading(`Uploading ${pending.length} trip(s)...`, { id: "up" });
    try {
      const { repaired, skippedStops, filled } = await uploadTrips(pending, token);
      const repairedById = new Map(repaired.map((t) => [t.id, t]));
      const pendingIds = new Set(pending.map((t) => t.id));
      const next = trips.map((t) => {
        if (!pendingIds.has(t.id)) return t;
        const saved = repairedById.get(t.id) ?? t;
        return { ...saved, uploaded: true };
      });
      setTrips(next);
      saveTrips(next);
      let msg = `Uploaded ${pending.length} trip(s)`;
      if (filled > 0) msg += ` · ${filled} stop(s) filled from GPS track`;
      if (skippedStops > 0) {
        msg += ` · ${skippedStops} stop(s) skipped (no GPS)`;
      }
      toast.success(msg, { id: "up" });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        saveToken(null);
        navigate({ to: "/" });
        toast.error("Session expired — sign in again", { id: "up" });
        return;
      }
      const msg = err instanceof Error ? err.message : "Upload failed";
      toast.error(msg, { id: "up" });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Toaster richColors position="top-center" />
      <header className="sticky top-0 z-20 border-b bg-background/80 pt-safe backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-4 sm:py-3">
          <div className="flex min-w-0 items-center gap-2">
            <img src="/logo.png" alt="DeyGo logo" className="h-8 w-auto shrink-0 object-contain" />
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold leading-none sm:text-base">DeyGo</h1>
              <p className="hidden text-[11px] text-muted-foreground sm:block">
                Paratransit trip recording and observations
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
            <Badge variant="outline" className="gap-1 font-mono text-[10px]">
              {online ? (
                <Wifi className="h-3 w-3 shrink-0" />
              ) : (
                <WifiOff className="h-3 w-3 shrink-0" />
              )}
              <span className="hidden min-[360px]:inline">{online ? "ONLINE" : "OFFLINE"}</span>
            </Badge>
            <Badge
              variant="outline"
              className={`gap-1 font-mono text-[10px] ${
                gpsStatus === "active" ? "border-success text-success" : ""
              }`}
            >
              <Navigation className="h-3 w-3 shrink-0" />
              <span className="hidden min-[400px]:inline">GPS </span>
              {gpsStatus.toUpperCase()}
              {gpsAccuracy != null && gpsStatus === "active" && (
                <span className="text-[10px]">· {Math.round(gpsAccuracy)}m</span>
              )}
            </Badge>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="hidden gap-1 text-xs sm:inline-flex"
              disabled={!online}
              title={online ? undefined : "Requires internet connection"}
              onClick={() => {
                if (!online) {
                  toast.error("My data requires an internet connection");
                  return;
                }
                setMyDataOpen(true);
              }}
            >
              <Database className="h-3.5 w-3.5" />
              My data
            </Button>

            {isAdmin && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="hidden gap-1 text-xs sm:inline-flex"
                onClick={() => navigate({ to: "/admin" })}
              >
                <Shield className="h-3.5 w-3.5" />
                Admin
              </Button>
            )}

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="hidden gap-1 text-xs sm:inline-flex"
              onClick={signOut}
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </Button>

            <Drawer>
              <DrawerTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 sm:hidden ml-auto"
                  aria-label="Open menu"
                >
                  <Menu className="h-5 w-5" />
                </Button>
              </DrawerTrigger>
              <DrawerContent>
                <DrawerHeader>
                  <DrawerTitle>Menu</DrawerTitle>
                  <DrawerDescription>Quick actions</DrawerDescription>
                </DrawerHeader>
                <div className="flex flex-col gap-2 px-4">
                  <Button
                    type="button"
                    variant="ghost"
                    className="justify-start gap-2"
                    disabled={!online}
                    onClick={() => {
                      if (!online) {
                        toast.error("My data requires an internet connection");
                        return;
                      }
                      setMyDataOpen(true);
                    }}
                  >
                    <Database className="h-4 w-4" />
                    My data
                  </Button>
                  {isAdmin && (
                    <Button
                      type="button"
                      variant="ghost"
                      className="justify-start gap-2"
                      onClick={() => navigate({ to: "/admin" })}
                    >
                      <Shield className="h-4 w-4" />
                      Admin
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    className="justify-start gap-2"
                    onClick={signOut}
                  >
                    <LogOut className="h-4 w-4" />
                    Sign out
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="justify-start gap-2"
                    onClick={uploadAll}
                    disabled={uploading || !online}
                  >
                    <Upload className="h-4 w-4" />
                    Upload to web
                  </Button>
                </div>
                <DrawerFooter>
                  <DrawerClose asChild>
                    <Button variant="outline" className="w-full">
                      Close
                    </Button>
                  </DrawerClose>
                </DrawerFooter>
              </DrawerContent>
            </Drawer>
          </div>
        </div>
      </header>

      <MyDataSheet
        open={myDataOpen}
        onOpenChange={setMyDataOpen}
        online={online}
        onSessionExpired={handleSessionExpired}
      />

      <main className="mx-auto max-w-3xl px-3 pb-28 pt-4 sm:px-4 sm:pb-24 sm:pt-6">
        {active ? (
          <ActiveTripView trip={active} now={now} onAddStop={addStop} onEnd={endTrip} />
        ) : (
          <Tabs defaultValue="start">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="start">New trip</TabsTrigger>
              <TabsTrigger value="history">
                History {trips.length ? `(${trips.length})` : ""}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="start" className="mt-4">
              <NewTripForm routeTypes={routeTypes} onStart={startTrip} />
            </TabsContent>
            <TabsContent value="history" className="mt-4 space-y-3">
              {user && (
                <p className="break-words px-1 text-center text-xs text-muted-foreground">
                  Signed in as {user.name || user.email} · Unit {user.unit_id}
                </p>
              )}
              {!online && (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-center text-xs text-amber-800 dark:text-amber-200">
                  Upload and server downloads need internet. Trip recording works offline.
                </p>
              )}
              <Button
                onClick={uploadAll}
                className="w-full gap-2"
                disabled={uploading || !online}
                title={online ? undefined : "Requires internet connection"}
              >
                <Upload className="h-4 w-4" /> Upload to web
              </Button>
              {trips.length === 0 && (
                <Card className="p-8 text-center text-sm text-muted-foreground">
                  No trips saved yet.
                </Card>
              )}
              {trips.map((t) => (
                <TripCard key={t.id} trip={t} onDelete={() => deleteTrip(t.id)} />
              ))}
            </TabsContent>
          </Tabs>
        )}
      </main>
    </div>
  );
}

// ========== NEW TRIP FORM (no fare) ==========
function NewTripForm({
  routeTypes,
  onStart,
}: {
  routeTypes: RouteType[];
  onStart: (d: {
    origin: string;
    destination: string;
    initialPassengers: number;
    vehicle?: VehicleType;
    routeType?: RouteType;
  }) => void;
}) {
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [pax, setPax] = useState("");
  const [vehicleName, setVehicleName] = useState("");
  const [vehicleCapacity, setVehicleCapacity] = useState("");
  const [routeTypeCode, setRouteTypeCode] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!origin.trim() || !destination.trim()) {
      toast.error("Origin & destination required");
      return;
    }
    const vehicle: VehicleType | undefined =
      vehicleName.trim() !== ""
        ? {
            id: uid(),
            code: vehicleName.trim().slice(0, 60),
            name: vehicleName.trim().slice(0, 60),
            capacity: Math.max(0, parseInt(vehicleCapacity) || 0),
          }
        : undefined;
    const routeType: RouteType | undefined =
      routeTypeCode !== "" ? routeTypes.find((rt) => rt.code === routeTypeCode) : undefined;
    onStart({
      origin: origin.trim().slice(0, 80),
      destination: destination.trim().slice(0, 80),
      initialPassengers: Math.max(0, parseInt(pax) || 0),
      vehicle,
      routeType,
    });
  };

  return (
    <Card className="p-4 shadow-card sm:p-5">
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label>Origin</Label>
          <Input
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            maxLength={80}
            placeholder="e.g. Central Station"
          />
        </div>
        <div className="space-y-2">
          <Label>Destination</Label>
          <Input
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            maxLength={80}
            placeholder="e.g. Airport"
          />
        </div>
        <div className="space-y-2">
          <Label>Passengers @ start</Label>
          <Input
            inputMode="numeric"
            value={pax}
            onChange={(e) => setPax(e.target.value)}
            placeholder="0"
          />
        </div>
        <div className="space-y-2">
          <Label>Route type</Label>
          <Select
            value={routeTypeCode || undefined}
            onValueChange={(v) => setRouteTypeCode(v === "none" ? "" : v)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Not specified" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Not specified</SelectItem>
              {routeTypes.map((rt) => (
                <SelectItem key={rt.code} value={rt.code}>
                  {rt.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Fixed route or on-demand service — separate from vehicle type.
          </p>
        </div>
        <div className="space-y-2">
          <Label>Vehicle type</Label>
          <Input
            value={vehicleName}
            onChange={(e) => setVehicleName(e.target.value)}
            maxLength={60}
            placeholder="e.g. Small Bus"
          />
        </div>
        <div className="space-y-2">
          <Label>Vehicle capacity</Label>
          <Input
            inputMode="numeric"
            value={vehicleCapacity}
            onChange={(e) => setVehicleCapacity(e.target.value)}
            placeholder="0"
          />
        </div>
        <Button type="submit" size="lg" className="w-full gap-2 bg-gradient-hero">
          <Navigation className="h-4 w-4" /> Start trip & GPS
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          GPS records every 3 sec. Trips save on this device; upload when online.
        </p>
      </form>
    </Card>
  );
}

// ========== ACTIVE TRIP VIEW (stop timeline removed) ==========
function ActiveTripView({
  trip,
  now,
  onAddStop,
  onEnd,
}: {
  trip: Trip;
  now: number;
  onAddStop: (s: Omit<Stop, "id" | "ts" | "lat" | "lng">) => void;
  onEnd: (s: Omit<Stop, "id" | "ts" | "lat" | "lng">, fare?: number) => void;
}) {
  const [regularOpen, setRegularOpen] = useState(false);
  const [signalOpen, setSignalOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const { passengers, totalBoard, totalAlight } = useMemo(() => {
    let p = trip.initialPassengers;
    let b = 0;
    let a = 0;
    for (const s of trip.stops) {
      p += s.boarding - s.alighting;
      b += s.boarding;
      a += s.alighting;
    }
    return { passengers: p, totalBoard: b, totalAlight: a };
  }, [trip]);

  const elapsed = (trip.endedAt ?? now) - trip.startedAt;

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden border-0 bg-gradient-hero p-4 text-primary-foreground shadow-elevated sm:p-5">
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest opacity-80">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
          Trip in progress
        </div>
        <div className="mt-2 font-mono text-[10px] opacity-80 sm:text-xs">ID · {trip.id}</div>
        <div className="mt-3 flex flex-col gap-0.5 text-base font-semibold sm:flex-row sm:items-center sm:gap-2 sm:text-lg">
          <span className="truncate">{trip.origin}</span>
          <span className="hidden opacity-50 sm:inline">→</span>
          <span className="truncate sm:before:content-none">
            <span className="opacity-50 sm:hidden">→ </span>
            {trip.destination}
          </span>
        </div>
        {trip.routeType ? (
          <div className="mt-3 flex w-fit items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs text-white">
            <RouteIcon className="h-3.5 w-3.5 text-accent" />
            {trip.routeType.name || trip.routeType.code}
          </div>
        ) : null}
        {trip.vehicle ? (
          <div className="mt-3 rounded-2xl border border-white/20 bg-white/10 p-3 text-sm text-white sm:p-4">
            <div className="text-[10px] uppercase tracking-widest text-white/70 sm:text-[11px]">
              Vehicle
            </div>
            <div className="mt-1 font-semibold">{trip.vehicle.name}</div>
            <div className="text-xs text-white/80">{trip.vehicle.capacity} passengers</div>
          </div>
        ) : null}
      </Card>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <TripStatBadge label="Time" value={fmtDuration(elapsed)} />
        <TripStatBadge label="Distance" value={fmtKm(trip.distanceMeters)} />
        <TripStatBadge label="Onboard" value={String(passengers)} />
        <TripStatBadge label="Stops" value={String(trip.stops.length)} accent />
      </div>

      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Passenger movement</h3>
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
            start: {trip.initialPassengers}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
          <div className="rounded-xl border bg-success/10 p-2 text-center sm:p-3">
            <div className="flex items-center justify-center gap-0.5 text-[10px] uppercase tracking-widest text-success sm:gap-1 sm:text-[11px]">
              <ArrowDownToLine className="h-3 w-3 shrink-0" />
              <span className="truncate">Boarded</span>
            </div>
            <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-success sm:text-2xl">
              {totalBoard}
            </div>
          </div>
          <div className="rounded-xl border bg-destructive/10 p-2 text-center sm:p-3">
            <div className="flex items-center justify-center gap-0.5 text-[10px] uppercase tracking-widest text-destructive sm:gap-1 sm:text-[11px]">
              <ArrowUpFromLine className="h-3 w-3 shrink-0" />
              <span className="truncate">Alighted</span>
            </div>
            <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-destructive sm:text-2xl">
              {totalAlight}
            </div>
          </div>
          <div className="rounded-xl border bg-secondary p-2 text-center sm:p-3">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground sm:text-[11px]">
              Onboard
            </div>
            <div className="mt-1 font-mono text-xl font-semibold tabular-nums sm:text-2xl">
              {passengers}
            </div>
          </div>
        </div>
      </Card>

      <div className="space-y-2 sm:space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:gap-3">
          <Button
            size="lg"
            onClick={() => setRegularOpen(true)}
            className="h-auto min-h-14 flex-col gap-1 py-3 text-sm sm:h-16 sm:flex-row sm:gap-2 sm:text-base"
          >
            <Pause className="h-5 w-5 shrink-0" />
            Stop
          </Button>
          <Button
            size="lg"
            onClick={() => setSignalOpen(true)}
            className="h-auto min-h-14 flex-col gap-1 py-3 text-sm sm:h-16 sm:flex-row sm:gap-2 sm:text-base"
          >
            <Plus className="h-5 w-5 shrink-0" />
            Signal stop
          </Button>
        </div>
        <Button
          size="lg"
          variant="destructive"
          onClick={() => setEndOpen(true)}
          className="h-auto min-h-14 w-full flex-col gap-1 py-3 text-sm sm:h-16 sm:flex-row sm:gap-2 sm:text-base"
        >
          <Square className="h-5 w-5 shrink-0" />
          End trip
        </Button>
      </div>

      {/* Stops timeline removed – stops are still saved in background */}

      <StopDialog
        open={regularOpen}
        onOpenChange={setRegularOpen}
        title="Stop"
        submitLabel="Log stop"
        stopType="regular"
        onSubmit={(d) => {
          onAddStop(d);
          setRegularOpen(false);
        }}
      />
      <StopDialog
        open={signalOpen}
        onOpenChange={setSignalOpen}
        title="Signal stop"
        submitLabel="Save signal stop"
        stopType="signalized"
        onSubmit={(d) => {
          onAddStop(d);
          setSignalOpen(false);
        }}
      />
      <StopDialog
        open={endOpen}
        onOpenChange={setEndOpen}
        title="End trip at stop"
        submitLabel="End trip"
        destructive
        stopType="signalized"
        onSubmit={(d, fare) => {
          onEnd(d, fare);
          setEndOpen(false);
        }}
      />
      <StopObservationsList stops={trip.stops} />
    </div>
  );
}

// ========== STOP DIALOG (regular stops only, fare on end) ==========
function StopDialog({
  open,
  onOpenChange,
  title,
  submitLabel,
  destructive,
  stopType,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  submitLabel: string;
  destructive?: boolean;
  stopType: StopType;
  onSubmit: (s: Omit<Stop, "id" | "ts" | "lat" | "lng">, fare?: number) => void;
}) {
  const [board, setBoard] = useState("0");
  const [alight, setAlight] = useState("0");
  const [notes, setNotes] = useState("");
  const [dwellStart, setDwellStart] = useState<number | null>(null);
  const [dwellPaused, setDwellPaused] = useState<number>(0);
  const [tick, setTick] = useState(0);
  const [fare, setFare] = useState("");

  useEffect(() => {
    if (open) {
      setBoard("0");
      setAlight("0");
      setNotes("");
      setDwellStart(stopType === "signalized" ? Date.now() : null);
      setDwellPaused(0);
      setFare("");
    }
  }, [open, stopType]);

  useEffect(() => {
    if (!open || dwellStart === null) return;
    const t = setInterval(() => setTick((x) => x + 1), 250);
    return () => clearInterval(t);
  }, [open, dwellStart]);

  const dwellMs = dwellStart === null ? dwellPaused : dwellPaused + (Date.now() - dwellStart);
  const dwellSec = Math.round(dwellMs / 1000);
  void tick;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(90vh,100dvh)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {stopType === "signalized" && (
            <div className="rounded-lg border bg-secondary/40 p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    Signal Stop time
                  </div>
                  <div className="font-mono text-xl font-semibold tabular-nums sm:text-2xl">
                    {fmtDuration(dwellMs)}
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="w-full shrink-0 sm:w-auto"
                  variant={dwellStart === null ? "default" : "outline"}
                  onClick={() => {
                    if (dwellStart === null) {
                      setDwellStart(Date.now());
                    } else {
                      setDwellPaused(dwellPaused + (Date.now() - dwellStart));
                      setDwellStart(null);
                    }
                  }}
                >
                  {dwellStart === null ? "Resume" : "Stop timer"}
                </Button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Auto-started when stop logged. Stop the timer when the vehicle moves.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Boarding</Label>
              <Input inputMode="numeric" value={board} onChange={(e) => setBoard(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Alighting</Label>
              <Input
                inputMode="numeric"
                value={alight}
                onChange={(e) => setAlight(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Observation (optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
              placeholder="Enter observations for this stop…"
              rows={3}
            />
          </div>

          {destructive && (
            <div className="space-y-2">
              <Label>Total fare (₦) *</Label>
              <Input
                inputMode="decimal"
                value={fare}
                onChange={(e) => setFare(e.target.value)}
                placeholder="Required"
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={() => {
              const fareValue = destructive && fare.trim() !== "" ? Number(fare) : undefined;
              if (
                destructive &&
                (fareValue === undefined || Number.isNaN(fareValue) || fareValue < 0)
              ) {
                toast.error("A valid total fare is required to end the trip.");
                return;
              }
              onSubmit(
                {
                  type: stopType,
                  dwellSeconds: stopType === "signalized" ? dwellSec : undefined,
                  boarding: Math.max(0, parseInt(board) || 0),
                  alighting: Math.max(0, parseInt(alight) || 0),
                  notes: notes.trim() || undefined,
                },
                fareValue,
              );
            }}
          >
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StopObservationsList({ stops }: { stops: Stop[] }) {
  const observations = stops.filter((stop) => stop.notes?.trim());

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Stop observations</h3>
          <p className="text-xs text-muted-foreground">
            Each visit is shown separately, even for the same stop.
          </p>
        </div>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          {observations.length} entries
        </span>
      </div>
      {observations.length === 0 ? (
        <div className="rounded-xl border border-dashed border-muted p-4 text-sm text-muted-foreground">
          No stop observations yet. Add an observation when logging a stop.
        </div>
      ) : (
        <div className="space-y-3">
          {observations.map((stop) => (
            <div key={stop.id} className="rounded-2xl border bg-muted/5 p-4 sm:p-5">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground sm:text-[11px]">
                    {stop.type === "signalized" ? "Signal stop" : "Regular stop"}
                    {stop.intersectionName ? ` · ${stop.intersectionName}` : ""}
                  </div>
                  <div className="mt-1 font-semibold">{new Date(stop.ts).toLocaleTimeString()}</div>
                </div>
                <div className="text-sm text-muted-foreground">
                  {stop.type === "signalized" ? "Signal stop entry" : "Regular stop entry"}
                </div>
              </div>
              <p className="mt-3 text-sm leading-6 text-foreground">{stop.notes}</p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function TripCard({ trip, onDelete }: { trip: Trip; onDelete: () => void }) {
  const dur = (trip.endedAt ?? trip.startedAt) - trip.startedAt;
  return (
    <Card className="p-3 shadow-card sm:p-4">
      <div className="flex items-start justify-between gap-2 sm:gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <Badge variant={trip.uploaded ? "default" : "outline"} className="text-[10px]">
              {trip.uploaded ? "UPLOADED" : "ON DEVICE"}
            </Badge>
            <span className="font-mono text-[10px] text-muted-foreground">{trip.id}</span>
          </div>
          <div className="mt-1 text-sm font-semibold leading-snug sm:truncate">
            {trip.origin} → {trip.destination}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {new Date(trip.startedAt).toLocaleString()}
          </div>
          {trip.routeType && (
            <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
              <RouteIcon className="h-3 w-3 text-accent" />
              {trip.routeType.name || trip.routeType.code}
            </p>
          )}
        </div>
        <Button size="icon" variant="ghost" onClick={onDelete}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="font-mono text-sm font-semibold">{fmtDuration(dur)}</div>
          <div className="text-[10px] text-muted-foreground">time</div>
        </div>
        <div>
          <div className="font-mono text-sm font-semibold">{fmtKm(trip.distanceMeters)}</div>
          <div className="text-[10px] text-muted-foreground">distance</div>
        </div>
        <div>
          <div className="font-mono text-sm font-semibold">{trip.stops.length}</div>
          <div className="text-[10px] text-muted-foreground">stops</div>
        </div>
      </div>
    </Card>
  );
}
