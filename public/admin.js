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

/**
 * KORREKTUR: Die createModal Funktion wurde überarbeitet, um Event Listener
 * programmatisch hinzuzufügen, anstatt unsichere inline 'onclick' Attribute zu verwenden.
 * Dies behebt die "Cannot access '...' before initialization" Fehler.
 */
function createModal(title, content, actions = []) {
    const modalId = 'dynamic-modal-' + Date.now();
    const modalHtml = `
        <div id="${modalId}" class="modal active">
            <div class="modal-content">
                <div class="modal-header">
                    <h3>${title}</h3>
                    <button class="close-btn">&times;</button>
                </div>
                <div class="modal-body" style="padding: 2rem;">
                    ${content}
                </div>
                ${actions.length > 0 ? `
                    <div class="modal-footer" style="padding: 1rem 2rem; border-top: 1px solid var(--gray-200); display: flex; gap: 1rem; justify-content: flex-end;">
                        ${actions.map((action, index) => `<button id="modal-action-${modalId}-${index}" class="btn ${action.class || 'btn-primary'}">${action.text}</button>`).join('')}
                    </div>
                ` : ''}
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    const modalElement = document.getElementById(modalId);

    // Event Listener für Schließen-Button
    modalElement.querySelector('.close-btn').addEventListener('click', () => closeModal(modalId));
    
    // Event Listener für Action-Buttons im Footer
    actions.forEach((action, index) => {
        const button = modalElement.querySelector(`#modal-action-${modalId}-${index}`);
        if (button && typeof action.handler === 'function') {
            button.addEventListener('click', () => action.handler(modalId)); 
        }
    });

    return modalElement;
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.remove();
    }
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
        // Entferne alte Event Listener, um Duplikate zu vermeiden
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
                <div class="tournament-actions" style="margin-top: 1rem;">
                    <button class="btn btn-warning" onclick="changeTournamentStatus()">
                        <i class="fas fa-edit"></i> Status ändern
                    </button>
                    <button class="btn btn-outline" onclick="reorganizeGroups()">
                        <i class="fas fa-refresh"></i> Gruppen neu organisieren
                    </button>
                    <button class="btn btn-outline" onclick="resetAllResults()">
                        <i class="fas fa-undo"></i> Alle Ergebnisse zurücksetzen
                    </button>
                    <button class="btn btn-outline" onclick="resetAllSchedules()">
                        <i class="fas fa-calendar-times"></i> Zeitpläne zurücksetzen
                    </button>
                    <button class="btn btn-outline" onclick="exportTournamentData()">
                        <i class="fas fa-download"></i> Daten exportieren
                    </button>
                    <button class="btn btn-danger" onclick="resetTournamentComplete()">
                        <i class="fas fa-trash"></i> Turnier komplett zurücksetzen
                    </button>
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
            rules: 'Regeln verwalten',
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
        case 'rules':
            loadRulesManagement();
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
                    ${match.referee ? `
                        <div class="match-referee">
                            <small><i class="fas fa-whistle"></i> Schiedsrichter: ${match.referee.team}</small>
                        </div>
                    ` : ''}
                </div>
            `;
        }
    } else {
        currentMatchDisplay.innerHTML = '<p>Kein Spiel läuft gerade</p>';
    }
    
    // Upcoming matches
    loadUpcomingMatches();
}

async function loadUpcomingMatches() {
    try {
        const response = await fetch('/api/next-match');
        const data = await response.json();
        
        const upcomingMatches = document.getElementById('upcoming-matches');
        
        if (data.nextMatch) {
            const nextMatch = data.nextMatch;
            const nextTime = new Date(nextMatch.datetime);
            const timeUntilMatch = nextTime - new Date();
            const minutesUntil = Math.max(0, Math.floor(timeUntilMatch / (1000 * 60)));
            
            upcomingMatches.innerHTML = `
                <div class="next-match-admin">
                    <div class="next-match-time">
                        <strong>${nextTime.toLocaleTimeString('de-DE', {hour: '2-digit', minute: '2-digit'})}</strong>
                        <span class="countdown">${minutesUntil > 0 ? `in ${minutesUntil} Min.` : 'Jetzt'}</span>
                    </div>
                    <div class="next-match-info">
                        <strong>${nextMatch.team1} vs ${nextMatch.team2}</strong>
                        <div class="match-details">
                            <span><i class="fas fa-layer-group"></i> ${nextMatch.group}</span>
                            <span><i class="fas fa-map-marker-alt"></i> ${nextMatch.field}</span>
                        </div>
                        ${nextMatch.referee ? `
                            <div class="match-referee">
                                <i class="fas fa-whistle"></i>
                                <span>Schiedsrichter: <strong>${nextMatch.referee.team}</strong> (${nextMatch.referee.group})</span>
                            </div>
                        ` : ''}
                    </div>
                    <div class="next-match-actions">
                        <button class="btn btn-small btn-success" onclick="startMatchDialog('${nextMatch.id}')">
                            <i class="fas fa-play"></i> Spiel starten
                        </button>
                    </div>
                </div>
            `;
        } else {
            // Show next 3 scheduled matches if no specific next match
            const nextMatches = matches
                .filter(m => !m.completed && m.scheduled)
                .sort((a, b) => new Date(a.scheduled.datetime) - new Date(b.scheduled.datetime))
                .slice(0, 3);
            
            if (nextMatches.length > 0) {
                upcomingMatches.innerHTML = nextMatches.map(match => `
                    <div class="upcoming-match">
                        <div><strong>${match.team1} vs ${match.team2}</strong></div>
                        <div><small>${formatDateTime(match.scheduled.datetime)}</small></div>
                        ${match.referee ? `
                            <div class="match-referee">
                                <small><i class="fas fa-whistle"></i> ${match.referee.team}</small>
                            </div>
                        ` : ''}
                    </div>
                `).join('');
            } else {
                upcomingMatches.innerHTML = '<p>Keine bevorstehenden Spiele</p>';
            }
        }
    } catch (error) {
        console.error('Error loading upcoming matches:', error);
        document.getElementById('upcoming-matches').innerHTML = '<p>Fehler beim Laden der nächsten Spiele</p>';
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
                enableSeventhPlace: tournamentOptions.seventhPlace,
                maxGamesPerTeam: tournamentOptions.maxGamesPerTeam
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
        
        <div style="margin-bottom: 1.5rem;">
            <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">
                Maximale Spiele pro Team in der Gruppenphase:
            </label>
            <select id="tournament-max-games" style="width: 100%; padding: 0.5rem; border: 2px solid #ccc; border-radius: 0.5rem;">
                <option value="">Alle möglichen Spiele (Jeder gegen Jeden)</option>
                <option value="2">Maximal 2 Spiele pro Team</option>
                <option value="3">Maximal 3 Spiele pro Team</option>
                <option value="4">Maximal 4 Spiele pro Team</option>
            </select>
            <small style="color: #666; margin-top: 0.5rem; display: block;">
                Wenn z.B. 5 Teams in einer Gruppe sind, können Sie begrenzen, dass jedes Team nur gegen 3 zufällige Gegner spielt.
            </small>
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
        <div style="background: white; padding: 2rem; border-radius: 1rem; max-width: 600px; width: 90%;">
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
            const maxGamesValue = document.getElementById('tournament-max-games').value;
            const result = {
                groupSize: parseInt(document.getElementById('tournament-group-size').value),
                maxGamesPerTeam: maxGamesValue ? parseInt(maxGamesValue) : null,
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

// NEW ADMIN MANAGEMENT FUNCTIONS

// Change Tournament Status
async function changeTournamentStatus() {
    if (!currentTournament) return;
    
    const statuses = [
        { value: 'registration', label: 'Anmeldung offen' },
        { value: 'closed', label: 'Anmeldung geschlossen' },
        { value: 'active', label: 'Turnier aktiv' },
        { value: 'finished', label: 'Turnier beendet' }
    ];
    
    const options = statuses.map(s => 
        `<option value="${s.value}" ${s.value === currentTournament.status ? 'selected' : ''}>${s.label}</option>`
    ).join('');
    
    createModal('Turnier-Status ändern', `
        <div class="form-group">
            <label for="new-status">Neuer Status:</label>
            <select id="new-status" style="width: 100%; padding: 0.5rem; border: 2px solid #ccc; border-radius: 0.5rem;">
                ${options}
            </select>
        </div>
    `, [
        { text: 'Status ändern', handler: (modalId) => saveNewStatus(modalId) },
        { text: 'Abbrechen', class: 'btn-outline', handler: (modalId) => closeModal(modalId) }
    ]);
}

async function saveNewStatus(modalId) {
    const newStatus = document.getElementById('new-status').value;
    
    try {
        const response = await fetch('/api/admin/tournament/status', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                password: adminPassword,
                status: newStatus
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification(`Turnier-Status erfolgreich auf "${newStatus}" geändert`);
            closeModal(modalId);
            await loadInitialData();
            loadTournamentManagement();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Ändern des Status', 'error');
    }
}

// Reorganize Groups
async function reorganizeGroups() {
    if (!currentTournament) return;
    
    createModal('Gruppen neu organisieren', `
        <div class="warning-box" style="background: #fef3c7; border: 1px solid #f59e0b; padding: 1rem; border-radius: 0.5rem; margin-bottom: 1rem;">
            <i class="fas fa-exclamation-triangle" style="color: #f59e0b;"></i>
            <strong>Achtung:</strong> Alle bestehenden Gruppenspiele werden gelöscht und neu erstellt!
        </div>
        <div class="form-group">
            <label for="new-group-size">Teams pro Gruppe:</label>
            <select id="new-group-size" style="width: 100%; padding: 0.5rem; border: 2px solid #ccc; border-radius: 0.5rem;">
                <option value="3">3 Teams pro Gruppe</option>
                <option value="4" selected>4 Teams pro Gruppe</option>
                <option value="5">5 Teams pro Gruppe</option>
            </select>
        </div>
        <p><strong>Aktuelle Teams:</strong> ${teams.length}</p>
    `, [
        { text: 'Gruppen neu organisieren', class: 'btn-warning', handler: (modalId) => executeReorganizeGroups(modalId) },
        { text: 'Abbrechen', class: 'btn-outline', handler: (modalId) => closeModal(modalId) }
    ]);
}

async function executeReorganizeGroups(modalId) {
    const newGroupSize = parseInt(document.getElementById('new-group-size').value);
    
    try {
        const response = await fetch('/api/admin/tournament/reorganize-groups', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                password: adminPassword,
                groupSize: newGroupSize
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification(data.message);
            closeModal(modalId);
            await loadInitialData();
            loadTournamentManagement();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Neu-Organisieren der Gruppen', 'error');
    }
}

// Reset All Results
async function resetAllResults() {
    createModal('Alle Ergebnisse zurücksetzen', `
        <div class="warning-box" style="background: #fef2f2; border: 1px solid #dc2626; padding: 1rem; border-radius: 0.5rem; margin-bottom: 1rem;">
            <i class="fas fa-exclamation-triangle" style="color: #dc2626;"></i>
            <strong>Achtung:</strong> Alle Spielergebnisse werden gelöscht und Tabellen zurückgesetzt!
        </div>
        <p>Diese Aktion löscht alle eingetragenen Ergebnisse und setzt die Tabellen zurück. Die Spielpaarungen bleiben bestehen.</p>
        <p><strong>Betroffen:</strong> ${matches.filter(m => m.completed).length} abgeschlossene Spiele</p>
    `, [
        { text: 'Ergebnisse zurücksetzen', class: 'btn-danger', handler: (modalId) => executeResetResults(modalId) },
        { text: 'Abbrechen', class: 'btn-outline', handler: (modalId) => closeModal(modalId) }
    ]);
}

async function executeResetResults(modalId) {
    try {
        const response = await fetch('/api/admin/matches/reset-results', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: adminPassword })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification(data.message);
            closeModal(modalId);
            await loadInitialData();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Zurücksetzen der Ergebnisse', 'error');
    }
}

// Reset All Schedules
async function resetAllSchedules() {
    createModal('Alle Zeitpläne zurücksetzen', `
        <div class="warning-box" style="background: #fef3c7; border: 1px solid #f59e0b; padding: 1rem; border-radius: 0.5rem; margin-bottom: 1rem;">
            <i class="fas fa-exclamation-triangle" style="color: #f59e0b;"></i>
            <strong>Achtung:</strong> Alle Zeitplanungen werden gelöscht!
        </div>
        <p>Diese Aktion entfernt alle geplanten Zeiten von allen Spielen. Die Spiele bleiben bestehen, müssen aber neu geplant werden.</p>
        <p><strong>Betroffen:</strong> ${matches.filter(m => m.scheduled).length} geplante Spiele</p>
    `, [
        { text: 'Zeitpläne zurücksetzen', class: 'btn-warning', handler: (modalId) => executeResetSchedules(modalId) },
        { text: 'Abbrechen', class: 'btn-outline', handler: (modalId) => closeModal(modalId) }
    ]);
}

async function executeResetSchedules(modalId) {
    try {
        const response = await fetch('/api/admin/matches/reset-schedule', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: adminPassword })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification(data.message);
            closeModal(modalId);
            await loadInitialData();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Zurücksetzen der Zeitpläne', 'error');
    }
}

// Export Tournament Data
function exportTournamentData() {
    if (!currentTournament) {
        showNotification('Kein aktives Turnier zum Exportieren', 'error');
        return;
    }
    
    const year = currentTournament.year;
    const link = document.createElement('a');
    link.href = `/api/admin/export/${year}`;
    link.download = `turnier_${year}_export.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showNotification(`Turnierdaten für ${year} wurden exportiert`);
}

