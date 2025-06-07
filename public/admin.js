// Admin Global State
let isLoggedIn = false;
let adminPassword = '';
let currentTournament = null;
let teams = [];
let matches = [];

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const adminContent = document.getElementById('admin-content');
const loginForm = document.getElementById('admin-login-form');
const notification = document.getElementById('notification');
const menuItems = document.querySelectorAll('.menu-item');
const adminTabs = document.querySelectorAll('.admin-tab');
const pageTitle = document.getElementById('page-title');

// Utility Functions
function showNotification(message, type = 'success') {
    notification.textContent = message;
    notification.className = `notification ${type}`;
    notification.classList.add('show');
    setTimeout(() => {
        notification.classList.remove('show');
    }, 3000);
}

function formatDateTime(date) {
    if (!date) return 'Nicht geplant';
    return new Date(date).toLocaleString('de-DE');
}

// Tournament Creation Handler
async function handleTournamentCreation(e) {
    e.preventDefault();
    
    console.log('Tournament creation triggered');
    
    const yearInput = document.getElementById('tournament-year');
    if (!yearInput) {
        console.error('Year input not found');
        showNotification('Fehler: Jahr-Eingabefeld nicht gefunden', 'error');
        return;
    }
    
    const year = yearInput.value;
    
    if (!adminPassword) {
        console.error('Admin password not set');
        showNotification('Admin-Passwort nicht verfügbar', 'error');
        return;
    }
    
    console.log('Creating tournament for year:', year);
    
    try {
        const response = await fetch('/api/admin/tournament', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                password: adminPassword,
                year: parseInt(year)
            })
        });
        
        console.log('Response status:', response.status);
        const data = await response.json();
        console.log('Response data:', data);
        
        if (data.success) {
            currentTournament = data.tournament;
            showNotification('Turnier erfolgreich erstellt! Teams können sich jetzt anmelden.');
            await loadInitialData();
            updateTournamentInfo();
            loadTournamentManagement();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Erstellen des Turniers', 'error');
        console.error('Tournament creation error:', error);
    }
}

// Tournament Creation Event Listener Setup
function setupTournamentForm() {
    console.log('Setting up tournament form');
    const form = document.getElementById('tournament-creation-form');
    if (form) {
        console.log('Tournament form found, adding event listener');
        // Entferne alte Event Listener
        const newForm = form.cloneNode(true);
        form.parentNode.replaceChild(newForm, form);
        
        // Füge Event Listener hinzu
        newForm.addEventListener('submit', handleTournamentCreation);
        
        console.log('Event listener added to tournament form');
    } else {
        console.error('Tournament creation form not found');
    }
}

// Status Info Helper
function getStatusInfo(status) {
    const statusMap = {
        'registration': {
            type: 'success',
            icon: 'fa-user-plus',
            title: 'Anmeldung offen',
            description: 'Teams können sich für das Turnier anmelden.'
        },
        'closed': {
            type: 'warning',
            icon: 'fa-lock',
            title: 'Anmeldung geschlossen',
            description: 'Spielplan wird erstellt...'
        },
        'active': {
            type: 'primary',
            icon: 'fa-play',
            title: 'Turnier läuft',
            description: 'Das Turnier ist aktiv und Spiele werden gespielt.'
        },
        'finished': {
            type: 'info',
            icon: 'fa-flag-checkered',
            title: 'Turnier beendet',
            description: 'Das Turnier ist abgeschlossen.'
        }
    };
    return statusMap[status] || statusMap['registration'];
}

// Tournament Management
function loadTournamentManagement() {
    console.log('Loading tournament management');
    const tournamentStatus = document.getElementById('tournament-status');
    const tournamentCreation = document.getElementById('tournament-creation');
    const registrationManagement = document.getElementById('registration-management');
    
    if (!currentTournament) {
        // Kein Turnier vorhanden - Erstellung anzeigen
        console.log('No current tournament, showing creation form');
        tournamentStatus.innerHTML = `
            <div class="status-card info">
                <i class="fas fa-info-circle"></i>
                <h4>Kein aktives Turnier</h4>
                <p>Erstelle ein neues Turnier für dieses Jahr.</p>
            </div>
        `;
        tournamentCreation.style.display = 'block';
        registrationManagement.style.display = 'none';
        
        // Setup Event Listener nach einem kurzen Delay
        setTimeout(() => {
            setupTournamentForm();
        }, 100);
        
    } else {
        // Turnier vorhanden - Status anzeigen
        console.log('Current tournament exists:', currentTournament);
        const statusInfo = getStatusInfo(currentTournament.status);
        tournamentStatus.innerHTML = `
            <div class="status-card ${statusInfo.type}">
                <i class="fas ${statusInfo.icon}"></i>
                <h4>Turnier ${currentTournament.year} - ${statusInfo.title}</h4>
                <p>${statusInfo.description}</p>
                <div class="tournament-stats">
                    <span><strong>Teams:</strong> ${teams.length}</span>
                    <span><strong>Status:</strong> ${statusInfo.title}</span>
                    ${currentTournament.registrationClosedAt ? 
                        `<span><strong>Anmeldung geschlossen:</strong> ${new Date(currentTournament.registrationClosedAt).toLocaleDateString('de-DE')}</span>` : 
                        ''
                    }
                </div>
            </div>
        `;
        
        if (currentTournament.status === 'registration') {
            registrationManagement.innerHTML = `
                <h4>Anmeldephase verwalten</h4>
                <p>Aktuell können sich Teams anmelden. Schließe die Anmeldung, um den Spielplan zu erstellen.</p>
                <div class="registration-actions">
                    <button class="btn btn-warning" onclick="closeRegistration()" ${teams.length < 4 ? 'disabled' : ''}>
                        <i class="fas fa-lock"></i> Anmeldung schließen und Spielplan erstellen
                    </button>
                    ${teams.length < 4 ? '<p><small>Mindestens 4 Teams erforderlich</small></p>' : ''}
                </div>
            `;
            registrationManagement.style.display = 'block';
        } else {
            registrationManagement.style.display = 'none';
        }
        
        tournamentCreation.style.display = 'none';
    }
}

