import { useEffect, useMemo, useState } from "react";
import {
  addDays,
  addHours,
  format,
  parseISO,
  startOfWeek,
} from "date-fns";
import {
  ArrowLeft,
  ArrowRight,
  CarFront,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Clock3,
  LoaderCircle,
  LogOut,
  MapPin,
  Plus,
  RefreshCw,
  UserRound,
  X,
} from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

function parseServerDate(value, time) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const normalized = String(value).includes("T")
    ? String(value)
    : String(value).includes(" ")
      ? String(value).replace(" ", "T")
      : `${value}T${time ?? "13:00"}`;
  const date = parseISO(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeReservations(payload) {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.reservations)
      ? payload.reservations
      : Array.isArray(payload?.items)
        ? payload.items
        : [];

  return rows
    .filter((row) => (row.action ?? "RESERVE") === "RESERVE")
    .map((row, index) => {
      const start = parseServerDate(
        row.start_time ?? row.reservation_date ?? row.date,
        row.reservation_starttime ?? row.starttime,
      );
      if (!start) return null;
      const end = parseServerDate(row.effective_end_time ?? row.end_time, row.endtime);
      const duration = Number(row.hours) || (end ? Math.max(1, (end - start) / 3600000) : 1);
      const email = row.user_id ?? row.user ?? "Reservation owner";
      const status = String(row.status ?? "WAITLISTED").toUpperCase();
      return {
        id: row.id ?? row.transaction_id ?? row.reservation_id ?? `live-${index}`,
        date: start,
        start,
        end: end ?? addHours(start, duration),
        hours: duration,
        user: row.user_name ?? row.name ?? email,
        userId: email,
        createdAt: parseServerDate(row.created_at),
        spot: row.spot_id ?? row.spot_allocation ?? row.assigned_spot ?? "—",
        vehicle: row.vehicle_type ?? row.vehicle ?? "Vehicle",
        purpose: row.purpose ?? "Reservation",
        status,
      };
    })
    .filter(Boolean);
}

