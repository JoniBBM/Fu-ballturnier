// Admin Global State
let isLoggedIn = false;
let adminPassword = '';
let currentTournament = null;
let teams = [];
let matches = [];
let isMobileMenuOpen = false;

// WebSocket Connection
let socket = null;
let isConnected = false;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;
const reconnectDelay = 1000;
let lastInitialDataLoad = 0;
let isInitialized = false;

// Debouncing and Request Management
let refreshTimeout = null;
let isRefreshing = false;
let pendingRefresh = false;
let lastWebSocketUpdate = 0;

// Header Update Debouncing
let connectionStatusTimeout = null;
let tournamentInfoTimeout = null;

// Notification Management
let notificationTimeout = null;

// Tournament Info Caching
let lastTournamentText = null;

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const adminContent = document.getElementById('admin-content');
const loginForm = document.getElementById('admin-login-form');
const notification = document.getElementById('notification');
const menuItems = document.querySelectorAll('.menu-item');
const adminTabs = document.querySelectorAll('.admin-tab');
const pageTitle = document.getElementById('page-title');
const refreshIndicator = document.getElementById('refresh-indicator');
const loadingOverlay = document.getElementById('loading-overlay');

// Auto-Refresh State (now handled by WebSocket)
let currentActiveTab = localStorage.getItem('adminCurrentTab') || 'dashboard';
// Auto-refresh now handled by WebSocket events - interval no longer needed
let liveControlInterval = null;
let isLiveControlUpdating = false;
let localLiveTimerInterval = null;
let currentLiveMatch = null;

// Session Management
const SESSION_KEY = 'admin_session';
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 Stunden

// Utility Functions
function showNotification(message, type = 'success') {
    // Clear any existing notification timeout to prevent conflicts
    if (notificationTimeout) {
        clearTimeout(notificationTimeout);
        notificationTimeout = null;
    }
    
    // If notification is already showing, immediately hide it before showing new one
    if (notification.classList.contains('show')) {
        notification.classList.remove('show');
        // Small delay to allow transition to complete
        setTimeout(() => {
            displayNotification(message, type);
        }, 150);
    } else {
        displayNotification(message, type);
    }
}

function displayNotification(message, type) {
    notification.textContent = message;
    notification.className = `notification ${type}`;
    notification.classList.add('show');
    
    notificationTimeout = setTimeout(() => {
        notification.classList.remove('show');
        // Additional cleanup after transition
        setTimeout(() => {
            if (!notification.classList.contains('show')) {
                notification.textContent = '';
                notification.className = 'notification';
            }
        }, 300); // Wait for CSS transition to complete
        notificationTimeout = null;
    }, 3000);
}

function showLoading(show = true) {
    if (show) {
        loadingOverlay.style.display = 'flex';
    } else {
        loadingOverlay.style.display = 'none';
    }
}

function showRefreshIndicator(show = true) {
    if (show) {
        refreshIndicator.style.display = 'block';
    } else {
        refreshIndicator.style.display = 'none';
    }
}