// Navigation
menuItems.forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        const targetTab = item.dataset.tab;
        
        // Update active menu item
        menuItems.forEach(mi => mi.classList.remove('active'));
        item.classList.add('active');
        
        // Update active tab
        adminTabs.forEach(tab => tab.classList.remove('active'));
        document.getElementById(`${targetTab}-tab`).classList.add('active');
        
        // Update page title
        const titles = {
            dashboard: 'Dashboard',
            tournament: 'Turnier verwalten',
            teams: 'Teams verwalten',
            matches: 'Spielplan',
            live: 'Live-Verwaltung',
            results: 'Ergebnisse',
            settings: 'Einstellungen'
        };
        pageTitle.textContent = titles[targetTab];
        
        // Load content
        loadTabContent(targetTab);
    });
});

// Login
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('admin-password').value;
    
    try {
        const response = await fetch('/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        
        const data = await response.json();
        
        if (data.success) {
            isLoggedIn = true;
            adminPassword = password;
            loginScreen.style.display = 'none';
            adminContent.style.display = 'block';
            showNotification('Erfolgreich angemeldet');
            await loadInitialData();
            loadTabContent('dashboard');
        } else {
            showNotification('Ungültiges Passwort', 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Anmelden', 'error');
    }
});

// Load Initial Data
async function loadInitialData() {
    try {
        // Load tournament
        const tournamentResponse = await fetch('/api/tournament');
        const tournamentData = await tournamentResponse.json();
        currentTournament = tournamentData.tournament;
        
        // Load teams
        const teamsResponse = await fetch('/api/admin/teams');
        teams = await teamsResponse.json();
        
        // Load matches
        const matchesResponse = await fetch('/api/matches');
        matches = await matchesResponse.json();
        
        updateTournamentInfo();
    } catch (error) {
        console.error('Fehler beim Laden der Daten:', error);
    }
}

function updateTournamentInfo() {
    const tournamentInfo = document.getElementById('current-tournament-info');
    if (currentTournament) {
        const statusMap = {
            'registration': 'Anmeldung offen',
            'closed': 'Anmeldung geschlossen',
            'active': 'Aktiv',
            'finished': 'Beendet'
        };
        const status = statusMap[currentTournament.status] || 'Unbekannt';
        tournamentInfo.textContent = `Turnier ${currentTournament.year} - ${status}`;
    } else {
        tournamentInfo.textContent = 'Kein aktives Turnier';
    }
}

// Tab Content Loading
async function loadTabContent(tab) {
    switch (tab) {
        case 'dashboard':
            loadDashboard();
            break;
        case 'tournament':
            loadTournamentManagement();
            break;
        case 'teams':
            loadTeams();
            break;
        case 'matches':
            loadMatches();
            break;
        case 'live':
            loadLiveControl();
            break;
        case 'results':
            loadResults();
            break;
        case 'settings':
            loadSettings();
            break;
    }
}

// Dashboard
function loadDashboard() {
    // Update stats
    document.getElementById('total-teams').textContent = teams.length;
    document.getElementById('total-matches').textContent = matches.length;
    document.getElementById('completed-matches').textContent = matches.filter(m => m.completed).length;
    document.getElementById('pending-matches').textContent = matches.filter(m => !m.completed).length;
    
    // Current match
    const currentMatchDisplay = document.getElementById('current-match-display');
    if (currentTournament && currentTournament.currentMatch) {
        const match = matches.find(m => m.id === currentTournament.currentMatch);
        if (match) {
            currentMatchDisplay.innerHTML = `
                <div class="current-match">
                    <h4>${match.team1} vs ${match.team2}</h4>
                    ${match.liveScore ? `
                        <div class="live-score">
                            ${match.liveScore.score1} : ${match.liveScore.score2}
                            <span class="minute">${match.liveScore.minute}'</span>
                        </div>
                    ` : '<p>Spiel läuft</p>'}
                </div>
            `;
        }
    } else {
        currentMatchDisplay.innerHTML = '<p>Kein Spiel läuft gerade</p>';
    }
    
    // Upcoming matches
    const upcomingMatches = document.getElementById('upcoming-matches');
    const nextMatches = matches.filter(m => !m.completed && m.scheduled).slice(0, 5);
    
    if (nextMatches.length > 0) {
        upcomingMatches.innerHTML = nextMatches.map(match => `
            <div class="upcoming-match">
                <div><strong>${match.team1} vs ${match.team2}</strong></div>
                <div><small>${formatDateTime(match.scheduled.datetime)}</small></div>
            </div>
        `).join('');
    } else {
        upcomingMatches.innerHTML = '<p>Keine bevorstehenden Spiele</p>';
    }
}

// Close Registration Functions
async function closeRegistration() {
    if (teams.length < 4) {
        showNotification('Mindestens 4 Teams erforderlich', 'error');
        return;
    }
    
    // Berechne verfügbare Platzierungsspiele basierend auf Teamanzahl
    const possiblePlacements = calculatePossiblePlacements(teams.length);
    
    // Erstelle Dialog für Gruppengröße und Platzierungsspiele
    const tournamentOptions = await createTournamentDialog(possiblePlacements);
    
    if (!tournamentOptions) {
        return; // User hat abgebrochen
    }
    
    try {
        const response = await fetch('/api/admin/close-registration', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                password: adminPassword,
                groupSize: tournamentOptions.groupSize,
                enableThirdPlace: tournamentOptions.thirdPlace,
                enableFifthPlace: tournamentOptions.fifthPlace,
                enableSeventhPlace: tournamentOptions.seventhPlace
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification(data.message || `Anmeldung geschlossen! Spielplan mit ${data.matchesGenerated} Spielen erstellt.`);
            await loadInitialData();
            updateTournamentInfo();
            loadTournamentManagement();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Schließen der Anmeldung', 'error');
        console.error('Close registration error:', error);
    }
}

// Helper Functions
function calculatePossiblePlacements(teamCount) {
    const placements = {
        thirdPlace: teamCount >= 4,
        fifthPlace: teamCount >= 6,
        seventhPlace: teamCount >= 8
    };
    return placements;
}

function createTournamentDialog(possiblePlacements) {
    let dialogHtml = `
        <div style="margin-bottom: 1.5rem;">
            <h4>Turnier-Einstellungen festlegen</h4>
            <p>Für ${teams.length} angemeldete Teams:</p>
        </div>
        
        <div style="margin-bottom: 1.5rem;">
            <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">
                Teams pro Gruppe:
            </label>
            <select id="tournament-group-size" style="width: 100%; padding: 0.5rem; border: 2px solid #ccc; border-radius: 0.5rem;">
                <option value="3">3 Teams pro Gruppe</option>
                <option value="4" selected>4 Teams pro Gruppe</option>
                <option value="5">5 Teams pro Gruppe</option>
            </select>
        </div>
        
        <div style="margin-bottom: 1rem;">
            <h5 style="margin-bottom: 0.5rem;">Platzierungsspiele:</h5>
        </div>
    `;
    
    if (possiblePlacements.thirdPlace) {
        dialogHtml += `
            <label style="display: block; margin-bottom: 0.5rem;">
                <input type="checkbox" id="placement-third" checked> Spiel um Platz 3
            </label>
        `;
    }
    
    if (possiblePlacements.fifthPlace) {
        dialogHtml += `
            <label style="display: block; margin-bottom: 0.5rem;">
                <input type="checkbox" id="placement-fifth"> Spiel um Platz 5
            </label>
        `;
    }
    
    if (possiblePlacements.seventhPlace) {
        dialogHtml += `
            <label style="display: block; margin-bottom: 0.5rem;">
                <input type="checkbox" id="placement-seventh"> Spiel um Platz 7
            </label>
        `;
    }
    
    const modalDiv = document.createElement('div');
    modalDiv.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; bottom: 0; 
        background: rgba(0,0,0,0.5); z-index: 10000; 
        display: flex; align-items: center; justify-content: center;
    `;
    
    modalDiv.innerHTML = `
        <div style="background: white; padding: 2rem; border-radius: 1rem; max-width: 500px; width: 90%;">
            ${dialogHtml}
            <div style="margin-top: 1.5rem; display: flex; gap: 1rem;">
                <button id="confirm-tournament" style="background: #dc2626; color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 0.5rem; cursor: pointer;">
                    Spielplan erstellen
                </button>
                <button id="cancel-tournament" style="background: #6b7280; color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 0.5rem; cursor: pointer;">
                    Abbrechen
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modalDiv);
    
    return new Promise((resolve) => {
        document.getElementById('confirm-tournament').onclick = () => {
            const result = {
                groupSize: parseInt(document.getElementById('tournament-group-size').value),
                thirdPlace: document.getElementById('placement-third')?.checked || false,
                fifthPlace: document.getElementById('placement-fifth')?.checked || false,
                seventhPlace: document.getElementById('placement-seventh')?.checked || false
            };
            document.body.removeChild(modalDiv);
            resolve(result);
        };
        
        document.getElementById('cancel-tournament').onclick = () => {
            document.body.removeChild(modalDiv);
            resolve(null);
        };
        
        modalDiv.onclick = (e) => {
            if (e.target === modalDiv) {
                document.body.removeChild(modalDiv);
                resolve(null);
            }
        };
    });
}

// Teams verwalten
function loadTeams() {
    const teamsList = document.getElementById('admin-teams-list');
    
    if (teams.length === 0) {
        teamsList.innerHTML = '<p>Noch keine Teams registriert</p>';
        return;
    }
    
    teamsList.innerHTML = teams.map(team => `
        <div class="team-admin-card">
            <div class="team-info">
                <h4>${team.name}</h4>
                <div class="team-contact">
                    <strong>Kontakt:</strong> ${team.contact.name}<br>
                    <strong>Info:</strong> ${team.contact.info}<br>
                    <small>Angemeldet: ${new Date(team.registeredAt).toLocaleDateString('de-DE')}</small>
                </div>
            </div>
            <div class="team-actions">
                <button class="btn btn-small btn-danger" onclick="deleteTeam(${team.id})">
                    <i class="fas fa-trash"></i> Löschen
                </button>
            </div>
        </div>
    `).join('');
}

// Spielplan verwalten
function loadMatches() {
    const matchesAdmin = document.getElementById('matches-schedule-admin');
    
    if (!currentTournament) {
        matchesAdmin.innerHTML = '<p>Kein Turnier vorhanden. Erstelle zuerst ein Turnier.</p>';
        return;
    }
    
    if (currentTournament.status === 'registration') {
        matchesAdmin.innerHTML = `
            <div class="status-card warning">
                <i class="fas fa-clock"></i>
                <h4>Spielplan noch nicht verfügbar</h4>
                <p>Der Spielplan wird erstellt, sobald die Anmeldung geschlossen wird.</p>
                <p><strong>Angemeldete Teams:</strong> ${teams.length}</p>
            </div>
        `;
        return;
    }
    
    if (matches.length === 0) {
        matchesAdmin.innerHTML = '<p>Keine Spiele vorhanden.</p>';
        return;
    }
    
    const groupedMatches = {};
    matches.forEach(match => {
        const phase = match.phase === 'group' ? match.group : match.phase;
        if (!groupedMatches[phase]) {
            groupedMatches[phase] = [];
        }
        groupedMatches[phase].push(match);
    });
    
    let html = '';
    Object.entries(groupedMatches).forEach(([phase, phaseMatches]) => {
        html += `<h4>${phase}</h4>`;
        phaseMatches.forEach(match => {
            html += `
                <div class="match-admin-card ${match.liveScore?.isLive ? 'live' : ''}">
                    <div class="match-header">
                        <div class="match-teams-admin">
                            <span class="team-name">${match.team1}</span>
                            <span class="vs">vs</span>
                            <span class="team-name">${match.team2}</span>
                        </div>
                        <div class="match-status">
                            ${match.completed ? 
                                `<strong>${match.score1}:${match.score2}</strong>` : 
                                match.liveScore?.isLive ? 
                                    `<strong class="live-indicator">LIVE ${match.liveScore.score1}:${match.liveScore.score2}</strong>` :
                                    'Ausstehend'
                            }
                        </div>
                    </div>
                    <div class="match-actions">
                        <button class="btn btn-small" onclick="scheduleMatch('${match.id}')">
                            <i class="fas fa-calendar"></i> Zeit planen
                        </button>
                        ${!match.completed && !match.liveScore?.isLive ? `
                            <button class="btn btn-small btn-success" onclick="startMatchDialog('${match.id}')">
                                <i class="fas fa-play"></i> Spiel starten
                            </button>
                        ` : ''}
                        <button class="btn btn-small btn-warning" onclick="editMatch('${match.id}')">
                            <i class="fas fa-edit"></i> Bearbeiten
                        </button>
                    </div>
                    ${match.scheduled ? `
                        <div class="match-schedule">
                            <small><i class="fas fa-clock"></i> ${new Date(match.scheduled.datetime).toLocaleTimeString('de-DE', {hour: '2-digit', minute: '2-digit'})} - ${match.scheduled.field}</small>
                        </div>
                    ` : ''}
                </div>
            `;
        });
    });
    
    // Add bulk scheduling button
    const unscheduled = matches.filter(m => !m.scheduled).length;
    if (unscheduled > 0) {
        html = `
            <div class="bulk-actions">
                <button class="btn btn-primary" onclick="scheduleAllMatches()">
                    <i class="fas fa-clock"></i> Alle ${unscheduled} Spiele automatisch planen
                </button>
            </div>
        ` + html;
    }
    
    matchesAdmin.innerHTML = html;
}

// Live-Verwaltung
function loadLiveControl() {
    const liveControl = document.getElementById('live-match-control');
    
    const liveMatches = matches.filter(m => m.liveScore?.isLive);
    const pendingMatches = matches.filter(m => !m.completed && !m.liveScore?.isLive);
    
    let html = '';
    
    if (liveMatches.length > 0) {
        html += '<h4>Laufende Spiele</h4>';
        liveMatches.forEach(match => {
            const timeInfo = calculateMatchTime(match.liveScore);
            html += `
                <div class="live-score-control" data-match-id="${match.id}">
                    <h5>${match.team1} vs ${match.team2}</h5>
                    <div class="match-timer">
                        <div class="timer-display">
                            <span class="current-time">${timeInfo.displayTime}</span>
                            <span class="half-info">${timeInfo.halfInfo}</span>
                        </div>
                        <div class="timer-controls">
                            <button class="btn btn-small pause-btn" onclick="pauseMatch('${match.id}')" 
                                    style="display: ${(!match.liveScore.isPaused && !match.liveScore.halfTimeBreak) ? 'inline-flex' : 'none'}">
                                <i class="fas fa-pause"></i> Pause
                            </button>
                            <button class="btn btn-small resume-btn" onclick="resumeMatch('${match.id}')"
                                    style="display: ${(match.liveScore.isPaused && !match.liveScore.halfTimeBreak) ? 'inline-flex' : 'none'}">
                                <i class="fas fa-play"></i> Weiter
                            </button>
                            <button class="btn btn-small btn-warning halftime-btn" onclick="halftimeBreak('${match.id}')"
                                    style="display: ${(match.liveScore.currentHalf === 1 && !match.liveScore.halfTimeBreak) ? 'inline-flex' : 'none'}">
                                <i class="fas fa-clock"></i> Halbzeit
                            </button>
                            <button class="btn btn-small btn-success second-half-btn" onclick="startSecondHalf('${match.id}')"
                                    style="display: ${match.liveScore.halfTimeBreak ? 'inline-flex' : 'none'}">
                                <i class="fas fa-play-circle"></i> 2. Halbzeit
                            </button>
                        </div>
                    </div>
                    <div class="score-input-grid">
                        <input type="number" class="score-input" id="live-score1-${match.id}" 
                               value="${match.liveScore.score1}" min="0">
                        <span class="vs">:</span>
                        <input type="number" class="score-input" id="live-score2-${match.id}" 
                               value="${match.liveScore.score2}" min="0">
                    </div>
                    <div class="live-actions">
                        <button class="btn btn-primary" onclick="updateLiveScore('${match.id}')">
                            <i class="fas fa-sync"></i> Score aktualisieren
                        </button>
                        <button class="btn btn-success" onclick="finishMatch('${match.id}')">
                            <i class="fas fa-flag"></i> Spiel beenden
                        </button>
                    </div>
                </div>
            `;
        });
    }
    
    if (pendingMatches.length > 0) {
        html += '<h4>Bereit zum Start</h4>';
        pendingMatches.forEach(match => {
            html += `
                <div class="match-admin-card">
                    <div class="match-header">
                        <div class="match-teams-admin">
                            <span class="team-name">${match.team1}</span>
                            <span class="vs">vs</span>
                            <span class="team-name">${match.team2}</span>
                        </div>
                        <button class="btn btn-success" onclick="startMatchDialog('${match.id}')">
                            <i class="fas fa-play"></i> Spiel starten
                        </button>
                    </div>
                </div>
            `;
        });
    }
    
    if (html === '') {
        html = '<p>Keine Spiele für Live-Verwaltung verfügbar</p>';
    }
    
    liveControl.innerHTML = html;
    
    // Start timer updates for live matches
    if (liveMatches.length > 0) {
        console.log(`Found ${liveMatches.length} live matches, starting updates`);
        startLiveUpdates();
    } else {
        console.log('No live matches found');
    }
}

// Ergebnisse verwalten
function loadResults() {
    const resultsInput = document.getElementById('results-input');
    const pendingMatches = matches.filter(m => !m.completed && !m.liveScore?.isLive);
    const completedMatches = matches.filter(m => m.completed);
    
    let html = '';
    
    if (pendingMatches.length > 0) {
        html += '<h4>Ergebnisse eintragen</h4>';
        pendingMatches.forEach(match => {
            html += `
                <div class="result-form">
                    <h5>${match.team1} vs ${match.team2}</h5>
                    ${match.group ? `<p><small>${match.group}</small></p>` : ''}
                    <div class="score-inputs">
                        <span class="team-name">${match.team1}</span>
                        <input type="number" min="0" id="result-score1-${match.id}" placeholder="0">
                        <span class="score-vs">:</span>
                        <input type="number" min="0" id="result-score2-${match.id}" placeholder="0">
                        <span class="team-name">${match.team2}</span>
                    </div>
                    <button onclick="submitResult('${match.id}')" class="btn btn-primary">
                        <i class="fas fa-save"></i> Ergebnis speichern
                    </button>
                </div>
            `;
        });
    }
    
    if (completedMatches.length > 0) {
        html += '<h4>Abgeschlossene Spiele</h4>';
        completedMatches.forEach(match => {
            html += `
                <div class="match-admin-card">
                    <div class="match-header">
                        <div class="match-teams-admin">
                            <span class="team-name">${match.team1}</span>
                            <span class="match-score">${match.score1} : ${match.score2}</span>
                            <span class="team-name">${match.team2}</span>
                        </div>
                        <button class="btn btn-small btn-warning" onclick="editResult('${match.id}')">
                            <i class="fas fa-edit"></i> Bearbeiten
                        </button>
                    </div>
                    ${match.group ? `<small>Gruppe: ${match.group}</small>` : ''}
                </div>
            `;
        });
    }
    
    if (html === '') {
        html = '<p>Keine Spiele verfügbar</p>';
    }
    
    resultsInput.innerHTML = html;
}

// Einstellungen
function loadSettings() {
    const settings = document.getElementById('tournament-settings');
    
    if (!currentTournament) {
        settings.innerHTML = '<p>Kein aktives Turnier vorhanden</p>';
        return;
    }
    
    settings.innerHTML = `
        <div class="settings-grid">
            <div class="setting-item">
                <label>Turnierjahr</label>
                <p>${currentTournament.year}</p>
            </div>
            <div class="setting-item">
                <label>Gruppengröße</label>
                <p>${currentTournament.settings?.groupSize || 4} Teams</p>
            </div>
            <div class="setting-item">
                <label>Spiel um Platz 3</label>
                <p>${currentTournament.settings?.enableThirdPlace ? 'Aktiviert' : 'Deaktiviert'}</p>
            </div>
            <div class="setting-item">
                <label>Spiel um Platz 5</label>
                <p>${currentTournament.settings?.enableFifthPlace ? 'Aktiviert' : 'Deaktiviert'}</p>
            </div>
        </div>
        <div class="danger-zone">
            <h4>Danger Zone</h4>
            <button class="btn btn-danger" onclick="resetTournament()">
                <i class="fas fa-trash"></i> Turnier zurücksetzen
            </button>
        </div>
    `;
}

// Live Timer Functions
let liveUpdateInterval = null;

function calculateMatchTime(liveScore) {
    if (!liveScore || !liveScore.startTime) {
        return { displayTime: '00:00', halfInfo: 'Nicht gestartet', status: 'stopped' };
    }
    
    const now = new Date();
    const startTime = new Date(liveScore.startTime);
    const halfTimeMinutes = liveScore.halfTimeMinutes || 45;
    
    // Wenn pausiert, Zeit bei Pausenbeginn stoppen
    if (liveScore.isPaused && !liveScore.halfTimeBreak) {
        const pausedMinute = liveScore.minute || 0;
        return {
            displayTime: formatMinutes(pausedMinute),
            halfInfo: 'PAUSIERT',
            status: 'paused'
        };
    }
    
    // Halbzeitpause
    if (liveScore.halfTimeBreak) {
        return {
            displayTime: formatMinutes(halfTimeMinutes),
            halfInfo: 'HALBZEIT',
            status: 'halftime'
        };
    }
    
    let currentMinute = 0;
    let halfInfo = '';
    let status = 'running';
    
    if (liveScore.currentHalf === 1) {
        // Erste Halbzeit - berechne seit Spielstart
        let elapsedTime = now - startTime;
        if (liveScore.pausedTime) {
            elapsedTime -= liveScore.pausedTime;
        }
        currentMinute = Math.floor(elapsedTime / (1000 * 60));
        
        if (currentMinute >= halfTimeMinutes) {
            currentMinute = halfTimeMinutes;
            halfInfo = '1. HALBZEIT ENDE';
            status = 'half-ended';
        } else {
            halfInfo = '1. HALBZEIT';
        }
    } else if (liveScore.currentHalf === 2 && liveScore.secondHalfStartTime) {
        // Zweite Halbzeit - berechne seit 2. Halbzeit Start
        const secondHalfStart = new Date(liveScore.secondHalfStartTime);
        let elapsedTime = now - secondHalfStart;
        currentMinute = Math.floor(elapsedTime / (1000 * 60));
        
        if (currentMinute >= halfTimeMinutes) {
            currentMinute = halfTimeMinutes;
            halfInfo = 'SPIEL ENDE';
            status = 'finished';
        } else {
            halfInfo = '2. HALBZEIT';
        }
    }
    
    const displayTime = formatMinutes(Math.max(0, currentMinute));
    
    return { displayTime, halfInfo, status, currentMinute };
}

function formatMinutes(minutes) {
    return Math.min(Math.max(minutes, 0), 99).toString().padStart(2, '0') + ':00';
}

function startLiveUpdates() {
    console.log('Starting live updates...');
    
    if (liveUpdateInterval) {
        clearInterval(liveUpdateInterval);
    }
    
    liveUpdateInterval = setInterval(async () => {
        try {
            // Reload matches data to get latest live scores
            const matchesResponse = await fetch('/api/matches');
            const latestMatches = await matchesResponse.json();
            
            const liveMatches = latestMatches.filter(m => m.liveScore?.isLive);
            
            if (liveMatches.length === 0) {
                console.log('No live matches found, stopping updates');
                clearInterval(liveUpdateInterval);
                liveUpdateInterval = null;
                return;
            }
            
            liveMatches.forEach(match => {
                const timeInfo = calculateMatchTime(match.liveScore);
                const matchElement = document.querySelector(`[data-match-id="${match.id}"]`);
                
                if (matchElement) {
                    const timerElement = matchElement.querySelector('.current-time');
                    const halfElement = matchElement.querySelector('.half-info');
                    
                    if (timerElement) {
                        timerElement.textContent = timeInfo.displayTime;
                        console.log(`Updated timer for match ${match.id}: ${timeInfo.displayTime}`);
                    }
                    if (halfElement) halfElement.textContent = timeInfo.halfInfo;
                    
                    // Update button states based on status
                    updateMatchControls(matchElement, match.liveScore, timeInfo.status);
                }
            });
            
            // Update global matches array
            matches = latestMatches;
            
        } catch (error) {
            console.error('Error updating live matches:', error);
        }
    }, 1000);
}

function updateMatchControls(matchElement, liveScore, status) {
    const pauseBtn = matchElement.querySelector('.pause-btn');
    const resumeBtn = matchElement.querySelector('.resume-btn');
    const halftimeBtn = matchElement.querySelector('.halftime-btn');
    const secondHalfBtn = matchElement.querySelector('.second-half-btn');
    
    if (pauseBtn) pauseBtn.style.display = (!liveScore.isPaused && !liveScore.halfTimeBreak) ? 'inline-flex' : 'none';
    if (resumeBtn) resumeBtn.style.display = (liveScore.isPaused && !liveScore.halfTimeBreak) ? 'inline-flex' : 'none';
    if (halftimeBtn) halftimeBtn.style.display = (liveScore.currentHalf === 1 && !liveScore.halfTimeBreak && status !== 'half-ended') ? 'inline-flex' : 'none';
    if (secondHalfBtn) secondHalfBtn.style.display = liveScore.halfTimeBreak ? 'inline-flex' : 'none';
}

// Action Functions
async function startMatchDialog(matchId) {
    const match = matches.find(m => m.id === matchId);
    if (!match) return;
    
    const halfTimeMinutes = prompt('Halbzeitlänge in Minuten:', '45');
    if (!halfTimeMinutes || isNaN(halfTimeMinutes)) return;
    
    try {
        const response = await fetch('/api/admin/start-match', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                password: adminPassword,
                matchId,
                halfTimeMinutes: parseInt(halfTimeMinutes)
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification(`Spiel gestartet! Halbzeitlänge: ${halfTimeMinutes} Minuten`);
            await loadInitialData();
            loadTabContent('live');
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Starten des Spiels', 'error');
    }
}

async function updateLiveScore(matchId) {
    const score1 = document.getElementById(`live-score1-${matchId}`).value;
    const score2 = document.getElementById(`live-score2-${matchId}`).value;
    
    try {
        const response = await fetch('/api/admin/live-score', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                password: adminPassword,
                matchId,
                score1: parseInt(score1),
                score2: parseInt(score2)
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Live-Score aktualisiert!');
            await loadInitialData();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Aktualisieren des Live-Scores', 'error');
    }
}

async function finishMatch(matchId) {
    try {
        const response = await fetch('/api/admin/finish-match', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: adminPassword, matchId })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Spiel beendet!');
            await loadInitialData();
            loadTabContent('live');
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Beenden des Spiels', 'error');
    }
}

async function submitResult(matchId) {
    const score1 = document.getElementById(`result-score1-${matchId}`).value;
    const score2 = document.getElementById(`result-score2-${matchId}`).value;
    
    if (!score1 || !score2) {
        showNotification('Bitte beide Ergebnisse eingeben', 'warning');
        return;
    }
    
    try {
        const response = await fetch('/api/admin/result', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                password: adminPassword,
                matchId,
                score1: parseInt(score1),
                score2: parseInt(score2)
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Ergebnis erfolgreich gespeichert!');
            await loadInitialData();
            loadResults();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Speichern des Ergebnisses', 'error');
    }
}

function scheduleMatch(matchId) {
    const time = prompt('Uhrzeit (HH:MM):', '15:00');
    const field = prompt('Spielfeld:', 'Hauptplatz');
    
    if (time && /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(time)) {
        console.log(`Scheduling match for time: ${time}`);
        
        // Aktuelles Datum mit der eingegebenen Uhrzeit kombinieren
        const today = new Date();
        const [hours, minutes] = time.split(':').map(num => parseInt(num));
        const datetime = new Date(today.getFullYear(), today.getMonth(), today.getDate(), hours, minutes, 0, 0);
        
        console.log(`Scheduled datetime: ${datetime.toLocaleString('de-DE')}`);
        
        fetch('/api/admin/schedule', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                password: adminPassword,
                matchId,
                datetime: datetime.toISOString(),
                field
            })
        }).then(response => response.json()).then(data => {
            if (data.success) {
                showNotification(`Spiel geplant für ${time} Uhr!`);
                loadInitialData().then(() => loadMatches());
            } else {
                showNotification(data.error, 'error');
            }
        }).catch(error => {
            console.error('Error scheduling match:', error);
            showNotification('Fehler beim Planen des Spiels', 'error');
        });
    } else if (time) {
        showNotification('Ungültiges Zeitformat. Bitte HH:MM verwenden.', 'error');
    }
}

