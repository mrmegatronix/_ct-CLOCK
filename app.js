/* ==========================================================================
   Coasters Tavern Shift Clock-in Logic Sheets (Modern Vanilla Javascript)
   ========================================================================== */

// 1. Mock Database Configuration
const VENUE_LAT = -43.4839;
const VENUE_LNG = 172.6105;
const GEOFENCE_LIMIT = 20; // Green boundary (metres)
const WARNING_LIMIT = 50;  // Orange boundary (metres)

const EMPLOYEES = {
    "1111": { id: "1111", name: "John Doe", role: "Bar Staff", rate: 25.00 },
    "2222": { id: "2222", name: "Jane Smith", role: "Kitchen Staff", rate: 26.50 },
    "3333": { id: "3333", name: "Bob Johnson", role: "Duty Manager", rate: 32.00 },
    "4444": { id: "4444", name: "Alice Green", role: "Duty Manager", rate: 32.00 }
};

// Seed initial clock logs to show PAYE and admin reports immediately
const SEED_LOGS = [
    // John Doe shifts
    { id: 1, employeeId: "1111", employeeName: "John Doe", role: "Bar Staff", timestamp: "2026-07-06T08:00:00Z", event: "Clock-In", method: "GPS Mobile", distance: 12, coordinates: "-43.4840, 172.6106", status: "Green Pass" },
    { id: 2, employeeId: "1111", employeeName: "John Doe", role: "Bar Staff", timestamp: "2026-07-06T16:30:00Z", event: "Clock-Out", method: "GPS Mobile", distance: 15, coordinates: "-43.4841, 172.6107", status: "Green Pass" },
    { id: 3, employeeId: "1111", employeeName: "John Doe", role: "Bar Staff", timestamp: "2026-07-07T08:15:00Z", event: "Clock-In", method: "GPS Mobile", distance: 125, coordinates: "-43.4851, 172.6120", status: "Red Flagged" }, // out of bounds
    { id: 4, employeeId: "1111", employeeName: "John Doe", role: "Bar Staff", timestamp: "2026-07-07T17:15:00Z", event: "Clock-Out", method: "GPS Mobile", distance: 10, coordinates: "-43.4839, 172.6105", status: "Green Pass" },
    
    // Jane Smith shifts (PIN terminal)
    { id: 5, employeeId: "2222", employeeName: "Jane Smith", role: "Kitchen Staff", timestamp: "2026-07-08T09:00:00Z", event: "Clock-In", method: "PIN Terminal", distance: 0, coordinates: "-43.4839, 172.6105", status: "Green Pass" },
    { id: 6, employeeId: "2222", employeeName: "Jane Smith", role: "Kitchen Staff", timestamp: "2026-07-08T18:00:00Z", event: "Clock-Out", method: "PIN Terminal", distance: 0, coordinates: "-43.4839, 172.6105", status: "Green Pass" }, // 9 hours (1 hour overtime)
    
    // Bob Johnson shifts
    { id: 7, employeeId: "3333", employeeName: "Bob Johnson", role: "Duty Manager", timestamp: "2026-07-09T10:00:00Z", event: "Clock-In", method: "QR Code Bypass", distance: 42, coordinates: "-43.4842, 172.6110", status: "Green Pass" }, // out of bounds but scanned QR
    { id: 8, employeeId: "3333", employeeName: "Bob Johnson", role: "Duty Manager", timestamp: "2026-07-09T18:00:00Z", event: "Clock-Out", method: "GPS Mobile", distance: 14, coordinates: "-43.4840, 172.6106", status: "Green Pass" }
];

// Seed holiday requests
const SEED_HOLIDAYS = [
    { id: 1, submitDate: "2026-07-08", employeeId: "1111", employeeName: "John Doe", role: "Bar Staff", type: "Annual Leave", startDate: "2026-07-20", endDate: "2026-07-24", totalDays: 5, reason: "Family holiday in Queenstown", status: "Pending" },
    { id: 2, submitDate: "2026-07-05", employeeId: "2222", employeeName: "Jane Smith", role: "Kitchen Staff", type: "Sick Leave", startDate: "2026-07-06", endDate: "2026-07-06", totalDays: 1, reason: "Dental checkup", status: "Approved" }
];