// Reset Tournament Complete
async function resetTournamentComplete() {
    createModal('Turnier komplett zurücksetzen', `
        <div class="danger-box" style="background: #fef2f2; border: 2px solid #dc2626; padding: 1.5rem; border-radius: 0.5rem; margin-bottom: 1rem;">
            <i class="fas fa-exclamation-triangle" style="color: #dc2626; font-size: 2rem; margin-bottom: 1rem;"></i>
            <h4 style="color: #dc2626; margin-bottom: 1rem;">WARNUNG: Unwiderrufliche Aktion!</h4>
            <p><strong>Diese Aktion löscht ALLES:</strong></p>
            <ul style="margin: 1rem 0; color: #dc2626; list-style-position: inside;">
                <li>Alle Teams (${teams.length})</li>
                <li>Alle Spiele (${matches.length})</li>
                <li>Turnier-Einstellungen</li>
                <li>Gruppentabellen</li>
                <li>Zeitplanungen</li>
                <li>Regeln</li>
            </ul>
        </div>
        <div class="form-group">
            <label for="reset-confirm">Zur Bestätigung schreibe <strong>"RESET"</strong>:</label>
            <input type="text" id="reset-confirm" placeholder="RESET" style="width: 100%; padding: 0.5rem; border: 2px solid #dc2626; border-radius: 0.5rem;">
        </div>
    `, [
        { text: 'Turnier KOMPLETT löschen', class: 'btn-danger', handler: (modalId) => executeResetComplete(modalId) },
        { text: 'Abbrechen', class: 'btn-outline', handler: (modalId) => closeModal(modalId) }
    ]);
}