// Automatische Gruppenplanung
async function scheduleAllMatches() {
    if (!confirm('Automatisch alle Spiele planen? (Abwechselnd zwischen Gruppen)')) return;
    
    const startTime = prompt('Startzeit (HH:MM):', '10:00');
    const matchDuration = prompt('Spieldauer + Pause in Minuten:', '60');
    const field = prompt('Spielfeld:', 'Hauptplatz');
    
    if (!startTime || !matchDuration) return;
    
    // Validiere Zeitformat
    if (!/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(startTime)) {
        showNotification('Ungültiges Zeitformat. Bitte HH:MM verwenden.', 'error');
        return;
    }
    
    console.log(`Auto-scheduling: Start at ${startTime}, duration ${matchDuration}min`);
    
    try {
        const response = await fetch('/api/admin/schedule-all', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                password: adminPassword,
                startTime,
                matchDuration: parseInt(matchDuration),
                field
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification(`${data.scheduledMatches} Spiele automatisch geplant ab ${startTime} Uhr!`);
            await loadInitialData();
            loadMatches();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        console.error('Error auto-scheduling:', error);
        showNotification('Fehler beim automatischen Planen', 'error');
    }
}

// Placeholder functions for future implementation
function deleteTeam(teamId) {
    if (confirm('Team wirklich löschen?')) {
        showNotification('Team löschen noch nicht implementiert', 'warning');
    }
}

function editMatch(matchId) {
    showNotification('Match bearbeiten noch nicht implementiert', 'warning');
}

function editResult(matchId) {
    showNotification('Ergebnis bearbeiten noch nicht implementiert', 'warning');
}

// Live Match Control Functions
async function pauseMatch(matchId) {
    try {
        const response = await fetch('/api/admin/pause-match', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: adminPassword, matchId })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Spiel pausiert');
            await loadInitialData();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Pausieren', 'error');
    }
}