// State variables
let logs = [];
let holidayRequests = [];
let activeShifts = {}; // keyed by employeeId: { clockInTime, coordinates, distance, status, qrBypassed }
let simulatedDistance = 10; // default 10 metres
let qrBypassed = false;
let currentUser = EMPLOYEES["1111"]; // John Doe as default mobile user

// Pin Terminal variables
let currentPinInput = "";

// 2. Initialize Application
document.addEventListener("DOMContentLoaded", async () => {
    // Load config from .env first
    await loadEnvConfig();

    // Load local storage or default seed data
    if (localStorage.getItem("ct_logs")) {
        logs = JSON.parse(localStorage.getItem("ct_logs"));
    } else {
        logs = [...SEED_LOGS];
        saveLogs();
    }

    if (localStorage.getItem("ct_holidays")) {
        holidayRequests = JSON.parse(localStorage.getItem("ct_holidays"));
    } else {
        holidayRequests = [...SEED_HOLIDAYS];
        saveHolidays();
    }

    if (localStorage.getItem("ct_active_shifts")) {
        activeShifts = JSON.parse(localStorage.getItem("ct_active_shifts"));
    }

    // Initialize UI Icons
    lucide.createIcons();

    // Start Live Clock
    startLiveClocks();

    // Set Initial simulated distance
    updateSimulatedLocation(simulatedDistance);

    // Initial table renders
    renderAll();
});

async function loadEnvConfig() {
    try {
        const response = await fetch('.env');
        if (response.ok) {
            const text = await response.text();
            const lines = text.split('\n');
            lines.forEach(line => {
                const parts = line.split('=');
                if (parts.length === 2) {
                    const key = parts[0].trim();
                    const value = parts[1].trim();
                    if (key === 'ADMIN_PIN') {
                        // Dynamic insertion of Admin into EMPLOYEES
                        EMPLOYEES[value] = { id: value, name: "System Admin", role: "Administrator", rate: 45.00 };
                    }
                }
            });
        } else {
            // Fallback if file fetched but error status
            EMPLOYEES["5555"] = { id: "5555", name: "System Admin", role: "Administrator", rate: 45.00 };
        }
    } catch (e) {
        console.warn("Could not load .env file, using default admin 5555 fallback", e);
        EMPLOYEES["5555"] = { id: "5555", name: "System Admin", role: "Administrator", rate: 45.00 };
    }
}

function renderPinReference() {
    const pinRefListEl = document.getElementById("pin-ref-list");
    if (!pinRefListEl) return;
    
    pinRefListEl.innerHTML = Object.values(EMPLOYEES).map(emp => {
        return `<div class="pin-ref-item"><span>${emp.name} (${emp.role})</span> <strong>${emp.id}</strong></div>`;
    }).join("");
}

function saveLogs() {
    localStorage.setItem("ct_logs", JSON.stringify(logs));
}

function saveHolidays() {
    localStorage.setItem("ct_holidays", JSON.stringify(holidayRequests));
}

function saveActiveShifts() {
    localStorage.setItem("ct_active_shifts", JSON.stringify(activeShifts));
}

// 3. Clock & UI view controls
function startLiveClocks() {
    setInterval(() => {
        const now = new Date();
        
        // Digital clock in phone mockup
        const liveTimeEl = document.getElementById("live-time");
        if (liveTimeEl) liveTimeEl.textContent = now.toLocaleTimeString();

        // Phone Status Bar Clock
        const phoneTimeEl = document.getElementById("phone-time");
        if (phoneTimeEl) {
            const mins = String(now.getMinutes()).padStart(2, '0');
            const hrs = String(now.getHours()).padStart(2, '0');
            phoneTimeEl.textContent = `${hrs}:${mins}`;
        }

        // Live shift counter update
        updateShiftDurationDisplay();
    }, 1000);
}

