# CineWave — Movie Ticket Booking Management (reference build)

A full-stack reference implementation of the Movie Ticket Booking Management case
lifecycle (Pega Academy NIP brief), built with a real Express backend and a React
frontend. Not a substitute for the Pega submission — it's here so you can see the
whole flow working end to end and check your own logic against a working example.

## Run it

```bash
npm install
node server.js
```

Then open **http://localhost:4000** in your browser.

## What's implemented, mapped to the user stories

| User Story | Where |
|---|---|
| US-001 Submit Movie Ticket Request | `POST /api/cases` — validated form (Customer persona) |
| US-002 Check Show Availability | `POST /api/cases/:id/check-availability` — Booking Agent step, blocks progress if seats insufficient |
| US-003 Calculate Booking Cost | `calculateTotalCost()` — fires like a Declare Expression whenever seats are confirmed |
| US-004 Confirm Booking Request | `POST /api/cases/:id/confirm` — Confirm/Cancel branch |
| US-005 Maintain Movie and Show Data | `movies` / `shows` objects in `data/db.json`, independent of case data |
| US-006 Review Booking Details | Ticket-stub card shows Movie, Show Timing, Tickets, Total Cost before confirming |
| US-007 Process Ticket Booking | `POST /api/cases/:id/process-booking` — allocates seats, generates Ticket ID |
| US-008 Notify Booking Confirmation | `GET /api/cases/:id/correspondence` — templated email, same body as the brief |
| US-009 Define Booking SLA | `slaStatus()` — Goal 1 day / Deadline 2 days, urgency bumps automatically |
| US-010 Route Booking Request by Show Type | `routeByShowType()` decision table → `PremiumShowQueue` / `StandardShowQueue` |

## Structure

```
server.js         Express API + case-lifecycle logic
public/index.html React frontend (persona switcher, ticket-stub cards)
data/db.json       JSON "database" — movies, shows, cases, queues (auto-seeded on first run)
```

## Notes

- Two personas are simulated via a switcher in the top right: **Customer** and
  **Booking Agent** — matching the personas in the Pega brief.
- The seed data includes one show with 0 seats left (`Marigold & Steel`) so you can
  test the "insufficient seats" rejection branch (US-002), and one Premium show
  vs. two Standard shows so you can see both queues get used (US-010).
- This is a demo/learning build, not a production system — the JSON file is not
  meant for concurrent writes, and there's no auth beyond the persona switcher.
