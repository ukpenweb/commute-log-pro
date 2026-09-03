import { useEffect, useState } from "react";
import {
  ApiError,
  downloadAdminTripShapefile,
  downloadAdminTripZip,
  fetchAdminTripDetail,
  fetchAdminTripObservations,
  loadToken,
  type AdminTrip,
  type AdminTripDetail,
  type TripObservation,
} from "@/lib/api";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CloudDownload,
  Layers,
  Loader2,
  MapPin,
  Route as RouteIcon,
  Shield,
  Truck,
  User,
  CalendarDays,
} from "lucide-react";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/utils";

type Props = {
  trip: AdminTrip | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSessionExpired: () => void;
};

function ObservationRow({ obs }: { obs: TripObservation }) {
  const ts = typeof obs.ts === "number" ? new Date(obs.ts) : null;
  const lat = typeof obs.lat === "number" ? obs.lat.toFixed(6) : null;
  const lng = typeof obs.lng === "number" ? obs.lng.toFixed(6) : null;
  return (
    <li className="flex items-start justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2">
      <div className="min-w-0">
        <p className="text-xs font-medium capitalize">
          {obs.record_type?.replace(/_/g, " ") || "record"}
        </p>
        <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
          {ts ? ts.toLocaleString(undefined, { dateStyle: "short", timeStyle: "medium" }) : "—"}
        </p>
      </div>
      <div className="shrink-0 text-right font-mono text-[10px] text-muted-foreground">
        {lat && lng ? (
          <span>
            {lat}, {lng}
          </span>
        ) : (
          "—"
        )}
      </div>
    </li>
  );
}

export function AdminTripDetailSheet({ trip, open, onOpenChange, onSessionExpired }: Props) {
  const [detail, setDetail] = useState<AdminTripDetail | null>(null);
  const [observations, setObservations] = useState<TripObservation[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState<"csv" | "shapefile" | null>(null);

  useEffect(() => {
    if (!open || !trip) return;
    let cancelled = false;
    const tok = loadToken();
    if (!tok) {
      onSessionExpired();
      return;
    }
    setLoading(true);
    setDetail(null);
    setObservations([]);
    Promise.all([
      fetchAdminTripDetail(tok, trip.tripId, trip.unit_id || undefined),
      fetchAdminTripObservations(tok, trip.tripId, trip.unit_id || undefined),
    ])
      .then(([d, o]) => {
        if (cancelled) return;
        setDetail(d);
        setObservations(Array.isArray(o) ? o : []);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          onSessionExpired();
        } else {
          toast.error(err instanceof Error ? err.message : "Failed to load trip detail");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, trip, onSessionExpired]);

  const download = async (kind: "csv" | "shapefile") => {
    if (!trip) return;
    const tok = loadToken();
    if (!tok) {
      onSessionExpired();
      return;
    }
    setDownloading(kind);
    try {
      if (kind === "csv") {
        await downloadAdminTripZip(tok, trip.tripId, trip.unit_id || undefined);
        toast.success(`CSV ZIP downloaded · ${trip.tripId}`);
      } else {
        await downloadAdminTripShapefile(tok, trip.tripId, trip.unit_id || undefined);
        toast.success(`Shapefile downloaded · ${trip.tripId}`);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onSessionExpired();
      } else {
        toast.error(err instanceof Error ? err.message : "Download failed");
      }
    } finally {
      setDownloading(null);
    }
  };

  const meta = [
    { icon: CalendarDays, label: "Date", value: formatDateTime(detail?.date ?? trip?.date) },
    { icon: Truck, label: "Vehicle", value: detail?.vehicleType || trip?.vehicleType || "—" },
    {
      icon: Shield,
      label: "Capacity",
      value: detail?.passengerCapacity != null ? String(detail.passengerCapacity) : "—",
    },
    {
      icon: User,
      label: "Owner",
      value:
        detail?.owner_name || detail?.owner_email || trip?.owner_name || trip?.owner_email || "—",
    },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col p-4 sm:max-w-md sm:p-6">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            {detail?.originDestination || trip?.originDestination || "Trip detail"}
          </SheetTitle>
          <SheetDescription className="break-all font-mono text-[11px]">
            {trip?.tripId}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={downloading !== null}
            onClick={() => download("csv")}
          >
            {downloading === "csv" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CloudDownload className="h-3.5 w-3.5" />
            )}
            CSV ZIP
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={downloading !== null}
            onClick={() => download("shapefile")}
          >
            {downloading === "shapefile" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Layers className="h-3.5 w-3.5" />
            )}
            Shapefile
          </Button>
          <Badge variant="outline" className="ml-auto capitalize">
            {detail?.status || trip?.status || "—"}
          </Badge>
        </div>

        <div className="mt-5 flex-1 space-y-4 overflow-y-auto pb-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading trip…
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                {meta.map((m) => (
                  <div key={m.label} className="rounded-md border p-3">
                    <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                      <m.icon className="h-3.5 w-3.5" />
                      {m.label}
                    </p>
                    <p className="mt-1 text-sm font-medium leading-snug">{m.value}</p>
                  </div>
                ))}
              </div>
              <div className="rounded-md border p-3">
                <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <RouteIcon className="h-3.5 w-3.5" />
                  Route type
                </p>
                <p className="mt-1 text-sm font-medium leading-snug">
                  {detail?.routeType || trip?.routeType || "—"}
                </p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Owner unit
                </p>
                <p className="mt-1 break-all font-mono text-xs">
                  {detail?.unit_id || trip?.unit_id || "—"}
                </p>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium">
                  Observations
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {observations.length}
                  </span>
                </p>
                {observations.length === 0 ? (
                  <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                    No observations recorded for this trip.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {observations.map((obs, i) => (
                      <ObservationRow key={obs.id ?? i} obs={obs} />
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
