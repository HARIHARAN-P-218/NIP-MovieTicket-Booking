const API = "http://localhost:4000/api";
const STAGES = ["Booking Request", "Availability", "Approval", "Booking Execution", "Resolved"];

let state = {
    persona: "Customer", // or "Booking Agent"
    cases: [],
    shows: []
};

// DOM Elements
const btnCustomer = document.getElementById("btnCustomer");
const btnAgent = document.getElementById("btnAgent");
const requestSection = document.getElementById("requestSection");
const queueTitle = document.getElementById("queueTitle");
const casesGrid = document.getElementById("casesGrid");
const emptyState = document.getElementById("emptyState");
const showSelect = document.getElementById("showSelect");
const bookingForm = document.getElementById("bookingForm");
const formErrors = document.getElementById("formErrors");

// Modal DOM
const emailModal = document.getElementById("emailModal");
const closeModal = document.getElementById("closeModal");
const mailTo = document.getElementById("mailTo");
const mailBody = document.getElementById("mailBody");

// Event Listeners
btnCustomer.addEventListener("click", () => switchPersona("Customer"));
btnAgent.addEventListener("click", () => switchPersona("Booking Agent"));
bookingForm.addEventListener("submit", handleBookingSubmit);
closeModal.addEventListener("click", () => emailModal.classList.add("hidden"));

// Initialization
async function init() {
    await fetchShows();
    await fetchCases();
    renderShows();
    renderCases();
    // Start polling
    setInterval(async () => {
        await fetchCases();
        renderCases();
    }, 4000);
}

function switchPersona(persona) {
    state.persona = persona;
    
    // Update active class on buttons
    btnCustomer.classList.toggle("active", persona === "Customer");
    btnAgent.classList.toggle("active", persona === "Booking Agent");
    
    // Update view
    requestSection.classList.toggle("hidden", persona !== "Customer");
    queueTitle.textContent = persona === "Customer" ? "My Booking Requests" : "Cases Awaiting Action";
    
    renderCases();
}

async function fetchShows() {
    try {
        const res = await fetch(`${API}/shows`);
        state.shows = await res.json();
    } catch (e) { console.error("Failed to fetch shows", e); }
}

async function fetchCases() {
    try {
        const res = await fetch(`${API}/cases`);
        state.cases = await res.json();
    } catch (e) { console.error("Failed to fetch cases", e); }
}

function renderShows() {
    showSelect.innerHTML = '<option value="" disabled selected>Select a show…</option>';
    state.shows.forEach(s => {
        const option = document.createElement("option");
        option.value = s.id;
        option.textContent = `${s.movieName} — ${s.showDate} ${s.showTime} (${s.showType})`;
        showSelect.appendChild(option);
    });
}