function switchView(viewId) {
    document.querySelectorAll(".view-panel").forEach(panel => panel.classList.remove("active"));
    document.querySelectorAll(".nav-btn").forEach(btn => btn.classList.remove("active"));

    document.getElementById(`${viewId}-view`).classList.add("active");
    document.getElementById(`nav-btn-${viewId}`).classList.add("active");
}

function switchPhoneSubView(subviewId) {
    document.querySelectorAll(".phone-sub-panel").forEach(panel => panel.classList.remove("active"));
    document.querySelectorAll(".sub-nav-btn").forEach(btn => btn.classList.remove("active"));

    document.getElementById(`phone-${subviewId}-subview`).classList.add("active");
    document.getElementById(`sub-nav-${subviewId}`).classList.add("active");
}

function switchAdminTab(tabId) {
    document.querySelectorAll(".admin-tab-panel").forEach(panel => panel.classList.remove("active"));
    document.querySelectorAll(".admin-tab-btn").forEach(btn => btn.classList.remove("active"));

    document.getElementById(`admin-${tabId}-panel`).classList.add("active");
    document.getElementById(`tab-${tabId}`).classList.add("active");
}

// 4. Geofencing Engine & Distance Mock
function updateSimulatedLocation(meters) {
    simulatedDistance = parseInt(meters);
    document.getElementById("slider-val").textContent = `${simulatedDistance}m`;
    document.getElementById("distance-readout-val").textContent = `${simulatedDistance}m`;

    // Calculate simulated coordinates based on offset
    // approx 1 meter is ~0.000009 degrees
    const latOffset = (simulatedDistance * 0.000009);
    const simulatedLat = (VENUE_LAT + latOffset).toFixed(6);
    const simulatedLng = (VENUE_LNG + latOffset).toFixed(6);
    document.getElementById("sim-coords").textContent = `${simulatedLat}, ${simulatedLng}`;

    // Update gauge styling (Green / Orange / Red)
    const gaugeBar = document.getElementById("gauge-bar");
    const gaugeBadge = document.getElementById("gauge-badge");
    const distanceDesc = document.getElementById("distance-readout-desc");
    const qrCard = document.getElementById("qr-bypass-card");
    const clockBtn = document.getElementById("clock-btn");

    // Remove existing state classes
    gaugeBadge.className = "badge";
    
    // Position percentage for gauge indicator
    // Max slider distance is 250m
    const percentage = Math.min((simulatedDistance / 250) * 100, 100);
    gaugeBar.style.width = `${Math.max(percentage, 5)}%`;

    if (simulatedDistance <= GEOFENCE_LIMIT) {
        // Green State: In Bounds
        gaugeBar.style.backgroundColor = "var(--color-success)";
        gaugeBadge.classList.add("badge-success");
        gaugeBadge.textContent = "In Range";
        distanceDesc.textContent = "Within tavern geofence (<=20m)";
        qrCard.style.display = "none";
        
        // Clear red class on clock button if inside range
        if (clockBtn.classList.contains("flagged")) {
            clockBtn.classList.remove("flagged");
        }
    } else if (simulatedDistance <= WARNING_LIMIT) {
        // Orange State: Warning Zone
        gaugeBar.style.backgroundColor = "var(--color-warning)";
        gaugeBadge.classList.add("badge-warning");
        gaugeBadge.textContent = "Near Venue";
        distanceDesc.textContent = "Slightly outside boundary (21m-50m)";
        
        // Show QR code validation prompt if not already QR bypassed or clocked in
        if (!qrBypassed && !activeShifts[currentUser.id]) {
            qrCard.style.display = "block";
        } else {
            qrCard.style.display = "none";
        }
    } else {
        // Red State: Far Away
        gaugeBar.style.backgroundColor = "var(--color-danger)";
        gaugeBadge.classList.add("badge-danger");
        gaugeBadge.textContent = "Out of Range";
        distanceDesc.textContent = "Far from venue (>50m). Clock-in will be FLAGGED.";
        
        // Show QR scan requirement to authenticate
        if (!qrBypassed && !activeShifts[currentUser.id]) {
            qrCard.style.display = "block";
        } else {
            qrCard.style.display = "none";
        }
    }
}

