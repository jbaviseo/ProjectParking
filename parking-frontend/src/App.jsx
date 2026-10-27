import { useEffect, useMemo, useState } from "react";
import {
  addDays,
  addHours,
  format,
  isSameDay,
  isToday,
  parseISO,
  startOfWeek,
} from "date-fns";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CarFront,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Clock3,
  Leaf,
  LoaderCircle,
  LogOut,
  MapPin,
  Plus,
  RefreshCw,
  UserRound,
  X,
} from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";
const SAMPLE_RESERVATIONS = [
  { day: 0, time: "08:30", hours: 2, name: "Alex Rivera", email: "alex.rivera@company.com", spot: "A-1", vehicle: "Car", purpose: "Client meeting", color: "mint" },
  { day: 0, time: "10:00", hours: 4, name: "Priya Shah", email: "priya.shah@company.com", spot: "B-2", vehicle: "Car", purpose: "Workshop", color: "coral" },
  { day: 1, time: "09:00", hours: 3, name: "Noah Chen", email: "noah.chen@company.com", spot: "A-2", vehicle: "Motorcycle", purpose: "Team planning", color: "blue" },
  { day: 1, time: "13:30", hours: 2, name: "Maya Brooks", email: "maya.brooks@company.com", spot: "B-1", vehicle: "Car", purpose: "Site visit", color: "yellow" },
  { day: 2, time: "08:00", hours: 6, name: "Ethan Park", email: "ethan.park@company.com", spot: "A-1", vehicle: "Car", purpose: "Operations", color: "blue" },
  { day: 2, time: "11:30", hours: 2, name: "Zoe Patel", email: "zoe.patel@company.com", spot: "B-3", vehicle: "Motorcycle", purpose: "Design review", color: "mint" },
  { day: 3, time: "09:30", hours: 3, name: "Sam Okafor", email: "sam.okafor@company.com", spot: "A-2", vehicle: "Car", purpose: "Partner meeting", color: "coral" },
  { day: 4, time: "08:30", hours: 4, name: "Lena Fischer", email: "lena.fischer@company.com", spot: "B-1", vehicle: "Car", purpose: "Quarterly review", color: "yellow" },
  { day: 4, time: "14:00", hours: 2, name: "Omar Ali", email: "omar.ali@company.com", spot: "B-3", vehicle: "Motorcycle", purpose: "Office visit", color: "mint" },
];

function atTime(date, time = "13:00") {
  return parseISO(`${format(date, "yyyy-MM-dd")}T${time}`);
}

function createDemoReservations(weekStart) {
  return SAMPLE_RESERVATIONS.map((reservation, index) => {
    const date = addDays(weekStart, reservation.day);
    const start = atTime(date, reservation.time);
    return {
      id: `demo-${format(date, "yyyyMMdd")}-${index}`,
      date,
      start,
      end: addHours(start, reservation.hours),
      hours: reservation.hours,
      user: reservation.name,
      userId: reservation.email,
      spot: reservation.spot,
      vehicle: reservation.vehicle,
      purpose: reservation.purpose,
      color: reservation.color,
      demo: true,
    };
  });
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
        confirmed: Boolean(row.confirmed ?? row.is_confirmed),
        color: ["mint", "coral", "blue", "yellow"][index % 4],
        demo: false,
      };
    })
    .filter(Boolean);
}

