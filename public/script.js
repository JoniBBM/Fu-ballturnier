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

// Auto-refresh state
let lastScheduleUpdate = null;
let scheduleRefreshInterval = null;
let currentActiveTab = 'home';

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
        
        // Update current active tab
        currentActiveTab = targetTab;
        
        // Update active nav button
        navBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Update active tab content
        tabContents.forEach(content => {
            content.classList.remove('active');
        });
        document.getElementById(targetTab).classList.add('active');
        
        // Load content based on tab
        loadTabContent(targetTab);
    });
});

function loadTabContent(tab) {
    currentActiveTab = tab; // Update current tab
    switch (tab) {
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
        case 'rules':
            loadRules();
            break;
    }
}

// Auto-refresh mechanism for schedule updates
function startScheduleAutoRefresh() {
    if (scheduleRefreshInterval) {
        clearInterval(scheduleRefreshInterval);
    }
    
    scheduleRefreshInterval = setInterval(async () => {
        try {
            // Check if schedule was updated
            const response = await fetch('/api/tournament');
            const data = await response.json();
            
            if (data.tournament && data.tournament.lastUpdated) {
                if (lastScheduleUpdate && new Date(data.tournament.lastUpdated) > new Date(lastScheduleUpdate)) {
                    console.log('Schedule updated, refreshing content...');
                    // Refresh current tab content if it's schedule, teams, tables, or home
                    if (['schedule', 'teams', 'tables', 'home'].includes(currentActiveTab)) {
                        loadTabContent(currentActiveTab);
                    }
                }
                lastScheduleUpdate = data.tournament.lastUpdated;
            }
        } catch (error) {
            console.error('Error checking for schedule updates:', error);
        }
    }, 5000); // Check every 5 seconds
}

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
            // Auto-refresh teams list if on teams tab
            if (currentActiveTab === 'teams') {
                loadTeams();
            }
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
        return { displayTime: '00:00', halfInfo: 'Kein Spiel', currentMinute: 0, currentSecond: 0 };
    }
    
    const now = new Date();
    const startTime = new Date(liveMatch.startTime);
    const halfTimeMinutes = liveMatch.halfTimeMinutes || 45;
    
    // Wenn pausiert und pauseStartTime gesetzt, Zeit bei Pausenbeginn stoppen
    if (liveMatch.isPaused && liveMatch.pauseStartTime) {
        const pauseStartTime = new Date(liveMatch.pauseStartTime);
        let elapsedTime = 0;
        
        if (liveMatch.currentHalf === 1) {
            elapsedTime = pauseStartTime - startTime - (liveMatch.pausedTime || 0);
        } else if (liveMatch.currentHalf === 2 && liveMatch.secondHalfStartTime) {
            const secondHalfStart = new Date(liveMatch.secondHalfStartTime);
            elapsedTime = pauseStartTime - secondHalfStart - (liveMatch.pausedTime || 0);
        }
        
        const totalSeconds = Math.floor(elapsedTime / 1000);
        const currentMinute = Math.floor(totalSeconds / 60);
        const currentSecond = totalSeconds % 60;
        
        return {
            displayTime: formatTime(Math.max(0, currentMinute), Math.max(0, currentSecond)),
            halfInfo: 'PAUSIERT',
            currentMinute: Math.max(0, currentMinute),
            currentSecond: Math.max(0, currentSecond)
        };
    }
    
    // Halbzeitpause
    if (liveMatch.halfTimeBreak) {
        return {
            displayTime: formatTime(halfTimeMinutes, 0),
            halfInfo: 'HALBZEIT',
            currentMinute: halfTimeMinutes,
            currentSecond: 0
        };
    }
    
    let elapsedTime = 0;
    let currentMinute = 0;
    let currentSecond = 0;
    let halfInfo = '';
    
    if (liveMatch.currentHalf === 1) {
        // Erste Halbzeit
        elapsedTime = now - startTime - (liveMatch.pausedTime || 0);
        const totalSeconds = Math.floor(elapsedTime / 1000);
        currentMinute = Math.floor(totalSeconds / 60);
        currentSecond = totalSeconds % 60;
        
        if (currentMinute >= halfTimeMinutes) {
            currentMinute = halfTimeMinutes;
            currentSecond = 0;
            halfInfo = '1. HALBZEIT ENDE';
        } else {
            halfInfo = '1. HALBZEIT';
        }
    } else if (liveMatch.currentHalf === 2 && liveMatch.secondHalfStartTime) {
        // Zweite Halbzeit
        const secondHalfStart = new Date(liveMatch.secondHalfStartTime);
        elapsedTime = now - secondHalfStart - (liveMatch.pausedTime || 0);
        const totalSeconds = Math.floor(elapsedTime / 1000);
        currentMinute = Math.floor(totalSeconds / 60);
        currentSecond = totalSeconds % 60;
        
        if (currentMinute >= halfTimeMinutes) {
            currentMinute = halfTimeMinutes;
            currentSecond = 0;
            halfInfo = 'SPIEL ENDE';
        } else {
            halfInfo = '2. HALBZEIT';
        }
    }
    
    const displayTime = formatTime(Math.max(0, currentMinute), Math.max(0, currentSecond));
    
    return { displayTime, halfInfo, currentMinute, currentSecond };
}