function setQuickPosition(meters) {
    document.getElementById("distance-slider").value = meters;
    updateSimulatedLocation(meters);
}

// Haversine formula to compute actual distance between two coordinates (for verification logs)
function calculateHaversine(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth radius in metres
    const phi1 = lat1 * Math.PI/180;
    const phi2 = lat2 * Math.PI/180;
    const deltaPhi = (lat2-lat1) * Math.PI/180;
    const deltaLambda = (lon2-lon1) * Math.PI/180;

    const a = Math.sin(deltaPhi/2) * Math.sin(deltaPhi/2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda/2) * Math.sin(deltaLambda/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c; // in metres
}

// 5. QR Code bypass simulation
function simulateQRScan() {
    document.getElementById("qr-modal").classList.add("active");
    document.getElementById("qr-success-message").style.display = "none";

    setTimeout(() => {
        document.getElementById("qr-success-message").style.display = "block";
        setTimeout(() => {
            closeQRModal();
            qrBypassed = true;
            document.getElementById("qr-bypass-card").style.display = "none";
            
            // Visual notification to staff
            const distanceDesc = document.getElementById("distance-readout-desc");
            distanceDesc.textContent = "Verified via Venue QR scan. Ready to clock in.";
        }, 1500);
    }, 1500);
}

function closeQRModal() {
    document.getElementById("qr-modal").classList.remove("active");
}

// 6. Mobile Clock In/Out Process
function toggleClock() {
    const userId = currentUser.id;
    const clockBtn = document.getElementById("clock-btn");
    const clockBtnText = document.getElementById("clock-btn-text");
    const timerDisplay = document.getElementById("shift-timer-display");

    const now = new Date();
    const latOffset = (simulatedDistance * 0.000009);
    const coordsStr = `${(VENUE_LAT + latOffset).toFixed(6)}, ${(VENUE_LNG + latOffset).toFixed(6)}`;

    if (!activeShifts[userId]) {
        // Clocking In
        let status = "Green Pass";
        let method = "GPS Mobile";

        if (qrBypassed) {
            status = "Green Pass";
            method = "QR Code Bypass";
        } else if (simulatedDistance > GEOFENCE_LIMIT) {
            status = "Red Flagged";
            // Red flag triggers visual warning on button
            clockBtn.classList.add("flagged");
        }

        activeShifts[userId] = {
            clockInTime: now.toISOString(),
            coordinates: coordsStr,
            distance: simulatedDistance,
            status: status,
            method: method
        };

        // Record clock-in log
        logs.unshift({
            id: Date.now(),
            employeeId: userId,
            employeeName: currentUser.name,
            role: currentUser.role,
            timestamp: now.toISOString(),
            event: "Clock-In",
            method: method,
            distance: simulatedDistance,
            coordinates: coordsStr,
            status: status
        });

        clockBtn.classList.add("active");
        clockBtnText.textContent = "Clock Out";
        timerDisplay.style.display = "block";

    } else {
        // Clocking Out
        const activeShift = activeShifts[userId];
        
        logs.unshift({
            id: Date.now(),
            employeeId: userId,
            employeeName: currentUser.name,
            role: currentUser.role,
            timestamp: now.toISOString(),
            event: "Clock-Out",
            method: activeShift.method,
            distance: simulatedDistance,
            coordinates: coordsStr,
            status: "Green Pass" // Clock-out geolocation is recorded but typically doesn't restrict payroll
        });

        delete activeShifts[userId];
        qrBypassed = false;

        clockBtn.className = "btn-clock";
        clockBtnText.textContent = "Clock In";
        timerDisplay.style.display = "none";
    }

    saveLogs();
    saveActiveShifts();
    renderAll();
}

function updateShiftDurationDisplay() {
    const timerValEl = document.getElementById("shift-duration-val");
    if (!timerValEl || !activeShifts[currentUser.id]) return;

    const shift = activeShifts[currentUser.id];
    const diffMs = new Date() - new Date(shift.clockInTime);
    
    const sec = Math.floor((diffMs / 1000) % 60);
    const min = Math.floor((diffMs / (1000 * 60)) % 60);
    const hrs = Math.floor((diffMs / (1000 * 60 * 60)) % 24);

    timerValEl.textContent = `${String(hrs).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// 7. PIN Terminal Logic
function appendPin(num) {
    if (currentPinInput.length < 4) {
        currentPinInput += num;
        document.getElementById("pin-input").value = currentPinInput;
    }
}

function clearPin() {
    currentPinInput = "";
    document.getElementById("pin-input").value = "";
}

function submitPin() {
    const feedbackEl = document.getElementById("terminal-feedback");
    
    if (!EMPLOYEES[currentPinInput]) {
        feedbackEl.innerHTML = `
            <div class="alert alert-danger">
                <i data-lucide="alert-circle"></i> Invalid Employee PIN. Try again.
            </div>
        `;
        lucide.createIcons();
        clearPin();
        return;
    }

    const employee = EMPLOYEES[currentPinInput];
    const now = new Date();
    const isClockedIn = activeShifts[employee.id];

    if (!isClockedIn) {
        // Clock In
        activeShifts[employee.id] = {
            clockInTime: now.toISOString(),
            coordinates: `${VENUE_LAT}, ${VENUE_LNG}`,
            distance: 0,
            status: "Green Pass",
            method: "PIN Terminal"
        };

        logs.unshift({
            id: Date.now(),
            employeeId: employee.id,
            employeeName: employee.name,
            role: employee.role,
            timestamp: now.toISOString(),
            event: "Clock-In",
            method: "PIN Terminal",
            distance: 0,
            coordinates: `${VENUE_LAT}, ${VENUE_LNG}`,
            status: "Green Pass"
        });

        feedbackEl.innerHTML = `
            <div class="alert alert-success">
                <i data-lucide="check-circle-2"></i> Welcome, ${employee.name}. Clocked In at ${now.toLocaleTimeString()}.
            </div>
        `;
    } else {
        // Clock Out
        logs.unshift({
            id: Date.now(),
            employeeId: employee.id,
            employeeName: employee.name,
            role: employee.role,
            timestamp: now.toISOString(),
            event: "Clock-Out",
            method: "PIN Terminal",
            distance: 0,
            coordinates: `${VENUE_LAT}, ${VENUE_LNG}`,
            status: "Green Pass"
        });

        delete activeShifts[employee.id];

        feedbackEl.innerHTML = `
            <div class="alert alert-success">
                <i data-lucide="check-circle-2"></i> Goodbye, ${employee.name}. Clocked Out at ${now.toLocaleTimeString()}.
            </div>
        `;
    }

    saveLogs();
    saveActiveShifts();
    clearPin();
    renderAll();
    lucide.createIcons();
}

// 8. Holiday Management
function submitHolidayRequest(event) {
    event.preventDefault();
    
    const startVal = document.getElementById("holiday-start").value;
    const endVal = document.getElementById("holiday-end").value;
    const typeVal = document.getElementById("holiday-type").value;
    const reasonVal = document.getElementById("holiday-reason").value;

    const start = new Date(startVal);
    const end = new Date(endVal);

    if (end < start) {
        alert("End date cannot be prior to start date.");
        return;
    }

    // Calculate days inclusive
    const diffTime = Math.abs(end - start);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

    const newRequest = {
        id: Date.now(),
        submitDate: new Date().toISOString().split('T')[0],
        employeeId: currentUser.id,
        employeeName: currentUser.name,
        role: currentUser.role,
        type: typeVal,
        startDate: startVal,
        endDate: endVal,
        totalDays: diffDays,
        reason: reasonVal || "Not specified",
        status: "Pending"
    };

    holidayRequests.unshift(newRequest);
    saveHolidays();
    
    // Reset form
    document.getElementById("holiday-form").reset();
    
    renderAll();
}

function handleHolidayDecision(id, decision) {
    const req = holidayRequests.find(h => h.id === id);
    if (req) {
        req.status = decision;
        saveHolidays();
        renderAll();
    }
}

// 9. Reporting and Calculations (PAYE Aggregate engine)
function calculatePAYEData() {
    const weeklyData = {};

    // Group logs by employee
    // To construct shifts, we sort logs chronologically per employee, pairing Clock-In with subsequent Clock-Out
    Object.keys(EMPLOYEES).forEach(empId => {
        const emp = EMPLOYEES[empId];
        weeklyData[empId] = {
            id: empId,
            name: emp.name,
            role: emp.role,
            normalHours: 0,
            overtimeHours: 0,
            totalHours: 0,
            methods: new Set()
        };
    });

    // Extract sorted chronologically
    const chronLogs = [...logs].reverse();

    // Temporary storage for matching active checkins during logs iteration
    const tempActiveShifts = {};

    chronLogs.forEach(log => {
        const empId = log.employeeId;
        if (!weeklyData[empId]) return; // unrecognized employee
        
        weeklyData[empId].methods.add(log.method);

        if (log.event === "Clock-In") {
            tempActiveShifts[empId] = new Date(log.timestamp);
        } else if (log.event === "Clock-Out" && tempActiveShifts[empId]) {
            const clockIn = tempActiveShifts[empId];
            const clockOut = new Date(log.timestamp);
            const durationHrs = (clockOut - clockIn) / (1000 * 60 * 60);

            // Daily 8-hour overtime threshold
            if (durationHrs > 8) {
                weeklyData[empId].normalHours += 8;
                weeklyData[empId].overtimeHours += (durationHrs - 8);
            } else {
                weeklyData[empId].normalHours += durationHrs;
            }

            delete tempActiveShifts[empId];
        }
    });

    // Format output
    return Object.values(weeklyData).map(data => {
        const rate = EMPLOYEES[data.id].rate;
        data.totalHours = data.normalHours + data.overtimeHours;
        data.grossPay = (data.normalHours * rate) + (data.overtimeHours * rate * 1.5);
        data.payeTax = data.grossPay * 0.175; // 17.5% PAYE
        data.netPay = data.grossPay - data.payeTax;
        data.methodsList = Array.from(data.methods).join(", ") || "None";
        return data;
    });
}

// 10. Renders
function renderAll() {
    renderMobileUI();
    renderHolidayLists();
    renderPAYETable();
    renderLogsTable();
    renderStats();
    renderPinReference();
}

function renderMobileUI() {
    const clockBtn = document.getElementById("clock-btn");
    const clockBtnText = document.getElementById("clock-btn-text");
    const timerDisplay = document.getElementById("shift-timer-display");

    if (activeShifts[currentUser.id]) {
        const shift = activeShifts[currentUser.id];
        clockBtn.className = "btn-clock active";
        if (shift.status === "Red Flagged") {
            clockBtn.classList.add("flagged");
        }
        clockBtnText.textContent = "Clock Out";
        timerDisplay.style.display = "block";
    } else {
        clockBtn.className = "btn-clock";
        clockBtnText.textContent = "Clock In";
        timerDisplay.style.display = "none";
    }
}

function renderHolidayLists() {
    // Phone UI subview requests
    const phoneListEl = document.getElementById("phone-requests-list");
    if (phoneListEl) {
        const myRequests = holidayRequests.filter(h => h.employeeId === currentUser.id);
        if (myRequests.length === 0) {
            phoneListEl.innerHTML = `<p class="text-center" style="grid-column: 1/-1; padding: 12px;">No requests found</p>`;
        } else {
            phoneListEl.innerHTML = myRequests.map(r => {
                let badgeClass = "badge-warning";
                if (r.status === "Approved") badgeClass = "badge-success";
                if (r.status === "Denied") badgeClass = "badge-danger";
                
                return `
                    <div class="request-item">
                        <div class="request-item-details">
                            <strong>${r.type} (${r.totalDays} Days)</strong>
                            <span>${r.startDate} to ${r.endDate}</span>
                        </div>
                        <span class="badge ${badgeClass}">${r.status}</span>
                    </div>
                `;
            }).join("");
        }
    }

    // Admin Panel Table requests
    const adminListEl = document.getElementById("holidays-table-body");
    if (adminListEl) {
        if (holidayRequests.length === 0) {
            adminListEl.innerHTML = `<tr><td colspan="9" class="text-center">No holiday requests submitted</td></tr>`;
        } else {
            adminListEl.innerHTML = holidayRequests.map(r => {
                let badgeClass = "badge-warning";
                if (r.status === "Approved") badgeClass = "badge-success";
                if (r.status === "Denied") badgeClass = "badge-danger";

                const isPending = r.status === "Pending";
                const actionButtons = isPending 
                    ? `<button class="btn btn-sm btn-primary" onclick="handleHolidayDecision(${r.id}, 'Approved')">Approve</button>
                       <button class="btn btn-sm btn-outline" style="color:var(--color-danger); border-color:rgba(239,68,68,0.2)" onclick="handleHolidayDecision(${r.id}, 'Denied')">Deny</button>`
                    : `<span style="color:var(--color-text-muted)">Evaluated</span>`;

                return `
                    <tr>
                        <td>${r.submitDate}</td>
                        <td><strong>${r.employeeName}</strong></td>
                        <td>${r.role}</td>
                        <td>${r.type}</td>
                        <td>${r.startDate} to ${r.endDate}</td>
                        <td>${r.totalDays}</td>
                        <td><small>${r.reason}</small></td>
                        <td><span class="badge ${badgeClass}">${r.status}</span></td>
                        <td class="no-print" style="display:flex; gap:8px;">${actionButtons}</td>
                    </tr>
                `;
            }).join("");
        }
    }
}

function renderPAYETable() {
    const tableBody = document.getElementById("paye-table-body");
    if (!tableBody) return;

    const data = calculatePAYEData();

    tableBody.innerHTML = data.map(row => {
        return `
            <tr>
                <td><strong>${row.name}</strong></td>
                <td>${row.role}</td>
                <td><small>${row.methodsList}</small></td>
                <td>${row.normalHours.toFixed(2)} hrs</td>
                <td>${row.overtimeHours.toFixed(2)} hrs</td>
                <td><strong>${row.totalHours.toFixed(2)} hrs</strong></td>
                <td>$${row.grossPay.toFixed(2)}</td>
                <td style="color:#fca5a5">$${row.payeTax.toFixed(2)}</td>
                <td style="color:#a7f3d0; font-weight:600">$${row.netPay.toFixed(2)}</td>
            </tr>
        `;
    }).join("");
}

function renderLogsTable() {
    const tableBody = document.getElementById("logs-table-body");
    if (!tableBody) return;

    if (logs.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="8" class="text-center">No clock-in logs found</td></tr>`;
        return;
    }

    tableBody.innerHTML = logs.map(log => {
        let statusDotClass = "green";
        if (log.status === "Orange Warning") statusDotClass = "orange";
        if (log.status === "Red Flagged") statusDotClass = "red";

        const formattedTime = new Date(log.timestamp).toLocaleString();
        
        let actionBtn = "";
        if (log.status === "Red Flagged") {
            actionBtn = `<button class="btn btn-sm btn-outline no-print" onclick="resolveFlag(${log.id})"><i data-lucide="check-circle-2"></i> Approve Flag</button>`;
        }

        return `
            <tr>
                <td>${formattedTime}</td>
                <td><strong>${log.employeeName}</strong></td>
                <td><span style="font-weight:600; color:${log.event === 'Clock-In' ? 'var(--color-success)' : 'var(--color-text-muted)'}">${log.event}</span></td>
                <td>${log.method}</td>
                <td>${log.distance}m</td>
                <td><small>${log.coordinates}</small></td>
                <td>
                    <span class="status-pill">
                        <span class="status-dot ${statusDotClass}"></span>
                        ${log.status}
                    </span>
                </td>
                <td>${actionBtn}</td>
            </tr>
        `;
    }).join("");
    lucide.createIcons();
}

