import { useEffect, useState } from "react";
import {
  ApiError,
  downloadAdminTripShapefile,
  downloadAdminTripZip,
  fetchAdminTrips,
  loadToken,
  type AdminTrip,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { CloudDownload, Eye, Layers, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { AdminTripDetailSheet } from "./AdminTripDetailSheet";
import { formatDateTime } from "@/lib/utils";

const PAGE_SIZE = 20;

type Props = {
  onSessionExpired: () => void;
};

export function AdminTripsTab({ onSessionExpired }: Props) {
  const [trips, setTrips] = useState<AdminTrip[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);

  const [statusFilter, setStatusFilter] = useState("");
  const [unitInput, setUnitInput] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);

  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminTrip | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setOffset(0), 300);
    return () => clearTimeout(t);
  }, [unitInput, dateFrom, dateTo, statusFilter]);

  useEffect(() => {
    let cancelled = false;
    const tok = loadToken();
    if (!tok) {
      onSessionExpired();
      return;
    }
    setLoading(true);
    fetchAdminTrips(tok, {
      unit_id: unitInput.trim() || undefined,
      status: statusFilter || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      offset,
      limit: PAGE_SIZE,
    })
      .then((res) => {
        if (cancelled) return;
        setTrips(res.trips ?? []);
        setTotal(res.total ?? 0);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          onSessionExpired();
          toast.error("Session expired — sign in again");
        } else {
          toast.error(err instanceof Error ? err.message : "Failed to load trips");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [statusFilter, unitInput, dateFrom, dateTo, offset, refreshTick, onSessionExpired]);

  const download = async (trip: AdminTrip, kind: "csv" | "shapefile") => {
    const tok = loadToken();
    if (!tok) {
      onSessionExpired();
      return;
    }
    const key = `${trip.tripId}:${kind}`;
    setDownloadingKey(key);
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
      setDownloadingKey(null);
    }
  };

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:flex-wrap">
        <div className="space-y-1.5">
          <Label htmlFor="trip-status">Status</Label>
          <Select
            value={statusFilter || undefined}
            onValueChange={(v) => setStatusFilter(v === "all" ? "" : v)}
          >
            <SelectTrigger id="trip-status" className="w-full lg:w-40">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="ongoing">Ongoing</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="trip-from">From</Label>
          <Input
            id="trip-from"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-full lg:w-44"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="trip-to">To</Label>
          <Input
            id="trip-to"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-full lg:w-44"
          />
        </div>
        <div className="space-y-1.5 lg:flex-1">
          <Label htmlFor="trip-unit">Unit ID</Label>
          <Input
            id="trip-unit"
            value={unitInput}
            onChange={(e) => setUnitInput(e.target.value)}
            placeholder="Filter by unit…"
            className="w-full lg:max-w-xs"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 shrink-0"
          title="Refresh"
          onClick={() => setRefreshTick((t) => t + 1)}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Route</TableHead>
              <TableHead className="hidden md:table-cell">Owner</TableHead>
              <TableHead className="hidden sm:table-cell">Vehicle</TableHead>
              <TableHead className="hidden sm:table-cell">Route type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && trips.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="h-28 text-center text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading trips…
                  </span>
                </TableCell>
              </TableRow>
            )}
            {!loading && trips.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="h-28 text-center text-sm text-muted-foreground">
                  No trips found.
                </TableCell>
              </TableRow>
            )}
            {trips.map((trip) => {
              const busy = downloadingKey !== null;
              const csvKey = `${trip.tripId}:csv`;
              const shpKey = `${trip.tripId}:shapefile`;
              return (
                <TableRow key={`${trip.unit_id}-${trip.tripId}`} className="cursor-pointer">
                  <TableCell className="whitespace-nowrap text-sm">
                    {formatDateTime(trip.date)}
                  </TableCell>
                  <TableCell className="max-w-[16rem]">
                    <p className="truncate font-medium">{trip.originDestination || "—"}</p>
                    <p className="hidden font-mono text-[10px] text-muted-foreground sm:block">
                      {trip.tripId}
                    </p>
                  </TableCell>
                  <TableCell className="hidden max-w-[12rem] md:table-cell">
                    <p className="truncate text-sm">{trip.owner_name || trip.owner_email || "—"}</p>
                  </TableCell>
                  <TableCell className="hidden text-sm sm:table-cell">
                    {trip.vehicleType || "—"}
                  </TableCell>
                  <TableCell className="hidden text-sm sm:table-cell">
                    {trip.routeType || "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {trip.status || "—"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="View"
                        onClick={() => setSelected(trip)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Download CSV ZIP"
                        disabled={busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          download(trip, "csv");
                        }}
                      >
                        {downloadingKey === csvKey ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <CloudDownload className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Download Shapefile"
                        disabled={busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          download(trip, "shapefile");
                        }}
                      >
                        {downloadingKey === shpKey ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Layers className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {total} trip{total === 1 ? "" : "s"} · page {page} of {pageCount}
        </span>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={offset === 0 || loading}
            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
          >
            Previous
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={offset + PAGE_SIZE >= total || loading}
            onClick={() => setOffset((o) => o + PAGE_SIZE)}
          >
            Next
          </Button>
        </div>
      </div>

      <AdminTripDetailSheet
        trip={selected}
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        onSessionExpired={onSessionExpired}
      />
    </div>
  );
}
