// Global State
let currentTournament = null;
let isAdminLoggedIn = false;
let adminPassword = '';
let availableColors = [];

// WebSocket Connection
let socket = null;
let isConnected = false;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;
const reconnectDelay = 3000;

// Connection stability tracking
let connectionStability = {
    consecutiveDisconnects: 0,
    lastConnectionTime: null,
    shouldUseFallback: false,
    fallbackStartTime: null
};

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
let liveUpdateInterval = null;
let currentActiveTab = localStorage.getItem('currentTab') || 'home';

// Local Live Timer Management
let localLiveTimerInterval = null;
let currentLiveMatch = null;

// Smart Update Management
let updateTimeout = null;
let isUpdating = false;
let pendingUpdate = false;
let lastWebSocketUpdate = 0;

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

// Smart Update Functions
function coordinatedUpdate(callback, minInterval = 1000) {
    const now = Date.now();
    if (now - lastWebSocketUpdate < minInterval) {
        // Too frequent, but ensure tables get updated eventually
        setTimeout(() => {
            lastWebSocketUpdate = now;
            callback();
        }, minInterval - (now - lastWebSocketUpdate));
        return false;
    }
    lastWebSocketUpdate = now;
    callback();
    return true;
}

function debouncedTabUpdate(tab) {
    if (updateTimeout) {
        clearTimeout(updateTimeout);
    }
    
    updateTimeout = setTimeout(() => {
        if (!isUpdating) {
            isUpdating = true;
            try {
                const result = loadTabContent(tab);
                if (result && typeof result.finally === 'function') {
                    result.finally(() => {
                        isUpdating = false;
                        // Handle pending updates
                        if (pendingUpdate) {
                            pendingUpdate = false;
                            setTimeout(() => debouncedTabUpdate(currentActiveTab), 500);
                        }
                    });
                } else {
                    isUpdating = false;
                    // Handle pending updates
                    if (pendingUpdate) {
                        pendingUpdate = false;
                        setTimeout(() => debouncedTabUpdate(currentActiveTab), 500);
                    }
                }
            } catch (error) {
                console.error('Error in loadTabContent:', error);
                isUpdating = false;
            }
        } else {
            pendingUpdate = true;
        }
    }, 300);
}

function smartUpdate(relevantTabs) {
    if (relevantTabs.includes(currentActiveTab)) {
        coordinatedUpdate(() => debouncedTabUpdate(currentActiveTab), 1000);
    }
}

// WebSocket Functions
function isWebSocketReady() {
    const isBasicallyConnected = typeof io !== 'undefined' && 
           socket && 
           socket.connected && 
           isConnected;
    
    // If basic connection is not working, definitely not ready
    if (!isBasicallyConnected) {
        return false;
    }
    
    // If we're in fallback mode, not ready
    if (connectionStability.shouldUseFallback) {
        return false;
    }
    
    // If we've had too many recent disconnects, not ready
    if (connectionStability.consecutiveDisconnects >= 3) {
        return false;
    }
    
    // If connection is very recent (less than 5 seconds), not ready yet
    if (connectionStability.lastConnectionTime && 
        (Date.now() - connectionStability.lastConnectionTime) < 5000) {
        return false;
    }
    
    return true;
}

function initializeWebSocket() {
    if (socket) {
        socket.removeAllListeners();
        socket.disconnect();
    }
    
    if (typeof io === 'undefined') {
        console.warn('Socket.IO not available, using fallback polling');
        return false;
    }
    
    socket = io({
        transports: ['polling', 'websocket'], // Try polling first, then websocket
        upgrade: true,
        rememberUpgrade: false, // Disable remember upgrade to prevent issues
        timeout: 30000, // Increase timeout
        forceNew: false,
        reconnection: false, // We handle reconnection manually
        pingTimeout: 60000,
        pingInterval: 25000,
        autoConnect: true,
        closeOnBeforeunload: false
    });
    
    socket.on('connect', () => {
        isConnected = true;
        reconnectAttempts = 0; // Reset reconnect attempts on successful connection
        console.log('WebSocket connected - ready for live updates');
        console.log('Connection details:', {
            transport: socket.io.engine.transport.name,
            upgraded: socket.io.engine.upgraded,
            id: socket.id
        });
        
        // Track connection stability
        const now = Date.now();
        if (connectionStability.lastConnectionTime) {
            const timeSinceLastConnection = now - connectionStability.lastConnectionTime;
            if (timeSinceLastConnection < 30000) { // Less than 30 seconds since last connection
                connectionStability.consecutiveDisconnects++;
                console.log(`Rapid reconnect detected (${connectionStability.consecutiveDisconnects}). Connection unstable.`);
                
                // If we have too many rapid disconnects, force fallback mode
                if (connectionStability.consecutiveDisconnects >= 7) {
                    connectionStability.shouldUseFallback = true;
                    connectionStability.fallbackStartTime = now;
                    console.log('Connection deemed unstable, forcing fallback mode');
                }
            } else {
                // Good connection, reset counter
                connectionStability.consecutiveDisconnects = 0;
                // If we've been in fallback for more than 30 seconds and connection seems stable, allow WebSocket
                if (connectionStability.shouldUseFallback && (now - connectionStability.fallbackStartTime > 30000)) {
                    connectionStability.shouldUseFallback = false;
                    console.log('Connection stability restored, allowing WebSocket use');
                }
            }
        }
        connectionStability.lastConnectionTime = now;
        
        console.log('WebSocket connected - ready for live updates');
        // Update connection status if indicator exists
        updateConnectionStatus();
        
        // Only switch from fallback to WebSocket if connection is stable
        if (currentActiveTab === 'live' && liveUpdateInterval && !connectionStability.shouldUseFallback) {
            console.log('Switching live tab from fallback to WebSocket updates');
            clearInterval(liveUpdateInterval);
            liveUpdateInterval = null;
        }
    });

    socket.on('disconnect', (reason) => {
        isConnected = false;
        console.log('WebSocket disconnected:', reason);
        console.log('Disconnect details:', {
            reason: reason,
            transport: socket.io?.engine?.transport?.name,
            wasConnected: socket.connected,
            consecutiveDisconnects: connectionStability.consecutiveDisconnects
        });
        updateConnectionStatus();
        
        // Always start fallback immediately if we're on live tab and don't have it running
        if (currentActiveTab === 'live' && !liveUpdateInterval && currentLiveMatch) {
            console.log('Starting polling fallback due to disconnect');
            startLiveUpdates(currentLiveMatch);
        }
        
        // Handle different disconnect reasons - be less aggressive about reconnecting
        if (reason === 'transport close' || reason === 'transport error') {
            console.log('Transport issue detected');
            
            // Don't immediately force fallback mode
            if (connectionStability.consecutiveDisconnects >= 3) {
                connectionStability.shouldUseFallback = true;
                connectionStability.fallbackStartTime = Date.now();
                console.log('Multiple transport issues, enabling fallback mode');
            }
            
            // Only try to reconnect if we haven't hit too many consecutive disconnects
            if (connectionStability.consecutiveDisconnects < 7 && reconnectAttempts < maxReconnectAttempts) {
                setTimeout(() => {
                    reconnectAttempts++;
                    console.log(`Reconnect attempt ${reconnectAttempts}/${maxReconnectAttempts} after transport issue`);
                    if (socket && !socket.connected) {
                        socket.connect();
                    }
                }, reconnectDelay * (reconnectAttempts + 2)); // Longer delay for transport issues
            } else {
                console.log('Too many transport issues, staying in fallback mode');
                connectionStability.shouldUseFallback = true;
                connectionStability.fallbackStartTime = Date.now();
            }
        } else if (reason !== 'io client disconnect' && reconnectAttempts < maxReconnectAttempts && connectionStability.consecutiveDisconnects < 7) {
            // For other disconnect reasons, try normal reconnection if connection isn't too unstable
            setTimeout(() => {
                reconnectAttempts++;
                console.log(`Reconnect attempt ${reconnectAttempts}/${maxReconnectAttempts}`);
                if (socket && !socket.connected) {
                    socket.connect();
                }
            }, reconnectDelay * (reconnectAttempts + 1));
        } else {
            console.log('WebSocket deemed unreliable, staying in polling mode');
            connectionStability.shouldUseFallback = true;
            connectionStability.fallbackStartTime = Date.now();
        }
    });

    socket.on('connect_error', (error) => {
        console.error('WebSocket connection error:', error);
        isConnected = false;
        updateConnectionStatus();
        
        // Force fallback mode after connection errors
        connectionStability.shouldUseFallback = true;
        connectionStability.fallbackStartTime = Date.now();
        connectionStability.consecutiveDisconnects++;
        
        // If we have connection errors, start polling fallback immediately
        if (currentActiveTab === 'live' && !liveUpdateInterval && currentLiveMatch) {
            console.log('Starting polling fallback due to connection error');
            startLiveUpdates(currentLiveMatch);
        }
        
        // Don't try to reconnect immediately after connection errors
        reconnectAttempts++;
    });
    
    // Handle reconnect error
    socket.on('reconnect_error', (error) => {
        console.error('WebSocket reconnect error:', error);
    });
    
    // Handle transport errors specifically
    socket.on('error', (error) => {
        console.error('WebSocket transport error:', error);
        // Force switch to polling if we get transport errors
        if (currentActiveTab === 'live' && !liveUpdateInterval && currentLiveMatch) {
            console.log('Starting polling fallback due to transport error');
            startLiveUpdates(currentLiveMatch);
        }
    });

    // Setup WebSocket event listeners
    setupWebSocketEventListeners();
    
    return true;
}