async function executeResetComplete(modalId) {
    const confirmText = document.getElementById('reset-confirm').value;
    
    if (confirmText !== 'RESET') {
        showNotification('Bestätigung erforderlich: Schreibe "RESET"', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/admin/tournament/reset', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                password: adminPassword,
                confirmText: confirmText
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification(data.message);
            closeModal(modalId);
            
            // Reset local state
            currentTournament = null;
            teams = [];
            matches = [];
            
            updateTournamentInfo();
            loadTournamentManagement();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Zurücksetzen des Turniers', 'error');
    }
}

// Rules Management
async function loadRulesManagement() {
    const rulesManagement = document.getElementById('rules-management');
    
    // Load current rules
    try {
        const response = await fetch('/api/rules');
        const data = await response.json();
        
        const rulesEditor = document.getElementById('rules-editor');
        rulesEditor.value = data.rules || '';
    } catch (error) {
        console.error('Fehler beim Laden der Regeln:', error);
        showNotification('Fehler beim Laden der aktuellen Regeln', 'error');
    }
}

async function saveRules() {
    const rulesEditor = document.getElementById('rules-editor');
    const rules = rulesEditor.value;
    
    try {
        const response = await fetch('/api/admin/rules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                password: adminPassword,
                rules: rules
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Regeln erfolgreich gespeichert!');
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Speichern der Regeln', 'error');
        console.error('Save rules error:', error);
    }
}

async function loadCurrentRules() {
    await loadRulesManagement();
    showNotification('Regeln neu geladen');
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
                <button class="btn btn-small btn-warning" onclick="editTeam(${team.id})">
                    <i class="fas fa-edit"></i> Bearbeiten
                </button>
                <button class="btn btn-small btn-danger" onclick="deleteTeam(${team.id})">
                    <i class="fas fa-trash"></i> Löschen
                </button>
            </div>
        </div>
    `).join('');
}

// Edit Team
async function editTeam(teamId) {
    const team = teams.find(t => t.id === teamId);
    if (!team) return;
    
    createModal('Team bearbeiten', `
        <div class="form-group">
            <label for="edit-team-name">Teamname:</label>
            <input type="text" id="edit-team-name" value="${team.name}" style="width: 100%; padding: 0.5rem; border: 2px solid #ccc; border-radius: 0.5rem;">
        </div>
        <div class="form-group">
            <label for="edit-contact-name">Ansprechpartner:</label>
            <input type="text" id="edit-contact-name" value="${team.contact.name}" style="width: 100%; padding: 0.5rem; border: 2px solid #ccc; border-radius: 0.5rem;">
        </div>
        <div class="form-group">
            <label for="edit-contact-info">Kontakt (E-Mail/Telefon):</label>
            <input type="text" id="edit-contact-info" value="${team.contact.info}" style="width: 100%; padding: 0.5rem; border: 2px solid #ccc; border-radius: 0.5rem;">
        </div>
    `, [
        { text: 'Team speichern', handler: (modalId) => saveTeamEdit(teamId, modalId) },
        { text: 'Abbrechen', class: 'btn-outline', handler: (modalId) => closeModal(modalId) }
    ]);
}

async function saveTeamEdit(teamId, modalId) {
    const teamName = document.getElementById('edit-team-name').value;
    const contactName = document.getElementById('edit-contact-name').value;
    const contactInfo = document.getElementById('edit-contact-info').value;
    
    if (!teamName || !contactName || !contactInfo) {
        showNotification('Alle Felder sind erforderlich', 'error');
        return;
    }
    
    try {
        const response = await fetch(`/api/admin/teams/${teamId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                password: adminPassword,
                teamName,
                contactName,
                contactInfo
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Team erfolgreich bearbeitet');
            closeModal(modalId);
            await loadInitialData();
            loadTeams();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Bearbeiten des Teams', 'error');
    }
}

// Delete Team
async function deleteTeam(teamId) {
    const team = teams.find(t => t.id === teamId);
    if (!team) return;
    
    if (!confirm(`Team "${team.name}" wirklich löschen?\n\nDas Team wird aus allen Spielen entfernt!`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/admin/teams/${teamId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: adminPassword })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification(data.message);
            await loadInitialData();
            loadTeams();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Löschen des Teams', 'error');
    }
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
        matchesAdmin.innerHTML = `
            <div class="empty-state">
                <p>Keine Spiele vorhanden.</p>
                <button class="btn btn-primary" onclick="addNewMatch()">
                    <i class="fas fa-plus"></i> Neues Spiel hinzufügen
                </button>
            </div>
        `;
        return;
    }
    
    // Sortiere Matches chronologisch
    const sortedMatches = [...matches].sort((a, b) => {
        if (a.scheduled && b.scheduled) {
            return new Date(a.scheduled.datetime) - new Date(b.scheduled.datetime);
        } else if (a.scheduled && !b.scheduled) {
            return -1;
        } else if (!a.scheduled && b.scheduled) {
            return 1;
        } else {
            // Beide ungeplant: sortiere nach Gruppe
            if (!a.group || !b.group) return 0;
            return a.group.localeCompare(b.group);
        }
    });
    
    // Gruppiere nach Status
    const scheduledMatches = sortedMatches.filter(m => m.scheduled);
    const unscheduledMatches = sortedMatches.filter(m => !m.scheduled);
    
    let html = '';
    
    // Add controls
    html += `
        <div class="matches-controls" style="margin-bottom: 2rem; display: flex; gap: 1rem; flex-wrap: wrap;">
            <button class="btn btn-primary" onclick="addNewMatch()">
                <i class="fas fa-plus"></i> Neues Spiel hinzufügen
            </button>
    `;
    
    // Add bulk scheduling button für ungeplante Spiele
    if (unscheduledMatches.length > 0) {
        html += `
            <button class="btn btn-warning" onclick="scheduleAllMatches()">
                <i class="fas fa-brain"></i> Alle ${unscheduledMatches.length} Spiele intelligent planen
            </button>
        `;
    }
    
    html += `</div>`;
    
    // Geplante Spiele chronologisch
    if (scheduledMatches.length > 0) {
        html += '<h4><i class="fas fa-clock"></i> Geplante Spiele (chronologisch)</h4>';
        scheduledMatches.forEach(match => {
            const matchTime = new Date(match.scheduled.datetime);
            html += `
                <div class="match-admin-card ${match.liveScore?.isLive ? 'live' : ''} chronological-admin">
                    <div class="match-time-admin">
                        <strong>${matchTime.toLocaleTimeString('de-DE', {hour: '2-digit', minute: '2-digit'})}</strong>
                        <small>${match.scheduled.field}</small>
                    </div>
                    
                    <div class="match-info-admin">
                        <div class="match-teams-admin">
                            <span class="team-name">${match.team1}</span>
                            <span class="vs">vs</span>
                            <span class="team-name">${match.team2}</span>
                        </div>
                        
                        <div class="match-details-admin">
                            <span class="match-group">${match.group}</span>
                            ${match.referee ? `
                                <span class="match-referee">
                                    <i class="fas fa-whistle"></i>
                                    Schiedsrichter: <strong>${match.referee.team}</strong> (${match.referee.group})
                                </span>
                            ` : ''}
                        </div>
                    </div>
                    
                    <div class="match-status-admin">
                        ${match.completed ? 
                            `<strong class="final-score">${match.score1}:${match.score2}</strong>` : 
                            match.liveScore?.isLive ? 
                                `<strong class="live-indicator">LIVE ${match.liveScore.score1}:${match.liveScore.score2}</strong>` :
                                '<span class="pending">Ausstehend</span>'
                        }
                    </div>
                    
                    <div class="match-actions">
                        <button class="btn btn-small" onclick="editMatch('${match.id}')">
                            <i class="fas fa-edit"></i> Bearbeiten
                        </button>
                        <button class="btn btn-small" onclick="scheduleMatch('${match.id}')">
                            <i class="fas fa-calendar"></i> Zeit ändern
                        </button>
                        ${!match.completed && !match.liveScore?.isLive ? `
                            <button class="btn btn-small btn-success" onclick="startMatchDialog('${match.id}')">
                                <i class="fas fa-play"></i> Spiel starten
                            </button>
                        ` : ''}
                        <button class="btn btn-small btn-danger" onclick="deleteMatch('${match.id}')">
                            <i class="fas fa-trash"></i> Löschen
                        </button>
                    </div>
                </div>
            `;
        });
    }
    
    // Ungeplante Spiele nach Gruppen
    if (unscheduledMatches.length > 0) {
        html += '<h4><i class="fas fa-calendar-plus"></i> Noch zu planende Spiele</h4>';
        
        const groupedUnscheduled = {};
        unscheduledMatches.forEach(match => {
            if (!groupedUnscheduled[match.group]) {
                groupedUnscheduled[match.group] = [];
            }
            groupedUnscheduled[match.group].push(match);
        });
        
        Object.entries(groupedUnscheduled).forEach(([groupName, groupMatches]) => {
            html += `<h5>${groupName}</h5>`;
            groupMatches.forEach(match => {
                html += `
                    <div class="match-admin-card">
                        <div class="match-header">
                            <div class="match-teams-admin">
                                <span class="team-name">${match.team1}</span>
                                <span class="vs">vs</span>
                                <span class="team-name">${match.team2}</span>
                            </div>
                            
                            ${match.referee ? `
                                <div class="match-referee-info">
                                    <small><i class="fas fa-whistle"></i> Schiedsrichter: ${match.referee.team}</small>
                                </div>
                            ` : ''}
                            
                            <div class="match-status">
                                ${match.completed ? 
                                    `<strong>${match.score1}:${match.score2}</strong>` : 
                                    'Noch nicht geplant'
                                }
                            </div>
                        </div>
                        <div class="match-actions">
                            <button class="btn btn-small" onclick="editMatch('${match.id}')">
                                <i class="fas fa-edit"></i> Bearbeiten
                            </button>
                            <button class="btn btn-small" onclick="scheduleMatch('${match.id}')">
                                <i class="fas fa-calendar"></i> Zeit planen
                            </button>
                            ${!match.completed && !match.liveScore?.isLive ? `
                                <button class="btn btn-small btn-success" onclick="startMatchDialog('${match.id}')">
                                    <i class="fas fa-play"></i> Spiel starten
                                </button>
                            ` : ''}
                            <button class="btn btn-small btn-danger" onclick="deleteMatch('${match.id}')">
                                <i class="fas fa-trash"></i> Löschen
                            </button>
                        </div>
                    </div>
                `;
            });
        });
    }
    
    matchesAdmin.innerHTML = html;
}

// Add New Match
async function addNewMatch() {
    const teamOptions = teams.map(team => `<option value="${team.name}">${team.name}</option>`).join('');
    
    const groups = currentTournament && currentTournament.groups ? 
        currentTournament.groups.map(g => `<option value="${g.name}">${g.name}</option>`).join('') :
        '<option value="Manuell">Manuell</option>';
    
    createModal('Neues Spiel hinzufügen', `
        <div class="form-group">
            <label for="new-match-team1">Team 1:</label>
            <select id="new-match-team1" style="width: 100%; padding: 0.5rem; border: 2px solid #ccc; border-radius: 0.5rem;">
                <option value="">Team auswählen</option>
                ${teamOptions}
            </select>
        </div>
        <div class="form-group">
            <label for="new-match-team2">Team 2:</label>
            <select id="new-match-team2" style="width: 100%; padding: 0.5rem; border: 2px solid #ccc; border-radius: 0.5rem;">
                <option value="">Team auswählen</option>
                ${teamOptions}
            </select>
        </div>
        <div class="form-group">
            <label for="new-match-group">Gruppe:</label>
            <select id="new-match-group" style="width: 100%; padding: 0.5rem; border: 2px solid #ccc; border-radius: 0.5rem;">
                ${groups}
            </select>
        </div>
        <div class="form-group">
            <label for="new-match-phase">Phase:</label>
            <select id="new-match-phase" style="width: 100%; padding: 0.5rem; border: 2px solid #ccc; border-radius: 0.5rem;">
                <option value="group">Gruppenphase</option>
                <option value="knockout">K.O.-Phase</option>
                <option value="placement">Platzierungsspiel</option>
            </select>
        </div>
        <div class="form-group">
            <label for="new-match-datetime">Datum/Zeit (optional):</label>
            <input type="datetime-local" id="new-match-datetime" style="width: 100%; padding: 0.5rem; border: 2px solid #ccc; border-radius: 0.5rem;">
        </div>
        <div class="form-group">
            <label for="new-match-field">Spielfeld (optional):</label>
            <input type="text" id="new-match-field" placeholder="Hauptplatz" style="width: 100%; padding: 0.5rem; border: 2px solid #ccc; border-radius: 0.5rem;">
        </div>
    `, [
        { text: 'Spiel hinzufügen', handler: (modalId) => saveNewMatch(modalId) },
        { text: 'Abbrechen', class: 'btn-outline', handler: (modalId) => closeModal(modalId) }
    ]);
}

async function saveNewMatch(modalId) {
    const team1 = document.getElementById('new-match-team1').value;
    const team2 = document.getElementById('new-match-team2').value;
    const group = document.getElementById('new-match-group').value;
    const phase = document.getElementById('new-match-phase').value;
    const datetime = document.getElementById('new-match-datetime').value;
    const field = document.getElementById('new-match-field').value;
    
    if (!team1 || !team2) {
        showNotification('Beide Teams müssen ausgewählt werden', 'error');
        return;
    }
    
    if (team1 === team2) {
        showNotification('Teams müssen unterschiedlich sein', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/admin/matches', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                password: adminPassword,
                team1,
                team2,
                group,
                phase,
                datetime: datetime || null,
                field: field || null
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Spiel erfolgreich hinzugefügt');
            closeModal(modalId);
            await loadInitialData();
            loadMatches();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Hinzufügen des Spiels', 'error');
    }
}

// Edit Match
async function editMatch(matchId) {
    const match = matches.find(m => m.id === matchId);
    if (!match) return;
    
    const teamOptions = teams.map(team => `<option value="${team.name}" ${team.name === match.team1 || team.name === match.team2 ? 'selected' : ''}>${team.name}</option>`).join('');
    
    const groups = currentTournament && currentTournament.groups ? 
        currentTournament.groups.map(g => `<option value="${g.name}" ${g.name === match.group ? 'selected' : ''}>${g.name}</option>`).join('') :
        `<option value="${match.group}" selected>${match.group}</option>`;
    
    const scheduledTime = match.scheduled ? new Date(match.scheduled.datetime).toISOString().slice(0, 16) : '';
    
    const content = `
        <div class="form-group">
            <label for="edit-match-team1">Team 1:</label>
            <select id="edit-match-team1" style="width: 100%; padding: 0.5rem; border: 2px solid #ccc; border-radius: 0.5rem;">
                <option value="${match.team1}" selected>${match.team1}</option>
                ${teamOptions}
            </select>
        </div>
        <div class="form-group">
            <label for="edit-match-team2">Team 2:</label>
            <select id="edit-match-team2" style="width: 100%; padding: 0.5rem; border: 2px solid #ccc; border-radius: 0.5rem;">
                <option value="${match.team2}" selected>${match.team2}</option>
                ${teamOptions}
            </select>
        </div>
        <div class="form-group">
            <label for="edit-match-group">Gruppe:</label>
            <select id="edit-match-group" style="width: 100%; padding: 0.5rem; border: 2px solid #ccc; border-radius: 0.5rem;">
                ${groups}
            </select>
        </div>
        <div class="form-group">
            <label for="edit-match-datetime">Datum/Zeit:</label>
            <input type="datetime-local" id="edit-match-datetime" value="${scheduledTime}" style="width: 100%; padding: 0.5rem; border: 2px solid #ccc; border-radius: 0.5rem;">
        </div>
        <div class="form-group">
            <label for="edit-match-field">Spielfeld:</label>
            <input type="text" id="edit-match-field" value="${match.scheduled?.field || ''}" style="width: 100%; padding: 0.5rem; border: 2px solid #ccc; border-radius: 0.5rem;">
        </div>
        <div id="referee-section">
            ${match.referee ? `
                <div class="form-group">
                    <label>Aktueller Schiedsrichter:</label>
                    <p>${match.referee.team} (${match.referee.group})</p>
                    <button type="button" id="remove-referee-btn" class="btn btn-small btn-outline">
                        <i class="fas fa-times"></i> Schiedsrichter entfernen
                    </button>
                </div>
            ` : ''}
        </div>
    `;

    const modalElement = createModal('Spiel bearbeiten', content, [
        { text: 'Spiel speichern', handler: (modalId) => saveMatchEdit(matchId, modalId) },
        { text: 'Abbrechen', class: 'btn-outline', handler: (modalId) => closeModal(modalId) }
    ]);
    
    // Add event listener for the remove referee button if it exists
    const removeBtn = modalElement.querySelector('#remove-referee-btn');
    if(removeBtn){
        removeBtn.addEventListener('click', () => removeReferee(matchId, modalElement.id));
    }
}

async function saveMatchEdit(matchId, modalId) {
    const team1 = document.getElementById('edit-match-team1').value;
    const team2 = document.getElementById('edit-match-team2').value;
    const group = document.getElementById('edit-match-group').value;
    const datetime = document.getElementById('edit-match-datetime').value;
    const field = document.getElementById('edit-match-field').value;
    
    try {
        const response = await fetch(`/api/admin/matches/${matchId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                password: adminPassword,
                team1,
                team2,
                group,
                datetime: datetime || null,
                field: field || null
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Spiel erfolgreich bearbeitet');
            closeModal(modalId);
            await loadInitialData();
            loadMatches();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Bearbeiten des Spiels', 'error');
    }
}

// NEUE Funktion zum Entfernen von Schiedsrichtern
async function removeReferee(matchId, modalId) {
    if (!confirm('Schiedsrichter wirklich von diesem Spiel entfernen?')) return;

    try {
        const response = await fetch(`/api/admin/matches/${matchId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                password: adminPassword,
                referee: null // null senden, um den Schiedsrichter zu entfernen
            })
        });

        const data = await response.json();
        if (data.success) {
            showNotification('Schiedsrichter entfernt');
            await loadInitialData();
            // Modal neu aufbauen, um die Änderung zu zeigen
            closeModal(modalId);
            editMatch(matchId);
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Entfernen des Schiedsrichters', 'error');
    }
}


// Delete Match
async function deleteMatch(matchId) {
    const match = matches.find(m => m.id === matchId);
    if (!match) return;
    
    if (!confirm(`Spiel "${match.team1} vs ${match.team2}" wirklich löschen?`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/admin/matches/${matchId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: adminPassword })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification(data.message);
            await loadInitialData();
            loadMatches();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Löschen des Spiels', 'error');
    }
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
                        <div class="match-actions">
                            <button class="btn btn-small btn-warning" onclick="editResult('${match.id}')">
                                <i class="fas fa-edit"></i> Bearbeiten
                            </button>
                        </div>
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

// Edit Result
async function editResult(matchId) {
    const match = matches.find(m => m.id === matchId);
    if (!match) return;
    
    createModal('Ergebnis bearbeiten', `
        <div class="form-group">
            <h4>${match.team1} vs ${match.team2}</h4>
            <p><small>${match.group || 'Kein Gruppe'}</small></p>
        </div>
        <div class="score-inputs" style="justify-content: center; margin: 2rem 0;">
            <span class="team-name">${match.team1}</span>
            <input type="number" min="0" id="edit-result-score1" value="${match.score1}" style="width: 80px; padding: 0.5rem; border: 2px solid #ccc; border-radius: 0.5rem; text-align: center; font-size: 1.25rem;">
            <span class="score-vs">:</span>
            <input type="number" min="0" id="edit-result-score2" value="${match.score2}" style="width: 80px; padding: 0.5rem; border: 2px solid #ccc; border-radius: 0.5rem; text-align: center; font-size: 1.25rem;">
            <span class="team-name">${match.team2}</span>
        </div>
    `, [
        { text: 'Ergebnis speichern', handler: (modalId) => saveResultEdit(matchId, modalId) },
        { text: 'Abbrechen', class: 'btn-outline', handler: (modalId) => closeModal(modalId) }
    ]);
}

async function saveResultEdit(matchId, modalId) {
    const score1 = parseInt(document.getElementById('edit-result-score1').value);
    const score2 = parseInt(document.getElementById('edit-result-score2').value);
    
    if (isNaN(score1) || isNaN(score2) || score1 < 0 || score2 < 0) {
        showNotification('Bitte gültige Ergebnisse eingeben', 'error');
        return;
    }
    
    try {
        const response = await fetch(`/api/admin/results/${matchId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                password: adminPassword,
                score1,
                score2
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Ergebnis erfolgreich bearbeitet');
            closeModal(modalId);
            await loadInitialData();
            loadResults();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Bearbeiten des Ergebnisses', 'error');
    }
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
                <label>Max. Spiele pro Team</label>
                <p>${currentTournament.settings?.maxGamesPerTeam || 'Alle'}</p>
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
            <p>Gefährliche Aktionen, die nicht rückgängig gemacht werden können.</p>
            <button class="btn btn-danger" onclick="resetTournamentComplete()">
                <i class="fas fa-trash"></i> Turnier komplett zurücksetzen
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
    
    // Wenn pausiert und pauseStartTime gesetzt, Zeit bei Pausenbeginn stoppen
    if (liveScore.isPaused && liveScore.pauseStartTime) {
        const pauseStartTime = new Date(liveScore.pauseStartTime);
        let elapsedTime = 0;
        
        if (liveScore.currentHalf === 1) {
            elapsedTime = pauseStartTime - startTime - (liveScore.pausedTime || 0);
        } else if (liveScore.currentHalf === 2 && liveScore.secondHalfStartTime) {
            const secondHalfStart = new Date(liveScore.secondHalfStartTime);
            elapsedTime = pauseStartTime - secondHalfStart - (liveScore.pausedTime || 0);
        }
        
        const totalSeconds = Math.floor(elapsedTime / 1000);
        const pausedMinute = Math.floor(totalSeconds / 60);
        const pausedSecond = totalSeconds % 60;
        
        return {
            displayTime: formatTime(Math.max(0, pausedMinute), Math.max(0, pausedSecond)),
            halfInfo: 'PAUSIERT',
            status: 'paused'
        };
    }
    
    // Halbzeitpause
    if (liveScore.halfTimeBreak) {
        return {
            displayTime: formatTime(halfTimeMinutes, 0),
            halfInfo: 'HALBZEIT',
            status: 'halftime'
        };
    }
    
    let currentMinute = 0;
    let currentSecond = 0;
    let halfInfo = '';
    let status = 'running';
    
    if (liveScore.currentHalf === 1) {
        // Erste Halbzeit - berechne seit Spielstart
        let elapsedTime = now - startTime;
        if (liveScore.pausedTime) {
            elapsedTime -= liveScore.pausedTime;
        }
        const totalSeconds = Math.floor(elapsedTime / 1000);
        currentMinute = Math.floor(totalSeconds / 60);
        currentSecond = totalSeconds % 60;
        
        if (currentMinute >= halfTimeMinutes) {
            currentMinute = halfTimeMinutes;
            currentSecond = 0;
            halfInfo = '1. HALBZEIT ENDE';
            status = 'half-ended';
        } else {
            halfInfo = '1. HALBZEIT';
        }
    } else if (liveScore.currentHalf === 2 && liveScore.secondHalfStartTime) {
        // Zweite Halbzeit - berechne seit 2. Halbzeit Start
        const secondHalfStart = new Date(liveScore.secondHalfStartTime);
        let elapsedTime = now - secondHalfStart;
        if (liveScore.pausedTime) {
            elapsedTime -= liveScore.pausedTime;
        }
        const totalSeconds = Math.floor(elapsedTime / 1000);
        currentMinute = Math.floor(totalSeconds / 60);
        currentSecond = totalSeconds % 60;
        
        if (currentMinute >= halfTimeMinutes) {
            currentMinute = halfTimeMinutes;
            currentSecond = 0;
            halfInfo = 'SPIEL ENDE';
            status = 'finished';
        } else {
            halfInfo = '2. HALBZEIT';
        }
    }
    
    const displayTime = formatTime(Math.max(0, currentMinute), Math.max(0, currentSecond));
    
    return { displayTime, halfInfo, status, currentMinute };
}

function formatTime(minutes, seconds) {
    const mins = Math.min(Math.max(minutes, 0), 99).toString().padStart(2, '0');
    const secs = Math.min(Math.max(seconds, 0), 59).toString().padStart(2, '0');
    return `${mins}:${secs}`;
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
                        console.log(`Updated timer for match ${match.id}: ${timeInfo.displayTime} - ${timeInfo.halfInfo}`);
                    }
                    if (halfElement) halfElement.textContent = timeInfo.halfInfo;
                    
                    // Update button states based on status
                    updateMatchControls(matchElement, match.liveScore, timeInfo.status);
                    
                    // Update score inputs only if they are not currently focused
                    const score1Input = matchElement.querySelector(`#live-score1-${match.id}`);
                    const score2Input = matchElement.querySelector(`#live-score2-${match.id}`);
                    
                    if (score1Input && document.activeElement !== score1Input && score1Input.value != match.liveScore.score1) {
                        score1Input.value = match.liveScore.score1;
                    }
                    if (score2Input && document.activeElement !== score2Input && score2Input.value != match.liveScore.score2) {
                        score2Input.value = match.liveScore.score2;
                    }
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
    if (!confirm('Automatisch alle Spiele planen? (Intelligenter Algorithmus)')) return;
    
    const startTime = prompt('Startzeit (HH:MM):', '10:00');
    const matchDuration = prompt('Spieldauer in Minuten:', '15');
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

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    console.log('Admin page loaded, DOM ready');
});


// KORREKTUR: Diese Logik wurde von admin.html hierher verschoben,
// um sicherzustellen, dass sie NACH dem Laden der Funktionen in admin.js ausgeführt wird.

// Helper function to refresh teams display
function refreshTeams() {
    loadInitialData().then(() => {
        loadTeams();
        showNotification('Teams aktualisiert');
    });
}

// Helper function to update team count display
function updateTeamCountDisplay() {
    const teamCountDisplay = document.getElementById('team-count-display');
    if (teamCountDisplay) {
        teamCountDisplay.textContent = `${teams.length} Teams registriert`;
    }
}

// Override loadTeams to include count update
// This needs to be done carefully after the original loadTeams is defined.
// We can wrap it in a DOMContentLoaded listener or just place it at the end of the file.
{
    // Block-Scope, um `originalLoadTeams` nicht global zu machen
    const originalLoadTeams = loadTeams;
    loadTeams = function() {
        originalLoadTeams();
        updateTeamCountDisplay();
    };
}
