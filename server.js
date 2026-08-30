// server.js — Movie Ticket Booking Management (full-stack reference build)
// Mirrors the Pega case-lifecycle spec: stages, personas, decision-table routing,
// declare-expression-style calculated fields, SLA, and correspondence.

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const DB_PATH = path.join(__dirname, "data", "db.json");

function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    const seed = {
      movies: [
        { id: "MOV-1", movieName: "Solaris Drift", genre: "Sci-Fi" },
        { id: "MOV-2", movieName: "The Last Ember", genre: "Drama" },
        { id: "MOV-3", movieName: "Marigold & Steel", genre: "Action" },
      ],
      shows: [
        { id: "SHW-1", movieId: "MOV-1", showDate: "2026-09-05", showTime: "18:30", seatCapacity: 120, showType: "Premium", ticketPrice: 450, availableSeats: 42 },
        { id: "SHW-2", movieId: "MOV-2", showDate: "2026-09-05", showTime: "20:00", seatCapacity: 90, showType: "Standard", ticketPrice: 220, availableSeats: 5 },
        { id: "SHW-3", movieId: "MOV-3", showDate: "2026-09-06", showTime: "17:00", seatCapacity: 150, showType: "Standard", ticketPrice: 250, availableSeats: 0 },
      ],
      cases: [],
      queues: { PremiumShowQueue: [], StandardShowQueue: [] },
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(seed, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
}
function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// ---- US-009: SLA config (Goal 1 day / Deadline 2 days) ----
const SLA_GOAL_MS = 1 * 24 * 60 * 60 * 1000;
const SLA_DEADLINE_MS = 2 * 24 * 60 * 60 * 1000;

function slaStatus(createdAt) {
  const age = Date.now() - new Date(createdAt).getTime();
  if (age > SLA_DEADLINE_MS) return { status: "Deadline breached", urgency: "High", priorityBumped: true };
  if (age > SLA_GOAL_MS) return { status: "Goal missed - approaching deadline", urgency: "Medium", priorityBumped: false };
  return { status: "On track", urgency: "Normal", priorityBumped: false };
}

// ---- US-010: Decision Table — RouteByShowType ----
function routeByShowType(showType) {
  // Decision Table: RouteByShowType
  // Row 1: ShowType = "Premium"  -> PremiumShowQueue
  // Row 2: otherwise             -> StandardShowQueue
  return showType === "Premium" ? "PremiumShowQueue" : "StandardShowQueue";
}

// ---- US-003: Declare Expression — CalculateTotalCost ----
function calculateTotalCost(ticketPrice, numberOfTickets) {
  return Math.round(ticketPrice * numberOfTickets * 100) / 100;
}

function withDerived(c) {
  const sla = slaStatus(c.createdAt);
  return { ...c, sla };
}

// ---------- US-005: Movie / Show data objects ----------
app.get("/api/movies", (req, res) => res.json(loadDB().movies));
app.get("/api/shows", (req, res) => {
  const db = loadDB();
  const shows = db.shows.map((s) => ({ ...s, movieName: db.movies.find((m) => m.id === s.movieId)?.movieName }));
  res.json(shows);
});

// ---------- US-001: Submit Movie Ticket Request ----------
app.post("/api/cases", (req, res) => {
  const { showId, numberOfTickets, customerName, customerEmail } = req.body;
  const db = loadDB();
  const show = db.shows.find((s) => s.id === showId);
  const movie = show && db.movies.find((m) => m.id === show.movieId);

  const errors = [];
  if (!showId || !show) errors.push("A valid show must be selected.");
  if (!customerName || !customerName.trim()) errors.push("Customer name is required.");
  if (!customerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) errors.push("A valid email is required.");
  if (!numberOfTickets || Number(numberOfTickets) <= 0) errors.push("Number of tickets must be greater than 0.");
  if (errors.length) return res.status(400).json({ errors });

  const caseId = "MTR-" + (1000 + db.cases.length + 1);
  const newCase = {
    caseId,
    stage: "Booking Request",
    status: "Open",
    customerName,
    customerEmail,
    movieName: movie.movieName,
    showId: show.id,
    showDate: show.showDate,
    showTime: show.showTime,
    showType: show.showType,
    numberOfTickets: Number(numberOfTickets),
    ticketPrice: show.ticketPrice,
    totalCost: null,
    seatAvailabilityStatus: null,
    availableSeatsCount: null,
    bookingStatus: null,
    bookingConfirmationStatus: null,
    seatNumbers: null,
    ticketId: null,
    routedQueue: null,
    createdAt: new Date().toISOString(),
    history: [{ stage: "Booking Request", note: "Case submitted by customer.", at: new Date().toISOString() }],
  };
  db.cases.push(newCase);
  saveDB(db);
  res.status(201).json(withDerived(newCase));
});

app.get("/api/cases", (req, res) => {
  const db = loadDB();
  res.json(db.cases.map(withDerived));
});

app.get("/api/cases/:id", (req, res) => {
  const db = loadDB();
  const c = db.cases.find((x) => x.caseId === req.params.id);
  if (!c) return res.status(404).json({ error: "Case not found" });
  res.json(withDerived(c));
});

// ---------- US-002: Check Show Availability (Booking Agent) ----------
app.post("/api/cases/:id/check-availability", (req, res) => {
  const db = loadDB();
  const c = db.cases.find((x) => x.caseId === req.params.id);
  if (!c) return res.status(404).json({ error: "Case not found" });
  const show = db.shows.find((s) => s.id === c.showId);

  c.availableSeatsCount = show.availableSeats;
  c.seatAvailabilityStatus = show.availableSeats >= c.numberOfTickets ? "Available" : "Insufficient";

  if (c.seatAvailabilityStatus === "Insufficient") {
    c.stage = "Resolved";
    c.status = "Resolved-No Seats";
    c.history.push({ stage: "Availability", note: `Only ${show.availableSeats} seats left; request could not proceed.`, at: new Date().toISOString() });
    saveDB(db);
    return res.json(withDerived(c));
  }

  // US-003: Declare Expression fires automatically once seats are confirmed
  c.totalCost = calculateTotalCost(c.ticketPrice, c.numberOfTickets);
  c.stage = "Availability";
  c.history.push({ stage: "Availability", note: `Seats confirmed (${show.availableSeats} available). Total Cost calculated: ₹${c.totalCost}.`, at: new Date().toISOString() });
  saveDB(db);
  res.json(withDerived(c));
});

// ---------- US-004 / US-006: Confirm Booking Request (Customer) ----------
app.post("/api/cases/:id/confirm", (req, res) => {
  const { decision } = req.body; // "Confirmed" | "Cancelled"
  const db = loadDB();
  const c = db.cases.find((x) => x.caseId === req.params.id);
  if (!c) return res.status(404).json({ error: "Case not found" });
  if (c.seatAvailabilityStatus !== "Available") return res.status(400).json({ error: "Case is not ready for confirmation." });

  c.bookingStatus = decision;
  if (decision === "Cancelled") {
    c.stage = "Resolved";
    c.status = "Resolved-Cancelled";
    c.history.push({ stage: "Approval", note: "Customer cancelled the booking request.", at: new Date().toISOString() });
  } else {
    c.stage = "Approval";
    c.status = "Open";
    c.history.push({ stage: "Approval", note: "Customer confirmed the booking.", at: new Date().toISOString() });
  }
  saveDB(db);
  res.json(withDerived(c));
});

// ---------- US-007 / US-010: Process Ticket Booking + routing ----------
app.post("/api/cases/:id/process-booking", (req, res) => {
  const db = loadDB();
  const c = db.cases.find((x) => x.caseId === req.params.id);
  if (!c) return res.status(404).json({ error: "Case not found" });
  if (c.bookingStatus !== "Confirmed") return res.status(400).json({ error: "Booking must be confirmed before processing." });

  const show = db.shows.find((s) => s.id === c.showId);
  show.availableSeats -= c.numberOfTickets;

  const seatNumbers = Array.from({ length: c.numberOfTickets }, (_, i) => `${String.fromCharCode(65 + (i % 6))}${10 + i}`);
  c.seatNumbers = seatNumbers.join(", ");
  c.ticketId = "TKT-" + crypto.randomBytes(3).toString("hex").toUpperCase();
  c.bookingConfirmationStatus = "Confirmed";
  c.stage = "Booking Execution";

  // Decision Table: RouteByShowType
  const queue = routeByShowType(c.showType);
  c.routedQueue = queue;
  db.queues[queue].push(c.caseId);

  c.status = "Resolved-Completed";
  c.resolvedAt = new Date().toISOString();
  c.history.push({ stage: "Booking Execution", note: `Seats allocated (${c.seatNumbers}), Ticket ${c.ticketId} generated. Routed to ${queue}.`, at: new Date().toISOString() });
  saveDB(db);
  res.json(withDerived(c));
});

// ---------- US-008: Notify Booking Confirmation (Correspondence) ----------
app.get("/api/cases/:id/correspondence", (req, res) => {
  const db = loadDB();
  const c = db.cases.find((x) => x.caseId === req.params.id);
  if (!c) return res.status(404).json({ error: "Case not found" });
  if (c.status !== "Resolved-Completed") return res.status(400).json({ error: "Correspondence is only generated once the case resolves." });

  const body =
`Subject: Movie Ticket Booking Confirmed – ${c.caseId}

Dear ${c.customerName},

Your movie ticket booking has been successfully confirmed.

Below are the details of your booking:
• Case ID: ${c.caseId}
• Movie Name: ${c.movieName}
• Show Date & Time: ${c.showDate} ${c.showTime}
• Number of Tickets: ${c.numberOfTickets}
• Seat Numbers: ${c.seatNumbers}
• Total Cost: ₹${c.totalCost}

Please arrive at the theatre before show time and present your booking details at entry.

Thank you for choosing our services. Enjoy your movie!

Regards,
CineWave Entertainment – Booking Support Team`;

  res.json({ to: c.customerEmail, body });
});

app.get("/api/queues", (req, res) => res.json(loadDB().queues));

app.listen(4000, () => console.log("Movie Ticket Booking API running on http://localhost:4000"));