function updateConnectionStatus() {
    // Optional: Update connection status indicator if it exists
    const statusElement = document.getElementById('connection-status');
    if (statusElement) {
        if (isConnected) {
            statusElement.innerHTML = '<i class="fas fa-circle" style="color: #16a34a;"></i> Live';
            statusElement.title = 'WebSocket Verbindung aktiv';
        } else {
            statusElement.innerHTML = '<i class="fas fa-circle" style="color: #dc2626;"></i> Offline';
            statusElement.title = 'WebSocket Verbindung getrennt';
        }
    }
}

function setupWebSocketEventListeners() {
    // Live Score Updates - update live display immediately
    socket.on('live-score-update', (data) => {
        console.log('Live score update received:', data);
        console.log('Data check:', {
            hasData: !!data,
            hasMatch: !!(data && data.match),
            currentTab: currentActiveTab
        });
        
        if (data && data.match) {
            console.log('Calling updateLiveScoreDisplay');
            updateLiveScoreDisplay(data);
            // If we're on the live tab and the elements don't exist yet, refresh the live content
            if (currentActiveTab === 'live' && !document.getElementById('live-score1')) {
                console.log('Refreshing live content because elements not found');
                loadLiveMatch();
            }
            // Also update schedule tab if it's active (to show updated live scores)
            if (currentActiveTab === 'schedule') {
                console.log('Refreshing schedule tab');
                loadSchedule();
            }
        } else {
            console.log('Skipping updateLiveScoreDisplay - no data or match');
        }
        
        // Also update tables if match is completed with this score update
        if (data && data.match && data.match.completed && currentActiveTab === 'tables') {
            setTimeout(() => loadTables(), 2000);
        }
    });

    // Match Started - refresh live tab and home statistics
    socket.on('match-started', (data) => {
        console.log('Match started:', data);
        showNotification(`Spiel gestartet: ${data.match.team1} vs ${data.match.team2}`, 'info');
        
        if (currentActiveTab === 'live') {
            // Immediately start timer with new match data
            if (data.match) {
                currentLiveMatch = data.match;
                startLocalLiveTimer(data.match);
            }
            coordinatedUpdate(() => loadLiveMatch(), 1000);
        }
        if (currentActiveTab === 'home') {
            coordinatedUpdate(() => updateStats(), 1000);
        }
    });

    // Match Finished - refresh multiple tabs
    socket.on('match-finished', (data) => {
        console.log('Match finished:', data);
        showNotification(`Spiel beendet: ${data.match.team1} vs ${data.match.team2}`, 'success');
        
        // Stop local timer since match ended
        stopLocalLiveTimer();
        currentLiveMatch = null;
        
        // Smart update for relevant tabs INCLUDING tables
        smartUpdate(['live', 'home', 'schedule', 'tables']);
        
        // Force table update if on tables tab
        if (currentActiveTab === 'tables') {
            setTimeout(() => loadTables(), 1500);
        }
    });

    // Match Result Added - refresh tables, schedule, and home
    socket.on('match-result-added', (data) => {
        console.log('Match result added:', data);
        showNotification(`Ergebnis eingetragen: ${data.match.team1} ${data.score1}:${data.score2} ${data.match.team2}`, 'success');
        
        // Smart update for relevant tabs
        smartUpdate(['tables', 'schedule', 'home']);
        
        // Force table update if on tables tab
        if (currentActiveTab === 'tables') {
            setTimeout(() => loadTables(), 1500);
        }
    });

    // Current Match Changed - update live display
    socket.on('current-match-changed', (data) => {
        console.log('Current match changed:', data);
        if (currentActiveTab === 'live') {
            // Stop current timer first
            stopLocalLiveTimer();
            currentLiveMatch = null;
            
            // Immediately reload to show new match
            coordinatedUpdate(() => loadLiveMatch(), 200);
        }
    });

    // Match Paused
    socket.on('match-paused', (data) => {
        console.log('Match paused:', data);
        if (currentActiveTab === 'live' && currentLiveMatch) {
            // Update local match data
            currentLiveMatch.isPaused = true;
            currentLiveMatch.pauseStartTime = data.pauseStartTime;
            showNotification(`Spiel pausiert: ${data.match.team1} vs ${data.match.team2}`, 'info');
        }
    });

    // Match Resumed
    socket.on('match-resumed', (data) => {
        console.log('Match resumed:', data);
        if (currentActiveTab === 'live' && currentLiveMatch) {
            // Update local match data
            currentLiveMatch.isPaused = false;
            currentLiveMatch.pausedTime = data.totalPausedTime;
            showNotification(`Spiel fortgesetzt: ${data.match.team1} vs ${data.match.team2}`, 'success');
        }
    });

    // Halftime Started
    socket.on('halftime-started', (data) => {
        console.log('Halftime started:', data);
        if (currentActiveTab === 'live' && currentLiveMatch) {
            currentLiveMatch.halfTimeBreak = true;
            currentLiveMatch.firstHalfEndTime = data.firstHalfEndTime;
            showNotification(`Halbzeit: ${data.match.team1} vs ${data.match.team2}`, 'info');
        }
    });

    // Second Half Started
    socket.on('second-half-started', (data) => {
        console.log('Second half started:', data);
        if (currentActiveTab === 'live') {
            if (currentLiveMatch) {
                currentLiveMatch.halfTimeBreak = false;
                currentLiveMatch.currentHalf = 2;
                currentLiveMatch.secondHalfStartTime = data.secondHalfStartTime;
            }
            showNotification(`2. Halbzeit gestartet: ${data.match.team1} vs ${data.match.team2}`, 'success');
            // Reload live display to show correct UI
            coordinatedUpdate(() => loadLiveMatch(), 500);
        }
    });

    // Data Imported - refresh all content
    socket.on('data-imported', (data) => {
        console.log('Data imported:', data);
        showNotification(`Turnierdaten aktualisiert: ${data.teamsCount} Teams, ${data.matchesCount} Spiele`, 'info');
        // Force update regardless of timing
        debouncedTabUpdate(currentActiveTab);
    });

    // Team Registered/Updated - refresh teams and home
    socket.on('team-registered', (data) => {
        console.log('Team registered:', data);
        smartUpdate(['teams', 'home']);
    });

    // Tournament Status Changed
    socket.on('tournament-status-changed', (data) => {
        console.log('Tournament status changed:', data);
        // Check registration status
        checkRegistrationStatus();
        if (currentActiveTab === 'home') {
            coordinatedUpdate(() => updateStats(), 1000);
        }
        // Refresh live display if on live tab
        if (currentActiveTab === 'live') {
            coordinatedUpdate(() => loadLiveMatch(), 500);
        }
    });

    // Matches Generated - refresh live display to show new schedule
    socket.on('matches-generated', (data) => {
        console.log('Matches generated:', data);
        showNotification(`Spielplan erstellt: ${data.totalMatches} Spiele generiert`, 'success');
        // Refresh live display immediately to show next match
        if (currentActiveTab === 'live') {
            coordinatedUpdate(() => loadLiveMatch(), 300);
        }
        // Also refresh other relevant tabs
        smartUpdate(['matches', 'home']);
    });

    // Matches Scheduled - refresh countdown timers and schedule displays
    socket.on('matches-scheduled', (data) => {
        console.log('Matches scheduled:', data);
        showNotification(`${data.scheduledCount} Spiele zeitlich geplant`, 'success');
        // Refresh live display to update countdown timers
        if (currentActiveTab === 'live') {
            coordinatedUpdate(() => loadLiveMatch(), 200);
        }
        // Also refresh matches tab to show updated schedule
        smartUpdate(['matches', 'home']);
    });
}