async function resumeMatch(matchId) {
    try {
        const response = await fetch('/api/admin/resume-match', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: adminPassword, matchId })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Spiel fortgesetzt');
            await loadInitialData();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Fortsetzen', 'error');
    }
}

async function halftimeBreak(matchId) {
    if (!confirm('Halbzeitpause starten?')) return;
    
    try {
        const response = await fetch('/api/admin/halftime-break', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: adminPassword, matchId })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Halbzeitpause gestartet');
            await loadInitialData();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Starten der Halbzeitpause', 'error');
    }
}

async function startSecondHalf(matchId) {
    if (!confirm('Zweite Halbzeit starten?')) return;
    
    try {
        const response = await fetch('/api/admin/start-second-half', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: adminPassword, matchId })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Zweite Halbzeit gestartet');
            await loadInitialData();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Starten der zweiten Halbzeit', 'error');
    }
}

function resetTournament() {
    if (confirm('Turnier wirklich zurücksetzen? Alle Daten gehen verloren!')) {
        showNotification('Turnier zurücksetzen noch nicht implementiert', 'warning');
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    console.log('Admin page loaded, DOM ready');
    
    // Check if already logged in (for development)
    if (window.location.hash === '#dev') {
        adminPassword = '1234qwer!';
        isLoggedIn = true;
        loginScreen.style.display = 'none';
        adminContent.style.display = 'block';
        loadInitialData().then(() => {
            loadTournamentManagement();
        });
    }
});