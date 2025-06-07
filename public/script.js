// Global State
let currentTournament = null;
let isAdminLoggedIn = false;
let adminPassword = '';

// DOM Elements
const navBtns = document.querySelectorAll('.nav-btn');
const tabContents = document.querySelectorAll('.tab-content');
const adminBtn = document.getElementById('admin-btn');
const adminModal = document.getElementById('admin-modal');
const closeAdminBtn = document.getElementById('close-admin');
const loginForm = document.getElementById('login-form');
const teamForm = document.getElementById('team-form');
const tournamentForm = document.getElementById('tournament-form');
const notification = document.getElementById('notification');

// Utility Functions
function showNotification(message, type = 'success') {
    notification.textContent = message;
    notification.className = `notification ${type}`;
    notification.classList.add('show');
    setTimeout(() => {
        notification.classList.remove('show');
    }, 3000);
}

function formatScore(score1, score2) {
    if (score1 === null || score2 === null) {
        return '<span class="match-pending">Ausstehend</span>';
    }
    return `<span class="match-score">${score1} : ${score2}</span>`;
}

function updateStats() {
    fetch('/api/teams')
        .then(response => response.json())
        .then(teams => {
            document.getElementById('team-count').textContent = teams.length;
        });
    
    fetch('/api/matches')
        .then(response => response.json())
        .then(matches => {
            document.getElementById('match-count').textContent = matches.length;
            const completed = matches.filter(m => m.completed).length;
            document.getElementById('completed-count').textContent = completed;
        });
}

// Navigation
navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const targetTab = btn.dataset.tab;
        
        // Update active nav button
        navBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Update active tab content
        tabContents.forEach(content => {
            content.classList.remove('active');
        });
        document.getElementById(targetTab).classList.add('active');
        
        // Load content based on tab
        switch (targetTab) {
            case 'home':
                updateStats();
                break;
            case 'live':
                loadLiveMatch();
                break;
            case 'register':
                checkRegistrationStatus();
                break;
            case 'teams':
                loadTeams();
                break;
            case 'schedule':
                loadSchedule();
                break;
            case 'tables':
                loadTables();
                break;
        }
    });
});

// Modal Management
adminBtn.addEventListener('click', () => {
    window.location.href = '/admin';
});

closeAdminBtn.addEventListener('click', () => {
    adminModal.classList.remove('active');
});

adminModal.addEventListener('click', (e) => {
    if (e.target === adminModal) {
        adminModal.classList.remove('active');
    }
});

// Admin Login
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
            isAdminLoggedIn = true;
            adminPassword = password;
            document.getElementById('admin-login').style.display = 'none';
            document.getElementById('admin-panel').style.display = 'block';
            showNotification('Erfolgreich als Admin angemeldet');
            loadAdminContent();
        } else {
            showNotification('Ungültiges Passwort', 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Anmelden', 'error');
    }
});

// Team Registration
teamForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const teamName = document.getElementById('team-name').value;
    const contactName = document.getElementById('contact-name').value;
    const contactInfo = document.getElementById('contact-info').value;
    
    try {
        const response = await fetch('/api/teams', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ teamName, contactName, contactInfo })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Team erfolgreich angemeldet!');
            teamForm.reset();
            updateStats();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler bei der Anmeldung', 'error');
    }
});

// Tournament Creation
tournamentForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const year = document.getElementById('tournament-year').value;
    
    try {
        const response = await fetch('/api/admin/tournament', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: adminPassword, year })
        });
        
        const data = await response.json();
        
        if (data.success) {
            currentTournament = data.tournament;
            showNotification('Turnier erfolgreich erstellt!');
            loadAdminContent();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Erstellen des Turniers', 'error');
    }
});