// Helper function to update live score display without full reload
function updateLiveScoreDisplay(data) {
    try {
        console.log('updateLiveScoreDisplay called with data:', data);
        if (!data || !data.match) {
            console.log('No data or match found');
            return;
        }
        
        // Update display elements
        const score1Element = document.getElementById('live-score1');
        const score2Element = document.getElementById('live-score2');
        
        console.log('Score elements found:', {
            score1Element: !!score1Element,
            score2Element: !!score2Element,
            score1: data.score1,
            score2: data.score2
        });
        
        if (score1Element && data.score1 !== null && data.score1 !== undefined) {
            score1Element.textContent = data.score1;
            console.log('Updated score1 element to:', data.score1);
        }
        if (score2Element && data.score2 !== null && data.score2 !== undefined) {
            score2Element.textContent = data.score2;
            console.log('Updated score2 element to:', data.score2);
        }
        
        // Update local match data for timer calculations
        if (currentLiveMatch) {
            currentLiveMatch.score1 = data.score1;
            currentLiveMatch.score2 = data.score2;
            // Update other match properties if available from data.match
            if (data.match) {
                if (data.match.isPaused !== undefined) currentLiveMatch.isPaused = data.match.isPaused;
                if (data.match.currentHalf !== undefined) currentLiveMatch.currentHalf = data.match.currentHalf;
                if (data.match.halfTimeBreak !== undefined) currentLiveMatch.halfTimeBreak = data.match.halfTimeBreak;
            }
            console.log('Updated currentLiveMatch scores:', currentLiveMatch.score1, currentLiveMatch.score2);
        }
    } catch (error) {
        console.error('Error updating live score display:', error);
    }
}

// Navigation
navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const targetTab = btn.dataset.tab;
        
        // Stop local timer if switching away from live tab
        if (currentActiveTab === 'live' && targetTab !== 'live') {
            stopLocalLiveTimer();
        }
        
        // Update current active tab
        currentActiveTab = targetTab;
        localStorage.setItem('currentTab', targetTab);
        
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
            // Ensure auto-refresh is running for home
            setTimeout(() => startScheduleAutoRefresh(), 500);
            break;
        case 'live':
            loadLiveMatch();
            break;
        case 'register':
            checkRegistrationStatus();
            break;
        case 'teams':
            loadTeams();
            // Ensure auto-refresh is running for teams
            setTimeout(() => startScheduleAutoRefresh(), 500);
            break;
        case 'schedule':
            loadSchedule();
            // Ensure auto-refresh is running for schedule
            setTimeout(() => startScheduleAutoRefresh(), 500);
            break;
        case 'tables':
            loadTables();
            // Always ensure auto-refresh is running for tables
            setTimeout(() => startScheduleAutoRefresh(), 500);
            break;
        case 'knockout':
            loadKnockoutMatches();
            break;
        case 'contact':
            loadContact();
            break;
        case 'rules':
            loadRules();
            break;
    }
}