function formatTime(minutes, seconds) {
    const mins = Math.min(Math.max(minutes, 0), 99).toString().padStart(2, '0');
    const secs = Math.min(Math.max(seconds, 0), 59).toString().padStart(2, '0');
    return `${mins}:${secs}`;
}

async function loadLiveMatch() {
    try {
        const [liveResponse, nextResponse] = await Promise.all([
            fetch('/api/live-match'),
            fetch('/api/next-match')
        ]);
        
        const liveData = await liveResponse.json();
        const nextData = await nextResponse.json();
        
        const liveContent = document.getElementById('live-content');
        
        let html = '';
        
        // Aktuelles Live-Spiel
        if (liveData.liveMatch) {
            const liveMatch = liveData.liveMatch;
            const timeInfo = calculateLiveTime(liveMatch);
            
            html += `
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
        }
        
        // Nächstes geplantes Spiel
        if (nextData.nextMatch) {
            const nextMatch = nextData.nextMatch;
            const nextTime = new Date(nextMatch.datetime);
            const timeUntilMatch = nextTime - new Date();
            const minutesUntil = Math.max(0, Math.floor(timeUntilMatch / (1000 * 60)));
            
            html += `
                <div class="next-match-section">
                    <h3><i class="fas fa-forward"></i> Nächstes Spiel</h3>
                    <div class="next-match-card">
                        <div class="next-match-time">
                            <i class="fas fa-clock"></i>
                            <span class="time">${nextTime.toLocaleTimeString('de-DE', {hour: '2-digit', minute: '2-digit'})}</span>
                            <span class="countdown">${minutesUntil > 0 ? `in ${minutesUntil} Min.` : 'Jetzt'}</span>
                        </div>
                        
                        <div class="next-match-teams">
                            <span class="team-name">${nextMatch.team1}</span>
                            <span class="vs">vs</span>
                            <span class="team-name">${nextMatch.team2}</span>
                        </div>
                        
                        <div class="next-match-details">
                            <div class="match-group">
                                <i class="fas fa-layer-group"></i> ${nextMatch.group}
                            </div>
                            <div class="match-field">
                                <i class="fas fa-map-marker-alt"></i> ${nextMatch.field}
                            </div>
                            ${nextMatch.referee ? `
                                <div class="match-referee">
                                    <i class="fas fa-whistle"></i>
                                    <span>Schiedsrichter: <strong>${nextMatch.referee.team}</strong></span>
                                    <small>(${nextMatch.referee.group})</small>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                </div>
            `;
        }
        
        // Falls weder Live-Spiel noch nächstes Spiel
        if (!liveData.liveMatch && !nextData.nextMatch) {
            html = `
                <div class="no-live-match">
                    <div class="no-live-icon">
                        <i class="fas fa-pause-circle"></i>
                    </div>
                    <h3>Derzeit kein Live-Spiel</h3>
                    <p>Aktuell wird kein Spiel übertragen und es sind keine weiteren Spiele geplant.</p>
                </div>
            `;
            
            // Clear existing interval
            if (liveUpdateInterval) {
                clearInterval(liveUpdateInterval);
                liveUpdateInterval = null;
            }
        }
        
        liveContent.innerHTML = html;
        
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
            // Fetch latest data first
            const response = await fetch('/api/live-match');
            const data = await response.json();
            
            if (!data.liveMatch) {
                // Match ended, reload page
                console.log('Match ended, reloading live match display');
                loadLiveMatch();
                return;
            }
            
            // Update liveMatch object with fresh data
            const updatedMatch = data.liveMatch;
            
            // Update timer
            const timeInfo = calculateLiveTime(updatedMatch);
            const timerElement = document.getElementById('live-timer');
            const halfElement = document.getElementById('live-half-info');
            
            if (timerElement) {
                timerElement.textContent = timeInfo.displayTime;
                console.log(`Updated viewer timer: ${timeInfo.displayTime} - ${timeInfo.halfInfo}`);
            }
            if (halfElement) halfElement.textContent = timeInfo.halfInfo;
            
            // Update scores
            const score1Element = document.getElementById('live-score1');
            const score2Element = document.getElementById('live-score2');
            
            if (score1Element) score1Element.textContent = updatedMatch.score1;
            if (score2Element) score2Element.textContent = updatedMatch.score2;
            
        } catch (error) {
            console.error('Fehler beim Live-Update:', error);
        }
    }, 1000);
}