// Check Registration Status
async function checkRegistrationStatus() {
    try {
        const response = await fetch('/api/tournament');
        const data = await response.json();
        
        const registrationStatus = document.getElementById('registration-status');
        const teamForm = document.getElementById('team-form');
        
        const currentYear = new Date().getFullYear();
        
        if (!data.tournament || data.tournament.year !== currentYear) {
            registrationStatus.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-calendar-times"></i>
                    <h3>Für dieses Jahr wurde noch kein Turnier geplant</h3>
                    <p>Die Anmeldung ist derzeit nicht möglich. Bitte wende dich an die Organisatoren des CVJM Fellbach für weitere Informationen.</p>
                </div>
            `;
            teamForm.style.display = 'none';
        } else if (data.tournament.status === 'registration') {
            registrationStatus.innerHTML = `
                <div class="registration-available">
                    <i class="fas fa-check-circle"></i>
                    <p><strong>Anmeldung für das Turnier ${data.tournament.year} ist geöffnet!</strong></p>
                    <p>Melde dein Team jetzt an und sichere dir einen Platz beim CVJM Fellbach Fußballturnier.</p>
                </div>
            `;
            teamForm.style.display = 'block';
        } else {
            // Anmeldung geschlossen oder Turnier läuft bereits
            const statusMessages = {
                'closed': 'Die Anmeldung wurde geschlossen und der Spielplan wird erstellt.',
                'active': 'Das Turnier läuft bereits. Die Anmeldung ist geschlossen.',
                'finished': 'Das Turnier ist beendet. Die Anmeldung ist geschlossen.'
            };
            
            registrationStatus.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-lock"></i>
                    <h3>Anmeldung geschlossen</h3>
                    <p>${statusMessages[data.tournament.status] || 'Die Anmeldung ist nicht mehr möglich.'}</p>
                    <p>Du kannst den Spielplan und die Ergebnisse in den entsprechenden Bereichen verfolgen.</p>
                </div>
            `;
            teamForm.style.display = 'none';
        }
    } catch (error) {
        console.error('Fehler beim Prüfen des Anmeldestatus:', error);
        const registrationStatus = document.getElementById('registration-status');
        registrationStatus.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-exclamation-triangle"></i>
                <h3>Fehler beim Laden</h3>
                <p>Der Anmeldestatus konnte nicht geladen werden. Bitte versuche es später erneut.</p>
            </div>
        `;
        document.getElementById('team-form').style.display = 'none';
    }
}

// Live Match Functions
let liveUpdateInterval = null;

function calculateLiveTime(liveMatch) {
    if (!liveMatch || !liveMatch.startTime) {
        return { displayTime: '00:00', halfInfo: 'Kein Spiel', currentMinute: 0 };
    }
    
    const now = new Date();
    const startTime = new Date(liveMatch.startTime);
    const halfTimeMinutes = liveMatch.halfTimeMinutes || 45;
    
    // Wenn pausiert, Zeit bei Pausenbeginn stoppen
    if (liveMatch.isPaused && !liveMatch.halfTimeBreak) {
        return {
            displayTime: formatMinutes(liveMatch.minute || 0),
            halfInfo: 'PAUSIERT',
            currentMinute: liveMatch.minute || 0
        };
    }
    
    // Halbzeitpause
    if (liveMatch.halfTimeBreak) {
        return {
            displayTime: formatMinutes(halfTimeMinutes),
            halfInfo: 'HALBZEIT',
            currentMinute: halfTimeMinutes
        };
    }
    
    let elapsedTime = 0;
    let currentMinute = 0;
    let halfInfo = '';
    
    if (liveMatch.currentHalf === 1) {
        // Erste Halbzeit
        elapsedTime = now - startTime - (liveMatch.pausedTime || 0);
        currentMinute = Math.floor(elapsedTime / (1000 * 60));
        
        if (currentMinute >= halfTimeMinutes) {
            currentMinute = halfTimeMinutes;
            halfInfo = '1. HALBZEIT ENDE';
        } else {
            halfInfo = '1. HALBZEIT';
        }
    } else if (liveMatch.currentHalf === 2 && liveMatch.secondHalfStartTime) {
        // Zweite Halbzeit
        const secondHalfStart = new Date(liveMatch.secondHalfStartTime);
        elapsedTime = now - secondHalfStart - (liveMatch.pausedTime || 0);
        currentMinute = Math.floor(elapsedTime / (1000 * 60));
        
        if (currentMinute >= halfTimeMinutes) {
            currentMinute = halfTimeMinutes;
            halfInfo = 'SPIEL ENDE';
        } else {
            halfInfo = '2. HALBZEIT';
        }
    }
    
    const displayTime = formatMinutes(Math.max(0, currentMinute));
    
    return { displayTime, halfInfo, currentMinute };
}

function formatMinutes(minutes) {
    return Math.min(minutes, 99).toString().padStart(2, '0') + ':00';
}

async function loadLiveMatch() {
    try {
        const response = await fetch('/api/live-match');
        const data = await response.json();
        
        const liveContent = document.getElementById('live-content');
        
        if (!data.liveMatch) {
            liveContent.innerHTML = `
                <div class="no-live-match">
                    <div class="no-live-icon">
                        <i class="fas fa-pause-circle"></i>
                    </div>
                    <h3>Derzeit kein Live-Spiel</h3>
                    <p>Aktuell wird kein Spiel übertragen. Schau später nochmal vorbei!</p>
                </div>
            `;
            // Clear existing interval
            if (liveUpdateInterval) {
                clearInterval(liveUpdateInterval);
                liveUpdateInterval = null;
            }
            return;
        }
        
        const liveMatch = data.liveMatch;
        const timeInfo = calculateLiveTime(liveMatch);
        
        liveContent.innerHTML = `
            <div class="live-match-display">
                <div class="live-timer-section">
                    <div class="live-timer" id="live-timer">${timeInfo.displayTime}</div>
                    <div class="live-half-info" id="live-half-info">${timeInfo.halfInfo}</div>
                </div>
                
                <div class="live-match-info">
                    <div class="live-teams">
                        <div class="live-team">
                            <div class="team-name">${liveMatch.team1}</div>
                            <div class="team-score" id="live-score1">${liveMatch.score1}</div>
                        </div>
                        
                        <div class="live-vs">
                            <span>VS</span>
                        </div>
                        
                        <div class="live-team">
                            <div class="team-name">${liveMatch.team2}</div>
                            <div class="team-score" id="live-score2">${liveMatch.score2}</div>
                        </div>
                    </div>
                    
                    ${liveMatch.group ? `
                        <div class="live-group-info">
                            <i class="fas fa-layer-group"></i> ${liveMatch.group}
                        </div>
                    ` : ''}
                </div>
                
                <div class="live-status">
                    <span class="live-indicator-badge">
                        <i class="fas fa-circle"></i> LIVE
                    </span>
                </div>
            </div>
        `;
        
        // Start live updates
        startLiveUpdates(liveMatch);
        
    } catch (error) {
        console.error('Fehler beim Laden des Live-Spiels:', error);
        const liveContent = document.getElementById('live-content');
        liveContent.innerHTML = `
            <div class="no-live-match">
                <div class="no-live-icon">
                    <i class="fas fa-exclamation-triangle"></i>
                </div>
                <h3>Fehler beim Laden</h3>
                <p>Live-Daten konnten nicht geladen werden.</p>
            </div>
        `;
    }
}

function startLiveUpdates(liveMatch) {
    console.log('Starting live updates for viewers...');
    
    // Clear existing interval
    if (liveUpdateInterval) {
        clearInterval(liveUpdateInterval);
    }
    
    liveUpdateInterval = setInterval(async () => {
        try {
            // Update timer
            const timeInfo = calculateLiveTime(liveMatch);
            const timerElement = document.getElementById('live-timer');
            const halfElement = document.getElementById('live-half-info');
            
            if (timerElement) {
                timerElement.textContent = timeInfo.displayTime;
                console.log(`Updated viewer timer: ${timeInfo.displayTime}`);
            }
            if (halfElement) halfElement.textContent = timeInfo.halfInfo;
            
            // Fetch latest score
            const response = await fetch('/api/live-match');
            const data = await response.json();
            
            if (!data.liveMatch) {
                // Match ended, reload page
                console.log('Match ended, reloading live match display');
                loadLiveMatch();
                return;
            }
            
            const score1Element = document.getElementById('live-score1');
            const score2Element = document.getElementById('live-score2');
            
            if (score1Element) score1Element.textContent = data.liveMatch.score1;
            if (score2Element) score2Element.textContent = data.liveMatch.score2;
            
            // Update liveMatch object for timer calculations
            liveMatch.score1 = data.liveMatch.score1;
            liveMatch.score2 = data.liveMatch.score2;
            liveMatch.halfTimeBreak = data.liveMatch.halfTimeBreak;
            liveMatch.isPaused = data.liveMatch.isPaused;
            liveMatch.pausedTime = data.liveMatch.pausedTime;
            liveMatch.currentHalf = data.liveMatch.currentHalf;
            liveMatch.secondHalfStartTime = data.liveMatch.secondHalfStartTime;
            liveMatch.minute = data.liveMatch.minute;
            
        } catch (error) {
            console.error('Fehler beim Live-Update:', error);
        }
    }, 1000);
}

// Load Functions
async function loadTeams() {
    try {
        const response = await fetch('/api/teams');
        const teams = await response.json();
        
        const teamsGrid = document.getElementById('teams-list');
        
        if (teams.length === 0) {
            teamsGrid.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-users"></i>
                    <h3>Noch keine Teams angemeldet</h3>
                    <p>Sei das erste Team und melde dich jetzt an!</p>
                </div>
            `;
            return;
        }
        
        teamsGrid.innerHTML = teams.map((team, index) => `
            <div class="team-card">
                <h3>${team.name}</h3>
                <div class="team-number">Team #${index + 1}</div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Fehler beim Laden der Teams:', error);
    }
}

async function loadSchedule() {
    try {
        const [tournamentResponse, matchesResponse] = await Promise.all([
            fetch('/api/tournament'),
            fetch('/api/matches')
        ]);
        
        const tournamentData = await tournamentResponse.json();
        const matches = await matchesResponse.json();
        
        const scheduleContent = document.getElementById('schedule-content');
        
        if (!tournamentData.tournament) {
            scheduleContent.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-calendar"></i>
                    <h3>Kein Spielplan verfügbar</h3>
                    <p>Das Turnier wurde noch nicht erstellt. Warte auf weitere Informationen!</p>
                </div>
            `;
            return;
        }
        
        if (tournamentData.tournament.status === 'registration') {
            scheduleContent.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-clock"></i>
                    <h3>Spielplan wird erstellt</h3>
                    <p>Die Anmeldung läuft noch. Der Spielplan wird erstellt, sobald die Anmeldung geschlossen wird.</p>
                    <p><strong>Bisher angemeldete Teams:</strong> ${matches.length === 0 ? 'Teams werden geladen...' : 'Teams verfügbar'}</p>
                </div>
            `;
            return;
        }
        
        currentTournament = tournamentData.tournament;
        
        // Group by phase
        const groupMatches = matches.filter(m => m.phase === 'group');
        const koMatches = matches.filter(m => m.phase !== 'group');
        
        let html = '';
        
        // Group Phase
        if (groupMatches.length > 0) {
            html += '<div class="schedule-phase"><h3><i class="fas fa-layer-group"></i> Gruppenphase</h3>';
            
            const groups = [...new Set(groupMatches.map(m => m.group))];
            groups.forEach(groupName => {
                const groupMatchesFiltered = groupMatches.filter(m => m.group === groupName);
                html += `<h4>${groupName}</h4><div class="matches-grid">`;
                
                groupMatchesFiltered.forEach(match => {
                    html += `
                        <div class="match-card ${match.completed ? 'completed' : ''}">
                            <div class="match-teams">
                                <span class="team-name">${match.team1}</span>
                                <span class="vs">vs</span>
                                <span class="team-name">${match.team2}</span>
                            </div>
                            <div class="match-result">
                                ${formatScore(match.score1, match.score2)}
                                ${match.liveScore?.isLive ? 
                                    `<div class="live-indicator">LIVE ${match.liveScore.minute}'</div>` : 
                                    ''
                                }
                            </div>
                        </div>
                    `;
                });
                
                html += '</div>';
            });
            
            html += '</div>';
        }
        
        // K.O. Phase
        if (koMatches.length > 0) {
            html += '<div class="schedule-phase"><h3><i class="fas fa-trophy"></i> K.O.-Phase</h3>';
            html += '<div class="matches-grid">';
            
            koMatches.forEach(match => {
                html += `
                    <div class="match-card ${match.completed ? 'completed' : ''}">
                        <div class="match-teams">
                            <span class="team-name">${match.team1 || 'TBD'}</span>
                            <span class="vs">vs</span>
                            <span class="team-name">${match.team2 || 'TBD'}</span>
                        </div>
                        <div class="match-result">
                            ${formatScore(match.score1, match.score2)}
                        </div>
                    </div>
                `;
            });
            
            html += '</div></div>';
        }
        
        if (html === '') {
            html = `
                <div class="empty-state">
                    <i class="fas fa-calendar"></i>
                    <h3>Spielplan wird vorbereitet</h3>
                    <p>Der Spielplan wird bald verfügbar sein.</p>
                </div>
            `;
        }
        
        scheduleContent.innerHTML = html;
    } catch (error) {
        console.error('Fehler beim Laden des Spielplans:', error);
    }
}

async function loadTables() {
    try {
        const response = await fetch('/api/tournament');
        const data = await response.json();
        
        const tablesContent = document.getElementById('tables-content');
        
        if (!data.tournament) {
            tablesContent.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-table"></i>
                    <h3>Keine Tabellen verfügbar</h3>
                    <p>Das Turnier wurde noch nicht erstellt.</p>
                </div>
            `;
            return;
        }
        
        if (data.tournament.status === 'registration') {
            tablesContent.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-clock"></i>
                    <h3>Tabellen werden erstellt</h3>
                    <p>Die Gruppentabellen werden erstellt, sobald die Anmeldung geschlossen und der Spielplan generiert wird.</p>
                </div>
            `;
            return;
        }
        
        if (!data.tournament.groups || data.tournament.groups.length === 0) {
            tablesContent.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-table"></i>
                    <h3>Keine Tabellen verfügbar</h3>
                    <p>Die Gruppentabellen werden erstellt, sobald das Turnier startet.</p>
                </div>
            `;
            return;
        }
        
        let html = '';
        
        data.tournament.groups.forEach(group => {
            html += `
                <div class="group-table">
                    <h3>${group.name}</h3>
                    <div class="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>Pos.</th>
                                    <th>Team</th>
                                    <th>Sp.</th>
                                    <th>S</th>
                                    <th>U</th>
                                    <th>N</th>
                                    <th>Tore</th>
                                    <th>Diff.</th>
                                    <th>Pkt.</th>
                                </tr>
                            </thead>
                            <tbody>
            `;
            
            group.table.forEach((entry, index) => {
                html += `
                    <tr>
                        <td><div class="position">${index + 1}</div></td>
                        <td><strong>${entry.team}</strong></td>
                        <td>${entry.games}</td>
                        <td>${entry.wins}</td>
                        <td>${entry.draws}</td>
                        <td>${entry.losses}</td>
                        <td>${entry.goalsFor}:${entry.goalsAgainst}</td>
                        <td>${entry.goalDiff > 0 ? '+' : ''}${entry.goalDiff}</td>
                        <td><strong>${entry.points}</strong></td>
                    </tr>
                `;
            });
            
            html += `
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        });
        
        tablesContent.innerHTML = html;
    } catch (error) {
        console.error('Fehler beim Laden der Tabellen:', error);
    }
}

async function loadAdminContent() {
    // Load admin teams
    try {
        const response = await fetch('/api/admin/teams');
        const teams = await response.json();
        
        const adminTeamsList = document.getElementById('admin-teams-list');
        adminTeamsList.innerHTML = teams.map(team => `
            <div class="team-card">
                <h3>${team.name}</h3>
                <p><strong>Kontakt:</strong> ${team.contact.name}</p>
                <p><strong>Info:</strong> ${team.contact.info}</p>
                <p><small>Angemeldet: ${new Date(team.registeredAt).toLocaleDateString('de-DE')}</small></p>
            </div>
        `).join('');
    } catch (error) {
        console.error('Fehler beim Laden der Admin-Teams:', error);
    }
    
    // Load matches for results
    try {
        const response = await fetch('/api/matches');
        const matches = await response.json();
        
        const matchesForResults = document.getElementById('matches-for-results');
        const pendingMatches = matches.filter(m => !m.completed);
        
        if (pendingMatches.length === 0) {
            matchesForResults.innerHTML = '<p>Keine ausstehenden Spiele vorhanden.</p>';
            return;
        }
        
        matchesForResults.innerHTML = pendingMatches.map(match => `
            <div class="result-form">
                <h4>${match.team1} vs ${match.team2}</h4>
                ${match.group ? `<p><small>${match.group}</small></p>` : ''}
                <div class="score-inputs">
                    <span class="team-name">${match.team1}</span>
                    <input type="number" min="0" id="score1-${match.id}" placeholder="0">
                    <span class="score-vs">:</span>
                    <input type="number" min="0" id="score2-${match.id}" placeholder="0">
                    <span class="team-name">${match.team2}</span>
                </div>
                <button onclick="submitResult('${match.id}')" class="submit-btn">
                    <i class="fas fa-save"></i> Ergebnis speichern
                </button>
            </div>
        `).join('');
    } catch (error) {
        console.error('Fehler beim Laden der Spiele für Ergebnisse:', error);
    }
}

// Admin Tab Management
document.querySelectorAll('.admin-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const targetTab = btn.dataset.adminTab;
        
        // Update active admin tab button
        document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Update active admin tab content
        document.querySelectorAll('.admin-tab-content').forEach(content => {
            content.classList.remove('active');
        });
        document.getElementById(`admin-${targetTab}`).classList.add('active');
        
        if (targetTab === 'results') {
            loadAdminContent();
        }
    });
});

// Submit Result Function
async function submitResult(matchId) {
    const score1 = document.getElementById(`score1-${matchId}`).value;
    const score2 = document.getElementById(`score2-${matchId}`).value;
    
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
            loadAdminContent();
            updateStats();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Speichern des Ergebnisses', 'error');
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    updateStats();
    loadTeams();
    checkRegistrationStatus();
    
    // Check for live matches on page load
    loadLiveMatch();
});