function App() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [reservations, setReservations] = useState([]);
  const [parkingSpotIds, setParkingSpotIds] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [apiNote, setApiNote] = useState("");
  const [configNote, setConfigNote] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState("");
  const [pendingAction, setPendingAction] = useState(null);
  const [actionNotice, setActionNotice] = useState(null);
  const [collapsedDates, setCollapsedDates] = useState(() => new Set());
  const [form, setForm] = useState({
    user_id: "",
    vehicle_type: "Car",
    reservation_date: format(new Date(), "yyyy-MM-dd"),
    reservation_starttime: "13:00",
    hours: "9",
    preferred_spot_id: "",
    purpose: "",
  });

  const weekEnd = addDays(weekStart, 6);
  const visibleReservations = useMemo(
    () => reservations
      .filter((reservation) => reservation.date >= weekStart && reservation.date < addDays(weekEnd, 1))
      .sort((a, b) => {
        const dateDifference = a.date - b.date;
        if (dateDifference !== 0) return dateDifference;
        const aCreated = a.createdAt?.getTime() ?? Number(a.id);
        const bCreated = b.createdAt?.getTime() ?? Number(b.id);
        return aCreated - bCreated;
      }),
    [reservations, weekStart, weekEnd],
  );
  const reservationsByDate = useMemo(() => {
    const groups = new Map();
    for (const reservation of visibleReservations) {
      const dateKey = format(reservation.date, "yyyy-MM-dd");
      if (!groups.has(dateKey)) groups.set(dateKey, []);
      groups.get(dateKey).push(reservation);
    }
    return [...groups.entries()].sort(([dateA], [dateB]) => dateB.localeCompare(dateA));
  }, [visibleReservations]);
  const weekLabel = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).formatRange(weekStart, weekEnd);

  async function loadReservations() {
    setIsLoading(true);
    setApiNote("");
    try {
      const query = new URLSearchParams({
        start_date: format(weekStart, "yyyy-MM-dd"),
        end_date: format(addDays(weekStart, 7), "yyyy-MM-dd"),
      });
      const response = await fetch(`${API_BASE}/reservations?${query}`, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`Reservations returned ${response.status}`);
      const data = await response.json();
      const rows = Array.isArray(data)
        ? data
        : Array.isArray(data?.reservations)
          ? data.reservations
          : Array.isArray(data?.items)
            ? data.items
            : null;
      if (rows === null) throw new Error("The reservations endpoint has not returned a reservation list yet.");
      const parsed = normalizeReservations(rows);
      setReservations(parsed);
    } catch (error) {
      setReservations([]);
      setApiNote(error.message);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadReservations();
  }, [weekStart]);

  async function loadConfig() {
    setConfigNote("");
    try {
      const response = await fetch(`${API_BASE}/config`, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`Parking config returned ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data?.parking_spot_ids)) {
        throw new Error("The parking config endpoint did not return a parking spot list.");
      }
      setParkingSpotIds(data.parking_spot_ids);
    } catch (error) {
      setParkingSpotIds([]);
      setConfigNote(error.message);
    }
  }

  useEffect(() => {
    loadConfig();
  }, []);

  function updateForm(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function submitReservation(event) {
    event.preventDefault();
    setSubmitError("");
    setSubmitSuccess("");
    setSubmitting(true);
    const payload = {
      ...form,
      hours: Number(form.hours),
      preferred_spot_id: form.preferred_spot_id || null,
    };

    try {
      const response = await fetch(`${API_BASE}/reserve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.detail ?? result?.error ?? `Reservation request failed (${response.status}).`);
      }
      if (!result || result.success === false || result === null) {
        throw new Error(result?.error ?? "The API responded without confirming the reservation. Check that /reserve is implemented.");
      }
      if (result.success !== true && !result.reservation_id && !result.transaction_id) {
        throw new Error("The API response did not include a reservation confirmation.");
      }

      await loadReservations();
      setSubmitSuccess(`Reservation ${result.reservation_id ?? result.transaction_id ?? "created"} was added.`);
      setForm((current) => ({ ...current, purpose: "" }));
    } catch (error) {
      setSubmitError(error.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function runLifecycleAction(action, reservation) {
    setPendingAction(`${reservation.id}:${action}`);
    setActionNotice(null);
    try {
      const response = await fetch(`${API_BASE}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          user_id: reservation.userId,
          ref_transaction_id: Number(reservation.id),
        }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.detail ?? result?.error ?? `${action} request failed (${response.status}).`);
      }
      if (!result || result.success !== true) {
        throw new Error(result?.error ?? `The API did not confirm the ${action} action.`);
      }

      await loadReservations();
      setActionNotice({
        kind: "success",
        text: action === "confirm"
          ? `${reservation.user}'s arrival was recorded.`
          : `${reservation.user}'s reservation was released.`,
      });
    } catch (error) {
      setActionNotice({ kind: "error", text: error.message });
    } finally {
      setPendingAction(null);
    }
  }

  function openForm() {
    setSubmitError("");
    setSubmitSuccess("");
    setFormOpen(true);
  }

  function toggleDate(dateKey) {
    setCollapsedDates((current) => {
      const next = new Set(current);
      if (next.has(dateKey)) next.delete(dateKey);
      else next.add(dateKey);
      return next;
    });
  }

  return (
    <div className="app-shell">
      <main className="page-content">
        <header className="page-header">
          <div>
            <h1>Reservations</h1>
            <p>{weekLabel}{format(weekEnd, " yyyy")}</p>
          </div>
          <div className="toolbar-actions">
            <div className="week-controls" aria-label="Change week">
              <button type="button" className="icon-button" onClick={() => setWeekStart((date) => addDays(date, -7))} title="Previous week" aria-label="Previous week"><ArrowLeft size={17} /></button>
              <button type="button" className="today-button" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>Today</button>
              <button type="button" className="icon-button" onClick={() => setWeekStart((date) => addDays(date, 7))} title="Next week" aria-label="Next week"><ArrowRight size={17} /></button>
            </div>
            <button type="button" className="refresh-button" onClick={loadReservations} disabled={isLoading} title="Refresh reservations" aria-label="Refresh reservations"><RefreshCw size={15} className={isLoading ? "spin" : ""} /></button>
            <button type="button" className="primary-button" onClick={openForm}><Plus size={17} /><span>New reservation</span></button>
          </div>
        </header>

        <section className={`workspace ${formOpen ? "workspace-form-open" : ""}`}>
          <div className="calendar-panel">
            {apiNote && <div className="api-notice" role="alert"><CircleAlert size={15} /><span><strong>Could not load reservations.</strong> {apiNote}</span><button type="button" onClick={loadReservations}>Retry</button></div>}
            {configNote && <div className="api-notice" role="alert"><CircleAlert size={15} /><span><strong>Could not load parking settings.</strong> {configNote}</span><button type="button" onClick={loadConfig}>Retry</button></div>}
            {actionNotice && <div className={`action-notice action-notice-${actionNotice.kind}`} role={actionNotice.kind === "error" ? "alert" : "status"}>{actionNotice.text}</div>}

            <div className="table-scroll">
              <table className="reservation-table">
                <thead>
                  <tr><th scope="col">Time</th><th scope="col">Reserved for</th><th scope="col">Space</th><th scope="col">Vehicle</th><th scope="col">Created</th><th scope="col">Status</th></tr>
                </thead>
                {isLoading ? (
                  <tbody>
                    <tr><td className="table-message" colSpan="6"><LoaderCircle size={16} className="spin" />Loading reservations…</td></tr>
                  </tbody>
                ) : reservationsByDate.length === 0 ? (
                  <tbody>
                    <tr><td className="table-message" colSpan="6">No reservations this week.</td></tr>
                  </tbody>
                ) : reservationsByDate.map(([dateKey, dayReservations]) => (
                  <tbody className="reservation-date-group" key={dateKey} id={`reservations-${dateKey}`}>
                    <tr className="date-group-heading">
                      <th scope="rowgroup" colSpan="6">
                        <button
                          type="button"
                          className="date-group-toggle"
                          aria-expanded={!collapsedDates.has(dateKey)}
                          aria-controls={`reservations-${dateKey}`}
                          onClick={() => toggleDate(dateKey)}
                        >
                          <span>{format(dayReservations[0].date, "EEEE, MMMM d, yyyy")}</span>
                          <span className="date-group-count">{dayReservations.length} {dayReservations.length === 1 ? "reservation" : "reservations"}</span>
                          <ChevronDown size={16} className={collapsedDates.has(dateKey) ? "date-group-chevron date-group-chevron-collapsed" : "date-group-chevron"} />
                        </button>
                      </th>
                    </tr>
                    {!collapsedDates.has(dateKey) && dayReservations.map((reservation) => (
                      <tr key={reservation.id} className={`reservation-row reservation-${reservation.status.toLowerCase()}`}>
                        <td>{format(reservation.start, "h:mm a")} – {format(reservation.end, "h:mm a")}</td>
                        <td title={reservation.user}>{reservation.user}</td>
                        <td>{reservation.spot}</td>
                        <td>{reservation.vehicle}</td>
                        <td>{reservation.createdAt ? format(reservation.createdAt, "MMM d, h:mm a") : "—"}</td>
                        <td>
                          <div className="status-actions">
                            <span className={`status-badge status-${reservation.status.toLowerCase()}`}>{reservation.status}</span>
                            {reservation.status === "ALLOCATED" && <button type="button" className="table-action" onClick={() => runLifecycleAction("confirm", reservation)} disabled={pendingAction !== null} aria-label={`Record arrival for ${reservation.user}`} title="Record driver arrival">{pendingAction === `${reservation.id}:confirm` ? <LoaderCircle size={13} className="spin" /> : <CircleCheck size={13} />}<span>Record arrival</span></button>}
                            {reservation.status !== "RELEASED" && <button type="button" className="table-action table-action-release" onClick={() => runLifecycleAction("release", reservation)} disabled={pendingAction !== null} aria-label={`Release reservation for ${reservation.user}`} title="Release reservation">{pendingAction === `${reservation.id}:release` ? <LoaderCircle size={13} className="spin" /> : <LogOut size={13} />}<span>Release</span></button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
          </div>

          {formOpen && (
            <aside className="reservation-drawer" aria-labelledby="form-title">
              <div className="drawer-header">
                <div><span className="section-kicker">NEW BOOKING</span><h2 id="form-title">Reserve a space</h2></div>
                <button type="button" className="icon-button drawer-close" onClick={() => setFormOpen(false)} aria-label="Close reservation form"><X size={18} /></button>
              </div>
              <p className="drawer-intro">Add a vehicle to the weekly parking schedule.</p>
              <form className="reservation-form" onSubmit={submitReservation}>
                <label className="field-label" htmlFor="user_id">Reserved for <span>REQUIRED</span></label>
                <div className="input-wrap"><UserRound size={16} /><input id="user_id" name="user_id" type="email" placeholder="email@viseo.com" value={form.user_id} onChange={updateForm} required /></div>

                <label className="field-label" htmlFor="vehicle_type">Vehicle type <span>REQUIRED</span></label>
                <div className="select-wrap"><CarFront size={16} /><select id="vehicle_type" name="vehicle_type" value={form.vehicle_type} onChange={updateForm} required><option>Car</option><option>Motorcycle</option></select><ChevronDown size={15} /></div>

                <div className="field-row">
                  <div className="field-group"><label className="field-label" htmlFor="reservation_date">Date <span>REQUIRED</span></label><input id="reservation_date" name="reservation_date" type="date" value={form.reservation_date} onChange={updateForm} required /></div>
                  <div className="field-group"><label className="field-label" htmlFor="reservation_starttime">Start <span>REQUIRED</span></label><input id="reservation_starttime" name="reservation_starttime" type="time" value={form.reservation_starttime} onChange={updateForm} required /></div>
                </div>

                <label className="field-label" htmlFor="hours">Duration <span>HOURS</span></label>
                <div className="select-wrap"><Clock3 size={16} /><select id="hours" name="hours" value={form.hours} onChange={updateForm}>{Array.from({ length: 12 }, (_, index) => index + 1).map((hour) => <option value={hour} key={hour}>{hour} {hour === 1 ? "hour" : "hours"}</option>)}</select><ChevronDown size={15} /></div>

                <label className="field-label" htmlFor="preferred_spot_id">Preferred space <span>OPTIONAL</span></label>
                <div className="select-wrap"><MapPin size={16} /><select id="preferred_spot_id" name="preferred_spot_id" value={form.preferred_spot_id} onChange={updateForm}><option value="">Any available space</option>{parkingSpotIds.map((spot) => <option value={spot} key={spot}>{spot}</option>)}</select><ChevronDown size={15} /></div>

                <label className="field-label" htmlFor="purpose">Purpose <span>OPTIONAL</span></label>
                <textarea id="purpose" name="purpose" placeholder="Meeting, office visit..." rows="3" value={form.purpose} onChange={updateForm} maxLength={240} />

                {submitError && <div className="form-message form-error" role="alert"><CircleAlert size={16} /><span>{submitError}</span></div>}
                {submitSuccess && <div className="form-message form-success" role="status"><Check size={16} /><span>{submitSuccess}</span></div>}

                <div className="drawer-actions"><button type="button" className="cancel-button" onClick={() => setFormOpen(false)}>Cancel</button><button type="submit" className="primary-button submit-button" disabled={submitting}>{submitting ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}<span>{submitting ? "Submitting" : "Reserve space"}</span></button></div>
              </form>
              <div className="drawer-footnote"><CircleAlert size={14} /><span>Reservations are subject to available parking capacity.</span></div>
            </aside>
          )}
        </section>
      </main>
      {formOpen && <button className="mobile-scrim" type="button" aria-label="Close reservation form" onClick={() => setFormOpen(false)} />}
    </div>
  );
}

export default App;