// Fallback auto-refresh mechanism (only when WebSocket is not connected)
function startScheduleAutoRefresh() {
    // Only start polling if WebSocket is not ready
    if (isWebSocketReady()) {
        console.log('WebSocket ready, skipping polling-based auto-refresh');
        return;
    }
    
    if (scheduleRefreshInterval) {
        clearInterval(scheduleRefreshInterval);
    }
    
    console.log('WebSocket not available, starting fallback polling...');
    scheduleRefreshInterval = setInterval(async () => {
        try {
            // Skip if WebSocket becomes available
            if (isWebSocketReady()) {
                clearInterval(scheduleRefreshInterval);
                scheduleRefreshInterval = null;
                console.log('WebSocket reconnected, stopping fallback polling');
                return;
            }
            
            // Check if schedule was updated
            const response = await fetch('/api/tournament');
            const data = await response.json();
            
            if (data.tournament && data.tournament.lastUpdated) {
                if (lastScheduleUpdate && new Date(data.tournament.lastUpdated) > new Date(lastScheduleUpdate)) {
                    console.log('Schedule updated via fallback polling, refreshing content...');
                    if (['schedule', 'teams', 'tables', 'home', 'live'].includes(currentActiveTab)) {
                        loadTabContent(currentActiveTab);
                    }
                }
                lastScheduleUpdate = data.tournament.lastUpdated;
            }
        } catch (error) {
            console.error('Error checking for schedule updates via fallback:', error);
        }
    }, 10000); // Check every 10 seconds (less frequent than before)
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

// TRIKOTFARBEN-FUNKTIONEN
async function loadJerseyColors() {
    try {
        const response = await fetch('/api/jersey-colors');
        availableColors = await response.json();
        
        const jerseySelect = document.getElementById('jersey-color');
        
        // Clear existing options (except first)
        while (jerseySelect.children.length > 1) {
            jerseySelect.removeChild(jerseySelect.lastChild);
        }
        
        // Add color options
        availableColors.forEach(color => {
            const option = document.createElement('option');
            option.value = color.value;
            option.textContent = `${color.name} ${color.usage > 0 ? `(${color.usage}x vergeben)` : ''}`;
            option.setAttribute('data-hex', color.hex);
            option.setAttribute('data-usage', color.usage);
            jerseySelect.appendChild(option);
        });
        
    } catch (error) {
        console.error('Error loading jersey colors:', error);
    }
}

function updateJerseyColorPreview() {
    const jerseySelect = document.getElementById('jersey-color');
    const preview = document.getElementById('jersey-color-preview');
    const colorSample = document.getElementById('color-sample');
    const colorName = document.getElementById('color-name');
    const usageInfo = document.getElementById('color-usage-info');
    
    const selectedOption = jerseySelect.selectedOptions[0];
    
    if (selectedOption && selectedOption.value) {
        const hex = selectedOption.getAttribute('data-hex');
        const usage = parseInt(selectedOption.getAttribute('data-usage')) || 0;
        
        // Show preview
        preview.style.display = 'flex';
        colorSample.style.backgroundColor = hex;
        colorSample.style.borderColor = hex === '#ffffff' ? '#ccc' : hex;
        colorName.textContent = selectedOption.textContent;
        
        // Update usage info
        if (usage === 0) {
            usageInfo.textContent = '✅ Diese Farbe ist noch frei';
            usageInfo.className = 'color-usage-info available';
        } else {
            usageInfo.textContent = `⚠️ Diese Farbe wurde bereits ${usage}x vergeben`;
            usageInfo.className = 'color-usage-info taken';
        }
    } else {
        preview.style.display = 'none';
        usageInfo.textContent = '';
    }
}

// Event listener für Farbauswahl
document.addEventListener('DOMContentLoaded', () => {
    const jerseySelect = document.getElementById('jersey-color');
    if (jerseySelect) {
        jerseySelect.addEventListener('change', updateJerseyColorPreview);
    }
});

// Team Registration (erweitert mit Trikotfarbe)
teamForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const teamName = document.getElementById('team-name').value;
    const contactName = document.getElementById('contact-name').value;
    const contactInfo = document.getElementById('contact-info').value;
    const jerseyColor = document.getElementById('jersey-color').value;
    
    if (!jerseyColor) {
        showNotification('Bitte eine Trikotfarbe auswählen', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/teams', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ teamName, contactName, contactInfo, jerseyColor })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Team erfolgreich angemeldet!');
            teamForm.reset();
            updateJerseyColorPreview(); // Reset preview
            updateStats();
            
            // Reload colors to update usage count
            await loadJerseyColors();
            
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

// Check Registration Status (erweitert)
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
            
            // Lade Trikotfarben
            await loadJerseyColors();
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
        const halftimeBreakMinutes = liveMatch.halftimeBreakMinutes || 1;
        
        // Berechne verbleibende Halbzeitpause
        if (liveMatch.firstHalfEndTime) {
            const firstHalfEnd = new Date(liveMatch.firstHalfEndTime);
            const halftimeElapsed = Math.floor((now - firstHalfEnd) / 1000);
            const halftimeTotal = halftimeBreakMinutes * 60;
            const halftimeRemaining = Math.max(0, halftimeTotal - halftimeElapsed);
            
            const remainingMinutes = Math.floor(halftimeRemaining / 60);
            const remainingSeconds = halftimeRemaining % 60;
            
            if (halftimeRemaining > 0) {
                return {
                    displayTime: formatTime(remainingMinutes, remainingSeconds),
                    halfInfo: 'HALBZEITPAUSE',
                    currentMinute: remainingMinutes,
                    currentSecond: remainingSeconds
                };
            }
        }
        
        // Wenn Halbzeitpause abgelaufen ist
        return {
            displayTime: '00:00',
            halfInfo: '2. HALBZEIT BEREIT',
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
            
            // NÄCHSTER SCHIEDSRICHTER WÄHREND LIVE-SPIEL
            if (nextData.nextMatch && nextData.nextMatch.referee) {
                html += `
                    <div class="next-referee-alert">
                        <div class="next-referee-header">
                            <i class="fas fa-whistle"></i>
                            <span>Nächster Schiedsrichter bereitmachen:</span>
                        </div>
                        <div class="next-referee-team">${nextData.nextMatch.referee.team}</div>
                        <div class="next-referee-details">
                            Für: ${nextData.nextMatch.team1} vs ${nextData.nextMatch.team2}
                        </div>
                    </div>
                `;
            }
            
            // Start live updates
            startLiveUpdates(liveMatch);
        }
        // VERBESSERUNG: Auch wenn kein Live-Spiel läuft, zeige das nächste Spiel
        else {
            // Lade das nächste Spiel aus dem Spielplan
            let nextMatch = nextData.nextMatch;
            
            // Falls kein nächstes Spiel von API, versuche es aus dem Spielplan zu finden
            if (!nextMatch) {
                nextMatch = await findNextScheduledMatch();
            }
            
            // Update nextData with found match for later logic
            if (nextMatch && !nextData.nextMatch) {
                nextData.nextMatch = nextMatch;
            }
            
            if (nextMatch) {
                let nextTime = null;
                let timeUntilMatch = 0;
                let minutesUntil = 0;
                
                if (nextMatch.scheduled && nextMatch.scheduled.datetime) {
                    nextTime = new Date(nextMatch.scheduled.datetime);
                    timeUntilMatch = nextTime - new Date();
                    minutesUntil = Math.max(0, Math.floor(timeUntilMatch / (1000 * 60)));
                } else if (nextMatch.datetime) {
                    nextTime = new Date(nextMatch.datetime);
                    timeUntilMatch = nextTime - new Date();
                    minutesUntil = Math.max(0, Math.floor(timeUntilMatch / (1000 * 60)));
                }
            
            html += `
                <div class="next-match-display-improved">
                    <div class="next-match-label">
                        <h2><i class="fas fa-forward"></i> Nächstes Spiel:</h2>
                    </div>
                    
                    <div class="next-match-main-content">
                        <div class="next-match-teams-improved">
                            <div class="team-name-improved">${nextMatch.team1}</div>
                            <div class="vs-large-improved">VS</div>
                            <div class="team-name-improved">${nextMatch.team2}</div>
                        </div>
                        
                        <div class="next-match-info-grid">
                            ${nextTime ? `
                                <div class="info-item">
                                    <i class="fas fa-clock"></i>
                                    <div class="info-content">
                                        <div class="info-label">Zeit</div>
                                        <div class="info-value">${nextTime.toLocaleTimeString('de-DE', {hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin'})}</div>
                                        <div class="countdown-display" data-next-time="${nextTime.toISOString()}">${minutesUntil > 0 ? `in ${minutesUntil} Min.` : 'Startet gleich!'}</div>
                                    </div>
                                </div>
                            ` : `
                                <div class="info-item">
                                    <i class="fas fa-clock"></i>
                                    <div class="info-content">
                                        <div class="info-label">Status</div>
                                        <div class="info-value">Noch nicht geplant</div>
                                    </div>
                                </div>
                            `}
                            <div class="info-item">
                                <i class="fas fa-layer-group"></i>
                                <div class="info-content">
                                    <div class="info-label">Gruppe</div>
                                    <div class="info-value">${nextMatch.group}</div>
                                </div>
                            </div>
                        </div>
                        
                        ${nextMatch.referee ? `
                            <div class="referee-display-super-prominent">
                                <div class="referee-badge">
                                    <i class="fas fa-whistle"></i>
                                    <span>SCHIEDSRICHTER</span>
                                </div>
                                <div class="referee-name-super-big">${nextMatch.referee.team}</div>
                                <div class="referee-group-info">${nextMatch.referee.group}</div>
                            </div>
                        ` : `
                            <div class="no-referee-display">
                                <i class="fas fa-user-question"></i>
                                <span>Kein Schiedsrichter zugewiesen</span>
                            </div>
                        `}
                    </div>
                </div>
            `;
        }
        }
        
        // Weitere kommende Spiele (falls vorhanden)
        if (nextData.nextMatch) {
            // Lade weitere Spiele
            try {
                const matchesResponse = await fetch('/api/matches');
                const allMatches = await matchesResponse.json();
                
                const now = new Date();
                const upcomingMatches = allMatches
                    .filter(m => m.scheduled && !m.completed && new Date(m.scheduled.datetime) > now)
                    .sort((a, b) => new Date(a.scheduled.datetime) - new Date(b.scheduled.datetime))
                    .slice(1, 4); // Nächste 3 Spiele (ohne das erste, das schon angezeigt wird)
                
                if (upcomingMatches.length > 0) {
                    html += `
                        <div class="upcoming-matches-section">
                            <h4><i class="fas fa-forward"></i> Weitere kommende Spiele</h4>
                            <div class="upcoming-matches-list">
                    `;
                    
                    upcomingMatches.forEach(match => {
                        const matchTime = new Date(match.scheduled.datetime);
                        html += `
                            <div class="upcoming-match-item">
                                <div class="match-time">${matchTime.toLocaleTimeString('de-DE', {hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin'})}</div>
                                <div class="match-teams">${match.team1} vs ${match.team2}</div>
                                <div class="match-info">${match.group}</div>
                                ${match.referee ? `
                                    <div class="match-referee">
                                        <i class="fas fa-whistle"></i> ${match.referee.team}
                                    </div>
                                ` : ''}
                            </div>
                        `;
                    });
                    
                    html += `
                            </div>
                        </div>
                    `;
                }
            } catch (error) {
                console.error('Error loading upcoming matches:', error);
            }
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
            
            // Clear existing intervals
            if (liveUpdateInterval) {
                clearInterval(liveUpdateInterval);
                liveUpdateInterval = null;
            }
            stopLocalLiveTimer();
            stopCountdownTimer();
        }
        
        liveContent.innerHTML = html;
        
        // Start countdown timer for "Startet in X Min" updates
        startCountdownTimer();
        
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
    // Start local timer only if not already running
    if (!localLiveTimerInterval) {
        startLocalLiveTimer(liveMatch);
    } else {
        // Update the match data for existing timer
        currentLiveMatch = liveMatch;
        console.log('Local timer already running, updated match data');
    }
    
    // Only start polling if WebSocket is not ready
    if (isWebSocketReady()) {
        console.log('WebSocket ready, live updates handled via WebSocket events');
        return;
    }
    
    console.log('WebSocket not ready, starting fallback live updates...');
    
    // Clear existing interval
    if (liveUpdateInterval) {
        clearInterval(liveUpdateInterval);
    }
    
    liveUpdateInterval = setInterval(async () => {
        try {
            // Skip if WebSocket becomes available
            if (isWebSocketReady()) {
                clearInterval(liveUpdateInterval);
                liveUpdateInterval = null;
                console.log('WebSocket reconnected, stopping fallback live updates');
                return;
            }
            
            // Fetch latest data first
            const [liveResponse, nextResponse] = await Promise.all([
                fetch('/api/live-match'),
                fetch('/api/next-match')
            ]);
            
            const liveData = await liveResponse.json();
            const nextData = await nextResponse.json();
            
            if (!liveData.liveMatch) {
                // Match ended, reload entire live match display to show next match
                console.log('Match ended, reloading live match display');
                loadLiveMatch();
                return;
            }
            
            // Update liveMatch object with fresh data
            const updatedMatch = liveData.liveMatch;
            
            // Update local match data for timer consistency
            if (currentLiveMatch) {
                Object.assign(currentLiveMatch, updatedMatch);
            } else {
                currentLiveMatch = updatedMatch;
                // Restart timer with updated data
                startLocalLiveTimer(updatedMatch);
            }
            
            // Update timer (local timer should be handling this, but fallback for display)
            const timeInfo = calculateLiveTime(updatedMatch);
            const timerElement = document.getElementById('live-timer');
            const halfElement = document.getElementById('live-half-info');
            
            if (timerElement) {
                timerElement.textContent = timeInfo.displayTime;
                console.log(`Updated viewer timer (fallback): ${timeInfo.displayTime} - ${timeInfo.halfInfo}`);
            }
            if (halfElement) halfElement.textContent = timeInfo.halfInfo;
            
            // Update scores
            const score1Element = document.getElementById('live-score1');
            const score2Element = document.getElementById('live-score2');
            
            if (score1Element) score1Element.textContent = updatedMatch.score1;
            if (score2Element) score2Element.textContent = updatedMatch.score2;
            
            // Update next referee info if needed
            const existingRefereeAlert = document.querySelector('.next-referee-alert');
            if (nextData.nextMatch && nextData.nextMatch.referee && !existingRefereeAlert) {
                // Add referee alert if not present
                const liveDisplay = document.querySelector('.live-match-display');
                if (liveDisplay) {
                    const refereeAlert = document.createElement('div');
                    refereeAlert.className = 'next-referee-alert';
                    refereeAlert.innerHTML = `
                        <div class="next-referee-header">
                            <i class="fas fa-whistle"></i>
                            <span>Nächster Schiedsrichter bereitmachen:</span>
                        </div>
                        <div class="next-referee-team">${nextData.nextMatch.referee.team}</div>
                        <div class="next-referee-details">
                            Für: ${nextData.nextMatch.team1} vs ${nextData.nextMatch.team2}
                        </div>
                    `;
                    liveDisplay.parentNode.insertBefore(refereeAlert, liveDisplay.nextSibling);
                }
            }
            
        } catch (error) {
            console.error('Fehler beim Live-Update (fallback):', error);
        }
    }, 2000); // Less frequent polling: 2 seconds instead of 1
}

// Local Live Timer for smooth display updates
function startLocalLiveTimer(liveMatch) {
    console.log('Starting local live timer for public view...');
    
    // Store the current match data locally
    currentLiveMatch = liveMatch;
    
    // Clear existing timer
    if (localLiveTimerInterval) {
        clearInterval(localLiveTimerInterval);
    }
    
    // Start local timer that updates every second
    localLiveTimerInterval = setInterval(() => {
        if (!currentLiveMatch || currentActiveTab !== 'live') {
            return;
        }
        
        try {
            // Calculate time based on stored match data and current time
            const timeInfo = calculateLiveTime(currentLiveMatch);
            
            const timerElement = document.getElementById('live-timer');
            const halfElement = document.getElementById('live-half-info');
            
            if (timerElement) {
                timerElement.textContent = timeInfo.displayTime;
            }
            if (halfElement) {
                halfElement.textContent = timeInfo.halfInfo;
            }
            
        } catch (error) {
            console.error('Local timer update error:', error);
        }
    }, 1000); // Update every second for smooth timer
}

// Global countdown timer for updating "Startet in X Min" displays
let countdownTimerInterval = null;

function startCountdownTimer() {
    // Clear existing timer
    if (countdownTimerInterval) {
        clearInterval(countdownTimerInterval);
    }
    
    // Start countdown timer that updates every 30 seconds
    countdownTimerInterval = setInterval(() => {
        if (currentActiveTab !== 'live') {
            return;
        }
        
        try {
            // Update countdown displays
            updateCountdownDisplays();
        } catch (error) {
            console.error('Countdown timer update error:', error);
        }
    }, 30000); // Update every 30 seconds
}

function updateCountdownDisplays() {
    const countdownElements = document.querySelectorAll('.countdown-display');
    countdownElements.forEach(element => {
        const nextTime = element.dataset.nextTime;
        if (nextTime) {
            const timeUntilMatch = new Date(nextTime) - new Date();
            const minutesUntil = Math.max(0, Math.floor(timeUntilMatch / (1000 * 60)));
            element.textContent = minutesUntil > 0 ? `in ${minutesUntil} Min.` : 'Startet gleich!';
        }
    });
}

// Stop local live timer
function stopLocalLiveTimer() {
    if (localLiveTimerInterval) {
        clearInterval(localLiveTimerInterval);
        localLiveTimerInterval = null;
        console.log('Stopped local live timer');
    }
}

// Stop countdown timer
function stopCountdownTimer() {
    if (countdownTimerInterval) {
        clearInterval(countdownTimerInterval);
        countdownTimerInterval = null;
        console.log('Stopped countdown timer');
    }
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

// Load Functions (erweitert mit Trikotfarben)
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
                ${team.jerseyColor ? `
                    <div class="team-jersey-color">
                        <div class="jersey-color-display" style="background-color: ${getJerseyColorHex(team.jerseyColor)}; border-color: ${team.jerseyColor === 'white' ? '#ccc' : getJerseyColorHex(team.jerseyColor)};"></div>
                        <span>${getJerseyColorName(team.jerseyColor)}</span>
                    </div>
                ` : ''}
            </div>
        `).join('');
    } catch (error) {
        console.error('Fehler beim Laden der Teams:', error);
    }
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
                            <strong>${matchTime.toLocaleTimeString('de-DE', {hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin'})}</strong>
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
        
        // Debug logging for troubleshooting
        console.log('Tournament data for tables:', {
            hasTournament: !!data.tournament,
            status: data.tournament?.status,
            hasGroups: !!(data.tournament?.groups),
            groupsLength: data.tournament?.groups?.length || 0,
            groups: data.tournament?.groups
        });
        
        if (!data.tournament.groups || data.tournament.groups.length === 0) {
            // Try to generate tables from existing matches if tournament is running or finished
            if (data.tournament.status === 'active' || data.tournament.status === 'running' || data.tournament.status === 'finished' || data.tournament.status === 'completed') {
                // Fetch matches to generate table data
                try {
                    const matchesResponse = await fetch('/api/matches');
                    const matches = await matchesResponse.json();
                    
                    if (matches && matches.length > 0) {
                        console.log('Generating tables from matches data');
                        // Generate groups from matches
                        const groupsFromMatches = generateGroupsFromMatches(matches);
                        if (groupsFromMatches.length > 0) {
                            data.tournament.groups = groupsFromMatches;
                        }
                    }
                } catch (matchError) {
                    console.error('Error fetching matches for table generation:', matchError);
                }
            }
            
            // If still no groups, show appropriate message
            if (!data.tournament.groups || data.tournament.groups.length === 0) {
                tablesContent.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-table"></i>
                        <h3>Keine Tabellen verfügbar</h3>
                        <p>Die Gruppentabellen werden erstellt, sobald das Turnier startet und Spiele gespielt werden.</p>
                        ${data.tournament.status !== 'active' && data.tournament.status !== 'finished' && data.tournament.status !== 'completed' ? `
                            <div style="margin-top: 1rem; padding: 1rem; background: #fef3c7; border-radius: 0.5rem;">
                                <strong>Turnier-Status:</strong> ${data.tournament.status}<br>
                                <small>Tabellen werden angezeigt wenn Status "active", "finished" oder "completed" ist und Gruppen vorhanden sind.</small>
                            </div>
                        ` : ''}
                    </div>
                `;
                return;
            }
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
            // Debug logging for group structure
            console.log('Group data:', {
                name: group.name,
                hasTable: !!group.table,
                tableLength: group.table?.length || 0,
                table: group.table
            });
            
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
            
            if (!group.table || group.table.length === 0) {
                html += `
                    <tr>
                        <td colspan="9" style="text-align: center; color: #666; padding: 2rem;">
                            Keine Tabellendaten verfügbar
                        </td>
                    </tr>
                `;
            } else {
                console.log(`Rendering table for ${group.name} with ${group.table.length} entries`);
                group.table.forEach((entry, index) => {
                    console.log(`Rendering entry ${index + 1}:`, entry);
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
            }
            
            html += `
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        });
        
        console.log('Final table HTML length:', html.length);
        console.log('Setting tablesContent.innerHTML');
        tablesContent.innerHTML = html;
        console.log('Table HTML set successfully');
    } catch (error) {
        console.error('Fehler beim Laden der Tabellen:', error);
        const tablesContent = document.getElementById('tables-content');
        tablesContent.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-exclamation-triangle"></i>
                <h3>Fehler beim Laden der Tabellen</h3>
                <p>Die Tabellen konnten nicht geladen werden. Bitte versuche es später erneut.</p>
            </div>
        `;
    }
}

// Helper function to generate groups from matches
function generateGroupsFromMatches(matches) {
    if (!matches || matches.length === 0) return [];
    
    // Group matches by their group property
    const groupsMap = new Map();
    
    matches.forEach(match => {
        if (match.group) {
            if (!groupsMap.has(match.group)) {
                groupsMap.set(match.group, {
                    name: match.group,
                    teams: new Set(),
                    matches: []
                });
            }
            
            const group = groupsMap.get(match.group);
            group.teams.add(match.team1);
            group.teams.add(match.team2);
            group.matches.push(match);
        }
    });
    
    // Convert to groups with table data
    return Array.from(groupsMap.values()).map(group => {
        const teams = Array.from(group.teams);
        const table = generateTableForGroup(teams, group.matches);
        
        return {
            name: group.name,
            teams: teams,
            table: table
        };
    });
}

// Helper function to generate table for a group
function generateTableForGroup(teams, matches) {
    const table = teams.map(team => ({
        team: team,
        games: 0,      // Changed from 'played' to 'games'
        wins: 0,       // Changed from 'won' to 'wins'
        draws: 0,      // Changed from 'drawn' to 'draws'
        losses: 0,     // Changed from 'lost' to 'losses'
        goalsFor: 0,
        goalsAgainst: 0,
        goalDiff: 0,   // Changed from 'goalDifference' to 'goalDiff'
        points: 0
    }));
    
    // Calculate stats from completed matches
    matches.forEach(match => {
        if (match.completed && match.score1 !== undefined && match.score2 !== undefined) {
            const team1Stats = table.find(t => t.team === match.team1);
            const team2Stats = table.find(t => t.team === match.team2);
            
            if (team1Stats && team2Stats) {
                team1Stats.games++;
                team2Stats.games++;
                team1Stats.goalsFor += match.score1;
                team1Stats.goalsAgainst += match.score2;
                team2Stats.goalsFor += match.score2;
                team2Stats.goalsAgainst += match.score1;
                
                if (match.score1 > match.score2) {
                    team1Stats.wins++;
                    team1Stats.points += 3;
                    team2Stats.losses++;
                } else if (match.score1 < match.score2) {
                    team2Stats.wins++;
                    team2Stats.points += 3;
                    team1Stats.losses++;
                } else {
                    team1Stats.draws++;
                    team2Stats.draws++;
                    team1Stats.points += 1;
                    team2Stats.points += 1;
                }
                
                team1Stats.goalDiff = team1Stats.goalsFor - team1Stats.goalsAgainst;
                team2Stats.goalDiff = team2Stats.goalsFor - team2Stats.goalsAgainst;
            }
        }
    });
    
    // Sort by points, then goal difference, then goals for
    table.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.goalDiff !== a.goalDiff) return b.goalDiff - a.goalDiff;
        return b.goalsFor - a.goalsFor;
    });
    
    return table;
}

// Function to find the next scheduled match from the schedule
async function findNextScheduledMatch() {
    try {
        const response = await fetch('/api/matches');
        const matches = await response.json();
        
        if (!matches || matches.length === 0) {
            return null;
        }
        
        const now = new Date();
        
        // Filter for matches that haven't started yet
        const upcomingMatches = matches.filter(match => {
            // If match has scheduled time, check if it's in the future
            if (match.scheduled && match.scheduled.datetime) {
                return !match.completed && 
                       (!match.liveScore || !match.liveScore.isLive) &&
                       new Date(match.scheduled.datetime) >= now;
            }
            // If no scheduled time, just check if it's not completed and not live
            return !match.completed && (!match.liveScore || !match.liveScore.isLive);
        });
        
        // Sort by datetime if available, otherwise keep original order
        upcomingMatches.sort((a, b) => {
            if (a.scheduled && a.scheduled.datetime && b.scheduled && b.scheduled.datetime) {
                return new Date(a.scheduled.datetime) - new Date(b.scheduled.datetime);
            }
            // If no scheduled times, keep original order
            return 0;
        });
        return upcomingMatches[0] || null;
        
    } catch (error) {
        console.error('Error finding next scheduled match:', error);
        return null;
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
                ${team.jerseyColor ? `
                    <div class="team-jersey-color">
                        <div class="jersey-color-display" style="background-color: ${getJerseyColorHex(team.jerseyColor)}; border-color: ${team.jerseyColor === 'white' ? '#ccc' : getJerseyColorHex(team.jerseyColor)};"></div>
                        <span>${getJerseyColorName(team.jerseyColor)}</span>
                    </div>
                ` : ''}
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

// Load knockout matches function
async function loadKnockoutMatches() {
    try {
        const response = await fetch('/api/matches');
        const matches = await response.json();
        
        const knockoutContent = document.getElementById('knockout-content');
        
        if (!matches || matches.length === 0) {
            knockoutContent.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-trophy"></i>
                    <h3>Keine KO-Spiele verfügbar</h3>
                    <p>Die KO-Spiele werden nach der Gruppenphase erstellt.</p>
                </div>
            `;
            return;
        }
        
        // Filter KO matches (by phase or group name)
        const koMatches = matches.filter(match => 
            match.phase === 'quarterfinal' || 
            match.phase === 'semifinal' || 
            match.phase === 'final' ||
            (match.group && (
                match.group.toLowerCase().includes('halbfinale') ||
                match.group.toLowerCase().includes('finale') ||
                match.group.toLowerCase().includes('platz') ||
                match.group.toLowerCase().includes('ko') ||
                match.group.toLowerCase().includes('semifinal') ||
                match.group.toLowerCase().includes('final') ||
                match.group.toLowerCase().includes('viertelfinale')
            ))
        );
        
        if (koMatches.length === 0) {
            knockoutContent.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-clock"></i>
                    <h3>KO-Phase steht noch aus</h3>
                    <p>Die KO-Spiele werden nach Abschluss der Gruppenphase erstellt.</p>
                    <div style="margin-top: 1rem; padding: 1rem; background: #f0f9ff; border-radius: 0.5rem;">
                        <strong>Ablauf:</strong><br>
                        1. Halbfinale<br>
                        2. Platzierungsspiele<br>
                        3. Finale
                    </div>
                </div>
            `;
            return;
        }
        
        // Group KO matches by type (check phase first, then group name)
        const quarterfinals = koMatches.filter(m => 
            m.phase === 'quarterfinal' || 
            (m.group && m.group.toLowerCase().includes('viertelfinale'))
        );
        const semifinals = koMatches.filter(m => 
            m.phase === 'semifinal' || 
            (m.group && (m.group.toLowerCase().includes('halbfinale') || m.group.toLowerCase().includes('semifinal')))
        );
        const thirdPlace = koMatches.filter(m => 
            m.group && m.group.toLowerCase().includes('platz')
        );
        const finals = koMatches.filter(m => 
            m.phase === 'final' || 
            (m.group && m.group.toLowerCase().includes('finale') && !m.group.toLowerCase().includes('halbfinale'))
        );
        
        let html = '';
        
        // Viertelfinale
        if (quarterfinals.length > 0) {
            html += `
                <div class="ko-stage">
                    <h3><i class="fas fa-medal"></i> Viertelfinale</h3>
                    <div class="ko-matches-grid">
            `;
            
            quarterfinals.forEach(match => {
                const matchTime = match.scheduled ? new Date(match.scheduled.datetime) : null;
                const statusClass = match.completed ? 'completed' : match.liveScore?.isLive ? 'live' : 'scheduled';
                
                html += `
                    <div class="ko-match-card ${statusClass}">
                        <div class="ko-match-header">
                            <span class="ko-match-type">${match.group}</span>
                            ${match.liveScore?.isLive ? '<span class="live-badge">LIVE</span>' : ''}
                        </div>
                        <div class="ko-match-teams">
                            <div class="ko-team">${match.team1}</div>
                            <div class="ko-match-score">
                                ${match.completed ? `${match.score1}:${match.score2}` : 
                                  match.liveScore?.isLive ? `${match.liveScore.score1}:${match.liveScore.score2}` : 'vs'}
                            </div>
                            <div class="ko-team">${match.team2}</div>
                        </div>
                        ${matchTime ? `
                            <div class="ko-match-time">
                                <i class="fas fa-clock"></i>
                                ${matchTime.toLocaleString('de-DE', {
                                    weekday: 'short',
                                    day: '2-digit',
                                    month: '2-digit',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    timeZone: 'Europe/Berlin'
                                })}
                            </div>
                        ` : ''}
                    </div>
                `;
            });
            
            html += `
                    </div>
                </div>
            `;
        }
        
        // Halbfinale
        if (semifinals.length > 0) {
            html += `
                <div class="ko-stage">
                    <h3><i class="fas fa-medal"></i> Halbfinale</h3>
                    <div class="ko-matches-grid">
            `;
            
            semifinals.forEach(match => {
                const matchTime = match.scheduled ? new Date(match.scheduled.datetime) : null;
                const statusClass = match.completed ? 'completed' : match.liveScore?.isLive ? 'live' : 'scheduled';
                
                html += `
                    <div class="ko-match-card ${statusClass}">
                        <div class="ko-match-header">
                            <span class="ko-match-type">${match.group}</span>
                            ${match.liveScore?.isLive ? '<span class="live-badge">LIVE</span>' : ''}
                        </div>
                        <div class="ko-match-teams">
                            <div class="ko-team">${match.team1}</div>
                            <div class="ko-match-score">
                                ${match.completed ? `${match.score1}:${match.score2}` : 
                                  match.liveScore?.isLive ? `${match.liveScore.score1}:${match.liveScore.score2}` : 'vs'}
                            </div>
                            <div class="ko-team">${match.team2}</div>
                        </div>
                        <div class="ko-match-time">
                            <i class="fas fa-clock"></i>
                            ${matchTime ? matchTime.toLocaleString('de-DE', {
                                weekday: 'short',
                                day: '2-digit',
                                month: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                                timeZone: 'Europe/Berlin'
                            }) : 'Noch nicht geplant'}
                        </div>
                    </div>
                `;
            });
            
            html += `
                    </div>
                </div>
            `;
        }
        
        // Platzierungsspiele
        if (thirdPlace.length > 0) {
            html += `
                <div class="ko-stage">
                    <h3><i class="fas fa-award"></i> Platzierungsspiele</h3>
                    <div class="ko-matches-grid">
            `;
            
            thirdPlace.forEach(match => {
                const matchTime = match.scheduled ? new Date(match.scheduled.datetime) : null;
                const statusClass = match.completed ? 'completed' : match.liveScore?.isLive ? 'live' : 'scheduled';
                
                html += `
                    <div class="ko-match-card ${statusClass}">
                        <div class="ko-match-header">
                            <span class="ko-match-type">${match.group}</span>
                            ${match.liveScore?.isLive ? '<span class="live-badge">LIVE</span>' : ''}
                        </div>
                        <div class="ko-match-teams">
                            <div class="ko-team">${match.team1}</div>
                            <div class="ko-match-score">
                                ${match.completed ? `${match.score1}:${match.score2}` : 
                                  match.liveScore?.isLive ? `${match.liveScore.score1}:${match.liveScore.score2}` : 'vs'}
                            </div>
                            <div class="ko-team">${match.team2}</div>
                        </div>
                        <div class="ko-match-time">
                            <i class="fas fa-clock"></i>
                            ${matchTime ? matchTime.toLocaleString('de-DE', {
                                weekday: 'short',
                                day: '2-digit',
                                month: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                                timeZone: 'Europe/Berlin'
                            }) : 'Noch nicht geplant'}
                        </div>
                    </div>
                `;
            });
            
            html += `
                    </div>
                </div>
            `;
        }
        
        // Finale
        if (finals.length > 0) {
            html += `
                <div class="ko-stage finale-stage">
                    <h3><i class="fas fa-trophy"></i> Finale</h3>
                    <div class="ko-matches-grid finale-grid">
            `;
            
            finals.forEach(match => {
                const matchTime = match.scheduled ? new Date(match.scheduled.datetime) : null;
                const statusClass = match.completed ? 'completed' : match.liveScore?.isLive ? 'live' : 'scheduled';
                
                html += `
                    <div class="ko-match-card finale-match ${statusClass}">
                        <div class="ko-match-header">
                            <span class="ko-match-type finale-type">${match.group}</span>
                            ${match.liveScore?.isLive ? '<span class="live-badge">LIVE</span>' : ''}
                        </div>
                        <div class="ko-match-teams finale-teams">
                            <div class="ko-team finale-team">${match.team1}</div>
                            <div class="ko-match-score finale-score">
                                ${match.completed ? `${match.score1}:${match.score2}` : 
                                  match.liveScore?.isLive ? `${match.liveScore.score1}:${match.liveScore.score2}` : 'vs'}
                            </div>
                            <div class="ko-team finale-team">${match.team2}</div>
                        </div>
                        <div class="ko-match-time">
                            <i class="fas fa-clock"></i>
                            ${matchTime ? matchTime.toLocaleString('de-DE', {
                                weekday: 'short',
                                day: '2-digit',
                                month: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                                timeZone: 'Europe/Berlin'
                            }) : 'Noch nicht geplant'}
                        </div>
                    </div>
                `;
            });
            
            html += `
                    </div>
                </div>
            `;
        }
        
        knockoutContent.innerHTML = html;
        
    } catch (error) {
        console.error('Fehler beim Laden der KO-Spiele:', error);
        const knockoutContent = document.getElementById('knockout-content');
        knockoutContent.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-exclamation-triangle"></i>
                <h3>Fehler beim Laden der KO-Spiele</h3>
                <p>Die KO-Spiele konnten nicht geladen werden. Bitte versuche es später erneut.</p>
            </div>
        `;
    }
}

// Load contact function
async function loadContact() {
    try {
        const response = await fetch('/api/contact');
        const contactContent = document.getElementById('contact-content');
        
        if (!response.ok) {
            // If contact API doesn't exist yet, show default contact
            contactContent.innerHTML = `
                <div class="contact-info">
                    <div class="contact-section">
                        <h3><i class="fas fa-map-marker-alt"></i> Adresse</h3>
                        <p>
                            CVJM Fellbach<br>
                            Stuttgarter Straße 75<br>
                            70734 Fellbach
                        </p>
                    </div>
                    
                    <div class="contact-section">
                        <h3><i class="fas fa-cloud"></i> Nextcloud Gruppe</h3>
                        <p>
                            <a href="https://nextcloud.example.com/group/fussballturnier" target="_blank">Nextcloud Gruppe beitreten</a><br>
                            <small>Hier findest du alle aktuellen Informationen und kannst dich mit anderen Teilnehmern austauschen.</small>
                        </p>
                    </div>
                </div>
            `;
            return;
        }
        
        const data = await response.json();
        
        let html = '<div class="contact-info">';
        
        if (data.address) {
            html += `
                <div class="contact-section">
                    <h3><i class="fas fa-map-marker-alt"></i> Adresse</h3>
                    <p>${data.address.replace(/\n/g, '<br>')}</p>
                </div>
            `;
        }
        
        if (data.nextcloudGroup) {
            html += `
                <div class="contact-section">
                    <h3><i class="fas fa-cloud"></i> Nextcloud Gruppe</h3>
                    <p><a href="${data.nextcloudGroup}" target="_blank">Nextcloud Gruppe beitreten</a><br>
                    <small>Hier findest du alle aktuellen Informationen und kannst dich mit anderen Teilnehmern austauschen.</small></p>
                </div>
            `;
        }
        
        if (data.additional) {
            html += `
                <div class="contact-section">
                    <h3><i class="fas fa-info-circle"></i> Weitere Informationen</h3>
                    <p>${data.additional.replace(/\n/g, '<br>')}</p>
                </div>
            `;
        }
        
        html += '</div>';
        
        contactContent.innerHTML = html;
        
    } catch (error) {
        console.error('Fehler beim Laden der Kontaktdaten:', error);
        // Fallback to default contact on error
        loadContact();
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Restore saved tab
    const savedTab = localStorage.getItem('currentTab');
    if (savedTab && document.getElementById(savedTab)) {
        // Set active nav button
        navBtns.forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.tab === savedTab) {
                btn.classList.add('active');
            }
        });
        
        // Set active tab content
        tabContents.forEach(content => {
            content.classList.remove('active');
        });
        const savedTabContent = document.getElementById(savedTab);
        if (savedTabContent) {
            savedTabContent.classList.add('active');
        }
        
        // Load content for saved tab
        loadTabContent(savedTab);
    } else {
        // Load default home tab
        loadTabContent('home');
    }
    
    updateStats();
    loadTeams();
    checkRegistrationStatus();
    
    // Initialize WebSocket connection first
    const webSocketResult = initializeWebSocket();
    
    // Wait a moment for WebSocket to connect, then load live matches
    if (webSocketResult !== false) {
        // WebSocket initialization started, wait for connection
        setTimeout(() => {
            loadLiveMatch();
        }, 500); // Short delay to allow WebSocket to connect
    } else {
        // WebSocket not available, load immediately with fallback
        loadLiveMatch();
    }
    
    // Start fallback auto-refresh (only if WebSocket fails)
    setTimeout(() => {
        startScheduleAutoRefresh();
    }, 2000); // Wait 2 seconds for WebSocket to connect
    
    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        if (socket) {
            socket.close();
        }
        if (scheduleRefreshInterval) {
            clearInterval(scheduleRefreshInterval);
        }
        if (liveUpdateInterval) {
            clearInterval(liveUpdateInterval);
        }
    });
});