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

function atTime(date, time = "13:00") {
  return parseISO(`${format(date, "yyyy-MM-dd")}T${time}`);
}

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
      const status = String(row.status ?? "").toLowerCase();
      return {
        id: row.id ?? row.transaction_id ?? row.reservation_id ?? `live-${index}`,
        date: start,
        start,
        end: end ?? addHours(start, duration),
        hours: duration,
        user: row.user_name ?? row.name ?? email,
        userId: email,
        spot: row.spot_id ?? row.spot_allocation ?? row.assigned_spot ?? "Unassigned",
        vehicle: row.vehicle_type ?? row.vehicle ?? "Vehicle",
        purpose: row.purpose ?? "Reservation",
        confirmed: Boolean(row.confirmed ?? row.is_confirmed) || status === "confirmed",
      };
    })
    .filter(Boolean);
}

function App() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [reservations, setReservations] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [apiNote, setApiNote] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState("");
  const [pendingAction, setPendingAction] = useState(null);
  const [actionNotice, setActionNotice] = useState(null);
  const [form, setForm] = useState({
    user_id: "",
    vehicle_type: "Car",
    reservation_date: format(new Date(), "yyyy-MM-dd"),
    reservation_starttime: "13:00",
    hours: "2",
    preferred_spot_id: "",
    purpose: "",
  });

  const weekEnd = addDays(weekStart, 6);
  const visibleReservations = useMemo(
    () => reservations
      .filter((reservation) => reservation.date >= weekStart && reservation.date < addDays(weekEnd, 1))
      .sort((a, b) => a.date - b.date || a.start - b.start),
    [reservations, weekStart, weekEnd],
  );
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

      const start = atTime(parseISO(form.reservation_date), form.reservation_starttime);
      const added = {
        id: result.transaction_id ?? result.reservation_id ?? `local-${Date.now()}`,
        date: start,
        start,
        end: addHours(start, Number(form.hours)),
        hours: Number(form.hours),
        user: form.user_id,
        userId: form.user_id,
        spot: result.spot_allocation ?? result.assigned_spot ?? result.spot_id ?? "Assigned",
        vehicle: form.vehicle_type,
        purpose: form.purpose || "Reservation",
        confirmed: false,
      };
      setReservations((current) => [...current, added]);
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

      if (action === "confirm") {
        setReservations((current) => current.map((item) =>
          item.id === reservation.id ? { ...item, confirmed: true } : item,
        ));
        setActionNotice({ kind: "success", text: `${reservation.user}'s reservation is confirmed.` });
      } else {
        setReservations((current) => current.filter((item) => item.id !== reservation.id));
        setActionNotice({ kind: "success", text: `${reservation.user}'s reservation was released.` });
      }
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
            {actionNotice && <div className={`action-notice action-notice-${actionNotice.kind}`} role={actionNotice.kind === "error" ? "alert" : "status"}>{actionNotice.text}</div>}

            <div className="table-scroll">
              <table className="reservation-table">
                <thead>
                  <tr><th scope="col">Date</th><th scope="col">Time</th><th scope="col">Reserved for</th><th scope="col">Space</th><th scope="col">Vehicle</th><th scope="col">Status</th></tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr><td className="table-message" colSpan="6"><LoaderCircle size={16} className="spin" />Loading reservations…</td></tr>
                  ) : visibleReservations.length === 0 ? (
                    <tr><td className="table-message" colSpan="6">No reservations this week.</td></tr>
                  ) : visibleReservations.map((reservation) => (
                    <tr key={reservation.id} className={`reservation-row ${reservation.confirmed ? "reservation-confirmed" : "reservation-pending"}`}>
                      <td className="reservation-date">{format(reservation.date, "EEE, MMM d")}</td>
                      <td>{format(reservation.start, "h:mm a")} – {format(reservation.end, "h:mm a")}</td>
                      <td title={reservation.user}>{reservation.user}</td>
                      <td>{reservation.spot}</td>
                      <td>{reservation.vehicle}</td>
                      <td>
                        <div className="status-actions">
                          <span className={`status-badge ${reservation.confirmed ? "status-confirmed" : "status-pending"}`}>{reservation.confirmed ? "Confirmed" : "Pending"}</span>
                          {reservation.confirmed ? null : <button type="button" className="table-action" onClick={() => runLifecycleAction("confirm", reservation)} disabled={pendingAction !== null} aria-label={`Confirm reservation for ${reservation.user}`} title="Confirm reservation">{pendingAction === `${reservation.id}:confirm` ? <LoaderCircle size={13} className="spin" /> : <CircleCheck size={13} />}<span>Confirm</span></button>}
                          <button type="button" className="table-action table-action-release" onClick={() => runLifecycleAction("release", reservation)} disabled={pendingAction !== null} aria-label={`Release reservation for ${reservation.user}`} title="Release reservation">{pendingAction === `${reservation.id}:release` ? <LoaderCircle size={13} className="spin" /> : <LogOut size={13} />}<span>Release</span></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
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
                <div className="input-wrap"><UserRound size={16} /><input id="user_id" name="user_id" type="email" placeholder="name@company.com" value={form.user_id} onChange={updateForm} required /></div>

                <label className="field-label" htmlFor="vehicle_type">Vehicle type <span>REQUIRED</span></label>
                <div className="select-wrap"><CarFront size={16} /><select id="vehicle_type" name="vehicle_type" value={form.vehicle_type} onChange={updateForm} required><option>Car</option><option>Motorcycle</option></select><ChevronDown size={15} /></div>

                <div className="field-row">
                  <div className="field-group"><label className="field-label" htmlFor="reservation_date">Date <span>REQUIRED</span></label><input id="reservation_date" name="reservation_date" type="date" value={form.reservation_date} onChange={updateForm} required /></div>
                  <div className="field-group"><label className="field-label" htmlFor="reservation_starttime">Start <span>REQUIRED</span></label><input id="reservation_starttime" name="reservation_starttime" type="time" value={form.reservation_starttime} onChange={updateForm} required /></div>
                </div>

                <label className="field-label" htmlFor="hours">Duration <span>HOURS</span></label>
                <div className="select-wrap"><Clock3 size={16} /><select id="hours" name="hours" value={form.hours} onChange={updateForm}>{Array.from({ length: 12 }, (_, index) => index + 1).map((hour) => <option value={hour} key={hour}>{hour} {hour === 1 ? "hour" : "hours"}</option>)}</select><ChevronDown size={15} /></div>

                <label className="field-label" htmlFor="preferred_spot_id">Preferred space <span>OPTIONAL</span></label>
                <div className="select-wrap"><MapPin size={16} /><select id="preferred_spot_id" name="preferred_spot_id" value={form.preferred_spot_id} onChange={updateForm}><option value="">Any available space</option>{["A-1", "A-2", "B-1", "B-2", "B-3"].map((spot) => <option value={spot} key={spot}>{spot}</option>)}</select><ChevronDown size={15} /></div>

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