function initials(name) {
  return name
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

function App() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [reservations, setReservations] = useState([]);
  const [isDemo, setIsDemo] = useState(true);
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

  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const visibleReservations = useMemo(
    () => reservations.filter((reservation) => days.some((day) => isSameDay(day, reservation.date))),
    [reservations, days],
  );
  const weekEnd = days[6];
  const totalCount = visibleReservations.length;
  const spotsInUse = new Set(visibleReservations.map((reservation) => reservation.spot)).size;
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
      setIsDemo(false);
    } catch (error) {
      setReservations(createDemoReservations(weekStart));
      setIsDemo(true);
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
        color: "mint",
        demo: false,
      };
      setReservations((current) => [...current.filter((item) => !item.demo), added]);
      setIsDemo(false);
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
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Parkside home">
          <span className="brand-mark"><Leaf size={17} strokeWidth={2.2} /></span>
          <span>parkside<span className="brand-dot">.</span></span>
        </a>
        <div className="topbar-right">
          <span className="topbar-label">PARKING OPERATIONS</span>
          <span className="topbar-divider" />
          <button className="profile-button" type="button" title="Signed in as operations" aria-label="Operations profile">
            <span>OP</span>
          </button>
        </div>
      </header>

      <main id="top" className="page-content">
        <section className="page-heading">
          <div>
            <p className="eyebrow"><span className="eyebrow-mark" /> WORKSPACE / RESERVATIONS</p>
            <h1>Reservation calendar</h1>
            <p className="heading-subtitle">A clear view of who is parking, where, and when.</p>
          </div>
          <div className="heading-date"><CalendarDays size={16} /><span>{format(new Date(), "EEEE, MMMM d")}</span></div>
        </section>

        <section className="summary-strip" aria-label="Weekly reservation summary">
          <div className="summary-item summary-total">
            <span className="summary-label">THIS WEEK</span>
            <strong>{isLoading ? "—" : String(totalCount).padStart(2, "0")}</strong>
            <span className="summary-caption">reservations</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">SPOTS IN USE</span>
            <strong>{isLoading ? "—" : String(spotsInUse).padStart(2, "0")}</strong>
            <span className="summary-caption">unique spaces</span>
          </div>
          <div className="summary-note">
            <span className="summary-note-icon"><MapPin size={16} /></span>
            <div><strong>Parking, in sync.</strong><span>Bookings are grouped by day and space.</span></div>
          </div>
        </section>

        <section className={`workspace ${formOpen ? "workspace-form-open" : ""}`}>
          <div className="calendar-panel">
            <div className="calendar-toolbar">
              <div className="week-title-wrap">
                <span className="section-kicker">WEEKLY VIEW</span>
                <h2>{weekLabel}<span className="week-year">{format(weekEnd, " yyyy")}</span></h2>
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
            </div>

            {isDemo && (
              <div className="demo-notice" role="status">
                <span className="demo-pulse" />
                <span><strong>Sample schedule</strong> · API reservations are not available yet.</span>
                {apiNote && <span className="demo-detail">{apiNote}</span>}
              </div>
            )}
            {actionNotice && <div className={`action-notice action-notice-${actionNotice.kind}`} role={actionNotice.kind === "error" ? "alert" : "status"}>{actionNotice.text}</div>}

            <div className="calendar-scroll">
              <div className="week-grid">
                {days.map((day) => {
                  const dayReservations = visibleReservations
                    .filter((reservation) => isSameDay(day, reservation.date))
                    .sort((a, b) => a.start - b.start);
                  return (
                    <section key={day.toISOString()} className={`day-column ${isToday(day) ? "day-today" : ""}`} aria-label={format(day, "EEEE, MMMM d")}>
                      <div className="day-header">
                        <span className="day-name">{format(day, "EEE").toUpperCase()}</span>
                        <span className={`day-number ${isToday(day) ? "day-number-today" : ""}`}>{format(day, "d")}</span>
                        <span className="day-count">{String(dayReservations.length).padStart(2, "0")} BOOKINGS</span>
                      </div>
                      <div className="day-bookings">
                        {isLoading ? (
                          <div className="loading-column"><LoaderCircle size={18} /><span>Loading</span></div>
                        ) : dayReservations.length ? dayReservations.map((reservation) => (
                          <article className={`booking-card booking-${reservation.color}`} key={reservation.id}>
                            <div className="booking-time"><Clock3 size={12} /><span>{format(reservation.start, "h:mm a")}</span><span className="time-dash">–</span><span>{format(reservation.end, "h:mm a")}</span></div>
                            <div className="booking-person">
                              <span className={`person-avatar avatar-${reservation.color}`}>{initials(reservation.user)}</span>
                              <span className="person-name" title={reservation.user}>{reservation.user}</span>
                            </div>
                            <div className="booking-meta"><span className="spot-label"><MapPin size={12} />{reservation.spot}</span><span className="vehicle-label"><CarFront size={13} />{reservation.vehicle}</span></div>
                            <div className="booking-purpose">{reservation.purpose}</div>
                            {!reservation.demo && <div className="booking-actions">
                              {reservation.confirmed ? <span className="confirmed-state"><CircleCheck size={12} />Confirmed</span> : <button type="button" className="booking-action-confirm" onClick={() => runLifecycleAction("confirm", reservation)} disabled={pendingAction !== null} aria-label={`Confirm reservation for ${reservation.user}`} title="Confirm reservation">{pendingAction === `${reservation.id}:confirm` ? <LoaderCircle size={12} className="spin" /> : <CircleCheck size={12} />}<span>Confirm</span></button>}
                              <button type="button" className="booking-action-release" onClick={() => runLifecycleAction("release", reservation)} disabled={pendingAction !== null} aria-label={`Release reservation for ${reservation.user}`} title="Release reservation">{pendingAction === `${reservation.id}:release` ? <LoaderCircle size={12} className="spin" /> : <LogOut size={12} />}<span>Release</span></button>
                            </div>}
                          </article>
                        )) : (
                          <div className="empty-day"><span className="empty-day-line" /><span>Open day</span><button type="button" onClick={() => { setForm((current) => ({ ...current, reservation_date: format(day, "yyyy-MM-dd") })); openForm(); }} aria-label={`Create reservation for ${format(day, "EEEE, MMMM d")}`}><Plus size={15} /></button></div>
                        )}
                      </div>
                      <button type="button" className="day-add" onClick={() => { setForm((current) => ({ ...current, reservation_date: format(day, "yyyy-MM-dd") })); openForm(); }}><Plus size={13} /><span>Add booking</span></button>
                    </section>
                  );
                })}
              </div>
            </div>

            <footer className="calendar-footer">
              <div className="legend"><span className="legend-label">RESERVATION TYPES</span><span><i className="legend-dot legend-mint" />Staff</span><span><i className="legend-dot legend-coral" />Visitor</span><span><i className="legend-dot legend-blue" />Operations</span></div>
              <span className="timezone-label">LOCAL TIME · HKT</span>
            </footer>
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