async function handleBookingSubmit(e) {
    e.preventDefault();
    formErrors.classList.add("hidden");
    
    const payload = {
        showId: showSelect.value,
        numberOfTickets: parseInt(document.getElementById("ticketCount").value),
        customerName: document.getElementById("customerName").value,
        customerEmail: document.getElementById("customerEmail").value
    };

    try {
        const res = await fetch(`${API}/cases`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        
        const data = await res.json();
        if (!res.ok) {
            formErrors.textContent = data.errors ? data.errors.join(" ") : "Something went wrong.";
            formErrors.classList.remove("hidden");
            return;
        }
        
        // Reset form on success
        bookingForm.reset();
        await fetchCases();
        renderCases();
    } catch (e) {
        formErrors.textContent = "Network error. Please try again.";
        formErrors.classList.remove("hidden");
    }
}

// Expose handleAction and showEmail to global scope for inline onclick handlers
window.handleAction = async function(caseId, endpoint, payload = {}) {
    try {
        await fetch(`${API}/cases/${caseId}/${endpoint}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        await fetchCases();
        renderCases();
    } catch (e) { console.error("Action failed", e); }
};

window.showEmail = async function(caseId) {
    try {
        const res = await fetch(`${API}/cases/${caseId}/correspondence`);
        const data = await res.json();
        mailTo.textContent = data.to;
        mailBody.textContent = data.body;
        emailModal.classList.remove("hidden");
    } catch (e) { console.error("Failed to fetch email", e); }
};

// Rendering Logic
function getSlaFraction(sla) {
    if (!sla) return 0;
    if (sla.status.includes("breached")) return 1;
    if (sla.status.includes("Goal missed")) return 0.75;
    return 0.3;
}

function getSlaClass(sla) {
    const frac = getSlaFraction(sla);
    if (frac >= 1) return "breach";
    if (frac >= 0.75) return "warning";
    return "";
}

function renderCases() {
    casesGrid.innerHTML = "";
    
    // Filter logic: customer sees all (for now assume they are the single customer), agent sees all for visibility in this demo
    const myQueue = state.cases;
    
    if (myQueue.length === 0) {
        emptyState.classList.remove("hidden");
        return;
    }
    
    emptyState.classList.add("hidden");
    
    // Reverse to show newest first
    [...myQueue].reverse().forEach(c => {
        const isDeadEnd = c.status && c.status.startsWith("Resolved-") && c.status !== "Resolved-Completed";
        const isOpen = c.status === "Open";
        const pillClass = c.status === "Resolved-Completed" ? "done" : (isDeadEnd ? "dead" : "open");
        
        // Generate Stage Tracker HTML
        const currentStageIdx = STAGES.indexOf(c.stage);
        let stagesHtml = '<div class="stage-tracker">';
        STAGES.forEach((s, i) => {
            let cls = "stage-dot";
            if (isDeadEnd && s === "Resolved") cls += " dead";
            else if (i < currentStageIdx || (s === "Resolved" && c.status === "Resolved-Completed")) cls += " done";
            else if (i === currentStageIdx) cls += " current";
            stagesHtml += `<div class="${cls}" title="${s}"></div>`;
        });
        stagesHtml += '</div>';

        // Action Buttons HTML
        let buttonsHtml = '';
        if (state.persona === "Booking Agent" && c.stage === "Booking Request") {
            buttonsHtml += `<button class="btn-secondary" onclick="handleAction('${c.caseId}', 'check-availability')">Verify Availability</button>`;
        }
        if (state.persona === "Customer" && c.stage === "Availability" && c.seatAvailabilityStatus === "Available") {
            buttonsHtml += `
                <button class="btn-primary" onclick="handleAction('${c.caseId}', 'confirm', {decision:'Confirmed'})">Confirm Booking</button>
                <button class="btn-danger" onclick="handleAction('${c.caseId}', 'confirm', {decision:'Cancelled'})">Cancel</button>
            `;
        }
        if (state.persona === "Booking Agent" && c.stage === "Approval" && c.bookingStatus === "Confirmed") {
            buttonsHtml += `<button class="btn-primary" onclick="handleAction('${c.caseId}', 'process-booking')">Process Booking</button>`;
        }
        if (c.status === "Resolved-Completed") {
            buttonsHtml += `<button class="btn-secondary" onclick="showEmail('${c.caseId}')">View Email Confirmation</button>`;
        }

        // SLA HTML
        let slaHtml = '';
        if (isOpen) {
            const width = getSlaFraction(c.sla) * 100;
            const slaClass = getSlaClass(c.sla);
            slaHtml = `
                <div class="sla-info">
                    <div class="sla-header">
                        <span>SLA Status</span>
                        <span>${c.sla.status}</span>
                    </div>
                    <div class="sla-bar-bg">
                        <div class="sla-bar-fill ${slaClass}" style="width: ${width}%"></div>
                    </div>
                </div>
            `;
        }

        // Card HTML
        const card = document.createElement("div");
        card.className = "ticket-card";
        card.innerHTML = `
            <div class="ticket-main">
                ${stagesHtml}
                <div class="ticket-header">
                    <div>
                        <h3 class="movie-title">${c.movieName}</h3>
                        <div class="ticket-meta">${c.caseId} • ${c.showDate} ${c.showTime} • ${c.showType}</div>
                    </div>
                    <div class="status-badge ${pillClass}">${c.status.replace("-", " ")}</div>
                </div>
                
                <div class="ticket-details">
                    <div class="detail-row">
                        <span class="detail-label">Customer</span>
                        <span class="detail-val">${c.customerName}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Tickets</span>
                        <span class="detail-val">${c.numberOfTickets}</span>
                    </div>
                    ${c.totalCost != null ? `
                    <div class="detail-row">
                        <span class="detail-label">Total Cost</span>
                        <span class="detail-val">₹${c.totalCost}</span>
                    </div>` : ''}
                    ${c.seatNumbers ? `
                    <div class="detail-row">
                        <span class="detail-label">Seats</span>
                        <span class="detail-val mono">${c.seatNumbers}</span>
                    </div>` : ''}
                    ${c.ticketId ? `
                    <div class="detail-row">
                        <span class="detail-label">Ticket ID</span>
                        <span class="detail-val mono">${c.ticketId}</span>
                    </div>` : ''}
                    ${c.routedQueue ? `
                    <div class="detail-row">
                        <span class="detail-label">Queue</span>
                        <span class="detail-val">${c.routedQueue}</span>
                    </div>` : ''}
                </div>
            </div>
            <div class="ticket-actions">
                ${slaHtml}
                ${buttonsHtml ? `<div class="action-buttons">${buttonsHtml}</div>` : ''}
            </div>
        `;
        
        casesGrid.appendChild(card);
    });
}

// Start app
init();