function resolveFlag(logId) {
    const log = logs.find(l => l.id === logId);
    if (log) {
        log.status = "Green Pass (Approved)";
        saveLogs();
        renderAll();
    }
}

function renderStats() {
    // 1. On shift count
    const onShiftEl = document.getElementById("stat-on-shift");
    if (onShiftEl) {
        onShiftEl.textContent = Object.keys(activeShifts).length;
    }

    // 2. Red flagged shifts count
    const flaggedEl = document.getElementById("stat-flagged");
    if (flaggedEl) {
        const count = logs.filter(l => l.status === "Red Flagged").length;
        flaggedEl.textContent = count;
        
        const flaggedIcon = document.getElementById("stat-flagged-icon");
        if (count > 0) {
            flaggedIcon.parentElement.classList.add("text-danger");
        } else {
            flaggedIcon.parentElement.classList.remove("text-danger");
        }
    }

    // 3. Pending Holiday Requests
    const holidaysEl = document.getElementById("stat-holidays");
    if (holidaysEl) {
        const count = holidayRequests.filter(h => h.status === "Pending").length;
        holidaysEl.textContent = count;
    }
}

// 11. Spreadsheet CSV Exporter
function exportToCSV() {
    const data = calculatePAYEData();
    let csvContent = "data:text/csv;charset=utf-8,";
    
    // Headers
    csvContent += "Employee,Role,Clock-In Methods,Normal Hours,Overtime Hours,Total Hours,Gross Pay ($),PAYE Tax Deduction ($),Net Pay ($)\r\n";

    // Row loop
    data.forEach(row => {
        const cleanName = `"${row.name.replace(/"/g, '""')}"`;
        const cleanRole = `"${row.role.replace(/"/g, '""')}"`;
        const cleanMethods = `"${row.methodsList.replace(/"/g, '""')}"`;
        
        csvContent += `${cleanName},${cleanRole},${cleanMethods},${row.normalHours.toFixed(2)},${row.overtimeHours.toFixed(2)},${row.totalHours.toFixed(2)},${row.grossPay.toFixed(2)},${row.payeTax.toFixed(2)},${row.netPay.toFixed(2)}\r\n`;
    });

    // Create hidden link and download
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `PAYE_Weekly_Summary_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// 12. Share QR Dropdown Controls
function toggleShareQR(event) {
    event.stopPropagation();
    const dropdown = document.getElementById("share-qr-dropdown");
    const isVisible = dropdown.style.display === "block";
    dropdown.style.display = isVisible ? "none" : "block";
}

// Global click handler to close QR dropdown on outside clicks
document.addEventListener("click", (event) => {
    const dropdown = document.getElementById("share-qr-dropdown");
    const shareBtn = document.getElementById("share-btn");
    if (dropdown && dropdown.style.display === "block" && !dropdown.contains(event.target) && event.target !== shareBtn && !shareBtn.contains(event.target)) {
        dropdown.style.display = "none";
    }
});
