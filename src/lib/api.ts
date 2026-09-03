import type { RouteType, Trip, VehicleType } from "@/lib/types";
import { prepareTripsForUpload } from "@/lib/tripGps";

export const API_BASE = "https://data-collection-backend-chi.vercel.app";

const TOKEN_KEY = "transit_auth_token_v1";

export type Token = {
  access_token: string;
  token_type: string;
};

export type User = {
  email?: string | null;
  name?: string | null;
  id: number;
  unit_id: string;
};

export function loadToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function saveToken(token: string | null) {
  if (!token) localStorage.removeItem(TOKEN_KEY);
  else localStorage.setItem(TOKEN_KEY, token);
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function fail(res: Response): Promise<never> {
  let message = res.statusText || "Request failed";
  try {
    const data = await res.json();
    if (Array.isArray(data.detail)) {
      message = data.detail.map((d: { msg: string }) => d.msg).join(", ");
    } else if (typeof data.detail === "string") {
      message = data.detail;
    }
  } catch {
    /* ignore */
  }
  throw new ApiError(message, res.status);
}

export async function register(email: string, name: string, password: string): Promise<User> {
  const res = await fetch(`${API_BASE}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, name: name || null, password }),
  });
  if (!res.ok) await fail(res);
  return res.json();
}

export async function login(email: string, password: string): Promise<Token> {
  const body = new URLSearchParams();
  body.set("username", email);
  body.set("password", password);

  const res = await fetch(`${API_BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) await fail(res);
  return res.json();
}

export async function getMe(token: string): Promise<User> {
  const res = await fetch(`${API_BASE}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) await fail(res);
  return res.json();
}

export type UploadResult = {
  repaired: Trip[];
  skippedStops: number;
  filled: number;
};

export type RemoteTrip = {
  tripId: string;
  originDestination: string;
  date: string;
};

export type RemoteTripsResponse = {
  trips: RemoteTrip[];
};

export async function fetchRemoteTrips(token: string): Promise<RemoteTrip[]> {
  const res = await fetch(`${API_BASE}/api/v1/data/trips`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) await fail(res);
  const data = (await res.json()) as RemoteTripsResponse;
  return data.trips ?? [];
}

export async function fetchVehicleTypes(token: string): Promise<VehicleType[]> {
  const res = await fetch(`${API_BASE}/api/v1/data/vehicle-types`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) await fail(res);
  const data = await res.json();
  return (Array.isArray(data) ? data : []).map((item) => ({
    ...item,
    id: String(item.id),
    code: String(item.code),
  })) as VehicleType[];
}

/** Fetch route operation types (Fixed-Route / Demand-Responsive). */
export async function fetchRouteTypes(token: string): Promise<RouteType[]> {
  const res = await fetch(`${API_BASE}/api/v1/data/route-types`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) await fail(res);
  const data = await res.json();
  return (Array.isArray(data) ? data : [])
    .filter((item) => item && typeof item.code === "string" && item.code !== "")
    .map((item) => ({
      ...item,
      id: String(item.id),
      code: String(item.code),
      name: String(item.name ?? item.code),
    })) as RouteType[];
}

export type EndTripResult = {
  tripId: string;
  status: "completed";
  fare: number | null;
  completedAt: string;
  message: string;
};

export async function endTrip(
  tripId: string,
  token: string,
  speedMps: number,
  fare?: number | null,
): Promise<EndTripResult> {
  const body: Record<string, unknown> = {
    tripId,
    speedMps,
  };
  if (fare !== undefined) {
    body.fare = fare;
  }

  const res = await fetch(`${API_BASE}/api/v1/data/trip/end`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) await fail(res);
  return res.json();
}

function filenameFromDisposition(header: string | null, fallback: string): string {
  const match = header?.match(/filename\*?=(?:UTF-8''|")?([^";\n]+)"?/i);
  return match?.[1]?.trim() ?? fallback;
}

async function downloadTripAttachment(
  path: string,
  token: string,
  fallbackFilename: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) await fail(res);

  const blob = await res.blob();
  const filename = filenameFromDisposition(
    res.headers.get("content-disposition"),
    fallbackFilename,
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Download processed trip data (ZIP of CSVs) from the backend. */
export function downloadTripProcessZip(tripId: string, token: string): Promise<void> {
  return downloadTripAttachment(
    `/api/v1/data/process/${encodeURIComponent(tripId)}`,
    token,
    `trip_${tripId}.zip`,
  );
}

/** Download trip shapefile ZIP. Fails with 404 if the trip has no GPS points on the server. */
export function downloadTripShapefileZip(tripId: string, token: string): Promise<void> {
  return downloadTripAttachment(
    `/api/v1/data/process/${encodeURIComponent(tripId)}/shapefile`,
    token,
    `trip_${tripId}_shapefile.zip`,
  );
}

export async function uploadTrips(trips: Trip[], token: string): Promise<UploadResult> {
  const { payloads, repaired, skippedStops, filled } = prepareTripsForUpload(trips);
  const form = new FormData();
  const blob = new Blob([JSON.stringify(payloads)], {
    type: "application/json",
  });
  form.append("file", blob, "trips.json");

  const res = await fetch(`${API_BASE}/api/v1/data/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) await fail(res);
  return { repaired, skippedStops, filled };
}

/* ------------------------------------------------------------------ */
/* Admin API                                                           */
/* ------------------------------------------------------------------ */

export type AdminRole = "user" | "admin" | "superadmin";

export type AdminUser = {
  id: number;
  email: string | null;
  name: string | null;
  role: AdminRole;
  unit_id: string;
  is_active: boolean;
};

export type AdminUsersResponse = {
  total: number;
  users: AdminUser[];
};

export type AdminUsersQuery = {
  search?: string;
  role?: string;
  is_active?: boolean;
  offset?: number;
  limit?: number;
};

export type AdminTrip = {
  tripId: string;
  unit_id: string;
  owner_email: string | null;
  owner_name: string | null;
  originDestination: string;
  date: string;
  vehicleType: string;
  passengerCapacity: number;
  routeType?: string;
  status: string;
};

export type AdminTripsResponse = {
  total: number;
  trips: AdminTrip[];
};

export type AdminTripsQuery = {
  unit_id?: string;
  status?: string;
  date_from?: string;
  date_to?: string;
  offset?: number;
  limit?: number;
};

export type AdminTripDetail = AdminTrip & {
  [key: string]: unknown;
};

export type TripObservation = {
  id?: number;
  record_type?: string;
  ts?: number;
  lat?: number | null;
  lng?: number | null;
  [key: string]: unknown;
};

export type AdminCreateUserInput = {
  email: string;
  password: string;
  name?: string | null;
  role?: AdminRole;
};

export type AdminUpdateUserInput = {
  name?: string | null;
  email?: string;
  password?: string;
  is_active?: boolean;
};

const ADMIN_BASE = `${API_BASE}/api/v1/admin`;

async function adminJson<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (init?.body && !(init.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`${ADMIN_BASE}${path}`, {
    ...init,
    headers: { ...headers, ...init?.headers },
  });
  if (!res.ok) await fail(res);
  return res.json();
}

async function adminVoid(token: string, path: string, init?: RequestInit): Promise<void> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (init?.body && !(init.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`${ADMIN_BASE}${path}`, {
    ...init,
    headers: { ...headers, ...init?.headers },
  });
  if (!res.ok) await fail(res);
}

function normalizeAdminUsers(data: unknown): AdminUser[] {
  if (Array.isArray(data)) return data as AdminUser[];
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (Array.isArray(d.admins)) return d.admins as AdminUser[];
    if (Array.isArray(d.users)) return d.users as AdminUser[];
    if (Array.isArray(d.items)) return d.items as AdminUser[];
    if (Array.isArray(d.data)) return d.data as AdminUser[];
  }
  return [];
}

export async function fetchAdminUsers(
  token: string,
  query: AdminUsersQuery = {},
): Promise<AdminUsersResponse> {
  const params = new URLSearchParams();
  if (query.search) params.set("search", query.search);
  if (query.role) params.set("role", query.role);
  if (query.is_active !== undefined) params.set("is_active", String(query.is_active));
  if (query.offset !== undefined) params.set("offset", String(query.offset));
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  const qs = params.toString();
  const data = await adminJson<unknown>(token, `/users${qs ? `?${qs}` : ""}`);
  if (Array.isArray(data)) {
    return { total: data.length, users: data as AdminUser[] };
  }
  const d = (data ?? {}) as Partial<AdminUsersResponse>;
  return {
    total: typeof d.total === "number" ? d.total : Array.isArray(d.users) ? d.users.length : 0,
    users: Array.isArray(d.users) ? d.users : [],
  };
}

export function createAdminUser(token: string, input: AdminCreateUserInput): Promise<AdminUser> {
  return adminJson(token, "/users", { method: "POST", body: JSON.stringify(input) });
}

export function fetchAdminUser(token: string, userId: number): Promise<AdminUser> {
  return adminJson(token, `/users/${userId}`);
}

export function updateAdminUser(
  token: string,
  userId: number,
  input: AdminUpdateUserInput,
): Promise<AdminUser> {
  return adminJson(token, `/users/${userId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteAdminUser(token: string, userId: number): Promise<void> {
  return adminVoid(token, `/users/${userId}`, { method: "DELETE" });
}

export function updateAdminUserRole(
  token: string,
  userId: number,
  role: AdminRole,
): Promise<AdminUser> {
  return adminJson(token, `/users/${userId}/role`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
}

export async function fetchAdmins(token: string): Promise<AdminUser[]> {
  return normalizeAdminUsers(await adminJson<unknown>(token, "/admins"));
}

export async function fetchAdminAssignedUsers(
  token: string,
  adminId: number,
): Promise<AdminUser[]> {
  return normalizeAdminUsers(await adminJson<unknown>(token, `/admins/${adminId}/users`));
}

export function assignUsersToAdmin(
  token: string,
  adminId: number,
  userIds: number[],
): Promise<AdminUser[]> {
  return adminJson(token, `/admins/${adminId}/users`, {
    method: "POST",
    body: JSON.stringify({ user_ids: userIds }),
  });
}

export function removeAdminAssignment(
  token: string,
  adminId: number,
  userId: number,
): Promise<void> {
  return adminVoid(token, `/admins/${adminId}/users/${userId}`, { method: "DELETE" });
}

export function fetchAdminTrips(
  token: string,
  query: AdminTripsQuery = {},
): Promise<AdminTripsResponse> {
  const params = new URLSearchParams();
  if (query.unit_id) params.set("unit_id", query.unit_id);
  if (query.status) params.set("status", query.status);
  if (query.date_from) params.set("date_from", query.date_from);
  if (query.date_to) params.set("date_to", query.date_to);
  if (query.offset !== undefined) params.set("offset", String(query.offset));
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  const qs = params.toString();
  return adminJson(token, `/trips${qs ? `?${qs}` : ""}`);
}

export function fetchAdminTripDetail(
  token: string,
  tripId: string,
  unitId?: string,
): Promise<AdminTripDetail> {
  const params = unitId ? `?unit_id=${encodeURIComponent(unitId)}` : "";
  return adminJson(token, `/trips/${encodeURIComponent(tripId)}${params}`);
}

export function fetchAdminTripObservations(
  token: string,
  tripId: string,
  unitId?: string,
): Promise<TripObservation[]> {
  const params = unitId ? `?unit_id=${encodeURIComponent(unitId)}` : "";
  return adminJson(token, `/trips/${encodeURIComponent(tripId)}/observations${params}`);
}

/** Download trip data ZIP (points.csv, stops.csv, routes.csv) scoped to the admin view. */
export function downloadAdminTripZip(
  token: string,
  tripId: string,
  unitId?: string,
): Promise<void> {
  const params = unitId ? `?unit_id=${encodeURIComponent(unitId)}` : "";
  return downloadTripAttachment(
    `/api/v1/admin/trips/${encodeURIComponent(tripId)}/download${params}`,
    token,
    `trip_${tripId}_admin.zip`,
  );
}

/** Download ESRI Shapefile ZIP of GPS points scoped to the admin view. */
export function downloadAdminTripShapefile(
  token: string,
  tripId: string,
  unitId?: string,
): Promise<void> {
  const params = unitId ? `?unit_id=${encodeURIComponent(unitId)}` : "";
  return downloadTripAttachment(
    `/api/v1/admin/trips/${encodeURIComponent(tripId)}/shapefile${params}`,
    token,
    `trip_${tripId}_admin_shapefile.zip`,
  );
}

/** Download all data_records (JSON) for a user, scoped to the admin view. */
export function downloadAdminUserData(token: string, userId: number): Promise<unknown[]> {
  return adminJson(token, `/users/${userId}/data`);
}