// Rules Functions
async function loadRules() {
    try {
        const response = await fetch('/api/rules');
        const data = await response.json();
        
        const rulesContent = document.getElementById('rules-content');
        
        if (!data.rules || data.rules.trim() === '') {
            rulesContent.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-book-open"></i>
                    <h3>Noch keine Regeln verfügbar</h3>
                    <p>Die Turnierregeln werden vom Organisator festgelegt und hier veröffentlicht.</p>
                </div>
            `;
        } else {
            // Format rules with basic HTML (replace line breaks)
            const formattedRules = data.rules
                .replace(/\n\n/g, '</p><p>')
                .replace(/\n/g, '<br>')
                .replace(/^/, '<p>')
                .replace(/$/, '</p>');
            
            rulesContent.innerHTML = `
                <div class="rules-text">
                    ${formattedRules}
                </div>
            `;
        }
    } catch (error) {
        console.error('Fehler beim Laden der Regeln:', error);
        const rulesContent = document.getElementById('rules-content');
        rulesContent.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-exclamation-triangle"></i>
                <h3>Fehler beim Laden</h3>
                <p>Die Regeln konnten nicht geladen werden.</p>
            </div>
        `;
    }
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
        
        if (matches.length === 0) {
            scheduleContent.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-calendar"></i>
                    <h3>Spielplan wird vorbereitet</h3>
                    <p>Der Spielplan wird bald verfügbar sein.</p>
                </div>
            `;
            return;
        }
        
        // Sortiere Matches chronologisch nach geplanter Zeit
        const sortedMatches = matches.sort((a, b) => {
            // Spiele mit Zeit zuerst, dann ungeplante
            if (a.scheduled && b.scheduled) {
                return new Date(a.scheduled.datetime) - new Date(b.scheduled.datetime);
            } else if (a.scheduled && !b.scheduled) {
                return -1;
            } else if (!a.scheduled && b.scheduled) {
                return 1;
            } else {
                // Beide ungeplant: sortiere nach Gruppe dann Teams
                if (a.group !== b.group) {
                    return a.group.localeCompare(b.group);
                }
                return a.team1.localeCompare(b.team1);
            }
        });
        
        // Gruppiere nach Status: Geplant vs. Ungeplant
        const scheduledMatches = sortedMatches.filter(m => m.scheduled);
        const unscheduledMatches = sortedMatches.filter(m => !m.scheduled);
        
        let html = '';
        
        // Tournament format info
        if (currentTournament.settings?.format) {
            const formatNames = {
                'groups': 'Gruppensystem',
                'swiss': 'Champions League Format',
                'league': 'Liga-Modus'
            };
            html += `
                <div style="margin-bottom: 2rem; padding: 1rem; background: #f0f9ff; border-radius: 0.5rem; border-left: 4px solid #3b82f6;">
                    <strong>Turnier-Format:</strong> ${formatNames[currentTournament.settings.format] || currentTournament.settings.format}
                </div>
            `;
        }
        
        // Geplante Spiele chronologisch
        if (scheduledMatches.length > 0) {
            html += '<div class="schedule-section"><h3><i class="fas fa-clock"></i> Geplante Spiele</h3>';
            html += '<div class="matches-timeline">';
            
            scheduledMatches.forEach(match => {
                const matchTime = new Date(match.scheduled.datetime);
                const isLive = match.liveScore?.isLive;
                const isCompleted = match.completed;
                
                html += `
                    <div class="match-card chronological ${isCompleted ? 'completed' : ''} ${isLive ? 'live' : ''}">
                        <div class="match-time">
                            <i class="fas fa-clock"></i>
                            <strong>${matchTime.toLocaleTimeString('de-DE', {hour: '2-digit', minute: '2-digit'})}</strong>
                            <div class="match-field">${match.scheduled.field}</div>
                        </div>
                        
                        <div class="match-info">
                            <div class="match-teams">
                                <span class="team-name">${match.team1}</span>
                                <span class="vs">vs</span>
                                <span class="team-name">${match.team2}</span>
                            </div>
                            
                            <div class="match-group">${match.group}</div>
                            
                            ${match.referee ? `
                                <div class="match-referee">
                                    <i class="fas fa-whistle"></i>
                                    <span>Schiedsrichter: <strong>${match.referee.team}</strong> (${match.referee.group})</span>
                                </div>
                            ` : ''}
                        </div>
                        
                        <div class="match-result">
                            ${isCompleted ? 
                                `<span class="final-score">${match.score1} : ${match.score2}</span>` : 
                                isLive ? 
                                    `<span class="live-score">LIVE ${match.liveScore.score1} : ${match.liveScore.score2}</span>` :
                                    '<span class="pending">Ausstehend</span>'
                            }
                        </div>
                    </div>
                `;
            });
            
            html += '</div></div>';
        }
        
        // Ungeplante Spiele nach Gruppen
        if (unscheduledMatches.length > 0) {
            html += '<div class="schedule-section"><h3><i class="fas fa-calendar-plus"></i> Noch zu planende Spiele</h3>';
            
            const groupedUnscheduled = {};
            unscheduledMatches.forEach(match => {
                if (!groupedUnscheduled[match.group]) {
                    groupedUnscheduled[match.group] = [];
                }
                groupedUnscheduled[match.group].push(match);
            });
            
            Object.entries(groupedUnscheduled).forEach(([groupName, groupMatches]) => {
                html += `<h4>${groupName}</h4><div class="matches-grid">`;
                
                groupMatches.forEach(match => {
                    html += `
                        <div class="match-card ${match.completed ? 'completed' : ''}">
                            <div class="match-teams">
                                <span class="team-name">${match.team1}</span>
                                <span class="vs">vs</span>
                                <span class="team-name">${match.team2}</span>
                            </div>
                            <div class="match-result">
                                ${formatScore(match.score1, match.score2)}
                            </div>
                            ${match.referee ? `
                                <div class="match-referee">
                                    <small><i class="fas fa-whistle"></i> ${match.referee.team}</small>
                                </div>
                            ` : ''}
                        </div>
                    `;
                });
                
                html += '</div>';
            });
            
            html += '</div>';
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
        
        // Show tournament format info
        if (data.tournament.settings?.format) {
            const formatNames = {
                'groups': 'Gruppentabellen',
                'swiss': 'Champions League Tabelle',
                'league': 'Liga-Tabelle'
            };
            html += `
                <div style="margin-bottom: 2rem; padding: 1rem; background: #f0f9ff; border-radius: 0.5rem; border-left: 4px solid #3b82f6;">
                    <strong>Format:</strong> ${formatNames[data.tournament.settings.format] || data.tournament.settings.format}
                </div>
            `;
        }
        
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
            // Auto-refresh current tab if relevant
            if (['schedule', 'tables'].includes(currentActiveTab)) {
                loadTabContent(currentActiveTab);
            }
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
    
    // Start auto-refresh for schedule updates
    startScheduleAutoRefresh();
});