function formatDateTime(date) {
    if (!date) return 'Nicht geplant';
    const dateObj = new Date(date);
    const berlinTime = dateObj.toLocaleString('de-DE', {
        timeZone: 'Europe/Berlin',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
    
    // Debug: Check if there's a timezone issue
    const localTime = dateObj.toLocaleString('de-DE', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
    
    if (berlinTime !== localTime) {
        console.log('Zeitzonenunterschied gefunden!', {
            iso: date,
            berlinTime: berlinTime,
            localTime: localTime,
            offset: dateObj.getTimezoneOffset()
        });
    }
    
    return berlinTime;
}

// Convert datetime-local input to ISO string
function dateTimeLocalToISO(dateTimeLocal) {
    if (!dateTimeLocal) return null;
    
    // The datetime-local value is in the browser's local timezone
    // We simply convert it to ISO format
    const date = new Date(dateTimeLocal);
    
    console.log('dateTimeLocalToISO - Input:', dateTimeLocal, 'Output:', date.toISOString());
    
    return date.toISOString();
}

// Format time for display (minutes:seconds)
function formatTime(minutes, seconds) {
    const mins = Math.min(Math.max(minutes, 0), 99).toString().padStart(2, '0');
    const secs = Math.min(Math.max(seconds, 0), 59).toString().padStart(2, '0');
    return `${mins}:${secs}`;
}

// Convert ISO string to datetime-local format for input fields
function isoToDateTimeLocal(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    
    // Get local date components (browser automatically uses local timezone)
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    
    console.log('isoToDateTimeLocal - Input:', isoString, 'Output:', `${year}-${month}-${day}T${hours}:${minutes}`);
    
    // Format for datetime-local input (YYYY-MM-DDTHH:mm)
    return `${year}-${month}-${day}T${hours}:${minutes}`;
}

// Session Management Functions
function saveSession(password) {
    const session = {
        password: password,
        timestamp: Date.now(),
        expires: Date.now() + SESSION_DURATION
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function loadSession() {
    try {
        const sessionData = localStorage.getItem(SESSION_KEY);
        if (!sessionData) return null;
        
        const session = JSON.parse(sessionData);
        if (session.expires < Date.now()) {
            localStorage.removeItem(SESSION_KEY);
            return null;
        }
        
        return session;
    } catch (error) {
        console.error('Error loading session:', error);
        return null;
    }
}

function clearSession() {
    localStorage.removeItem(SESSION_KEY);
}

function logout() {
    clearSession();
    isLoggedIn = false;
    adminPassword = '';
    currentTournament = null;
    teams = [];
    matches = [];
    
    loginScreen.style.display = 'flex';
    adminContent.style.display = 'none';
    
    // Reset form
    document.getElementById('admin-password').value = '';
    document.getElementById('remember-login').checked = false;
    
    if (socket) {
        socket.close();
        socket = null;
        isConnected = false;
    }
    showNotification('Erfolgreich abgemeldet');
}

// Mobile Menu Functions
function toggleMobileMenu() {
    isMobileMenuOpen = !isMobileMenuOpen;
    const sidebar = document.querySelector('.admin-sidebar');
    const container = document.querySelector('.admin-container');
    
    if (isMobileMenuOpen) {
        sidebar.classList.add('mobile-open');
        container.classList.add('mobile-menu-open');
    } else {
        sidebar.classList.remove('mobile-open');
        container.classList.remove('mobile-menu-open');
    }
}

function closeMobileMenu() {
    if (isMobileMenuOpen) {
        isMobileMenuOpen = false;
        const sidebar = document.querySelector('.admin-sidebar');
        const container = document.querySelector('.admin-container');
        sidebar.classList.remove('mobile-open');
        container.classList.remove('mobile-menu-open');
    }
}

// WebSocket System
function initializeWebSocket() {
    if (socket) {
        socket.disconnect();
    }

    // Initialize with better configuration for stability
    socket = io({
        transports: ['websocket', 'polling'], // Allow fallback to polling
        upgrade: true,
        rememberUpgrade: true,
        timeout: 20000,
        forceNew: false,
        reconnection: true,
        reconnectionAttempts: maxReconnectAttempts,
        reconnectionDelay: reconnectDelay,
        reconnectionDelayMax: 10000,
        maxReconnectionAttempts: maxReconnectAttempts
    });
    
    socket.on('connect', () => {
        isConnected = true;
        reconnectAttempts = 0;
        debouncedUpdateConnectionStatus();
        console.log('WebSocket connected');
        
        // Initiale Daten nur beim ersten Mal oder nach längerer Trennung laden
        if (isLoggedIn && !isInitialized) {
            const now = Date.now();
            if (now - lastInitialDataLoad > 10000) { // Mindestens 10 Sekunden seit letztem Load
                setTimeout(() => {
                    if (!isInitialized) { // Double check to prevent race conditions
                        lastInitialDataLoad = now;
                        isInitialized = true;
                        loadInitialData();
                    }
                }, 500); // 500ms Delay für stabilere Verbindung
            }
        }
    });

    socket.on('disconnect', (reason) => {
        isConnected = false;
        debouncedUpdateConnectionStatus();
        console.log('WebSocket disconnected:', reason);
        
        // Reset initialization flag for transport errors to allow reconnection
        if (reason === 'transport error' || reason === 'transport close') {
            console.log('Transport error detected, allowing re-initialization');
            // Don't increment reconnectAttempts for transport errors as they're usually temporary
        } else if (reason !== 'io client disconnect') {
            reconnectAttempts++;
        }
        
        // Socket.IO handles automatic reconnection, we just track attempts
        if (reconnectAttempts <= maxReconnectAttempts) {
            console.log(`Reconnect attempt ${reconnectAttempts}/${maxReconnectAttempts}`);
        }
    });

    socket.on('connect_error', (error) => {
        console.error('WebSocket connection error:', error);
        isConnected = false;
        debouncedUpdateConnectionStatus();
    });

    // WebSocket Event Listeners
    setupWebSocketEventListeners();
}

function updateConnectionStatus() {
    const statusElement = document.getElementById('connection-status');
    if (statusElement) {
        const icon = statusElement.querySelector('i');
        const span = statusElement.querySelector('span');
        
        if (isConnected) {
            icon.style.color = '#16a34a';
            span.textContent = 'Live';
            statusElement.title = 'WebSocket Verbindung aktiv';
        } else {
            icon.style.color = '#dc2626';
            span.textContent = 'Offline';
            statusElement.title = 'WebSocket Verbindung getrennt';
        }
    }
    
    // Update refresh indicator
    showRefreshIndicator(!isConnected);
}

// Debounced version to prevent flickering
function debouncedUpdateConnectionStatus() {
    if (connectionStatusTimeout) {
        clearTimeout(connectionStatusTimeout);
    }
    connectionStatusTimeout = setTimeout(() => {
        updateConnectionStatus();
        connectionStatusTimeout = null;
    }, 200); // 200ms debounce
}

function setupWebSocketEventListeners() {
    // Initial data from server
    socket.on('initial-data', (data) => {
        console.log('Received initial data from server:', data);
        // This can help sync state but we don't want to overwrite current operations
        if (!isRefreshing && !window.isStartingMatch) {
            // Optionally update some cached data here if needed
        }
    });
    
    // Live Score Updates - only update UI, no refresh needed
    socket.on('live-score-update', (data) => {
        console.log('Live score update received:', data);
        updateLiveScoreDisplay(data);
        // Only refresh if not currently refreshing and on relevant tabs
        if (!isRefreshing && (currentActiveTab === 'dashboard')) {
            coordinatedWebSocketUpdate(() => refreshCurrentTabContent(), 1000);
        }
    });

    // Match Started - refresh live tab (but avoid race condition with executeStartMatch)
    socket.on('match-started', (data) => {
        console.log('Match started:', data);
        showNotification(`Spiel gestartet: ${data.match.team1} vs ${data.match.team2}`, 'info');
        
        // Set timestamp for error recovery detection
        window.lastMatchStartedEvent = Date.now();
        
        // Avoid race condition if we're in the middle of starting a match manually
        if (window.isStartingMatch) {
            console.log('Skipping immediate refresh due to manual match start in progress');
            return;
        }
        
        // Always refresh relevant tabs for match start events
        if (currentActiveTab === 'live' || currentActiveTab === 'dashboard' || currentActiveTab === 'matches') {
            coordinatedWebSocketUpdate(() => refreshCurrentTabContent(), 1000);
        }
    });

    // Match Paused - minimal refresh
    socket.on('match-paused', (data) => {
        console.log('Match paused:', data);
        showNotification(`Spiel pausiert: ${data.match.team1} vs ${data.match.team2}`, 'warning');
        // Update UI state without full refresh
        updateMatchStatus(data.match, 'paused');
    });

    // Match Resumed - minimal refresh
    socket.on('match-resumed', (data) => {
        console.log('Match resumed:', data);
        showNotification(`Spiel fortgesetzt: ${data.match.team1} vs ${data.match.team2}`, 'info');
        // Update UI state without full refresh
        updateMatchStatus(data.match, 'resumed');
    });

    // Match Finished - important refresh and auto-load next match
    socket.on('match-finished', (data) => {
        console.log('Match finished:', data);
        showNotification(`Spiel beendet: ${data.match.team1} vs ${data.match.team2}`, 'success');
        if (!isRefreshing) {
            coordinatedWebSocketUpdate(() => refreshCurrentTabContent(), 1000);
        }
        
        // If on live tab, automatically load next match after short delay
        if (currentActiveTab === 'live') {
            setTimeout(() => {
                if (!isRefreshing) {
                    console.log('Auto-loading next match after match finish');
                    loadLiveControl();
                }
            }, 2000); // 2 second delay to show completion message
        }
    });

    // Match Result Added
    socket.on('match-result-added', (data) => {
        console.log('Match result added:', data);
        showNotification(`Ergebnis eingetragen: ${data.match.team1} ${data.score1}:${data.score2} ${data.match.team2}`, 'success');
        // Always refresh for result updates as they affect multiple tabs
        if (currentActiveTab === 'results' || currentActiveTab === 'dashboard' || currentActiveTab === 'matches') {
            coordinatedWebSocketUpdate(() => refreshCurrentTabContent(), 1000);
        }
    });

    // Current Match Changed
    socket.on('current-match-changed', (data) => {
        console.log('Current match changed:', data);
        if (!isRefreshing && currentActiveTab === 'live') {
            coordinatedWebSocketUpdate(() => refreshCurrentTabContent(), 1000);
        }
    });

    // Halftime Started
    socket.on('halftime-started', (data) => {
        console.log('Halftime started:', data);
        showNotification(`Halbzeit eingeläutet: ${data.match.team1} vs ${data.match.team2}`, 'info');
        if (!isRefreshing && currentActiveTab === 'live') {
            // Sofortiges Neuladen für bessere UX
            setTimeout(() => {
                loadLiveControl();
            }, 500);
        }
    });

    // Second Half Started
    socket.on('second-half-started', (data) => {
        console.log('Second half started:', data);
        showNotification(`2. Halbzeit gestartet: ${data.match.team1} vs ${data.match.team2}`, 'success');
        if (!isRefreshing && currentActiveTab === 'live') {
            // Sofortiges Neuladen für korrekte Button-Anzeige
            setTimeout(() => {
                loadLiveControl();
            }, 500);
        }
    });

    // Data Imported Event
    socket.on('data-imported', (data) => {
        console.log('Data imported:', data);
        showNotification(`Daten für ${data.year} erfolgreich importiert: ${data.teamsCount} Teams, ${data.matchesCount} Spiele`, 'success');
        if (!isRefreshing) {
            coordinatedWebSocketUpdate(() => refreshCurrentTabContent(), 1000);
        }
        // Update tournament info immediately after import
        debouncedUpdateTournamentInfo();
    });

    // Tournament Reset Event
    socket.on('tournament-reset', (data) => {
        console.log('Tournament reset received:', data);
        showNotification(`${data.message}`, 'warning');
        
        // Clear any cached data and reload the tournament management
        if (!isRefreshing) {
            setTimeout(() => {
                // Force a complete reload of the tournament management
                if (typeof loadTournamentManagement === 'function') {
                    loadTournamentManagement();
                } else {
                    // Fallback: reload the current tab
                    refreshCurrentTabContent();
                }
            }, 1000);
        }
    });

    // Tournament Status Changed - refresh all relevant tabs
    socket.on('tournament-status-changed', (data) => {
        console.log('Tournament status changed:', data);
        showNotification(`Turnier-Status geändert zu: ${data.newStatus}`, 'info');
        
        // Update global tournament data
        if (data.tournament) {
            currentTournament = data.tournament;
        }
        
        // Refresh current tab to show new status
        if (!isRefreshing) {
            coordinatedWebSocketUpdate(() => refreshCurrentTabContent(), 500);
        }
    });

    // Team Registered - refresh teams and dashboard
    socket.on('team-registered', (data) => {
        console.log('Team registered:', data);
        showNotification(`Neues Team angemeldet: ${data.team.name}`, 'success');
        
        // Refresh relevant tabs
        if (!isRefreshing && (currentActiveTab === 'teams' || currentActiveTab === 'dashboard' || currentActiveTab === 'tournament')) {
            coordinatedWebSocketUpdate(() => refreshCurrentTabContent(), 500);
        }
    });

    // Matches Generated - refresh matches and related tabs
    socket.on('matches-generated', (data) => {
        console.log('Matches generated:', data);
        showNotification(`Spielplan erstellt: ${data.totalMatches} Spiele generiert`, 'success');
        
        // Update global tournament data
        if (data.tournament) {
            currentTournament = data.tournament;
        }
        
        // Refresh all tabs that show match data
        if (!isRefreshing) {
            coordinatedWebSocketUpdate(() => refreshCurrentTabContent(), 500);
        }
    });

    // Matches Scheduled - refresh matches tab when games are scheduled
    socket.on('matches-scheduled', (data) => {
        console.log('Matches scheduled:', data);
        showNotification(`${data.scheduledCount} Spiele geplant ab ${data.startTime}`, 'success');
        
        // Refresh matches tab and live tab
        if (!isRefreshing && (currentActiveTab === 'matches' || currentActiveTab === 'live' || currentActiveTab === 'dashboard')) {
            coordinatedWebSocketUpdate(() => refreshCurrentTabContent(), 500);
        }
    });
}

// Helper function to update match status without full refresh
function updateMatchStatus(match, status) {
    const matchElements = document.querySelectorAll(`[data-match-id="${match.id}"]`);
    matchElements.forEach(element => {
        const statusElement = element.querySelector('.match-status');
        if (statusElement) {
            switch(status) {
                case 'paused':
                    statusElement.textContent = 'PAUSIERT';
                    statusElement.className = 'match-status paused';
                    break;
                case 'resumed':
                    statusElement.textContent = 'LIVE';
                    statusElement.className = 'match-status live';
                    break;
            }
        }
    });
    
    // Update pause/resume buttons in live control
    updatePauseResumeButtons(match.id, status);
}

// Helper function to update pause/resume buttons
function updatePauseResumeButtons(matchId, status) {
    const pauseResumeButton = document.querySelector(`button[onclick*="pauseMatch('${matchId}')"], button[onclick*="resumeMatch('${matchId}')"]`);
    
    if (pauseResumeButton) {
        switch(status) {
            case 'paused':
                // Change to Resume button
                pauseResumeButton.innerHTML = '<i class="fas fa-play"></i> Spiel fortsetzen';
                pauseResumeButton.className = 'btn btn-success btn-large';
                pauseResumeButton.setAttribute('onclick', `resumeMatch('${matchId}')`);
                break;
            case 'resumed':
                // Change to Pause button
                pauseResumeButton.innerHTML = '<i class="fas fa-pause"></i> Spiel pausieren';
                pauseResumeButton.className = 'btn btn-warning btn-large';
                pauseResumeButton.setAttribute('onclick', `pauseMatch('${matchId}')`);
                break;
        }
    }
}

// Helper function to update live scores in real-time (renamed to avoid conflict)
function updateLiveScoreDisplay(data) {
    const { matchId, score1, score2, match } = data;
    
    // Update live score inputs ONLY if they are not currently focused (prevents overwriting user input)
    const score1Input = document.querySelector(`input[data-match-id="${matchId}"][data-score="1"]`);
    const score2Input = document.querySelector(`input[data-match-id="${matchId}"][data-score="2"]`);
    
    // Also check the live control inputs
    const liveScore1Input = document.getElementById('live-score1');
    const liveScore2Input = document.getElementById('live-score2');
    
    // Only update if not currently focused (user is not typing)
    if (score1Input && document.activeElement !== score1Input) {
        score1Input.value = score1;
    }
    if (score2Input && document.activeElement !== score2Input) {
        score2Input.value = score2;
    }
    if (liveScore1Input && document.activeElement !== liveScore1Input) {
        liveScore1Input.value = score1;
    }
    if (liveScore2Input && document.activeElement !== liveScore2Input) {
        liveScore2Input.value = score2;
    }

    // Update match displays (these are always safe to update)
    const matchElements = document.querySelectorAll(`[data-match-id="${matchId}"]`);
    matchElements.forEach(element => {
        const scoreDisplay = element.querySelector('.live-score');
        if (scoreDisplay) {
            scoreDisplay.textContent = `${score1}:${score2}`;
        }
    });
}

// Helper function to coordinate WebSocket-triggered updates
function coordinatedWebSocketUpdate(callback, minInterval = 500) {
    const now = Date.now();
    if (now - lastWebSocketUpdate < minInterval) {
        // Too frequent, skip this update
        return false;
    }
    lastWebSocketUpdate = now;
    callback();
    return true;
}

// Helper function to refresh current tab content with debouncing
async function refreshCurrentTabContent() {
    if (!isLoggedIn || !isConnected) return;
    
    // If already refreshing, mark as pending
    if (isRefreshing) {
        pendingRefresh = true;
        return;
    }
    
    // Clear any pending timeout
    if (refreshTimeout) {
        clearTimeout(refreshTimeout);
    }
    
    // Debounce rapid refresh calls
    refreshTimeout = setTimeout(async () => {
        await performTabRefresh();
    }, 300);
}

// Actual tab refresh implementation
async function performTabRefresh() {
    if (!isLoggedIn || !isConnected) return;
    
    if (isRefreshing) return;
    isRefreshing = true;
    
    try {
        // Only load initial data if we're in a stable state
        if (socket && socket.connected) {
            await loadInitialData();
        }
        
        // Refresh current tab - für Tabs mit Datenabhängigkeit forceReload
        switch(currentActiveTab) {
            case 'dashboard':
                await loadDashboard();
                break;
            case 'tournament':
                loadTournamentManagement();
                break;
            case 'teams':
                await loadInitialData(true); // Force reload für Teams
                loadTeams();
                break;
            case 'matches':
                await loadInitialData(true); // Force reload für Matches  
                await loadMatches();
                break;
            case 'live':
                await loadLiveControl();
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
        
        // Only update tournament info if we actually loaded new data and socket is stable
        if (socket && socket.connected) {
            debouncedUpdateTournamentInfo();
        }
        console.log(`WebSocket refreshed tab: ${currentActiveTab}`);
    } catch (error) {
        console.error('Failed to refresh tab content:', error);
        // Show user-friendly error only for critical tabs
        if (currentActiveTab === 'live') {
            showNotification('Live-Control aktualisiert sich automatisch...', 'info');
        }
    } finally {
        isRefreshing = false;
        
        // Handle pending refresh if needed with longer delay to prevent cascading
        if (pendingRefresh) {
            pendingRefresh = false;
            setTimeout(() => refreshCurrentTabContent(), 2000); // Increased from 500ms to 2000ms
        }
    }
}

// Modal Functions
function createModal(title, content, actions = []) {
    const modalId = 'dynamic-modal-' + Date.now();
    const modalHtml = `
        <div id="${modalId}" class="modal active">
            <div class="modal-content">
                <div class="modal-header">
                    <h3>${title}</h3>
                    <button class="close-btn" onclick="closeModal('${modalId}')">&times;</button>
                </div>
                <div class="modal-body" style="padding: 2rem;">
                    ${content}
                </div>
                ${actions.length > 0 ? `
                    <div class="modal-footer" style="padding: 1rem 2rem; border-top: 1px solid var(--gray-200); display: flex; gap: 1rem; justify-content: flex-end; flex-wrap: wrap;">
                        ${actions.map((action, index) => `<button id="modal-action-${modalId}-${index}" class="btn ${action.class || 'btn-primary'}">${action.text}</button>`).join('')}
                    </div>
                ` : ''}
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    const modalElement = document.getElementById(modalId);

    // Event Listener für Action-Buttons
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
    showLoading(true);
    
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
            // Direkt die UI aktualisieren ohne Verzögerung
            loadTournamentManagement();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Erstellen des Turniers', 'error');
        console.error('Tournament creation error:', error);
    } finally {
        showLoading(false);
    }
}

// Tournament Creation Event Listener Setup
function setupTournamentForm() {
    console.log('Setting up tournament form');
    const form = document.getElementById('tournament-creation-form');
    if (form) {
        console.log('Tournament form found, adding event listener');
        const newForm = form.cloneNode(true);
        form.parentNode.replaceChild(newForm, form);
        
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

// Navigation
menuItems.forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        const targetTab = item.dataset.tab;
        switchToTab(targetTab);
        closeMobileMenu();
    });
});

// Quick Action Tab Switch
function switchToTab(targetTab) {
    // Update current active tab
    currentActiveTab = targetTab;
    localStorage.setItem('adminCurrentTab', targetTab);
    
    // Update active menu item
    menuItems.forEach(mi => mi.classList.remove('active'));
    const targetMenuItem = document.querySelector(`[data-tab="${targetTab}"]`);
    if (targetMenuItem) {
        targetMenuItem.classList.add('active');
    }
    
    // Update active tab
    adminTabs.forEach(tab => tab.classList.remove('active'));
    const targetTabContent = document.getElementById(`${targetTab}-tab`);
    if (targetTabContent) {
        targetTabContent.classList.add('active');
    }
    
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
    pageTitle.textContent = titles[targetTab] || 'Admin Dashboard';
    
    // Load content
    loadTabContent(targetTab);
}

// Login mit Session-Management
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('admin-password').value;
    const rememberLogin = document.getElementById('remember-login').checked;
    
    showLoading(true);
    
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
            
            // Session speichern wenn gewünscht
            if (rememberLogin) {
                saveSession(password);
            }
            
            loginScreen.style.display = 'none';
            adminContent.style.display = 'block';
            showNotification('Erfolgreich angemeldet');
            
            // Initialize WebSocket first, then load data
            initializeWebSocket();
            
            // Mark as initialized to prevent duplicate loads
            isInitialized = true;
            lastInitialDataLoad = Date.now();
            
            // Small delay to allow WebSocket to connect
            setTimeout(async () => {
                await loadInitialData();
                
                // Restore saved tab or use dashboard as default
                const savedTab = localStorage.getItem('adminCurrentTab') || 'dashboard';
                switchToTab(savedTab);
                loadTabContent(savedTab);
            }, 1000);
        } else {
            showNotification('Ungültiges Passwort', 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Anmelden', 'error');
    } finally {
        showLoading(false);
    }
});

// Auto-Login bei gespeicherter Session
async function checkAutoLogin() {
    const session = loadSession();
    if (session) {
        adminPassword = session.password;
        
        try {
            const response = await fetch('/api/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: session.password })
            });
            
            const data = await response.json();
            
            if (data.success) {
                isLoggedIn = true;
                loginScreen.style.display = 'none';
                adminContent.style.display = 'block';
                
                // Initialize WebSocket first, then load data
                initializeWebSocket();
                
                // Mark as initialized to prevent duplicate loads
                isInitialized = true;
                lastInitialDataLoad = Date.now();
                
                // Small delay to allow WebSocket to connect
                setTimeout(async () => {
                    await loadInitialData();
                    
                    // Restore saved tab or use dashboard as default
                    const savedTab = localStorage.getItem('adminCurrentTab') || 'dashboard';
                    switchToTab(savedTab);
                    loadTabContent(savedTab);
                    console.log('Auto-login successful');
                }, 1000);
            } else {
                clearSession();
            }
        } catch (error) {
            console.error('Auto-login failed:', error);
            clearSession();
        }
    }
}

// Load Initial Data
async function loadInitialData(forceReload = false) {
    // Verhindere mehrfache gleichzeitige Aufrufe, außer bei forceReload
    if (isRefreshing && !forceReload) {
        console.log('loadInitialData bereits in Bearbeitung, überspringe');
        return;
    }
    
    isRefreshing = true;
    console.log('Lade initiale Daten...');
    
    // Alle API-Aufrufe parallel ausführen mit Promise.allSettled
    const apiCalls = [
        fetch('/api/tournament').then(response => response.json()),
        fetch('/api/admin/teams').then(response => response.json()),
        fetch('/api/matches').then(response => response.json())
    ];
    
    try {
        const results = await Promise.allSettled(apiCalls);
        
        // Tournament-Daten verarbeiten
        if (results[0].status === 'fulfilled') {
            currentTournament = results[0].value.tournament;
        } else {
            console.error('Fehler beim Laden des Turniers:', results[0].reason);
            currentTournament = null;
        }
        
        // Teams-Daten verarbeiten
        if (results[1].status === 'fulfilled') {
            teams = results[1].value;
        } else {
            console.error('Fehler beim Laden der Teams:', results[1].reason);
            teams = [];
        }
        
        // Matches-Daten verarbeiten
        if (results[2].status === 'fulfilled') {
            matches = results[2].value;
        } else {
            console.error('Fehler beim Laden der Spiele:', results[2].reason);
            matches = [];
        }
        
        // UI aktualisieren (auch wenn einige Requests fehlgeschlagen sind)
        debouncedUpdateTournamentInfo();
        
        // Erfolgreich geladene Daten loggen
        const successCount = results.filter(r => r.status === 'fulfilled').length;
        const failureCount = results.length - successCount;
        
        if (failureCount > 0) {
            console.warn(`${successCount}/${results.length} API-Aufrufe erfolgreich. ${failureCount} fehlgeschlagen.`);
        } else {
            console.log('Alle Daten erfolgreich geladen');
        }
        
    } catch (error) {
        // Sollte theoretisch nicht auftreten, da Promise.allSettled nie rejected
        console.error('Unerwarteter Fehler beim Laden der Daten:', error);
        // Fallback-Werte setzen
        currentTournament = null;
        teams = [];
        matches = [];
        debouncedUpdateTournamentInfo();
    } finally {
        isRefreshing = false;
    }
}

function updateTournamentInfo() {
    const tournamentInfo = document.getElementById('current-tournament-info');
    let newText;
    
    if (currentTournament) {
        const statusMap = {
            'registration': 'Anmeldung offen',
            'closed': 'Anmeldung geschlossen',
            'active': 'Aktiv',
            'finished': 'Beendet'
        };
        const status = statusMap[currentTournament.status] || 'Unbekannt';
        newText = `Turnier ${currentTournament.year} - ${status}`;
    } else {
        newText = 'Kein aktives Turnier';
    }
    
    // Nur updaten wenn sich der Text tatsächlich geändert hat
    if (tournamentInfo && lastTournamentText !== newText) {
        tournamentInfo.textContent = newText;
        lastTournamentText = newText;
    }
}

// Debounced version to prevent flickering
function debouncedUpdateTournamentInfo() {
    if (tournamentInfoTimeout) {
        clearTimeout(tournamentInfoTimeout);
    }
    tournamentInfoTimeout = setTimeout(() => {
        updateTournamentInfo();
        tournamentInfoTimeout = null;
    }, 150); // 150ms debounce
}

// Tab Content Loading
async function loadTabContent(tab) {
    currentActiveTab = tab;
    switch (tab) {
        case 'dashboard':
            await loadDashboard();
            break;
        case 'tournament':
            loadTournamentManagement();
            break;
        case 'teams':
            loadTeams();
            break;
        case 'matches':
            await loadMatches();
            break;
        case 'live':
            await loadLiveControl();
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

// Tournament Management
function loadTournamentManagement() {
    console.log('Loading tournament management');
    const tournamentStatus = document.getElementById('tournament-status');
    const tournamentCreation = document.getElementById('tournament-creation');
    const registrationManagement = document.getElementById('registration-management');
    
    if (!currentTournament) {
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
        
        setTimeout(() => {
            setupTournamentForm();
        }, 100);
        
    } else {
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
                    <span><strong>Format:</strong> ${currentTournament.settings?.format || 'Nicht festgelegt'}</span>
                    ${currentTournament.registrationClosedAt ? 
                        `<span><strong>Anmeldung geschlossen:</strong> ${new Date(currentTournament.registrationClosedAt).toLocaleDateString('de-DE')}</span>` : 
                        ''
                    }
                </div>
                <div class="tournament-actions">
                    <button class="btn btn-warning" onclick="changeTournamentStatus()">
                        <i class="fas fa-edit"></i> <span class="btn-text">Status ändern</span>
                    </button>
                    <button class="btn btn-outline" onclick="reorganizeGroups()">
                        <i class="fas fa-refresh"></i> <span class="btn-text">Gruppen neu organisieren</span>
                    </button>
                    ${currentTournament.settings?.format === 'swiss' ? `
                        <button class="btn btn-outline" onclick="configureSwissSystem()">
                            <i class="fas fa-cog"></i> <span class="btn-text">Champions League konfigurieren</span>
                        </button>
                    ` : ''}
                    <button class="btn btn-outline" onclick="generatePenaltyShootouts()">
                        <i class="fas fa-dot-circle"></i> <span class="btn-text">Elfmeterschießen generieren</span>
                    </button>
                    <button class="btn btn-outline" onclick="resetAllResults()">
                        <i class="fas fa-undo"></i> <span class="btn-text">Alle Ergebnisse zurücksetzen</span>
                    </button>
                    <button class="btn btn-outline" onclick="resetAllSchedules()">
                        <i class="fas fa-calendar-times"></i> <span class="btn-text">Zeitpläne zurücksetzen</span>
                    </button>
                    <button class="btn btn-outline" onclick="resetKOSchedules()">
                        <i class="fas fa-trophy"></i> <span class="btn-text">KO-Spiele Zeitplan zurücksetzen</span>
                    </button>
                    <button class="btn btn-outline" onclick="recalculateTables()">
                        <i class="fas fa-calculator"></i> <span class="btn-text">Tabellen neu berechnen</span>
                    </button>
                    <button class="btn btn-outline" onclick="exportTournamentData()">
                        <i class="fas fa-download"></i> <span class="btn-text">Daten exportieren</span>
                    </button>
                    <button class="btn btn-danger" onclick="resetTournamentComplete()">
                        <i class="fas fa-trash"></i> <span class="btn-text">Turnier komplett zurücksetzen</span>
                    </button>
                </div>
            </div>
        `;
        
        if (currentTournament.status === 'registration') {
            registrationManagement.innerHTML = `
                <h4>Anmeldephase verwalten</h4>
                <p>Aktuell können sich Teams anmelden. Wähle das Format und schließe die Anmeldung, um den Spielplan zu erstellen.</p>
                <div class="registration-actions">
                    <button class="btn btn-warning" onclick="openAdvancedRegistrationDialog()" ${teams.length < 4 ? 'disabled' : ''}>
                        <i class="fas fa-cog"></i> Anmeldung schließen - Erweiterte Optionen
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

// Swiss System Configuration
async function configureSwissSystem() {
    if (!currentTournament || currentTournament.settings?.format !== 'swiss') {
        showNotification('Nur für Champions League Format verfügbar', 'error');
        return;
    }
    
    const currentRounds = currentTournament.settings?.rounds || 5;
    const recommendedRounds = Math.min(Math.ceil(Math.log2(teams.length)) + 1, teams.length - 1);
    
    const dialogContent = `
        <div style="margin-bottom: 2rem;">
            <h4>Champions League Format konfigurieren</h4>
            <p><strong>${teams.length} Teams</strong> im aktuellen Turnier.</p>
        </div>
        
        <div style="margin-bottom: 2rem;">
            <div class="form-group">
                <label for="new-swiss-rounds" style="font-weight: 600; margin-bottom: 0.5rem; display: block;">Anzahl Runden:</label>
                <select id="new-swiss-rounds" style="width: 100%; padding: 0.5rem; border: 2px solid #ccc; border-radius: 0.5rem;">
                    <option value="3" ${currentRounds === 3 ? 'selected' : ''}>3 Runden</option>
                    <option value="4" ${currentRounds === 4 ? 'selected' : ''}>4 Runden</option>
                    <option value="5" ${currentRounds === 5 ? 'selected' : ''}>5 Runden</option>
                    <option value="6" ${currentRounds === 6 ? 'selected' : ''}>6 Runden</option>
                    <option value="7" ${currentRounds === 7 ? 'selected' : ''}>7 Runden</option>
                </select>
                <small style="color: #666; margin-top: 0.5rem; display: block;">
                    Empfohlen für ${teams.length} Teams: ${recommendedRounds} Runden
                </small>
            </div>
        </div>
        
        <div style="background: #fef3c7; border: 1px solid #f59e0b; padding: 1rem; border-radius: 0.5rem; margin-bottom: 1rem;">
            <strong style="color: #f59e0b;">⚠️ Wichtiger Hinweis:</strong>
            <p style="margin: 0.5rem 0 0 0; color: #92400e;">
                Änderungen an der Rundenzahl erstellen den Spielplan komplett neu. 
                Alle bisherigen Spiele und Ergebnisse gehen verloren!
            </p>
        </div>
    `;
    
    const modal = createModal('Champions League Format bearbeiten', dialogContent, [
        { text: 'Spielplan neu erstellen', class: 'btn-warning', handler: (modalId) => executeSwissReconfiguration(modalId) },
        { text: 'Abbrechen', class: 'btn-outline', handler: (modalId) => closeModal(modalId) }
    ]);
}

async function executeSwissReconfiguration(modalId) {
    const newRounds = parseInt(document.getElementById('new-swiss-rounds').value);
    
    if (!confirm(`Champions League Format mit ${newRounds} Runden neu erstellen?\n\nAlle bisherigen Spiele und Ergebnisse gehen verloren!`)) {
        return;
    }
    
    showLoading(true);
    
    try {
        const response = await fetch('/api/admin/reconfigure-swiss', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                password: adminPassword,
                rounds: newRounds
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification(`Champions League Format mit ${newRounds} Runden neu erstellt`);
            closeModal(modalId);
            await refreshCurrentTabContent();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Neu-Konfigurieren', 'error');
        console.error('Swiss reconfiguration error:', error);
    } finally {
        showLoading(false);
    }
}

// Elfmeterschießen generieren
async function generatePenaltyShootouts() {
    if (!currentTournament) {
        showNotification('Kein aktives Turnier', 'error');
        return;
    }
    
    if (!confirm('Elfmeterschießen für alle Gleichstände generieren?\n\nDies erstellt Spiele zwischen Teams mit exakt gleichen Tabellenpositionen.')) {
        return;
    }
    
    showLoading(true);
    
    try {
        const response = await fetch('/api/admin/generate-penalties', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: adminPassword })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification(data.message);
            await refreshCurrentTabContent();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Generieren der Elfmeterschießen', 'error');
        console.error('Generate penalties error:', error);
    } finally {
        showLoading(false);
    }
}

// Erweiterte Anmeldung-schließen Dialog
async function openAdvancedRegistrationDialog() {
    if (teams.length < 4) {
        showNotification('Mindestens 4 Teams erforderlich', 'error');
        return;
    }
    
    const dialogContent = `
        <div style="margin-bottom: 2rem;">
            <h4>Turnier-Format wählen</h4>
            <p><strong>${teams.length} Teams</strong> haben sich angemeldet. Wähle das gewünschte Format:</p>
        </div>
        
        <div style="margin-bottom: 2rem;">
            <div class="format-selector">
                <label style="display: block; margin-bottom: 1rem; cursor: pointer; padding: 1rem; border: 2px solid #ccc; border-radius: 0.5rem;">
                    <input type="radio" name="tournament-format" value="groups" checked style="margin-right: 1rem;">
                    <strong>Gruppen-System</strong> <small>(klassisch)</small>
                    <div style="margin-top: 0.5rem; color: #666; font-size: 0.9rem;">
                        Teams werden in Gruppen aufgeteilt, Gruppenphase + K.O.-Phase
                    </div>
                </label>
                
                <label style="display: block; margin-bottom: 1rem; cursor: pointer; padding: 1rem; border: 2px solid #ccc; border-radius: 0.5rem;">
                    <input type="radio" name="tournament-format" value="swiss" style="margin-right: 1rem;">
                    <strong>Champions League Format</strong> <small>(modern)</small>
                    <div style="margin-top: 0.5rem; color: #666; font-size: 0.9rem;">
                        Alle Teams in einer Liga, jedes Team spielt verschiedene Gegner + K.O.-Phase
                    </div>
                </label>
            </div>
        </div>
        
        <!-- Options Container -->
        <div id="format-options">
            <!-- Wird dynamisch gefüllt -->
        </div>
        
        <!-- Validierungs-Sektion -->
        <div style="margin-top: 2rem; padding: 1rem; background: #f0f9ff; border-radius: 0.5rem;">
            <button type="button" class="btn btn-outline" onclick="analyzeCurrentConfiguration()" style="margin-bottom: 1rem;">
                <i class="fas fa-brain"></i> Konfiguration analysieren & validieren
            </button>
            <div id="analysis-results" style="display: none;">
                <!-- Analysis results will be shown here -->
            </div>
        </div>
    `;
    
    const modal = createModal('Turnier-Konfiguration', dialogContent, [
        { text: 'Spielplan erstellen', handler: (modalId) => submitAdvancedRegistration(modalId) },
        { text: 'Abbrechen', class: 'btn-outline', handler: (modalId) => closeModal(modalId) }
    ]);
    
    // Event listeners für Format-Änderung
    const formatRadios = modal.querySelectorAll('input[name="tournament-format"]');
    formatRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            updateFormatOptions(radio.value, modal);
            // Update radio button styling
            formatRadios.forEach(r => {
                const label = r.closest('label');
                if (r.checked) {
                    label.style.borderColor = '#dc2626';
                    label.style.backgroundColor = '#fef2f2';
                } else {
                    label.style.borderColor = '#ccc';
                    label.style.backgroundColor = 'white';
                }
            });
        });
    });
    
    // Initial format options load
    updateFormatOptions('groups', modal);
    
    // Initial styling
    formatRadios[0].closest('label').style.borderColor = '#dc2626';
    formatRadios[0].closest('label').style.backgroundColor = '#fef2f2';
}

function updateFormatOptions(format, modal) {
    const optionsContainer = modal.querySelector('#format-options');
    
    if (format === 'groups') {
        optionsContainer.innerHTML = `
            <h5>Gruppen-Einstellungen</h5>
            <div style="margin-bottom: 1rem;">
                <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Teams pro Gruppe:</label>
                <select id="group-size" style="width: 100%; padding: 0.5rem; border: 2px solid #ccc; border-radius: 0.5rem;">
                    <option value="3">3 Teams pro Gruppe</option>
                    <option value="4" selected>4 Teams pro Gruppe</option>
                    <option value="5">5 Teams pro Gruppe</option>
                </select>
            </div>
            <div style="margin-bottom: 1rem;">
                <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Spiele pro Team in Gruppenphase:</label>
                <select id="max-games" style="width: 100%; padding: 0.5rem; border: 2px solid #ccc; border-radius: 0.5rem;">
                    <option value="">Alle möglichen Spiele (Jeder gegen Jeden)</option>
                    <option value="2">Genau 2 Spiele pro Team</option>
                    <option value="3">Genau 3 Spiele pro Team</option>
                    <option value="4">Genau 4 Spiele pro Team</option>
                </select>
                <small style="color: #dc2626; font-weight: 600; margin-top: 0.5rem; display: block;">
                    ⚠️ Wird automatisch validiert - unmögliche Kombinationen werden abgelehnt
                </small>
            </div>
            <h5>K.O.-Phase Einstellungen</h5>
            <div style="margin-bottom: 1rem;">
                <label style="display: block; margin-bottom: 0.5rem;">
                    <input type="checkbox" id="enable-quarterfinals" ${teams.length >= 8 ? 'checked' : 'disabled'}> 
                    Viertelfinale (nur ab 8+ Teams)
                </label>
                <label style="display: block; margin-bottom: 0.5rem;">
                    <input type="checkbox" id="enable-third-place" checked> Spiel um Platz 3
                </label>
                <label style="display: block; margin-bottom: 0.5rem;">
                    <input type="checkbox" id="enable-fifth-place"> Spiel um Platz 5
                </label>
                <label style="display: block; margin-bottom: 0.5rem;">
                    <input type="checkbox" id="enable-seventh-place"> Spiel um Platz 7
                </label>
            </div>
        `;
    } else if (format === 'swiss') {
        const recommendedRounds = Math.min(Math.ceil(Math.log2(teams.length)) + 1, teams.length - 1);
        optionsContainer.innerHTML = `
            <h5>Champions League Format Einstellungen</h5>
            <div style="margin-bottom: 1rem;">
                <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Anzahl Runden:</label>
                <select id="swiss-rounds" style="width: 100%; padding: 0.5rem; border: 2px solid #ccc; border-radius: 0.5rem;">
                    <option value="3">3 Runden</option>
                    <option value="4">4 Runden</option>
                    <option value="5" ${recommendedRounds === 5 ? 'selected' : ''}>5 Runden</option>
                    <option value="6" ${recommendedRounds === 6 ? 'selected' : ''}>6 Runden</option>
                    <option value="7" ${recommendedRounds === 7 ? 'selected' : ''}>7 Runden</option>
                </select>
                <small style="color: #666; margin-top: 0.5rem; display: block;">
                    Empfohlen für ${teams.length} Teams: ${recommendedRounds} Runden
                </small>
                <small style="color: #dc2626; font-weight: 600; margin-top: 0.5rem; display: block;">
                    ⚠️ Wird automatisch validiert - ungerade Spiel-Kombinationen werden verhindert
                </small>
            </div>
            <h5>K.O.-Phase Einstellungen</h5>
            <div style="margin-bottom: 1rem;">
                <label style="display: block; margin-bottom: 0.5rem;">
                    <input type="checkbox" id="enable-quarterfinals" ${teams.length >= 8 ? 'checked' : 'disabled'}> 
                    Viertelfinale (nur ab 8+ Teams)
                </label>
                <label style="display: block; margin-bottom: 0.5rem;">
                    <input type="checkbox" id="enable-third-place" checked> Spiel um Platz 3
                </label>
                <label style="display: block; margin-bottom: 0.5rem;">
                    <input type="checkbox" id="enable-fifth-place"> Spiel um Platz 5
                </label>
            </div>
        `;
    }
}

async function analyzeCurrentConfiguration() {
    const modal = document.querySelector('.modal.active');
    const format = modal.querySelector('input[name="tournament-format"]:checked').value;
    
    let options = {};
    
    if (format === 'groups') {
        options.groupSize = parseInt(modal.querySelector('#group-size').value);
        options.maxGamesPerTeam = modal.querySelector('#max-games').value ? parseInt(modal.querySelector('#max-games').value) : null;
    } else if (format === 'swiss') {
        options.rounds = parseInt(modal.querySelector('#swiss-rounds').value);
    }
    
    try {
        const response = await fetch('/api/admin/analyze-tournament-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                password: adminPassword,
                format: format,
                options: options
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            displayAnalysisResults(data.analysis, modal);
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler bei der Analyse', 'error');
        console.error('Analysis error:', error);
    }
}

function displayAnalysisResults(analysis, modal) {
    const resultsContainer = modal.querySelector('#analysis-results');
    
    let html = '<h5>Analyse-Ergebnisse:</h5>';
    
    if (analysis.feasible) {
        html += '<div style="background: #f0fdf4; border: 1px solid #16a34a; padding: 1rem; border-radius: 0.5rem; margin-bottom: 1rem;">';
        html += '<strong style="color: #16a34a;">✓ Konfiguration ist mathematisch korrekt und durchführbar</strong>';
        html += '</div>';
    } else {
        html += '<div style="background: #fef2f2; border: 1px solid #dc2626; padding: 1rem; border-radius: 0.5rem; margin-bottom: 1rem;">';
        html += '<strong style="color: #dc2626;">⚠ FEHLER: Mathematisch unmögliche Konfiguration!</strong>';
        analysis.warnings.forEach(warning => {
            html += `<div style="margin-top: 0.5rem;">• ${warning}</div>`;
        });
        html += '</div>';
    }
    
    if (analysis.recommendations.length > 0) {
        html += '<div style="background: #fef3c7; border: 1px solid #f59e0b; padding: 1rem; border-radius: 0.5rem; margin-bottom: 1rem;">';
        html += '<strong style="color: #f59e0b;">💡 Lösungsvorschläge:</strong>';
        analysis.recommendations.forEach(rec => {
            html += `<div style="margin-top: 0.5rem;">• ${rec}</div>`;
        });
        html += '</div>';
    }
    
    if (analysis.alternatives.length > 0) {
        html += '<div style="background: #f0f9ff; border: 1px solid #3b82f6; padding: 1rem; border-radius: 0.5rem; margin-bottom: 1rem;">';
        html += '<strong style="color: #3b82f6;">🔄 Alternative Formate:</strong>';
        analysis.alternatives.forEach(alt => {
            html += `<div style="margin-top: 1rem; padding: 0.5rem; background: white; border-radius: 0.25rem;">`;
            html += `<strong>${alt.description}</strong>`;
            if (alt.advantages) {
                html += '<div style="margin-top: 0.5rem; font-size: 0.9rem;">';
                alt.advantages.forEach(adv => {
                    html += `<div>✓ ${adv}</div>`;
                });
                html += '</div>';
            }
            html += '</div>';
        });
        html += '</div>';
    }
    
    resultsContainer.innerHTML = html;
    resultsContainer.style.display = 'block';
}

async function submitAdvancedRegistration(modalId) {
    const modal = document.getElementById(modalId);
    const format = modal.querySelector('input[name="tournament-format"]:checked').value;
    
    let requestData = {
        password: adminPassword,
        format: format
    };
    
    // Format-spezifische Optionen sammeln
    if (format === 'groups') {
        requestData.groupSize = parseInt(modal.querySelector('#group-size').value);
        const maxGamesValue = modal.querySelector('#max-games').value;
        requestData.maxGamesPerTeam = maxGamesValue ? parseInt(maxGamesValue) : null;
        
        requestData.enableQuarterfinals = modal.querySelector('#enable-quarterfinals')?.checked || false;
        requestData.enableThirdPlace = modal.querySelector('#enable-third-place')?.checked || false;
        requestData.enableFifthPlace = modal.querySelector('#enable-fifth-place')?.checked || false;
        requestData.enableSeventhPlace = modal.querySelector('#enable-seventh-place')?.checked || false;
        
    } else if (format === 'swiss') {
        requestData.rounds = parseInt(modal.querySelector('#swiss-rounds').value);
        
        requestData.enableQuarterfinals = modal.querySelector('#enable-quarterfinals')?.checked || false;
        requestData.enableThirdPlace = modal.querySelector('#enable-third-place')?.checked || false;
        requestData.enableFifthPlace = modal.querySelector('#enable-fifth-place')?.checked || false;
    }
    
    showLoading(true);
    
    try {
        const response = await fetch('/api/admin/close-registration', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestData)
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification(data.message || `Anmeldung geschlossen! Spielplan mit ${data.matchesGenerated} Spielen erstellt.`);
            closeModal(modalId);
            await refreshCurrentTabContent();
        } else {
            // Spezielle Behandlung für Validierungsfehler
            if (data.details && data.suggestions) {
                let errorMsg = data.error + '\n\nProbleme:\n';
                data.details.forEach(detail => errorMsg += '• ' + detail + '\n');
                if (data.suggestions.length > 0) {
                    errorMsg += '\nLösungen:\n';
                    data.suggestions.forEach(suggestion => errorMsg += '• ' + suggestion + '\n');
                }
                alert(errorMsg);
            } else {
                showNotification(data.error, 'error');
            }
        }
    } catch (error) {
        showNotification('Fehler beim Schließen der Anmeldung', 'error');
        console.error('Close registration error:', error);
    } finally {
        showLoading(false);
    }
}

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
    
    showLoading(true);
    
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
            await refreshCurrentTabContent();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Ändern des Status', 'error');
    } finally {
        showLoading(false);
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
    
    showLoading(true);
    
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
            await refreshCurrentTabContent();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Neu-Organisieren der Gruppen', 'error');
    } finally {
        showLoading(false);
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
    showLoading(true);
    
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
            await refreshCurrentTabContent();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Zurücksetzen der Ergebnisse', 'error');
    } finally {
        showLoading(false);
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

// Reset KO Match Schedules
async function resetKOSchedules() {
    const koMatches = matches.filter(m => 
        m.scheduled && 
        (m.phase === 'quarterfinal' || m.phase === 'semifinal' || m.phase === 'final' ||
         m.group?.toLowerCase().includes('finale') ||
         m.group?.toLowerCase().includes('platz'))
    );
    
    createModal('KO-Spiele Zeitplan zurücksetzen', `
        <div class="warning-box" style="background: #fef3c7; border: 1px solid #f59e0b; padding: 1rem; border-radius: 0.5rem; margin-bottom: 1rem;">
            <i class="fas fa-exclamation-triangle" style="color: #f59e0b;"></i>
            <strong>Achtung:</strong> Nur KO-Spiele Zeitplanungen werden gelöscht!
        </div>
        <p>Diese Aktion entfernt die geplanten Zeiten nur von KO-Spielen (Viertelfinale, Halbfinale, Finale, Platzierungsspiele). Gruppenspiele bleiben geplant.</p>
        <p><strong>Betroffen:</strong> ${koMatches.length} geplante KO-Spiele</p>
        ${koMatches.length === 0 ? '<p><em>Keine geplanten KO-Spiele gefunden.</em></p>' : ''}
    `, [
        { text: 'KO-Zeitpläne zurücksetzen', class: 'btn-warning', handler: (modalId) => executeResetKOSchedules(modalId) },
        { text: 'Abbrechen', class: 'btn-outline', handler: (modalId) => closeModal(modalId) }
    ]);
}

async function executeResetKOSchedules(modalId) {
    showLoading(true);
    closeModal(modalId);
    
    try {
        const response = await fetch('/api/admin/reset-ko-schedules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: adminPassword })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification(`${data.resetCount} KO-Spiele Zeitplanungen zurückgesetzt`);
            await loadInitialData(true);
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        console.error('Fehler beim Zurücksetzen der KO-Zeitpläne:', error);
        showNotification('Fehler beim Zurücksetzen der KO-Zeitpläne', 'error');
    } finally {
        showLoading(false);
    }
}

async function executeResetSchedules(modalId) {
    showLoading(true);
    
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
            // WebSocket wird automatisch aktualisiert - nur Tab-Content refreshen
            setTimeout(() => {
                refreshCurrentTabContent();
            }, 300);
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Zurücksetzen der Zeitpläne', 'error');
    } finally {
        showLoading(false);
    }
}

// Recalculate Tables
async function recalculateTables() {
    if (!currentTournament) {
        showNotification('Kein aktives Turnier vorhanden', 'error');
        return;
    }

    if (!adminPassword) {
        showNotification('Kein Admin-Passwort gesetzt', 'error');
        return;
    }

    // Simple confirmation without modal
    if (!confirm('Sollen alle Tabellen basierend auf den abgeschlossenen Spielen neu berechnet werden? Dies kann bei Inkonsistenzen in der Tabelle helfen.')) {
        return;
    }

    showLoading(true);
    try {
        console.log('Sending recalculate request...');
        const response = await fetch('/api/admin/recalculate-tables', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: adminPassword })
        });

        const data = await response.json();
        console.log('Recalculate response:', data);

        if (response.ok) {
            showNotification(data.message || 'Tabellen erfolgreich neu berechnet', 'success');
            // Refresh current tab content
            if (typeof refreshCurrentTabContent === 'function') {
                refreshCurrentTabContent();
            }
        } else {
            showNotification(data.error || 'Fehler beim Neuberechnen der Tabellen', 'error');
        }
    } catch (error) {
        console.error('Error recalculating tables:', error);
        showNotification('Fehler beim Neuberechnen der Tabellen', 'error');
    } finally {
        showLoading(false);
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

// Import Tournament Data
function handleFileImport(input) {
    if (!input.files || input.files.length === 0) {
        return;
    }
    
    const file = input.files[0];
    if (!file.name.endsWith('.json')) {
        showNotification('Bitte eine JSON-Datei auswählen', 'error');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);
            await importTournamentData(data);
        } catch (error) {
            showNotification('Ungültige JSON-Datei', 'error');
            console.error('JSON parse error:', error);
        }
    };
    reader.readAsText(file);
}

async function importTournamentData(data) {
    showLoading(true);
    
    try {
        const response = await fetch('/api/admin/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                password: adminPassword,
                data: data
            })
        });
        
        // Überprüfe HTTP-Statuscode
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Unbekannter Serverfehler' }));
            throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        
        if (result.success) {
            // Korrekte Feldnamen basierend auf Server-Response
            const teamsCount = result.data?.teamsImported || 0;
            const matchesCount = result.data?.matchesImported || 0;
            
            showNotification('Turnierdaten erfolgreich importiert!');
            await refreshCurrentTabContent();
            
            // Update status display
            const statusDiv = document.getElementById('import-status');
            if (statusDiv) {
                statusDiv.innerHTML = `
                    <div class="import-status success">
                        <strong>✓ Import erfolgreich!</strong><br>
                        ${teamsCount} Teams, ${matchesCount} Spiele importiert
                    </div>
                `;
                statusDiv.style.display = 'block';
            }
        } else {
            throw new Error(result.error || 'Unbekannter Fehler beim Import');
        }
    } catch (error) {
        console.error('Import error:', error);
        
        // Detailliertere Fehlermeldungen
        let errorMessage = 'Fehler beim Importieren der Turnierdaten';
        if (error.message) {
            errorMessage += `: ${error.message}`;
        }
        
        showNotification(errorMessage, 'error');
        
        // Update status display mit detaillierten Fehlerinformationen
        const statusDiv = document.getElementById('import-status');
        if (statusDiv) {
            statusDiv.innerHTML = `
                <div class="import-status error">
                    <strong>✗ Import fehlgeschlagen!</strong><br>
                    ${error.message || 'Unbekannter Fehler'}
                </div>
            `;
            statusDiv.style.display = 'block';
        }
    } finally {
        showLoading(false);
    }
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
    
    showLoading(true);
    
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
            
            await refreshCurrentTabContent();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Zurücksetzen des Turniers', 'error');
    } finally {
        showLoading(false);
    }
}

// Rules Management
async function loadRulesManagement() {
    const rulesManagement = document.getElementById('rules-management');
    
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
    
    showLoading(true);
    
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
    } finally {
        showLoading(false);
    }
}

async function loadCurrentRules() {
    await loadRulesManagement();
    showNotification('Regeln neu geladen');
}

// Contact Management
async function loadContactData() {
    try {
        const response = await fetch('/api/contact');
        const data = await response.json();
        
        document.getElementById('contact-address').value = data.address || '';
        document.getElementById('contact-nextcloud-group').value = data.nextcloudGroup || '';
        document.getElementById('contact-additional').value = data.additional || '';
    } catch (error) {
        console.error('Fehler beim Laden der Kontaktdaten:', error);
        showNotification('Fehler beim Laden der Kontaktdaten', 'error');
    }
}

async function saveContact() {
    const address = document.getElementById('contact-address').value;
    const nextcloudGroup = document.getElementById('contact-nextcloud-group').value;
    const additional = document.getElementById('contact-additional').value;
    
    showLoading(true);
    
    try {
        const response = await fetch('/api/admin/contact', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                password: adminPassword,
                address: address,
                nextcloudGroup: nextcloudGroup,
                additional: additional
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Kontaktdaten erfolgreich gespeichert!');
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Speichern der Kontaktdaten', 'error');
        console.error('Save contact error:', error);
    } finally {
        showLoading(false);
    }
}

// K.O.-Konfiguration Modal öffnen
async function openKnockoutConfigModal() {
    const generateBtn = document.getElementById('generate-knockout-btn');
    const statusDiv = document.getElementById('knockout-status');
    
    if (!currentTournament) {
        statusDiv.innerHTML = '<span style="color: #dc2626;"><i class="fas fa-exclamation-triangle"></i> Kein aktives Turnier vorhanden</span>';
        return;
    }
    
    // Berechne finale Tabelle um Teamanzahl zu ermitteln
    try {
        const response = await fetch('/api/admin/get-final-table', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                password: adminPassword
            })
        });
        
        const data = await response.json();
        
        if (!data.success) {
            statusDiv.innerHTML = `<span style="color: #dc2626;"><i class="fas fa-exclamation-triangle"></i> ${data.error}</span>`;
            return;
        }
        
        const teamCount = data.finalTable.length;
        console.log('Team count for KO config:', teamCount);
        
        // Erstelle Konfigurations-Modal
        const canQuarterfinals = teamCount >= 8;
        const canThirdPlace = teamCount >= 3;
        const canFifthPlace = teamCount >= 6;
        const canSeventhPlace = teamCount >= 8;
        
        createModal('K.O.-Phase Konfiguration', `
            <div class="knockout-config-form">
                <div class="form-group">
                    <div class="info-banner" style="margin-bottom: 1.5rem;">
                        <i class="fas fa-info-circle" style="color: #3b82f6;"></i>
                        <strong>K.O.-Phase für ${teamCount} Teams konfigurieren</strong>
                        <p>Wähle aus, welche K.O.-Spiele generiert werden sollen. Nur verfügbare Optionen können ausgewählt werden.</p>
                    </div>
                </div>
                
                <div class="form-group">
                    <label class="checkbox-label ${!canQuarterfinals ? 'disabled' : ''}">
                        <input type="checkbox" id="enable-quarterfinals" ${!canQuarterfinals ? 'disabled' : ''} ${canQuarterfinals ? 'checked' : ''}>
                        <span class="checkmark"></span>
                        Viertelfinale (benötigt mindestens 8 Teams)
                        ${!canQuarterfinals ? '<small style="color: #6b7280;"> - Nicht genügend Teams</small>' : ''}
                    </label>
                </div>
                
                <div class="form-group">
                    <label class="checkbox-label ${!canThirdPlace ? 'disabled' : ''}">
                        <input type="checkbox" id="enable-third-place" ${!canThirdPlace ? 'disabled' : ''} ${canThirdPlace ? 'checked' : ''}>
                        <span class="checkmark"></span>
                        Spiel um Platz 3 (benötigt mindestens 3 Teams)
                        ${!canThirdPlace ? '<small style="color: #6b7280;"> - Nicht genügend Teams</small>' : ''}
                    </label>
                </div>
                
                <div class="form-group">
                    <label class="checkbox-label ${!canFifthPlace ? 'disabled' : ''}">
                        <input type="checkbox" id="enable-fifth-place" ${!canFifthPlace ? 'disabled' : ''}>
                        <span class="checkmark"></span>
                        Spiel um Platz 5 (benötigt mindestens 6 Teams)
                        ${!canFifthPlace ? '<small style="color: #6b7280;"> - Nicht genügend Teams</small>' : ''}
                    </label>
                </div>
                
                <div class="form-group">
                    <label class="checkbox-label ${!canSeventhPlace ? 'disabled' : ''}">
                        <input type="checkbox" id="enable-seventh-place" ${!canSeventhPlace ? 'disabled' : ''}>
                        <span class="checkmark"></span>
                        Spiel um Platz 7 (benötigt mindestens 8 Teams)
                        ${!canSeventhPlace ? '<small style="color: #6b7280;"> - Nicht genügend Teams</small>' : ''}
                    </label>
                </div>
                
                <div class="knockout-preview" id="knockout-preview" style="margin-top: 1.5rem; padding: 1rem; background: #f8fafc; border-radius: 0.5rem; border-left: 4px solid #3b82f6;">
                    <h4><i class="fas fa-eye"></i> Vorschau der K.O.-Spiele:</h4>
                    <div id="knockout-preview-content">
                        <!-- Wird dynamisch befüllt -->
                    </div>
                </div>
                
                <div class="modal-actions" style="margin-top: 2rem; display: flex; gap: 1rem;">
                    <button class="btn btn-success" onclick="generateKnockoutWithConfig()">
                        <i class="fas fa-trophy"></i> K.O.-Spiele generieren
                    </button>
                    <button class="btn btn-outline" onclick="this.closest('.modal').remove()">
                        <i class="fas fa-times"></i> Abbrechen
                    </button>
                </div>
            </div>
        `, []);
        
        // Event Listeners für Live-Vorschau
        document.querySelectorAll('#enable-quarterfinals, #enable-third-place, #enable-fifth-place, #enable-seventh-place').forEach(checkbox => {
            checkbox.addEventListener('change', updateKnockoutPreview);
        });
        
        // Initiale Vorschau
        updateKnockoutPreview();
        
    } catch (error) {
        console.error('Fehler beim Laden der finalen Tabelle:', error);
        statusDiv.innerHTML = '<span style="color: #dc2626;"><i class="fas fa-exclamation-triangle"></i> Fehler beim Laden der Teamdaten</span>';
    }
}

// Aktualisiert die Vorschau der K.O.-Spiele
function updateKnockoutPreview() {
    const enableQuarterfinals = document.getElementById('enable-quarterfinals')?.checked || false;
    const enableThirdPlace = document.getElementById('enable-third-place')?.checked || false;
    const enableFifthPlace = document.getElementById('enable-fifth-place')?.checked || false;
    const enableSeventhPlace = document.getElementById('enable-seventh-place')?.checked || false;
    
    const previewContent = document.getElementById('knockout-preview-content');
    if (!previewContent) return;
    
    let matches = [];
    
    if (enableQuarterfinals) {
        matches.push('4 Viertelfinale (1. vs 8., 2. vs 7., 3. vs 6., 4. vs 5.)');
        matches.push('2 Halbfinale (aus Viertelfinale-Siegern)');
    } else {
        matches.push('2 Halbfinale (1. vs 4., 2. vs 3.)');
    }
    
    matches.push('1 Finale');
    
    if (enableThirdPlace) {
        matches.push('1 Spiel um Platz 3');
    }
    
    if (enableFifthPlace) {
        matches.push('1 Spiel um Platz 5');
    }
    
    if (enableSeventhPlace) {
        matches.push('1 Spiel um Platz 7');
    }
    
    const totalMatches = matches.length;
    
    previewContent.innerHTML = `
        <ul style="margin: 0; padding-left: 1.5rem;">
            ${matches.map(match => `<li>${match}</li>`).join('')}
        </ul>
        <div style="margin-top: 1rem; font-weight: bold; color: #3b82f6;">
            Gesamt: ${totalMatches} Spiele werden generiert
        </div>
    `;
}

// K.O.-Spiele mit gewählter Konfiguration generieren
async function generateKnockoutWithConfig() {
    const enableQuarterfinals = document.getElementById('enable-quarterfinals')?.checked || false;
    const enableThirdPlace = document.getElementById('enable-third-place')?.checked || false;
    const enableFifthPlace = document.getElementById('enable-fifth-place')?.checked || false;
    const enableSeventhPlace = document.getElementById('enable-seventh-place')?.checked || false;
    
    const config = {
        enableQuarterfinals,
        enableThirdPlace,
        enableFifthPlace,
        enableSeventhPlace
    };
    
    console.log('Generating KO matches with config:', config);
    
    try {
        const response = await fetch('/api/admin/generate-knockout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                password: adminPassword,
                config: config
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('K.O.-Phase erfolgreich generiert!');
            closeModal('knockout-config-modal');
            
            // Status aktualisieren
            const statusDiv = document.getElementById('knockout-status');
            if (statusDiv) {
                statusDiv.innerHTML = `
                    <span style="color: #16a34a;">
                        <i class="fas fa-check-circle"></i> 
                        K.O.-Spiele erfolgreich generiert! (${data.matchesGenerated} Spiele)
                    </span>
                `;
            }
            
            // Daten neu laden
            await loadInitialData();
            
            // Button deaktivieren
            const generateBtn = document.getElementById('generate-knockout-btn');
            if (generateBtn) {
                generateBtn.innerHTML = '<i class="fas fa-check"></i> K.O.-Spiele generiert';
                generateBtn.disabled = true;
                generateBtn.style.opacity = '0.6';
            }
            
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        console.error('Fehler beim Generieren der K.O.-Spiele:', error);
        showNotification('Fehler beim Generieren der K.O.-Spiele', 'error');
    }
}

// K.O.-Spiele manuell generieren (Legacy-Funktion)
async function generateKnockoutMatches() {
    const generateBtn = document.getElementById('generate-knockout-btn');
    const statusDiv = document.getElementById('knockout-status');
    
    if (!currentTournament) {
        statusDiv.innerHTML = '<span style="color: #dc2626;"><i class="fas fa-exclamation-triangle"></i> Kein aktives Turnier vorhanden</span>';
        return;
    }
    
    generateBtn.disabled = true;
    generateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generiere...';
    statusDiv.innerHTML = '<span style="color: #3b82f6;"><i class="fas fa-clock"></i> K.O.-Spiele werden generiert...</span>';
    
    try {
        const response = await fetch('/api/admin/generate-knockout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                password: adminPassword
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            statusDiv.innerHTML = `
                <span style="color: #16a34a;">
                    <i class="fas fa-check-circle"></i> 
                    K.O.-Spiele erfolgreich generiert! (${data.matchesGenerated} Spiele)
                </span>
            `;
            
            showNotification('K.O.-Phase erfolgreich generiert!');
            
            // Lade Spielplan neu um K.O.-Spiele anzuzeigen
            await loadInitialData(true);
            
            // Deaktiviere Button dauerhaft
            generateBtn.innerHTML = '<i class="fas fa-check"></i> K.O.-Spiele generiert';
            generateBtn.disabled = true;
            generateBtn.style.opacity = '0.6';
            
        } else {
            let debugInfo = '';
            if (data.debug) {
                debugInfo = `<br><small>Debug: Status=${data.debug.tournamentStatus}, Format=${data.debug.format}, Gruppenspiele=${data.debug.groupMatches}, Offen=${data.debug.incompleteMatches}, Gruppen=${data.debug.groups}</small>`;
            }
            
            statusDiv.innerHTML = `
                <span style="color: #dc2626;">
                    <i class="fas fa-exclamation-triangle"></i> 
                    ${data.error}${debugInfo}
                </span>
            `;
            showNotification(data.error, 'error');
            
            generateBtn.disabled = false;
            generateBtn.innerHTML = '<i class="fas fa-trophy"></i> K.O.-Spiele generieren';
        }
    } catch (error) {
        console.error('Fehler beim Generieren der K.O.-Spiele:', error);
        statusDiv.innerHTML = `
            <span style="color: #dc2626;">
                <i class="fas fa-exclamation-triangle"></i> 
                Fehler beim Generieren der K.O.-Spiele
            </span>
        `;
        showNotification('Fehler beim Generieren der K.O.-Spiele', 'error');
        
        generateBtn.disabled = false;
        generateBtn.innerHTML = '<i class="fas fa-trophy"></i> K.O.-Spiele generieren';
    }
}

// Prüfe K.O.-Status beim Laden der Matches-Tab
async function checkKnockoutStatus() {
    const statusDiv = document.getElementById('knockout-status');
    const generateBtn = document.getElementById('generate-knockout-btn');
    
    if (!statusDiv || !generateBtn) return;
    
    try {
        // Prüfe ob bereits K.O.-Spiele existieren
        const existingKoMatches = matches.filter(m => 
            m.phase === 'quarterfinal' || 
            m.phase === 'semifinal' || 
            m.phase === 'final' ||
            m.group?.toLowerCase().includes('finale') ||
            m.group?.toLowerCase().includes('platz')
        );
        
        if (existingKoMatches.length > 0) {
            statusDiv.innerHTML = `
                <span style="color: #16a34a;">
                    <i class="fas fa-check-circle"></i> 
                    K.O.-Spiele bereits vorhanden (${existingKoMatches.length} Spiele)
                </span>
            `;
            generateBtn.innerHTML = '<i class="fas fa-check"></i> K.O.-Spiele bereits generiert';
            generateBtn.disabled = true;
            generateBtn.style.opacity = '0.6';
            return;
        }
        
        // Prüfe Gruppenphase-Status
        if (!currentTournament || currentTournament.status !== 'active') {
            statusDiv.innerHTML = '<span style="color: #6b7280;"><i class="fas fa-info-circle"></i> Turnier muss aktiv sein</span>';
            generateBtn.disabled = true;
            return;
        }
        
        // Prüfe ob Gruppenspiele abgeschlossen sind
        const incompleteGroupMatches = matches.filter(m => 
            m.phase === 'group' && 
            !m.completed && 
            !m.isPenaltyShootout
        );
        
        if (incompleteGroupMatches.length > 0) {
            statusDiv.innerHTML = `
                <span style="color: #f59e0b;">
                    <i class="fas fa-clock"></i> 
                    Noch ${incompleteGroupMatches.length} Gruppenspiele ausstehend
                </span>
            `;
            generateBtn.disabled = true;
        } else {
            statusDiv.innerHTML = `
                <span style="color: #16a34a;">
                    <i class="fas fa-check-circle"></i> 
                    Gruppenphase abgeschlossen - K.O.-Spiele können generiert werden
                </span>
            `;
            generateBtn.disabled = false;
        }
        
    } catch (error) {
        console.error('Fehler beim Prüfen des K.O.-Status:', error);
        statusDiv.innerHTML = '<span style="color: #dc2626;"><i class="fas fa-exclamation-triangle"></i> Fehler beim Status-Check</span>';
    }
}

// Dashboard mit Schiedsrichter-Anzeige
async function loadDashboard() {
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
    
    // Upcoming matches mit verbesserter Schiedsrichter-Anzeige
    await loadUpcomingMatches();
}

// Upcoming matches Funktion
async function loadUpcomingMatches() {
    try {
        const [liveResponse, nextResponse] = await Promise.all([
            fetch('/api/live-match'),
            fetch('/api/next-match')
        ]);
        
        const liveData = await liveResponse.json();
        const nextData = await nextResponse.json();
        
        const upcomingMatches = document.getElementById('upcoming-matches');
        
        // Wenn Live-Match läuft, zeige das
        if (liveData.liveMatch) {
            const liveMatch = liveData.liveMatch;
            upcomingMatches.innerHTML = `
                <div class="live-match-admin">
                    <div class="live-match-header">
                        <h4><i class="fas fa-circle" style="color: #dc2626; animation: pulse 1.5s infinite;"></i> LIVE SPIEL</h4>
                    </div>
                    <div class="live-match-info">
                        <strong>${liveMatch.team1} vs ${liveMatch.team2}</strong>
                        <div class="live-score">${liveMatch.score1} : ${liveMatch.score2}</div>
                        <div class="live-time">${liveMatch.halfInfo}</div>
                        <div class="live-group">${liveMatch.group}</div>
                    </div>
                    <div class="live-actions">
                        <button class="btn btn-small btn-primary" onclick="switchToTab('live')">
                            <i class="fas fa-broadcast-tower"></i> Live verwalten
                        </button>
                    </div>
                </div>
                
                ${nextData.nextMatch && nextData.nextMatch.referee ? `
                    <div class="next-referee-alert-dashboard">
                        <div class="next-referee-header">
                            <i class="fas fa-whistle"></i>
                            <span>Nächster Schiedsrichter bereitmachen:</span>
                        </div>
                        <div class="next-referee-team-big">${nextData.nextMatch.referee.team}</div>
                        <div class="next-referee-details">
                            Für: ${nextData.nextMatch.team1} vs ${nextData.nextMatch.team2}
                        </div>
                        <small style="color: #92400e; margin-top: 0.5rem; display: block;">
                            ${nextData.nextMatch.referee.group} • ${new Date(nextData.nextMatch.datetime).toLocaleTimeString('de-DE', {hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin'})}
                        </small>
                    </div>
                ` : ''}
            `;
        }
        // Wenn kein Live-Match, aber nächstes Spiel geplant
        else if (nextData.nextMatch) {
            const nextMatch = nextData.nextMatch;
            const nextTime = new Date(nextMatch.datetime);
            const timeUntilMatch = nextTime - new Date();
            const minutesUntil = Math.max(0, Math.floor(timeUntilMatch / (1000 * 60)));
            
            upcomingMatches.innerHTML = `
                <div class="next-match-admin">
                    <div class="next-match-time">
                        <strong>${nextTime.toLocaleTimeString('de-DE', {hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin'})}</strong>
                        <span class="countdown" data-next-time="${nextTime.toISOString()}">${minutesUntil > 0 ? `in ${minutesUntil} Min.` : 'Jetzt'}</span>
                    </div>
                    <div class="next-match-info">
                        <strong>${nextMatch.team1} vs ${nextMatch.team2}</strong>
                        <div class="match-details">
                            <span><i class="fas fa-layer-group"></i> ${nextMatch.group}</span>
                        </div>
                    </div>
                    <div class="next-match-actions">
                        <button class="btn btn-small btn-success" onclick="startMatchDialog('${nextMatch.id}')">
                            <i class="fas fa-play"></i> Spiel starten
                        </button>
                    </div>
                </div>
                
                ${nextMatch.referee ? `
                    <div class="next-referee-display-dashboard">
                        <div class="referee-header-dashboard">
                            <i class="fas fa-whistle"></i>
                            <span>SCHIEDSRICHTER</span>
                        </div>
                        <div class="referee-name-dashboard">${nextMatch.referee.team}</div>
                        <div class="referee-group-dashboard">${nextMatch.referee.group}</div>
                    </div>
                ` : ''}
            `;
        } else {
            // Weitere kommende Spiele suchen
            const now = new Date();
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
    
    // Start countdown timer for admin displays
    startAdminCountdownTimer();
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
                <h4>${team.name} ${team.jerseyColor ? `<span class="jersey-color-badge" style="background: ${getJerseyColorHex(team.jerseyColor)}; color: ${team.jerseyColor === 'white' ? '#000' : '#fff'};">${getJerseyColorName(team.jerseyColor)}</span>` : ''}</h4>
                <div class="team-contact">
                    <strong>Kontakt:</strong> ${team.contact.name}<br>
                    <strong>Info:</strong> ${team.contact.info}<br>
                    <small>Angemeldet: ${new Date(team.registeredAt).toLocaleDateString('de-DE')}</small>
                </div>
            </div>
            <div class="team-actions">
                <button class="btn btn-small btn-warning" onclick="editTeam(${team.id})">
                    <i class="fas fa-edit"></i> <span class="btn-text">Bearbeiten</span>
                </button>
                <button class="btn btn-small btn-danger" onclick="deleteTeam(${team.id})">
                    <i class="fas fa-trash"></i> <span class="btn-text">Löschen</span>
                </button>
            </div>
        </div>
    `).join('');
    
    updateTeamCountDisplay();
}

function getJerseyColorName(colorValue) {
    const colors = {
        'red': 'Rot',
        'blue': 'Blau',
        'green': 'Grün',
        'yellow': 'Gelb',
        'orange': 'Orange',
        'purple': 'Lila',
        'white': 'Weiß',
        'black': 'Schwarz',
        'pink': 'Pink',
        'teal': 'Türkis',
        'gray': 'Grau',
        'brown': 'Braun'
    };
    return colors[colorValue] || colorValue;
}

function getJerseyColorHex(colorValue) {
    const colors = {
        'red': '#dc2626',
        'blue': '#2563eb',
        'green': '#16a34a',
        'yellow': '#eab308',
        'orange': '#ea580c',
        'purple': '#9333ea',
        'white': '#ffffff',
        'black': '#000000',
        'pink': '#ec4899',
        'teal': '#0891b2',
        'gray': '#6b7280',
        'brown': '#92400e'
    };
    return colors[colorValue] || '#6b7280';
}

// Edit Team (erweitert mit Trikotfarbe)
async function editTeam(teamId) {
    const team = teams.find(t => t.id === teamId);
    if (!team) return;
    
    // Lade verfügbare Farben
    try {
        const colorResponse = await fetch('/api/jersey-colors');
        const availableColors = await colorResponse.json();
        
        const colorOptions = availableColors.map(color => `
            <option value="${color.value}" ${team.jerseyColor === color.value ? 'selected' : ''}>
                ${color.name} ${color.usage > 0 ? `(${color.usage}x verwendet)` : ''}
            </option>
        `).join('');
        
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
            <div class="form-group">
                <label for="edit-jersey-color">Trikotfarbe:</label>
                <select id="edit-jersey-color" style="width: 100%; padding: 0.5rem; border: 2px solid #ccc; border-radius: 0.5rem;">
                    ${colorOptions}
                </select>
            </div>
        `, [
            { text: 'Team speichern', handler: (modalId) => saveTeamEdit(teamId, modalId) },
            { text: 'Abbrechen', class: 'btn-outline', handler: (modalId) => closeModal(modalId) }
        ]);
    } catch (error) {
        console.error('Error loading jersey colors:', error);
        showNotification('Fehler beim Laden der Trikotfarben', 'error');
    }
}

async function saveTeamEdit(teamId, modalId) {
    const teamName = document.getElementById('edit-team-name').value;
    const contactName = document.getElementById('edit-contact-name').value;
    const contactInfo = document.getElementById('edit-contact-info').value;
    const jerseyColor = document.getElementById('edit-jersey-color').value;
    
    if (!teamName || !contactName || !contactInfo || !jerseyColor) {
        showNotification('Alle Felder sind erforderlich', 'error');
        return;
    }
    
    showLoading(true);
    
    try {
        const response = await fetch(`/api/admin/teams/${teamId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                password: adminPassword,
                teamName,
                contactName,
                contactInfo,
                jerseyColor
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Team erfolgreich bearbeitet');
            closeModal(modalId);
            await refreshCurrentTabContent();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Bearbeiten des Teams', 'error');
    } finally {
        showLoading(false);
    }
}

// Delete Team
async function deleteTeam(teamId) {
    const team = teams.find(t => t.id === teamId);
    if (!team) return;
    
    if (!confirm(`Team "${team.name}" wirklich löschen?\n\nDas Team wird aus allen Spielen entfernt!`)) {
        return;
    }
    
    showLoading(true);
    
    try {
        const response = await fetch(`/api/admin/teams/${teamId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: adminPassword })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification(data.message);
            await refreshCurrentTabContent();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Löschen des Teams', 'error');
    } finally {
        showLoading(false);
    }
}

// Spielplan verwalten
async function loadMatches() {
    const matchesAdmin = document.getElementById('matches-schedule-admin');
    
    if (!currentTournament) {
        matchesAdmin.innerHTML = '<p>Kein Turnier vorhanden. Erstelle zuerst ein Turnier.</p>';
        return;
    }
    
    // Always refresh matches data to include latest KO matches
    try {
        const response = await fetch('/api/matches');
        const latestMatches = await response.json();
        if (latestMatches) {
            matches = latestMatches;
            console.log('Spielstand-Daten aktualisiert, Gesamtspiele:', matches.length);
        }
    } catch (error) {
        console.error('Fehler beim Laden der aktuellen Spiele:', error);
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
        <div class="matches-controls">
            <button class="btn btn-primary" onclick="addNewMatch()">
                <i class="fas fa-plus"></i> Neues Spiel hinzufügen
            </button>
    `;
    
    // Add bulk scheduling button für ungeplante Spiele
    if (unscheduledMatches.length > 0) {
        html += `
            <button class="btn btn-warning" onclick="scheduleAllMatches()">
                <i class="fas fa-brain"></i> Alle ${unscheduledMatches.length} Spiele planen
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
                        <strong>${matchTime.toLocaleTimeString('de-DE', {hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin'})}</strong>
                    </div>
                    
                    <div class="match-info-admin">
                        <div class="match-teams-admin">
                            <span class="team-name">${match.team1}</span>
                            <span class="vs">vs</span>
                            <span class="team-name">${match.team2}</span>
                        </div>
                        
                        <div class="match-details-admin">
                            <span class="match-group">${match.group} ${match.isPenaltyShootout ? '(Elfmeterschießen)' : ''}</span>
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
                            `<strong class="final-score">${match.score1}:${match.score2}${match.isPenaltyShootout ? ' (E)' : ''}</strong>` : 
                            match.liveScore?.isLive ? 
                                `<strong class="live-indicator">LIVE ${match.liveScore.score1}:${match.liveScore.score2}</strong>` :
                                '<span class="pending">Ausstehend</span>'
                        }
                    </div>
                    
                    <div class="match-actions">
                        <button class="btn btn-small" onclick="editMatch('${match.id}')">
                            <i class="fas fa-edit"></i> <span class="btn-text">Bearbeiten</span>
                        </button>
                        ${match.completed ? `
                            <button class="btn btn-small btn-warning" onclick="editResult('${match.id}')">
                                <i class="fas fa-edit"></i> <span class="btn-text">Ergebnis korrigieren</span>
                            </button>
                        ` : ''}
                        <button class="btn btn-small" onclick="scheduleMatch('${match.id}')">
                            <i class="fas fa-clock"></i> <span class="btn-text">Uhrzeit ändern</span>
                        </button>
                        ${!match.completed && !match.liveScore?.isLive ? `
                            <button class="btn btn-small btn-success" onclick="startMatchDialog('${match.id}')">
                                <i class="fas fa-play"></i> <span class="btn-text">Spiel starten</span>
                            </button>
                        ` : ''}
                        <button class="btn btn-small btn-danger" onclick="deleteMatch('${match.id}')">
                            <i class="fas fa-trash"></i> <span class="btn-text">Löschen</span>
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
                                    `<strong>${match.score1}:${match.score2}${match.isPenaltyShootout ? ' (E)' : ''}</strong>` : 
                                    'Noch nicht geplant'
                                }
                            </div>
                        </div>
                        <div class="match-actions">
                            <button class="btn btn-small" onclick="editMatch('${match.id}')">
                                <i class="fas fa-edit"></i> <span class="btn-text">Bearbeiten</span>
                            </button>
                            ${match.completed ? `
                                <button class="btn btn-small btn-warning" onclick="editResult('${match.id}')">
                                    <i class="fas fa-edit"></i> <span class="btn-text">Ergebnis korrigieren</span>
                                </button>
                            ` : ''}
                            <button class="btn btn-small" onclick="scheduleMatch('${match.id}')">
                                <i class="fas fa-calendar"></i> <span class="btn-text">Zeit planen</span>
                            </button>
                            ${!match.completed && !match.liveScore?.isLive ? `
                                <button class="btn btn-small btn-success" onclick="startMatchDialog('${match.id}')">
                                    <i class="fas fa-play"></i> <span class="btn-text">Spiel starten</span>
                                </button>
                            ` : ''}
                            <button class="btn btn-small btn-danger" onclick="deleteMatch('${match.id}')">
                                <i class="fas fa-trash"></i> <span class="btn-text">Löschen</span>
                            </button>
                        </div>
                    </div>
                `;
            });
        });
    }
    
    matchesAdmin.innerHTML = html;
    
    // Prüfe K.O.-Status nach dem Laden der Matches
    setTimeout(checkKnockoutStatus, 100);
}

// Ergebnis korrigieren/bearbeiten 
async function editResult(matchId) {
    const match = matches.find(m => m.id === matchId);
    if (!match) return;
    
    createModal('Ergebnis korrigieren', `
        <div class="form-group">
            <h4>${match.team1} vs ${match.team2}</h4>
            <p><small>${match.group || 'Kein Gruppe'} ${match.isPenaltyShootout ? '(Elfmeterschießen)' : ''}</small></p>
        </div>
        <div class="score-inputs" style="justify-content: center; margin: 2rem 0; display: flex; align-items: center; gap: 1rem;">
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
    
    showLoading(true);
    
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
            showNotification('Ergebnis erfolgreich korrigiert');
            closeModal(modalId);
            await refreshCurrentTabContent();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Bearbeiten des Ergebnisses', 'error');
    } finally {
        showLoading(false);
    }
}

// Add New Match (erweitert)
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
                <option value="penalty">Elfmeterschießen</option>
            </select>
        </div>
        <div class="form-group">
            <label>
                <input type="checkbox" id="new-match-penalty"> Elfmeterschießen
            </label>
        </div>
        <div class="form-group">
            <label for="new-match-datetime">Datum/Zeit (optional):</label>
            <input type="datetime-local" id="new-match-datetime" style="width: 100%; padding: 0.5rem; border: 2px solid #ccc; border-radius: 0.5rem;">
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
    const isPenalty = document.getElementById('new-match-penalty').checked;
    const datetime = document.getElementById('new-match-datetime').value;
    
    if (!team1 || !team2) {
        showNotification('Beide Teams müssen ausgewählt werden', 'error');
        return;
    }
    
    if (team1 === team2) {
        showNotification('Teams müssen unterschiedlich sein', 'error');
        return;
    }
    
    showLoading(true);
    
    try {
        const requestData = {
            password: adminPassword,
            team1,
            team2,
            group,
            phase: isPenalty ? 'penalty' : phase,
            datetime: datetime || null
        };
        
        const response = await fetch('/api/admin/matches', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestData)
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Spiel erfolgreich hinzugefügt');
            closeModal(modalId);
            await refreshCurrentTabContent();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Hinzufügen des Spiels', 'error');
    } finally {
        showLoading(false);
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
    
    const scheduledTime = match.scheduled && match.scheduled.datetime ? isoToDateTimeLocal(match.scheduled.datetime) : '';
    
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
            <label>
                <input type="checkbox" id="edit-match-penalty" ${match.isPenaltyShootout ? 'checked' : ''}> Elfmeterschießen
            </label>
        </div>
        <div class="form-group">
            <label for="edit-match-datetime">Datum/Zeit:</label>
            <input type="datetime-local" id="edit-match-datetime" value="${scheduledTime}" style="width: 100%; padding: 0.5rem; border: 2px solid #ccc; border-radius: 0.5rem;">
        </div>
    `;
    
    createModal('Spiel bearbeiten', content, [
        { text: 'Spiel speichern', handler: (modalId) => saveMatchEdit(matchId, modalId) },
        { text: 'Abbrechen', class: 'btn-outline', handler: (modalId) => closeModal(modalId) }
    ]);
}

async function saveMatchEdit(matchId, modalId) {
    const team1 = document.getElementById('edit-match-team1').value;
    const team2 = document.getElementById('edit-match-team2').value;
    const group = document.getElementById('edit-match-group').value;
    const isPenalty = document.getElementById('edit-match-penalty').checked;
    const datetime = document.getElementById('edit-match-datetime').value;
    
    if (!team1 || !team2) {
        showNotification('Beide Teams müssen ausgewählt werden', 'error');
        return;
    }
    
    if (team1 === team2) {
        showNotification('Teams müssen unterschiedlich sein', 'error');
        return;
    }
    
    showLoading(true);
    
    try {
        const response = await fetch(`/api/admin/matches/${matchId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                password: adminPassword,
                team1,
                team2,
                group,
                isPenaltyShootout: isPenalty,
                datetime: datetime || null
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Spiel erfolgreich bearbeitet');
            closeModal(modalId);
            await refreshCurrentTabContent();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Bearbeiten des Spiels', 'error');
    } finally {
        showLoading(false);
    }
}

// Delete Match
async function deleteMatch(matchId) {
    const match = matches.find(m => m.id === matchId);
    if (!match) return;
    
    if (!confirm(`Spiel "${match.team1} vs ${match.team2}" wirklich löschen?`)) {
        return;
    }
    
    showLoading(true);
    
    try {
        const response = await fetch(`/api/admin/matches/${matchId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: adminPassword })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Spiel erfolgreich gelöscht');
            await refreshCurrentTabContent();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Löschen des Spiels', 'error');
    } finally {
        showLoading(false);
    }
}

// Schedule Match
async function scheduleMatch(matchId) {
    const match = matches.find(m => m.id === matchId);
    if (!match) return;
    
    let scheduledTime = '';
    let scheduledDate = '';
    if (match.scheduled && match.scheduled.datetime) {
        const date = new Date(match.scheduled.datetime);
        // Use isoToDateTimeLocal to get the correct local time
        const localDateTime = isoToDateTimeLocal(match.scheduled.datetime);
        if (localDateTime) {
            const [_, timePart] = localDateTime.split('T');
            scheduledTime = timePart;
        }
        scheduledDate = date.toLocaleDateString('de-DE', {day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin'});
    }
    
    createModal('Spielzeit ändern', `
        <div class="form-group">
            <h4>${match.team1} vs ${match.team2}</h4>
            <p><small>${match.group || 'Keine Gruppe'}</small></p>
            ${scheduledDate ? `<p><small>Datum: ${scheduledDate}</small></p>` : ''}
        </div>
        <div class="form-group">
            <label for="schedule-time">Uhrzeit:</label>
            <input type="time" id="schedule-time" value="${scheduledTime}" style="width: 100%; padding: 0.5rem; border: 2px solid #ccc; border-radius: 0.5rem;">
        </div>
    `, [
        { text: 'Speichern', handler: (modalId) => saveMatchSchedule(matchId, modalId) },
        { text: 'Zeit entfernen', class: 'btn-warning', handler: (modalId) => removeMatchSchedule(matchId, modalId) },
        { text: 'Abbrechen', class: 'btn-outline', handler: (modalId) => closeModal(modalId) }
    ]);
}

async function saveMatchSchedule(matchId, modalId) {
    const time = document.getElementById('schedule-time').value;
    
    console.log('saveMatchSchedule - Eingabe Zeit:', time);
    
    if (!time) {
        showNotification('Uhrzeit ist erforderlich', 'error');
        return;
    }
    
    const match = matches.find(m => m.id === matchId);
    if (!match) return;
    
    // Behalte das existierende Datum oder verwende heute
    let datetime;
    if (match.scheduled && match.scheduled.datetime) {
        // Behalte das existierende Datum, ändere nur die Uhrzeit
        const existingDate = new Date(match.scheduled.datetime);
        const dateStr = existingDate.toLocaleDateString('en-CA'); // YYYY-MM-DD format
        datetime = dateTimeLocalToISO(`${dateStr}T${time}`);
    } else {
        // Neues Spiel: verwende heutiges Datum mit der angegebenen Uhrzeit
        const today = new Date();
        const dateStr = today.toLocaleDateString('en-CA'); // YYYY-MM-DD format
        datetime = dateTimeLocalToISO(`${dateStr}T${time}`);
    }
    
    console.log('saveMatchSchedule - Konvertierte Zeit:', datetime);
    
    showLoading(true);
    
    try {
        const response = await fetch(`/api/admin/matches/${matchId}/schedule`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                password: adminPassword,
                datetime
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Spielzeit erfolgreich geändert');
            closeModal(modalId);
            await refreshCurrentTabContent();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Ändern der Spielzeit', 'error');
    } finally {
        showLoading(false);
    }
}

async function removeMatchSchedule(matchId, modalId) {
    showLoading(true);
    
    try {
        const response = await fetch(`/api/admin/matches/${matchId}/schedule`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: adminPassword })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Zeitplanung entfernt');
            closeModal(modalId);
            await refreshCurrentTabContent();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Entfernen der Zeitplanung', 'error');
    } finally {
        showLoading(false);
    }
}

// Schedule All Matches (Intelligent)
async function scheduleAllMatches() {
    // Refresh matches data first to get latest KO matches
    try {
        const response = await fetch('/api/matches');
        const latestMatches = await response.json();
        if (latestMatches) {
            matches = latestMatches;
        }
    } catch (error) {
        console.error('Fehler beim Aktualisieren der Spiele:', error);
    }
    
    const unscheduledMatches = matches.filter(m => !m.scheduled);
    const unscheduledCount = unscheduledMatches.length;
    
    console.log('Alle Spiele:', matches.length);
    console.log('Ungeplante Spiele gefunden:', unscheduledMatches);
    console.log('Anzahl ungeplanter Spiele:', unscheduledCount);
    
    if (unscheduledCount === 0) {
        showNotification('Keine ungeplanten Spiele vorhanden', 'warning');
        return;
    }
    
    createModal('Spielplan automatisch erstellen', `
        <div class="form-group">
            <p>Es werden <strong>${unscheduledCount} ungeplante Spiele</strong> automatisch geplant.</p>
            <p>Das System berücksichtigt Pausen zwischen den Spielen für jedes Team.</p>
        </div>
        <div class="form-group">
            <label for="schedule-start-time">Startzeit erstes Spiel:</label>
            <input type="time" id="schedule-start-time" value="10:00" style="width: 100%; padding: 0.5rem; border: 2px solid #ccc; border-radius: 0.5rem;">
        </div>
        <div class="form-group">
            <label for="schedule-halftime-duration">Dauer einer Halbzeit (Minuten):</label>
            <input type="number" id="schedule-halftime-duration" value="10" min="1" max="99" style="width: 100%; padding: 0.5rem; border: 2px solid #ccc; border-radius: 0.5rem;">
        </div>
        <div class="form-group">
            <label for="schedule-halftime-break">Halbzeitpause (Minuten):</label>
            <input type="number" id="schedule-halftime-break" value="1" min="1" max="10" style="width: 100%; padding: 0.5rem; border: 2px solid #ccc; border-radius: 0.5rem;">
        </div>
        <div class="form-group">
            <label for="schedule-break-duration">Pause zwischen Spielen (Minuten):</label>
            <input type="number" id="schedule-break-duration" value="5" min="0" max="30" style="width: 100%; padding: 0.5rem; border: 2px solid #ccc; border-radius: 0.5rem;">
        </div>
    `, [
        { text: 'Spielplan erstellen', handler: (modalId) => executeScheduleAllMatches(modalId) },
        { text: 'Abbrechen', class: 'btn-outline', handler: (modalId) => closeModal(modalId) }
    ]);
}

async function executeScheduleAllMatches(modalId) {
    const startTime = document.getElementById('schedule-start-time').value;
    const halftimeDuration = parseInt(document.getElementById('schedule-halftime-duration').value);
    const halftimeBreak = parseInt(document.getElementById('schedule-halftime-break').value);
    const breakDuration = parseInt(document.getElementById('schedule-break-duration').value);
    
    console.log('Eingabe Startzeit:', startTime);
    
    if (!startTime) {
        showNotification('Startzeit ist erforderlich', 'error');
        return;
    }
    
    if (isNaN(halftimeDuration) || halftimeDuration < 1 || halftimeDuration > 99) {
        showNotification('Ungültige Halbzeitdauer (1-99 Minuten)', 'error');
        return;
    }
    
    if (isNaN(halftimeBreak) || halftimeBreak < 1 || halftimeBreak > 10) {
        showNotification('Ungültige Halbzeitpause (1-10 Minuten)', 'error');
        return;
    }
    
    if (isNaN(breakDuration) || breakDuration < 0 || breakDuration > 30) {
        showNotification('Ungültige Pausendauer (0-30 Minuten)', 'error');
        return;
    }
    
    showLoading(true);
    closeModal(modalId);
    
    try {
        // Berechne Gesamtspieldauer: 2 Halbzeiten + Halbzeitpause
        const matchDuration = (halftimeDuration * 2) + halftimeBreak;
        
        const response = await fetch('/api/admin/matches/schedule-all', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                password: adminPassword,
                startTime: startTime,
                matchDuration: matchDuration,
                halftimeDuration: halftimeDuration,
                halftimeBreak: halftimeBreak,
                breakDuration: breakDuration
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            console.log('Spielplan erfolgreich erstellt:', data);
            showNotification(data.message);
            await refreshCurrentTabContent();
            
            // Debug: Check first few scheduled matches
            setTimeout(() => {
                const scheduledMatches = matches.filter(m => m.scheduled).slice(0, 3);
                console.log('Erste geplante Spiele nach Erstellung:');
                scheduledMatches.forEach(match => {
                    console.log(`${match.team1} vs ${match.team2}:`, {
                        iso: match.scheduled.datetime,
                        formatted: formatDateTime(match.scheduled.datetime),
                        local: new Date(match.scheduled.datetime).toLocaleTimeString('de-DE')
                    });
                });
            }, 1000);
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Planen aller Spiele', 'error');
    } finally {
        showLoading(false);
    }
}

// VERBESSERTES Start Match Dialog - mit freier Halbzeitlängeneingabe (Standard 5 Min)
async function startMatchDialog(matchId) {
    const match = matches.find(m => m.id === matchId);
    if (!match) return;
    
    // Get values from scheduled match, tournament settings, or defaults
    const halfTimeMinutes = match.scheduled?.halftimeDuration || currentTournament.settings.halfTimeMinutes || 5;
    const halftimeBreakMinutes = match.scheduled?.halftimeBreak || currentTournament.settings.halftimeBreakMinutes || 1;
    
    createModal('Spiel starten', `
        <div class="start-match-info">
            <h4>${match.team1} vs ${match.team2}</h4>
            <p><strong>Gruppe:</strong> ${match.group}</p>
            ${match.scheduled ? `
                <p><strong>Geplante Zeit:</strong> ${formatDateTime(match.scheduled.datetime)}</p>
            ` : ''}
            ${match.referee ? `
                <p><strong>Schiedsrichter:</strong> ${match.referee.team} (${match.referee.group})</p>
            ` : ''}
        </div>
        
        <div class="start-match-options">
            <div class="form-group">
                <label for="half-time-duration">Halbzeit-Dauer (Minuten):</label>
                <input type="number" id="half-time-duration" value="${halfTimeMinutes}" min="1" max="99" 
                       style="width: 100%; padding: 0.5rem; border: 2px solid #ccc; border-radius: 0.5rem; text-align: center; font-size: 1.125rem;">
                <small style="color: #666; margin-top: 0.5rem; display: block;">
                    ${match.scheduled ? `Geplant: ${halfTimeMinutes} Minuten pro Halbzeit` : `Standard: ${halfTimeMinutes} Minuten pro Halbzeit (aus Turnier-Einstellungen)`}. Du kannst jeden Wert zwischen 1-99 Minuten eingeben.
                </small>
            </div>
            <div class="form-group">
                <label for="halftime-break-duration">Halbzeitpause (Minuten):</label>
                <input type="number" id="halftime-break-duration" value="${halftimeBreakMinutes}" min="1" max="10" 
                       style="width: 100%; padding: 0.5rem; border: 2px solid #ccc; border-radius: 0.5rem; text-align: center; font-size: 1.125rem;">
                <small style="color: #666; margin-top: 0.5rem; display: block;">
                    ${match.scheduled ? `Geplant: ${halftimeBreakMinutes} Minuten Halbzeitpause` : `Standard: ${halftimeBreakMinutes} Minuten Halbzeitpause (aus Turnier-Einstellungen)`}.
                </small>
            </div>
        </div>
        
        <div class="warning-box" style="background: #fef3c7; border: 1px solid #f59e0b; padding: 1rem; border-radius: 0.5rem; margin-top: 1rem;">
            <i class="fas fa-info-circle" style="color: #f59e0b;"></i>
            <strong>Hinweis:</strong> Nach dem Start wird das Spiel sofort live übertragen und der Timer läuft. Das System wechselt automatisch zur Live-Verwaltung.
        </div>
    `, [
        { text: 'Spiel jetzt starten', class: 'btn-success', handler: (modalId) => executeStartMatch(matchId, modalId) },
        { text: 'Abbrechen', class: 'btn-outline', handler: (modalId) => closeModal(modalId) }
    ]);
}

async function executeStartMatch(matchId, modalId, retryCount = 0) {
    const halfTimeDuration = parseInt(document.getElementById('half-time-duration').value);
    const halftimeBreakDuration = parseInt(document.getElementById('halftime-break-duration').value);
    
    if (isNaN(halfTimeDuration) || halfTimeDuration < 1 || halfTimeDuration > 99) {
        showNotification('Bitte eine gültige Halbzeitdauer zwischen 1-99 Minuten eingeben', 'error');
        return;
    }
    
    if (isNaN(halftimeBreakDuration) || halftimeBreakDuration < 1 || halftimeBreakDuration > 10) {
        showNotification('Bitte eine gültige Halbzeitpause zwischen 1-10 Minuten eingeben', 'error');
        return;
    }
    
    if (retryCount >= 3) {
        showNotification('Maximale Anzahl von Wiederholungsversuchen erreicht', 'error');
        return;
    }
    
    showLoading(true);
    
    try {
        // Check if WebSocket is connected before making API call
        if (!isConnected) {
            console.warn('WebSocket not connected, starting match anyway...');
        }
        
        const response = await fetch('/api/admin/start-match', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                password: adminPassword,
                matchId: matchId,
                halfTimeMinutes: halfTimeDuration,
                halftimeBreakMinutes: halftimeBreakDuration
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Spiel erfolgreich gestartet! Live-Timer läuft...');
            closeModal(modalId);
            
            // Set flag to prevent race condition with WebSocket events
            window.isStartingMatch = true;
            
            // AUTO-SWITCH TO LIVE TAB
            switchToTab('live');
            
            // Wait for potential WebSocket events to arrive before manual refresh
            setTimeout(async () => {
                window.isStartingMatch = false;
                // Force a fresh load of live control after match start
                if (currentActiveTab === 'live') {
                    await loadLiveControl();
                }
            }, 1500); // Wait 1.5 seconds for server sync and WebSocket events
        } else {
            showNotification(data.error || 'Unbekannter Fehler beim Starten', 'error');
        }
    } catch (error) {
        console.error('Error starting match:', error);
        
        // Check if this is a network error that might have succeeded on server
        if (error.name === 'TypeError' && (error.message.includes('Failed to fetch') || error.message === 'Load failed')) {
            console.log('Network error during match start - checking if match was actually started via WebSocket events');
            showNotification('Netzwerkunterbrechung - prüfe ob Spiel gestartet wurde...', 'warning');
            
            // Wait for potential WebSocket events to confirm if match started
            setTimeout(() => {
                // Check if we received a match-started event in the meantime
                if (window.lastMatchStartedEvent && Date.now() - window.lastMatchStartedEvent < 5000) {
                    console.log('Match was actually started successfully (confirmed via WebSocket)');
                    showNotification('Spiel erfolgreich gestartet! (Netzwerkunterbrechung ignoriert)', 'success');
                    closeModal(modalId);
                    switchToTab('live');
                } else {
                    // Offer retry option
                    const retryMessage = 'Netzwerkfehler beim Starten. Möchten Sie es erneut versuchen?';
                    if (confirm(retryMessage)) {
                        console.log(`Retrying match start after network error (attempt ${retryCount + 1})`);
                        // Retry the match start with incremented counter
                        executeStartMatch(matchId, modalId, retryCount + 1);
                    } else {
                        showNotification('Spiel-Start abgebrochen', 'error');
                    }
                }
            }, 2000);
        } else {
            showNotification(`Fehler beim Starten des Spiels: ${error.message}`, 'error');
        }
    } finally {
        showLoading(false);
        window.isStartingMatch = false;
    }
}

// VERBESSERTE LIVE CONTROL FUNCTION mit besserem Design
async function loadLiveControl() {
    const liveControl = document.getElementById('live-match-control');
    
    // Show loading state
    liveControl.innerHTML = `
        <div class="loading-state-improved">
            <div class="loading-spinner">
                <i class="fas fa-spinner fa-spin"></i>
            </div>
            <h3>Live-Control wird geladen...</h3>
            <p>Lade aktuelle Spieldaten...</p>
        </div>
    `;
    
    try {
        // Load current live match and next match data with better error handling
        const [liveResult, nextResult] = await Promise.allSettled([
            fetch('/api/live-match').then(async r => {
                if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
                return r.json();
            }),
            fetch('/api/next-match').then(async r => {
                if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
                return r.json();
            })
        ]);
        
        const liveData = liveResult.status === 'fulfilled' ? liveResult.value : { liveMatch: null };
        const nextData = nextResult.status === 'fulfilled' ? nextResult.value : { nextMatch: null };
        
        // Log any failures but continue with partial data
        if (liveResult.status === 'rejected') {
            console.error('Failed to load live match:', liveResult.reason);
        }
        if (nextResult.status === 'rejected') {
            console.error('Failed to load next match:', nextResult.reason);
        }
        
        // If both API calls failed, show connection error instead of "tournament complete"
        if (liveResult.status === 'rejected' && nextResult.status === 'rejected') {
            throw new Error('Both live and next match API calls failed');
        }
        
        let html = '';
        
        if (liveData.liveMatch) {
            // Live match is running
            const liveMatch = liveData.liveMatch;
            
            // Debug logging for halftime state
            console.log('Live match state:', {
                id: liveMatch.id,
                currentHalf: liveMatch.currentHalf,
                halfTimeBreak: liveMatch.halfTimeBreak,
                isPaused: liveMatch.isPaused,
                team1: liveMatch.team1,
                team2: liveMatch.team2
            });
            
            // Debug button visibility conditions
            console.log('Live match detailed status:', {
                currentHalf: liveMatch.currentHalf,
                halfTimeBreak: liveMatch.halfTimeBreak,
                isPaused: liveMatch.isPaused,
                startTime: liveMatch.startTime,
                firstHalfEndTime: liveMatch.firstHalfEndTime,
                secondHalfStartTime: liveMatch.secondHalfStartTime
            });
            console.log('Button visibility conditions:', {
                halftimeButton: liveMatch.currentHalf === 1 && !liveMatch.halfTimeBreak,
                secondHalfButton: liveMatch.halfTimeBreak,
                endMatchButton: liveMatch.currentHalf === 2 && !liveMatch.halfTimeBreak,
                pauseResumeButton: liveMatch.isPaused ? 'resume' : 'pause'
            });
            
            html += `
                <div class="live-control-panel-improved">
                    <!-- Live Status Header -->
                    <div class="live-status-header">
                        <div class="live-indicator-big">
                            <i class="fas fa-broadcast-tower live-pulse"></i>
                            <span>LIVE SPIEL LÄUFT</span>
                        </div>
                        <div class="live-timer-container">
                            <div class="live-timer-display" id="admin-live-timer">
                                ${calculateLiveTime(liveMatch).displayTime}
                            </div>
                            <div class="live-half-display" id="admin-live-half">
                                ${calculateLiveTime(liveMatch).halfInfo}
                            </div>
                        </div>
                    </div>
                    
                    <!-- Match Info Card -->
                    <div class="live-match-card">
                        <div class="match-teams-header">
                            <h3>${liveMatch.team1} <span class="vs-separator">vs</span> ${liveMatch.team2}</h3>
                            <div class="match-group-info">${liveMatch.group}</div>
                        </div>
                        
                        <!-- Score Management -->
                        <div class="live-score-section">
                            <div class="score-display-grid">
                                <div class="team-score-box">
                                    <label>${liveMatch.team1}</label>
                                    <input type="number" min="0" id="live-score1" value="${liveMatch.score1}" class="score-input-live">
                                </div>
                                <div class="score-separator-live">:</div>
                                <div class="team-score-box">
                                    <label>${liveMatch.team2}</label>
                                    <input type="number" min="0" id="live-score2" value="${liveMatch.score2}" class="score-input-live">
                                </div>
                            </div>
                            <button class="btn btn-primary update-score-btn" onclick="updateLiveScore('${liveMatch.id}')">
                                <i class="fas fa-sync"></i> Score aktualisieren
                            </button>
                        </div>
                        
                        <!-- Match Details -->
                        <div class="live-match-details">
                            <div class="detail-item">
                                <span class="detail-label">Halbzeit-Dauer:</span>
                                <span class="detail-value">${liveMatch.halfTimeMinutes || 5} Minuten</span>
                            </div>
                            ${liveMatch.referee ? `
                                <div class="detail-item">
                                    <span class="detail-label">Schiedsrichter:</span>
                                    <span class="detail-value">${liveMatch.referee.team}</span>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                    
                    <!-- Control Buttons -->
                    <div class="live-control-buttons">
                        <div class="primary-controls">
                            ${liveMatch.isPaused ? `
                                <button class="btn btn-success btn-large" onclick="resumeMatch('${liveMatch.id}')">
                                    <i class="fas fa-play"></i> Spiel fortsetzen
                                </button>
                            ` : `
                                <button class="btn btn-warning btn-large" onclick="pauseMatch('${liveMatch.id}')">
                                    <i class="fas fa-pause"></i> Spiel pausieren
                                </button>
                            `}
                            
                            ${(() => {
                                // Prüfe ob erste Halbzeit abgelaufen ist
                                const timeInfo = calculateLiveTime(liveMatch);
                                const isFirstHalfExpired = liveMatch.currentHalf === 1 && 
                                                          timeInfo.currentMinute >= (liveMatch.halfTimeMinutes || 45);
                                
                                if (liveMatch.currentHalf === 1 && !liveMatch.halfTimeBreak && !isFirstHalfExpired) {
                                    return `<button class="btn btn-info btn-large" onclick="startHalfTime('${liveMatch.id}')">
                                        <i class="fas fa-clock"></i> Halbzeit einläuten
                                    </button>`;
                                } else if ((liveMatch.halfTimeBreak || isFirstHalfExpired) && !liveMatch.extensionStarted) {
                                    return `<button class="btn btn-success btn-large" onclick="startSecondHalf('${liveMatch.id}')">
                                        <i class="fas fa-play"></i> 2. Halbzeit starten
                                    </button>`;
                                }
                                return '';
                            })()}
                            
                            ${liveMatch.currentHalf === 2 && !liveMatch.halfTimeBreak && !liveMatch.extensionStarted ? `
                                <button class="btn btn-primary btn-large" onclick="endMatch('${liveMatch.id}')">
                                    <i class="fas fa-flag-checkered"></i> ${isKnockoutMatch(liveMatch) ? '2. Halbzeit beenden' : 'Spiel beenden'}
                                </button>
                            ` : ''}
                            
                            ${liveMatch.extensionStarted ? `
                                <div class="extension-controls">
                                    <h4>Verlängerung</h4>
                                    ${liveMatch.extensionMainBreak ? `
                                        <button class="btn btn-success btn-large" onclick="startExtensionFirstHalf('${liveMatch.id}')">
                                            <i class="fas fa-play"></i> 1. Verlängerung starten
                                        </button>
                                    ` : ''}
                                    ${liveMatch.currentHalf === 3 && liveMatch.halfTimeBreak ? `
                                        <button class="btn btn-success btn-large" onclick="startExtensionSecondHalf('${liveMatch.id}')">
                                            <i class="fas fa-play"></i> 2. Verlängerung starten
                                        </button>
                                    ` : ''}
                                    ${liveMatch.currentHalf === 4 && !liveMatch.halfTimeBreak ? `
                                        <button class="btn btn-primary btn-large" onclick="endMatch('${liveMatch.id}')">
                                            <i class="fas fa-flag-checkered"></i> Spiel beenden
                                        </button>
                                    ` : ''}
                                    ${liveMatch.currentHalf === 3 && !liveMatch.halfTimeBreak ? `
                                        <button class="btn btn-info btn-large" onclick="startExtensionHalfTime('${liveMatch.id}')">
                                            <i class="fas fa-clock"></i> Verlängerung Halbzeit
                                        </button>
                                    ` : ''}
                                </div>
                            ` : ''}
                        </div>
                        
                        <div class="emergency-controls">
                            <button class="btn btn-danger btn-large" onclick="stopMatch('${liveMatch.id}')">
                                <i class="fas fa-stop"></i> Spiel abbrechen (Notfall)
                            </button>
                        </div>
                    </div>
                </div>
            `;
            
            // Nächstes Spiel Anzeige während Live-Spiel (immer anzeigen wenn verfügbar)
            if (nextData.nextMatch) {
                const nextMatch = nextData.nextMatch;
                const nextTime = new Date(nextMatch.datetime);
                const timeUntilMatch = nextTime - new Date();
                const minutesUntil = Math.max(0, Math.floor(timeUntilMatch / (1000 * 60)));
                
                html += `
                    <div class="next-match-ready-section">
                        <div class="next-match-header-live">
                            <i class="fas fa-forward"></i>
                            <h4>Nächstes Spiel bereit</h4>
                        </div>
                        <div class="next-match-card-live">
                            <div class="next-match-teams-live">
                                ${nextMatch.team1} <span class="vs-live">vs</span> ${nextMatch.team2}
                            </div>
                            <div class="next-match-details-live">
                                <div class="detail-row">
                                    <i class="fas fa-layer-group"></i> 
                                    <span>${nextMatch.group}</span>
                                </div>
                                <div class="detail-row">
                                    <i class="fas fa-clock"></i> 
                                    <span>${nextTime.toLocaleTimeString('de-DE', {hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin'})}</span>
                                    ${minutesUntil > 0 ? `<span class="time-until countdown-badge" data-next-time="${nextTime.toISOString()}">(in ${minutesUntil} Min.)</span>` : '<span class="time-until ready countdown-badge">Startbereit!</span>'}
                                </div>
                            </div>
                            
                            ${nextMatch.referee ? `
                                <div class="next-referee-info-live">
                                    <div class="referee-icon-live">
                                        <i class="fas fa-whistle"></i>
                                    </div>
                                    <div class="referee-details-live">
                                        <strong>Schiedsrichter:</strong><br>
                                        ${nextMatch.referee.team} (${nextMatch.referee.group})
                                    </div>
                                </div>
                            ` : `
                                <div class="no-referee-info-live">
                                    <i class="fas fa-user-question"></i>
                                    <span>Kein Schiedsrichter zugewiesen</span>
                                </div>
                            `}
                            
                            <div class="next-match-actions-live">
                                <button class="btn btn-success btn-large" onclick="startMatchDialog('${nextMatch.id}')">
                                    <i class="fas fa-play"></i> Nächstes Spiel starten
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            }
            
            // Start live timer updates
            startLocalLiveTimer(liveMatch);
            
        } else {
            // No live match - show next match and upcoming
            if (nextData.nextMatch) {
                const nextMatch = nextData.nextMatch;
                const nextTime = new Date(nextMatch.datetime);
                const timeUntilMatch = nextTime - new Date();
                const minutesUntil = Math.max(0, Math.floor(timeUntilMatch / (1000 * 60)));
                
                html += `
                    <div class="no-live-match-improved">
                        <div class="next-match-ready">
                            <div class="next-match-header">
                                <i class="fas fa-clock"></i>
                                <h3>Nächstes geplantes Spiel</h3>
                            </div>
                            
                            <div class="next-match-info-card">
                                <div class="match-teams-display">${nextMatch.team1} <span class="vs">vs</span> ${nextMatch.team2}</div>
                                <div class="match-time-display">
                                    <strong>${nextTime.toLocaleTimeString('de-DE', {hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin'})}</strong>
                                    <span class="countdown-badge" data-next-time="${nextTime.toISOString()}">${minutesUntil > 0 ? `in ${minutesUntil} Min.` : 'Jetzt startbereit!'}</span>
                                </div>
                                <div class="match-details-grid">
                                    <div class="detail-item">
                                        <i class="fas fa-layer-group"></i> ${nextMatch.group}
                                    </div>
                                </div>
                                
                                ${nextMatch.referee ? `
                                    <div class="referee-ready-display">
                                        <div class="referee-icon">
                                            <i class="fas fa-whistle"></i>
                                        </div>
                                        <div class="referee-info">
                                            <strong>Schiedsrichter bereit:</strong><br>
                                            ${nextMatch.referee.team} (${nextMatch.referee.group})
                                        </div>
                                    </div>
                                ` : ''}
                            </div>
                            
                            <div class="start-match-action">
                                <button class="btn btn-success btn-large" onclick="startMatchDialog('${nextMatch.id}')">
                                    <i class="fas fa-play"></i> Dieses Spiel jetzt starten
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            } else {
                // No next match from API - check if there are still matches to play
                // Use current matches data first, then fallback to fresh API call if needed
                let latestMatches = matches || [];
                
                // If we don't have matches data or it seems stale, try to fetch fresh data
                if (!latestMatches.length) {
                    try {
                        const matchesResponse = await fetch('/api/matches');
                        if (matchesResponse.ok) {
                            latestMatches = await matchesResponse.json();
                        }
                    } catch (matchError) {
                        console.error('Error fetching latest matches:', matchError);
                        // Use empty array as fallback
                        latestMatches = [];
                    }
                }
                
                const allMatches = latestMatches.filter(m => !m.completed);
                const unscheduledMatches = allMatches.filter(m => !m.scheduled);
                const scheduledButNotCompleted = allMatches.filter(m => m.scheduled && !m.completed);
                const liveMatches = allMatches.filter(m => m.liveScore && m.liveScore.isLive);
                
                console.log('Match analysis:', {
                    total: latestMatches.length,
                    completed: latestMatches.filter(m => m.completed).length,
                    unscheduled: unscheduledMatches.length,
                    scheduledNotCompleted: scheduledButNotCompleted.length,
                    liveMatches: liveMatches.length
                });
                
                // If there are live matches, something went wrong with the live-match API
                if (liveMatches.length > 0) {
                    html += `
                        <div class="error-state-improved">
                            <div class="error-icon">
                                <i class="fas fa-sync"></i>
                            </div>
                            <h3>Live-Daten werden synchronisiert...</h3>
                            <p>Ein Spiel läuft gerade. Lade aktuelle Daten...</p>
                            <div class="auto-retry-indicator">
                                <i class="fas fa-sync fa-spin"></i>
                                <span>Automatische Aktualisierung in Kürze...</span>
                            </div>
                        </div>
                    `;
                    // Auto-retry after 2 seconds if live matches detected but live-match API failed
                    setTimeout(() => {
                        if (currentActiveTab === 'live') {
                            console.log('Auto-retrying due to detected live matches...');
                            loadLiveControl();
                        }
                    }, 2000);
                } else if (scheduledButNotCompleted.length > 0) {
                        // There are still scheduled matches that are not completed
                        const nextScheduled = scheduledButNotCompleted
                            .filter(m => new Date(m.datetime) > new Date())
                            .sort((a, b) => new Date(a.datetime) - new Date(b.datetime))[0];
                        
                        if (nextScheduled) {
                            html += `
                                <div class="no-live-match-improved">
                                    <div class="next-match-ready">
                                        <div class="next-match-header">
                                            <i class="fas fa-clock"></i>
                                            <h3>Nächstes geplantes Spiel</h3>
                                        </div>
                                        
                                        <div class="next-match-info-card">
                                            <div class="match-teams-display">${nextScheduled.team1} <span class="vs">vs</span> ${nextScheduled.team2}</div>
                                            <div class="match-time-display">
                                                <strong>${new Date(nextScheduled.datetime).toLocaleTimeString('de-DE', {hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin'})}</strong>
                                                <span class="countdown-badge">Startbereit!</span>
                                            </div>
                                            <div class="match-details-grid">
                                                <div class="detail-item">
                                                    <i class="fas fa-layer-group"></i> ${nextScheduled.group}
                                                </div>
                                            </div>
                                        </div>
                                        
                                        <div class="start-match-action">
                                            <button class="btn btn-success btn-large" onclick="startMatchDialog('${nextScheduled.id}')">
                                                <i class="fas fa-play"></i> Dieses Spiel jetzt starten
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            `;
                        }
                    } else if (unscheduledMatches.length > 0) {
                    html += `
                        <div class="no-live-match-improved">
                            <div class="no-scheduled-state">
                                <div class="state-icon">
                                    <i class="fas fa-calendar-times"></i>
                                </div>
                                <h3>Keine geplanten Spiele</h3>
                                <p>Es sind ${unscheduledMatches.length} Spiele vorhanden, aber noch nicht zeitlich geplant.</p>
                                <div class="action-buttons">
                                    <button class="btn btn-primary btn-large" onclick="switchToTab('matches')">
                                        <i class="fas fa-calendar"></i> Spiele planen
                                    </button>
                                    <button class="btn btn-warning btn-large" onclick="scheduleAllMatches()">
                                        <i class="fas fa-brain"></i> Alle automatisch planen
                                    </button>
                                </div>
                            </div>
                        </div>
                    `;
                    } else {
                        html += `
                            <div class="no-live-match-improved">
                                <div class="tournament-complete-state">
                                    <div class="state-icon">
                                        <i class="fas fa-trophy"></i>
                                    </div>
                                    <h3>Alle Spiele abgeschlossen</h3>
                                    <p>Das Turnier ist beendet. Alle Spiele wurden gespielt.</p>
                                    <div class="action-buttons">
                                        <button class="btn btn-success btn-large" onclick="switchToTab('results')">
                                            <i class="fas fa-trophy"></i> Endergebnisse anzeigen
                                        </button>
                                        <button class="btn btn-outline btn-large" onclick="exportTournamentData()">
                                            <i class="fas fa-download"></i> Turnierdaten exportieren
                                        </button>
                                    </div>
                                </div>
                            </div>
                        `;
                    }
            }
        }
        
        liveControl.innerHTML = html;
        
        // Start countdown timer for live control displays
        startAdminCountdownTimer();
        
    } catch (error) {
        console.error('Error loading live control:', error);
        const liveControl = document.getElementById('live-match-control');
        liveControl.innerHTML = `
            <div class="error-state-improved">
                <div class="error-icon">
                    <i class="fas fa-wifi"></i>
                </div>
                <h3>Verbindungsproblem</h3>
                <p>Live-Control konnte nicht geladen werden. Automatische Wiederholung in Kürze...</p>
                <div class="auto-retry-indicator">
                    <i class="fas fa-sync fa-spin"></i>
                    <span>Versuche erneut zu verbinden...</span>
                </div>
            </div>
        `;
        
        // Automatisches Retry nach 1 Sekunde
        setTimeout(() => {
            if (currentActiveTab === 'live') {
                console.log('Auto-retrying live control load...');
                loadLiveControl();
            }
        }, 1000);
    }
}

// LOCAL LIVE TIMER UPDATES (independent of API calls)
function startLocalLiveTimer(liveMatch) {
    console.log('Starting local live timer for admin...');
    
    // Store the current match data locally
    currentLiveMatch = liveMatch;
    
    // Clear existing timers
    if (localLiveTimerInterval) {
        clearInterval(localLiveTimerInterval);
    }
    if (liveControlInterval) {
        clearInterval(liveControlInterval);
    }
    
    // Start local timer that updates every second
    localLiveTimerInterval = setInterval(() => {
        if (!currentLiveMatch || currentActiveTab !== 'live') {
            return;
        }
        
        try {
            // Calculate time based on stored match data and current time
            const timeInfo = calculateLiveTime(currentLiveMatch);
            
            const timerElement = document.getElementById('admin-live-timer');
            const halfElement = document.getElementById('admin-live-half');
            
            if (timerElement) {
                timerElement.textContent = timeInfo.displayTime;
            }
            if (halfElement) {
                halfElement.textContent = timeInfo.halfInfo;
            }
            
            // Auto-trigger halftime when first half ends
            if (timeInfo.halfInfo === '1. HALBZEIT ENDE' && 
                currentLiveMatch.currentHalf === 1 && 
                !currentLiveMatch.halfTimeBreak &&
                !currentLiveMatch.autoHalftimeTriggered) {
                
                console.log('Auto-triggering halftime break...');
                currentLiveMatch.autoHalftimeTriggered = true;
                
                // Trigger halftime break
                startHalfTime(currentLiveMatch.id);
            }
            
        } catch (error) {
            console.error('Local timer update error:', error);
        }
    }, 1000); // Update every second for smooth timer
    
    // Start less frequent API sync for data updates
    startLiveControlUpdates();
}

// LIVE CONTROL API SYNC (less frequent, for data sync only)
function startLiveControlUpdates() {
    console.log('Starting live control API sync...');
    
    liveControlInterval = setInterval(async () => {
        // Skip if not on live tab
        if (currentActiveTab !== 'live' || isLiveControlUpdating) {
            return;
        }
        
        try {
            isLiveControlUpdating = true;
            
            // Try to fetch latest live match data for sync
            const response = await fetch('/api/live-match');
            if (!response.ok) {
                console.log(`API sync failed (${response.status}), continuing with local timer`);
                return;
            }
            
            const data = await response.json();
            
            if (!data.liveMatch) {
                // Match ended, reload live control completely
                console.log('Match ended, reloading live control');
                clearInterval(liveControlInterval);
                clearInterval(localLiveTimerInterval);
                liveControlInterval = null;
                localLiveTimerInterval = null;
                currentLiveMatch = null;
                await loadLiveControl();
                return;
            }
            
            // Update local match data
            const updatedMatch = data.liveMatch;
            
            // Check if halftime state changed - reload if so
            const currentHalfTimeState = updatedMatch.halfTimeBreak;
            const currentHalf = updatedMatch.currentHalf;
            
            if (currentLiveMatch && 
                (currentLiveMatch.halfTimeBreak !== currentHalfTimeState || 
                 currentLiveMatch.currentHalf !== currentHalf)) {
                console.log('Halftime state changed, reloading live control');
                clearInterval(liveControlInterval);
                clearInterval(localLiveTimerInterval);
                liveControlInterval = null;
                localLiveTimerInterval = null;
                await loadLiveControl();
                return;
            }
            
            // Update local match data
            currentLiveMatch = updatedMatch;
            
            // Update scores if changed
            const score1Input = document.getElementById('live-score1');
            const score2Input = document.getElementById('live-score2');
            
            if (score1Input && score1Input.value != updatedMatch.score1 && document.activeElement !== score1Input) {
                score1Input.value = updatedMatch.score1;
            }
            if (score2Input && score2Input.value != updatedMatch.score2 && document.activeElement !== score2Input) {
                score2Input.value = updatedMatch.score2;
            }
            
        } catch (error) {
            console.log('API sync error, continuing with local timer:', error.message);
        } finally {
            isLiveControlUpdating = false;
        }
    }, 5000); // Check every 5 seconds for data sync
}

// Live Time Calculation Function
function calculateLiveTime(liveMatch) {
    if (!liveMatch || !liveMatch.startTime) {
        return { displayTime: '00:00', halfInfo: 'Kein Spiel', currentMinute: 0, currentSecond: 0 };
    }
    
    const now = new Date();
    const startTime = new Date(liveMatch.startTime);
    const halfTimeMinutes = liveMatch.halfTimeMinutes || 5; // Standard auf 5 Minuten geändert
    
    // Wenn pausiert und pauseStartTime gesetzt, Zeit bei Pausenbeginn stoppen
    if (liveMatch.isPaused && liveMatch.pauseStartTime) {
        const pauseStartTime = new Date(liveMatch.pauseStartTime);
        let elapsedTime = 0;
        
        if (liveMatch.currentHalf === 1) {
            elapsedTime = pauseStartTime - startTime - (liveMatch.pausedTime || 0);
        } else if (liveMatch.currentHalf === 2 && liveMatch.secondHalfStartTime) {
            const secondHalfStart = new Date(liveMatch.secondHalfStartTime);
            elapsedTime = pauseStartTime - secondHalfStart - (liveMatch.pausedTime || 0);
        } else if ((liveMatch.currentHalf === 3 || liveMatch.currentHalf === 4) && liveMatch.extensionStarted) {
            elapsedTime = pauseStartTime - startTime - (liveMatch.pausedTime || 0);
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
    
    // Halbzeitpause oder Verlängerungspause
    if (liveMatch.halfTimeBreak) {
        let breakMinutes, breakInfo, nextHalfInfo;
        
        if (liveMatch.extensionMainBreak) {
            // Hauptpause vor Verlängerung
            breakMinutes = liveMatch.extensionConfig?.mainBreakMinutes || 10;
            breakInfo = 'PAUSE VOR VERLÄNGERUNG';
            nextHalfInfo = '1. VERLÄNGERUNG BEREIT';
        } else if (liveMatch.currentHalf === 3 && liveMatch.extensionStarted) {
            // Pause zwischen Verlängerungshalbzeiten
            breakMinutes = liveMatch.extensionConfig?.breakMinutes || 5;
            breakInfo = 'VERLÄNGERUNG HALBZEITPAUSE';
            nextHalfInfo = '2. VERLÄNGERUNG BEREIT';
        } else {
            // Normale Halbzeitpause
            breakMinutes = liveMatch.halftimeBreakMinutes || 1;
            breakInfo = 'HALBZEITPAUSE';
            nextHalfInfo = '2. HALBZEIT BEREIT';
        }
        
        // Berechne verbleibende Pause
        if (liveMatch.breakStartTime) {
            const breakStart = new Date(liveMatch.breakStartTime);
            const breakElapsed = Math.floor((now - breakStart) / 1000);
            const breakTotal = breakMinutes * 60;
            const breakRemaining = Math.max(0, breakTotal - breakElapsed);
            
            const remainingMinutes = Math.floor(breakRemaining / 60);
            const remainingSeconds = breakRemaining % 60;
            
            if (breakRemaining > 0) {
                return {
                    displayTime: formatTime(remainingMinutes, remainingSeconds),
                    halfInfo: breakInfo,
                    currentMinute: remainingMinutes,
                    currentSecond: remainingSeconds
                };
            }
        } else if (liveMatch.firstHalfEndTime) {
            // Fallback für normale Halbzeitpause
            const firstHalfEnd = new Date(liveMatch.firstHalfEndTime);
            const halftimeElapsed = Math.floor((now - firstHalfEnd) / 1000);
            const halftimeTotal = breakMinutes * 60;
            const halftimeRemaining = Math.max(0, halftimeTotal - halftimeElapsed);
            
            const remainingMinutes = Math.floor(halftimeRemaining / 60);
            const remainingSeconds = halftimeRemaining % 60;
            
            if (halftimeRemaining > 0) {
                return {
                    displayTime: formatTime(remainingMinutes, remainingSeconds),
                    halfInfo: breakInfo,
                    currentMinute: remainingMinutes,
                    currentSecond: remainingSeconds
                };
            }
        }
        
        // Wenn Pause abgelaufen ist
        return {
            displayTime: '00:00',
            halfInfo: nextHalfInfo,
            currentMinute: 0,
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
            halfInfo = liveMatch.extensionStarted ? '2. HALBZEIT ENDE' : 'SPIEL ENDE';
        } else {
            halfInfo = '2. HALBZEIT';
        }
    } else if (liveMatch.currentHalf === 3 && liveMatch.extensionStarted) {
        // Erste Verlängerung
        elapsedTime = now - startTime - (liveMatch.pausedTime || 0);
        const totalSeconds = Math.floor(elapsedTime / 1000);
        currentMinute = Math.floor(totalSeconds / 60);
        currentSecond = totalSeconds % 60;
        
        const extensionHalfTime = liveMatch.extensionConfig?.halfTimeMinutes || 15;
        if (currentMinute >= extensionHalfTime) {
            currentMinute = extensionHalfTime;
            currentSecond = 0;
            halfInfo = '1. VERLÄNGERUNG ENDE';
        } else {
            halfInfo = '1. VERLÄNGERUNG';
        }
    } else if (liveMatch.currentHalf === 4 && liveMatch.extensionStarted) {
        // Zweite Verlängerung
        elapsedTime = now - startTime - (liveMatch.pausedTime || 0);
        const totalSeconds = Math.floor(elapsedTime / 1000);
        currentMinute = Math.floor(totalSeconds / 60);
        currentSecond = totalSeconds % 60;
        
        const extensionHalfTime = liveMatch.extensionConfig?.halfTimeMinutes || 15;
        if (currentMinute >= extensionHalfTime) {
            currentMinute = extensionHalfTime;
            currentSecond = 0;
            halfInfo = 'VERLÄNGERUNG ENDE';
        } else {
            halfInfo = '2. VERLÄNGERUNG';
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

// Admin Countdown Timer for updating "in X Min" displays
let adminCountdownTimerInterval = null;

function startAdminCountdownTimer() {
    // Clear existing timer
    if (adminCountdownTimerInterval) {
        clearInterval(adminCountdownTimerInterval);
    }
    
    // Start countdown timer that updates every 30 seconds
    adminCountdownTimerInterval = setInterval(() => {
        try {
            // Update countdown displays in admin panel
            updateAdminCountdownDisplays();
        } catch (error) {
            console.error('Admin countdown timer update error:', error);
        }
    }, 30000); // Update every 30 seconds
}

function updateAdminCountdownDisplays() {
    const countdownElements = document.querySelectorAll('.countdown, .countdown-admin, .countdown-badge');
    countdownElements.forEach(element => {
        const nextTime = element.dataset.nextTime;
        if (nextTime) {
            const timeUntilMatch = new Date(nextTime) - new Date();
            const minutesUntil = Math.max(0, Math.floor(timeUntilMatch / (1000 * 60)));
            
            // Update text based on context
            if (element.classList.contains('countdown-badge')) {
                element.textContent = minutesUntil > 0 ? `(in ${minutesUntil} Min.)` : 'Startbereit!';
            } else {
                element.textContent = minutesUntil > 0 ? `in ${minutesUntil} Min.` : 'Jetzt';
            }
        }
    });
}

function stopAdminCountdownTimer() {
    if (adminCountdownTimerInterval) {
        clearInterval(adminCountdownTimerInterval);
        adminCountdownTimerInterval = null;
        console.log('Stopped admin countdown timer');
    }
}

// Live Match Control Functions
async function updateLiveScore(matchId) {
    const score1 = parseInt(document.getElementById('live-score1').value);
    const score2 = parseInt(document.getElementById('live-score2').value);
    
    if (isNaN(score1) || isNaN(score2) || score1 < 0 || score2 < 0) {
        showNotification('Ungültige Ergebnisse', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/admin/live-score', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                password: adminPassword,
                matchId,
                score1,
                score2
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Score aktualisiert');
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Aktualisieren des Scores', 'error');
    }
}

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
            // await refreshCurrentTabContent(); // Entfernt - wird durch WebSocket-Events gehandelt
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
            // await refreshCurrentTabContent(); // Entfernt - wird durch WebSocket-Events gehandelt
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Fortsetzen', 'error');
    }
}

async function startHalfTime(matchId) {
    try {
        const response = await fetch('/api/admin/halftime-break', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: adminPassword, matchId })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Halbzeit eingeläutet');
            // Force immediate live control update
            if (currentActiveTab === 'live') {
                await loadLiveControl();
            }
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Einläuten der Halbzeit', 'error');
    }
}

async function startSecondHalf(matchId) {
    try {
        const response = await fetch('/api/admin/start-second-half', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: adminPassword, matchId })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('2. Halbzeit gestartet');
            // Force immediate live control update with retry
            if (currentActiveTab === 'live') {
                try {
                    await loadLiveControl();
                } catch (error) {
                    console.log('Initial live control load failed, retrying in 500ms...');
                    setTimeout(async () => {
                        try {
                            await loadLiveControl();
                        } catch (retryError) {
                            console.log('Retry failed, will use auto-retry mechanism');
                        }
                    }, 500);
                }
            }
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Starten der 2. Halbzeit', 'error');
    }
}

// Helper function to check if a match is a knockout match
function isKnockoutMatch(match) {
    return match.phase === 'quarterfinal' || match.phase === 'semifinal' || match.phase === 'final' || match.id === 'third_place';
}

async function endMatch(matchId) {
    const match = matches.find(m => m.id === matchId);
    if (!match) {
        showNotification('Spiel nicht gefunden', 'error');
        return;
    }
    
    // Use server-side logic to determine match ending behavior
    // The title will be determined based on match type
    const title = isKnockoutMatch(match) ? '2. Halbzeit beenden' : 'Spiel beenden';
    createModal(title, `
        <div class="warning-box" style="background: #fef3c7; border: 1px solid #f59e0b; padding: 1rem; border-radius: 0.5rem; margin-bottom: 1rem;">
            <i class="fas fa-info-circle" style="color: #f59e0b;"></i>
            <strong>${title}:</strong> Das Ergebnis wird gespeichert und das Spiel als abgeschlossen markiert.
        </div>
        <p>Das Live-Spiel wird beendet und das aktuelle Ergebnis gespeichert.</p>
        ${isKnockoutMatch(match) ? '<p><small>Hinweis: Bei Unentschieden wird automatisch die Verlängerung konfiguriert.</small></p>' : ''}
    `, [
        { text: title, class: 'btn-success', handler: (modalId) => executeEndMatch(matchId, modalId) },
        { text: 'Abbrechen', class: 'btn-outline', handler: (modalId) => closeModal(modalId) }
    ]);
}

function showExtensionTimeModal(matchId) {
    createModal('Verlängerung konfigurieren', `
        <div class="info-box" style="background: #e0f2fe; border: 1px solid #0ea5e9; padding: 1rem; border-radius: 0.5rem; margin-bottom: 1rem;">
            <i class="fas fa-info-circle" style="color: #0ea5e9;"></i>
            <strong>Unentschieden nach 2. Halbzeit:</strong> Das Spiel geht in die Verlängerung.
        </div>
        <p>Bitte geben Sie die Verlängerungszeiten ein:</p>
        
        <div class="form-group">
            <label for="extensionHalfTime">Dauer einer Verlängerungshalbzeit (Minuten):</label>
            <input type="number" id="extensionHalfTime" class="form-control" value="15" min="5" max="30">
        </div>
        
        <div class="form-group">
            <label for="extensionBreakTime">Pause zwischen den Verlängerungshalbzeiten (Minuten):</label>
            <input type="number" id="extensionBreakTime" class="form-control" value="5" min="1" max="10">
        </div>
        
        <div class="form-group">
            <label for="extensionMainBreak">Pause vor der Verlängerung (Minuten):</label>
            <input type="number" id="extensionMainBreak" class="form-control" value="10" min="5" max="15">
        </div>
    `, [
        { text: 'Verlängerung starten', class: 'btn-primary', handler: (modalId) => startExtensionTime(matchId, modalId) },
        { text: 'Abbrechen', class: 'btn-outline', handler: (modalId) => closeModal(modalId) }
    ]);
}

async function startExtensionTime(matchId, modalId) {
    const extensionHalfTime = parseInt(document.getElementById('extensionHalfTime').value);
    const extensionBreakTime = parseInt(document.getElementById('extensionBreakTime').value);
    const extensionMainBreak = parseInt(document.getElementById('extensionMainBreak').value);
    
    if (!extensionHalfTime || !extensionBreakTime || !extensionMainBreak) {
        showNotification('Bitte alle Zeitangaben eingeben', 'error');
        return;
    }
    
    showLoading(true);
    
    try {
        const response = await fetch('/api/admin/start-extension', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                matchId,
                extensionHalfTime,
                extensionBreakTime,
                extensionMainBreak
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showNotification('Verlängerung wird gestartet...', 'success');
            closeModal(modalId);
            // Refresh will happen automatically via WebSocket updates
        } else {
            console.error('Extension start failed:', response.status, data);
            showNotification(data.error || 'Fehler beim Starten der Verlängerung', 'error');
            if (data.details) {
                console.error('Server error details:', data.details);
            }
        }
    } catch (error) {
        console.error('Fehler beim Starten der Verlängerung:', error);
        showNotification('Fehler beim Starten der Verlängerung', 'error');
    } finally {
        showLoading(false);
    }
}

async function startExtensionFirstHalf(matchId) {
    showLoading(true);
    
    try {
        const response = await fetch('/api/admin/start-extension-first-half', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ matchId })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showNotification('1. Verlängerung gestartet', 'success');
            // Refresh will happen automatically via WebSocket updates
        } else {
            showNotification(data.error || 'Fehler beim Starten der 1. Verlängerung', 'error');
        }
    } catch (error) {
        console.error('Fehler beim Starten der 1. Verlängerung:', error);
        showNotification('Fehler beim Starten der 1. Verlängerung', 'error');
    } finally {
        showLoading(false);
    }
}

async function startExtensionHalfTime(matchId) {
    showLoading(true);
    
    try {
        const response = await fetch('/api/admin/start-extension-halftime', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ matchId })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showNotification('Verlängerung Halbzeitpause gestartet', 'success');
            // Refresh will happen automatically via WebSocket updates
        } else {
            showNotification(data.error || 'Fehler beim Starten der Halbzeitpause', 'error');
        }
    } catch (error) {
        console.error('Fehler beim Starten der Halbzeitpause:', error);
        showNotification('Fehler beim Starten der Halbzeitpause', 'error');
    } finally {
        showLoading(false);
    }
}

async function startExtensionSecondHalf(matchId) {
    showLoading(true);
    
    try {
        const response = await fetch('/api/admin/start-extension-second-half', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ matchId })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showNotification('2. Verlängerung gestartet', 'success');
            // Refresh will happen automatically via WebSocket updates
        } else {
            showNotification(data.error || 'Fehler beim Starten der 2. Verlängerung', 'error');
        }
    } catch (error) {
        console.error('Fehler beim Starten der 2. Verlängerung:', error);
        showNotification('Fehler beim Starten der 2. Verlängerung', 'error');
    } finally {
        showLoading(false);
    }
}

async function executeEndMatch(matchId, modalId) {
    showLoading(true);
    
    try {
        const response = await fetch('/api/admin/finish-match', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: adminPassword, matchId })
        });
        
        const data = await response.json();
        
        // Handle non-success HTTP status codes
        if (!response.ok) {
            console.error(`HTTP ${response.status} error:`, data);
            
            // Special case: unentschieden KO match needs extension
            if (data.error === 'unentschieden_ko' && data.requiresOvertime) {
                closeModal(modalId);
                showExtensionTimeModal(matchId);
                return;
            }
            
            throw new Error(data.message || data.error || `Server returned ${response.status}`);
        }
        
        if (data.success) {
            showNotification('Spiel erfolgreich beendet');
            closeModal(modalId);
            
            // Clear live timers
            if (liveControlInterval) {
                clearInterval(liveControlInterval);
                liveControlInterval = null;
            }
            if (localLiveTimerInterval) {
                clearInterval(localLiveTimerInterval);
                localLiveTimerInterval = null;
            }
            currentLiveMatch = null;
            
            // await refreshCurrentTabContent(); // Entfernt - wird durch WebSocket-Events gehandelt
        } else {
            // Handle specific error cases
            let errorMessage = data.message || data.error || 'Unbekannter Fehler beim Beenden des Spiels';
            
            if (data.error === 'unentschieden_ko') {
                errorMessage = 'K.O.-Spiel ist unentschieden! Verlängerung erforderlich.';
            } else if (data.error === 'unentschieden_ko_overtime') {
                errorMessage = 'Spiel ist nach Verlängerung unentschieden! Elfmeterschießen erforderlich.';
            } else if (data.error === 'penalty_shootout_active') {
                errorMessage = 'Elfmeterschießen ist noch aktiv! Bitte beenden Sie das Elfmeterschießen zuerst.';
            }
            
            console.error('Match finish error:', data);
            showNotification(errorMessage, 'error');
        }
    } catch (error) {
        console.error('Execute end match error:', error);
        let errorMessage = 'Fehler beim Beenden des Spiels';
        
        if (error.message.includes('unentschieden_ko')) {
            errorMessage = 'K.O.-Spiel ist unentschieden! Verlängerung erforderlich.';
        } else if (error.message.includes('penalty_shootout_active')) {
            errorMessage = 'Elfmeterschießen ist noch aktiv! Bitte beenden Sie das Elfmeterschießen zuerst.';
        } else if (error.message) {
            errorMessage = error.message;
        }
        
        showNotification(errorMessage, 'error');
    } finally {
        showLoading(false);
    }
}

async function stopMatch(matchId) {
    createModal('Spiel abbrechen (Notfall)', `
        <div class="danger-box" style="background: #fef2f2; border: 2px solid #dc2626; padding: 1rem; border-radius: 0.5rem; margin-bottom: 1rem;">
            <i class="fas fa-exclamation-triangle" style="color: #dc2626;"></i>
            <strong>ACHTUNG: Notfall-Abbruch!</strong> Das Spiel wird gestoppt, aber NICHT als abgeschlossen markiert.
        </div>
        <p>Das Spiel wird sofort gestoppt und kann später neu gestartet werden. Das aktuelle Ergebnis geht verloren.</p>
        <p><strong>Verwende diese Funktion nur im Notfall!</strong></p>
    `, [
        { text: 'Spiel abbrechen', class: 'btn-danger', handler: (modalId) => executeStopMatch(matchId, modalId) },
        { text: 'Abbrechen', class: 'btn-outline', handler: (modalId) => closeModal(modalId) }
    ]);
}

async function executeStopMatch(matchId, modalId) {
    showLoading(true);
    
    try {
        const response = await fetch('/api/admin/stop-match', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: adminPassword, matchId })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Spiel abgebrochen');
            closeModal(modalId);
            
            // Clear live timers
            if (liveControlInterval) {
                clearInterval(liveControlInterval);
                liveControlInterval = null;
            }
            if (localLiveTimerInterval) {
                clearInterval(localLiveTimerInterval);
                localLiveTimerInterval = null;
            }
            currentLiveMatch = null;
            
            // await refreshCurrentTabContent(); // Entfernt - wird durch WebSocket-Events gehandelt
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Abbrechen des Spiels', 'error');
    } finally {
        showLoading(false);
    }
}

// Results Management
function loadResults() {
    const resultsInput = document.getElementById('results-input');
    
    if (!currentTournament) {
        resultsInput.innerHTML = '<p>Kein Turnier vorhanden.</p>';
        return;
    }
    
    if (matches.length === 0) {
        resultsInput.innerHTML = '<p>Keine Spiele vorhanden.</p>';
        return;
    }
    
    // Gruppiere Spiele nach Status
    const completedMatches = matches.filter(m => m.completed);
    const pendingMatches = matches.filter(m => !m.completed);
    
    let html = '';
    
    // Statistics
    html += `
        <div class="results-stats">
            <div class="stat-item">
                <strong>${completedMatches.length}</strong> abgeschlossen
            </div>
            <div class="stat-item">
                <strong>${pendingMatches.length}</strong> ausstehend
            </div>
            <div class="stat-item">
                <strong>${matches.length}</strong> gesamt
            </div>
        </div>
    `;
    
    // Pending matches for result input
    if (pendingMatches.length > 0) {
        html += '<h4><i class="fas fa-clock"></i> Ergebnisse eintragen</h4>';
        pendingMatches.forEach(match => {
            html += `
                <div class="result-input-card">
                    <div class="match-header">
                        <h5>${match.team1} vs ${match.team2}</h5>
                        <small>${match.group} ${match.isPenaltyShootout ? '(Elfmeterschießen)' : ''}</small>
                        ${match.scheduled ? `<small>Geplant: ${formatDateTime(match.scheduled.datetime)}</small>` : ''}
                        ${match.referee ? `<small><i class="fas fa-whistle"></i> ${match.referee.team}</small>` : ''}
                    </div>
                    <div class="score-inputs" style="justify-content: center; margin: 1rem 0; display: flex; align-items: center; gap: 1rem;">
                        <span class="team-name">${match.team1}</span>
                        <input type="number" min="0" id="result-score1-${match.id}" placeholder="0" style="width: 80px; padding: 0.5rem; border: 2px solid #ccc; border-radius: 0.5rem; text-align: center; font-size: 1.125rem;">
                        <span class="score-vs">:</span>
                        <input type="number" min="0" id="result-score2-${match.id}" placeholder="0" style="width: 80px; padding: 0.5rem; border: 2px solid #ccc; border-radius: 0.5rem; text-align: center; font-size: 1.125rem;">
                        <span class="team-name">${match.team2}</span>
                    </div>
                    <button class="btn btn-primary" onclick="submitResult('${match.id}')">
                        <i class="fas fa-save"></i> Ergebnis speichern
                    </button>
                </div>
            `;
        });
    }
    
    // Completed matches for editing
    if (completedMatches.length > 0) {
        html += '<h4><i class="fas fa-check-circle"></i> Abgeschlossene Spiele (bearbeitbar)</h4>';
        completedMatches.forEach(match => {
            html += `
                <div class="completed-match-card">
                    <div class="match-info">
                        <h5>${match.team1} vs ${match.team2}</h5>
                        <div class="final-score-display">${match.score1} : ${match.score2}${match.isPenaltyShootout ? ' (E)' : ''}</div>
                        <small>${match.group}</small>
                        ${match.referee ? `<small><i class="fas fa-whistle"></i> ${match.referee.team}</small>` : ''}
                    </div>
                    <div class="match-actions">
                        <button class="btn btn-small btn-warning" onclick="editResult('${match.id}')">
                            <i class="fas fa-edit"></i> <span class="btn-text">Korrigieren</span>
                        </button>
                    </div>
                </div>
            `;
        });
    }
    
    resultsInput.innerHTML = html;
}

// Submit Result Function
async function submitResult(matchId) {
    const score1 = document.getElementById(`result-score1-${matchId}`).value;
    const score2 = document.getElementById(`result-score2-${matchId}`).value;
    
    if (!score1 || !score2) {
        showNotification('Bitte beide Ergebnisse eingeben', 'warning');
        return;
    }
    
    showLoading(true);
    
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
            await refreshCurrentTabContent();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Speichern des Ergebnisses', 'error');
    } finally {
        showLoading(false);
    }
}

// Settings Management
function loadSettings() {
    const tournamentSettings = document.getElementById('tournament-settings');
    
    // Load contact data when settings tab is opened
    loadContactData();
    
    if (!currentTournament) {
        tournamentSettings.innerHTML = `
            <div class="status-card info">
                <i class="fas fa-info-circle"></i>
                <h4>Kein aktives Turnier</h4>
                <p>Erstelle zuerst ein Turnier, um Einstellungen zu verwalten.</p>
            </div>
        `;
        return;
    }
    
    const settings = currentTournament.settings || {};
    
    tournamentSettings.innerHTML = `
        <div class="settings-form">
            <h4>Aktuelle Turnier-Einstellungen</h4>
            
            <div class="form-group">
                <label for="tournament-format-setting">Turnier-Format:</label>
                <select id="tournament-format-setting" style="width: 100%; padding: 0.5rem; border: 2px solid #ccc; border-radius: 0.5rem;">
                    <option value="groups" ${settings.format === 'groups' ? 'selected' : ''}>Gruppensystem</option>
                    <option value="swiss" ${settings.format === 'swiss' ? 'selected' : ''}>Champions League Format</option>
                    <option value="league" ${settings.format === 'league' ? 'selected' : ''}>Liga-Modus</option>
                </select>
            </div>
            
            ${settings.format === 'groups' ? `
                <div class="form-group">
                    <label for="group-size-setting">Teams pro Gruppe:</label>
                    <input type="number" id="group-size-setting" value="${settings.groupSize || 4}" min="3" max="6" style="width: 100%; padding: 0.5rem; border: 2px solid #ccc; border-radius: 0.5rem;">
                </div>
            ` : ''}
            
            ${settings.format === 'swiss' ? `
                <div class="form-group">
                    <label for="swiss-rounds-setting">Anzahl Runden:</label>
                    <input type="number" id="swiss-rounds-setting" value="${settings.rounds || 5}" min="3" max="10" style="width: 100%; padding: 0.5rem; border: 2px solid #ccc; border-radius: 0.5rem;">
                </div>
            ` : ''}
            
            <div class="form-group">
                <label for="half-time-minutes">Standard Halbzeit-Dauer (Minuten):</label>
                <input type="number" id="half-time-minutes" value="${settings.halfTimeMinutes || 5}" min="1" max="45" style="width: 100%; padding: 0.5rem; border: 2px solid #ccc; border-radius: 0.5rem;">
            </div>
            
            <div class="form-group">
                <label for="halftime-break-minutes">Standard Halbzeitpause (Minuten):</label>
                <input type="number" id="halftime-break-minutes" value="${settings.halftimeBreakMinutes || 1}" min="1" max="10" style="width: 100%; padding: 0.5rem; border: 2px solid #ccc; border-radius: 0.5rem;">
            </div>
            
            <div class="settings-checkboxes">
                <h5>K.O.-Phase Optionen:</h5>
                <label style="display: block; margin-bottom: 0.5rem;">
                    <input type="checkbox" id="enable-quarterfinals-setting" ${settings.enableQuarterfinals ? 'checked' : ''}> 
                    Viertelfinale aktivieren
                </label>
                <label style="display: block; margin-bottom: 0.5rem;">
                    <input type="checkbox" id="enable-third-place-setting" ${settings.enableThirdPlace ? 'checked' : ''}> 
                    Spiel um Platz 3
                </label>
                <label style="display: block; margin-bottom: 0.5rem;">
                    <input type="checkbox" id="enable-fifth-place-setting" ${settings.enableFifthPlace ? 'checked' : ''}> 
                    Spiel um Platz 5
                </label>
                <label style="display: block; margin-bottom: 0.5rem;">
                    <input type="checkbox" id="enable-seventh-place-setting" ${settings.enableSeventhPlace ? 'checked' : ''}> 
                    Spiel um Platz 7
                </label>
            </div>
            
            <div class="settings-actions">
                <button class="btn btn-primary" onclick="saveTournamentSettings()">
                    <i class="fas fa-save"></i> Einstellungen speichern
                </button>
                <button class="btn btn-outline" onclick="resetTournamentSettings()">
                    <i class="fas fa-undo"></i> Zurücksetzen
                </button>
            </div>
        </div>
        
        <div class="tournament-info-card">
            <h4>Turnier-Informationen</h4>
            <div class="info-grid">
                <div><strong>Jahr:</strong> ${currentTournament.year}</div>
                <div><strong>Status:</strong> ${currentTournament.status}</div>
                <div><strong>Teams:</strong> ${teams.length}</div>
                <div><strong>Spiele:</strong> ${matches.length}</div>
                <div><strong>Gruppen:</strong> ${currentTournament.groups ? currentTournament.groups.length : 0}</div>
                <div><strong>Erstellt:</strong> ${new Date(currentTournament.createdAt).toLocaleDateString('de-DE')}</div>
                ${currentTournament.registrationClosedAt ? `<div><strong>Anmeldung geschlossen:</strong> ${new Date(currentTournament.registrationClosedAt).toLocaleDateString('de-DE')}</div>` : ''}
            </div>
        </div>
    `;
}

async function saveTournamentSettings() {
    const format = document.getElementById('tournament-format-setting').value;
    const halfTimeMinutes = parseInt(document.getElementById('half-time-minutes').value);
    
    let settings = {
        format,
        halfTimeMinutes,
        enableQuarterfinals: document.getElementById('enable-quarterfinals-setting')?.checked || false,
        enableThirdPlace: document.getElementById('enable-third-place-setting')?.checked || false,
        enableFifthPlace: document.getElementById('enable-fifth-place-setting')?.checked || false,
        enableSeventhPlace: document.getElementById('enable-seventh-place-setting')?.checked || false
    };
    
    if (format === 'groups') {
        settings.groupSize = parseInt(document.getElementById('group-size-setting').value);
    } else if (format === 'swiss') {
        settings.rounds = parseInt(document.getElementById('swiss-rounds-setting').value);
    }
    
    showLoading(true);
    
    try {
        const response = await fetch('/api/admin/tournament/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                password: adminPassword,
                settings
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Einstellungen erfolgreich gespeichert');
            await refreshCurrentTabContent();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Fehler beim Speichern der Einstellungen', 'error');
    } finally {
        showLoading(false);
    }
}

function resetTournamentSettings() {
    loadSettings();
    showNotification('Einstellungen zurückgesetzt');
}

// Helper Functions
function updateTeamCountDisplay() {
    const teamCountDisplay = document.getElementById('team-count-display');
    if (teamCountDisplay) {
        teamCountDisplay.textContent = `${teams.length} Teams registriert`;
    }
}

function refreshTeams() {
    refreshCurrentTabContent();
    showNotification('Teams manuell aktualisiert');
}

async function saveTournamentSettings() {
    const halfTimeMinutes = parseInt(document.getElementById('half-time-minutes').value);
    const halftimeBreakMinutes = parseInt(document.getElementById('halftime-break-minutes').value);
    
    if (isNaN(halfTimeMinutes) || halfTimeMinutes < 1 || halfTimeMinutes > 45) {
        showNotification('Halbzeit-Dauer muss zwischen 1 und 45 Minuten liegen', 'error');
        return;
    }
    
    if (isNaN(halftimeBreakMinutes) || halftimeBreakMinutes < 1 || halftimeBreakMinutes > 10) {
        showNotification('Halbzeitpause muss zwischen 1 und 10 Minuten liegen', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/admin/update-settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
            },
            body: JSON.stringify({
                halfTimeMinutes,
                halftimeBreakMinutes
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.success) {
                currentTournament.settings.halfTimeMinutes = halfTimeMinutes;
                currentTournament.settings.halftimeBreakMinutes = halftimeBreakMinutes;
                showNotification('Einstellungen erfolgreich gespeichert');
            } else {
                showNotification('Fehler beim Speichern der Einstellungen', 'error');
            }
        } else {
            showNotification('Fehler beim Speichern der Einstellungen', 'error');
        }
    } catch (error) {
        console.error('Error saving settings:', error);
        showNotification('Fehler beim Speichern der Einstellungen', 'error');
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    checkAutoLogin();
});

// Page Unload - Clean up timers
window.addEventListener('beforeunload', () => {
    // WebSocket cleanup handled by beforeunload - no manual stop needed
    if (liveControlInterval) {
        clearInterval(liveControlInterval);
    }
    if (localLiveTimerInterval) {
        clearInterval(localLiveTimerInterval);
    }
});