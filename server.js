const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 5678;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Persistenz-Datei
const DATA_FILE = path.join(__dirname, 'tournament-data.json');

// In-Memory-Datenbank
let tournaments = [];
let teams = [];
let matches = [];
let currentTournament = null;

// Daten laden beim Start
function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            tournaments = data.tournaments || [];
            teams = data.teams || [];
            matches = data.matches || [];
            currentTournament = data.currentTournament || null;
            console.log(`Daten geladen: ${tournaments.length} Turniere, ${teams.length} Teams, ${matches.length} Spiele`);
        } else {
            console.log('Keine gespeicherten Daten gefunden - Start mit leerer Datenbank');
        }
    } catch (error) {
        console.error('Fehler beim Laden der Daten:', error);
        // Bei Fehler mit leeren Arrays starten
        tournaments = [];
        teams = [];
        matches = [];
        currentTournament = null;
    }
}

// Daten speichern
function saveData() {
    try {
        const data = {
            tournaments,
            teams,
            matches,
            currentTournament,
            lastUpdated: new Date().toISOString()
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        console.log('Daten gespeichert');
    } catch (error) {
        console.error('Fehler beim Speichern der Daten:', error);
    }
}

// Automatisches Speichern bei Änderungen
function autoSave() {
    saveData();
}

// Admin-Authentifizierung (vereinfacht)
const ADMIN_PASSWORD = '1234qwer!';

// Hilfsfunktionen
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function createGroups(teams, groupSize = 4) {
    const shuffledTeams = shuffleArray(teams);
    const groups = [];
    const groupCount = Math.ceil(shuffledTeams.length / groupSize);
    
    for (let i = 0; i < groupCount; i++) {
        groups.push({
            name: `Gruppe ${String.fromCharCode(65 + i)}`,
            teams: shuffledTeams.slice(i * groupSize, (i + 1) * groupSize),
            table: shuffledTeams.slice(i * groupSize, (i + 1) * groupSize).map(team => ({
                team: team.name,
                games: 0,
                wins: 0,
                draws: 0,
                losses: 0,
                goalsFor: 0,
                goalsAgainst: 0,
                goalDiff: 0,
                points: 0
            }))
        });
    }
    return groups;
}

function generateGroupMatches(groups) {
    const matches = [];
    groups.forEach((group, groupIndex) => {
        const teams = group.teams;
        for (let i = 0; i < teams.length; i++) {
            for (let j = i + 1; j < teams.length; j++) {
                matches.push({
                    id: `group_${groupIndex}_${i}_${j}`,
                    phase: 'group',
                    group: group.name,
                    team1: teams[i].name,
                    team2: teams[j].name,
                    score1: null,
                    score2: null,
                    completed: false
                });
            }
        }
    });
    return matches;
}

function updateGroupTable(groupName, matches) {
    if (!currentTournament) return;
    
    const group = currentTournament.groups.find(g => g.name === groupName);
    if (!group) return;
    
    // Reset table
    group.table.forEach(entry => {
        entry.games = 0;
        entry.wins = 0;
        entry.draws = 0;
        entry.losses = 0;
        entry.goalsFor = 0;
        entry.goalsAgainst = 0;
        entry.goalDiff = 0;
        entry.points = 0;
    });
    
    // Calculate stats from matches
    const groupMatches = matches.filter(m => m.group === groupName && m.completed);
    groupMatches.forEach(match => {
        const team1Entry = group.table.find(t => t.team === match.team1);
        const team2Entry = group.table.find(t => t.team === match.team2);
        
        team1Entry.games++;
        team2Entry.games++;
        team1Entry.goalsFor += match.score1;
        team1Entry.goalsAgainst += match.score2;
        team2Entry.goalsFor += match.score2;
        team2Entry.goalsAgainst += match.score1;
        
        if (match.score1 > match.score2) {
            team1Entry.wins++;
            team1Entry.points += 3;
            team2Entry.losses++;
        } else if (match.score2 > match.score1) {
            team2Entry.wins++;
            team2Entry.points += 3;
            team1Entry.losses++;
        } else {
            team1Entry.draws++;
            team2Entry.draws++;
            team1Entry.points++;
            team2Entry.points++;
        }
        
        team1Entry.goalDiff = team1Entry.goalsFor - team1Entry.goalsAgainst;
        team2Entry.goalDiff = team2Entry.goalsFor - team2Entry.goalsAgainst;
    });
    
    // Sort table
    group.table.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.goalDiff !== a.goalDiff) return b.goalDiff - a.goalDiff;
        return b.goalsFor - a.goalsFor;
    });
}

// Routes

// Startseite
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Admin-Seite
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Teams registrieren
app.post('/api/teams', (req, res) => {
    const { teamName, contactName, contactInfo } = req.body;
    
    if (!teamName || !contactName || !contactInfo) {
        return res.status(400).json({ error: 'Alle Felder sind erforderlich' });
    }
    
    // Prüfen ob Turnier für aktuelles Jahr existiert und Anmeldung offen ist
    const currentYear = new Date().getFullYear();
    if (!currentTournament || currentTournament.year !== currentYear) {
        return res.status(400).json({ error: 'Für dieses Jahr wurde noch kein Turnier geplant. Bitte wende dich an die Organisatoren.' });
    }
    
    if (currentTournament.status !== 'registration') {
        return res.status(400).json({ error: 'Die Anmeldung für das Turnier ist bereits geschlossen.' });
    }
    
    if (teams.find(t => t.name === teamName)) {
        return res.status(400).json({ error: 'Teamname bereits vergeben' });
    }
    
    const team = {
        id: Date.now(),
        name: teamName,
        contact: {
            name: contactName,
            info: contactInfo
        },
        registeredAt: new Date()
    };
    
    teams.push(team);
    autoSave();
    res.json({ success: true, team });
});

// Teams abrufen (nur öffentliche Daten)
app.get('/api/teams', (req, res) => {
    const publicTeams = teams.map(team => ({
        id: team.id,
        name: team.name
    }));
    res.json(publicTeams);
});

// Admin: Alle Teams mit Kontaktdaten
app.get('/api/admin/teams', (req, res) => {
    res.json(teams);
});

// Admin: Turnier erstellen
app.post('/api/admin/tournament', (req, res) => {
    const { password, year } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ungültiges Passwort' });
    }
    
    currentTournament = {
        id: Date.now(),
        year: year || new Date().getFullYear(),
        settings: {},
        status: 'registration', // registration, closed, active, finished
        groups: [],
        knockoutPhase: {
            quarterfinals: [],
            semifinals: [],
            final: null
        },
        phase: 'registration',
        currentMatch: null,
        registrationClosedAt: null
    };
    
    // Teams und Matches zurücksetzen für neues Turnier
    teams = [];
    matches = [];
    tournaments.push(currentTournament);
    
    autoSave();
    
    res.json({ success: true, tournament: currentTournament });
});

// Admin: Anmeldung schließen und Spielplan generieren
app.post('/api/admin/close-registration', (req, res) => {
    const { password, groupSize, enableThirdPlace, enableFifthPlace, enableSeventhPlace } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ungültiges Passwort' });
    }
    
    if (!currentTournament || currentTournament.status !== 'registration') {
        return res.status(400).json({ error: 'Kein Turnier in Anmeldephase vorhanden' });
    }
    
    if (teams.length < 4) {
        return res.status(400).json({ error: 'Mindestens 4 Teams für Spielplan erforderlich' });
    }
    
    // Anmeldung schließen
    currentTournament.status = 'closed';
    currentTournament.registrationClosedAt = new Date();
    
    // Einstellungen speichern
    currentTournament.settings = {
        groupSize: groupSize || 4,
        enableThirdPlace: enableThirdPlace || false,
        enableFifthPlace: enableFifthPlace || false,
        enableSeventhPlace: enableSeventhPlace || false
    };
    
    // Knockout-Phase erweitern
    currentTournament.knockoutPhase = {
        quarterfinals: [],
        semifinals: [],
        final: null,
        thirdPlace: enableThirdPlace ? null : undefined,
        fifthPlace: enableFifthPlace ? null : undefined,
        seventhPlace: enableSeventhPlace ? null : undefined
    };
    
    // Gruppen erstellen
    const groups = createGroups(teams, currentTournament.settings.groupSize);
    currentTournament.groups = groups;
    
    // Spielplan generieren
    const groupMatches = generateGroupMatches(groups);
    matches = [...groupMatches];
    
    // Status auf aktiv setzen
    currentTournament.status = 'active';
    currentTournament.phase = 'group';
    
    autoSave();
    
    console.log(`Turnier aktiviert: ${teams.length} Teams, ${matches.length} Spiele generiert`);
    
    res.json({ 
        success: true, 
        tournament: currentTournament, 
        matchesGenerated: matches.length,
        message: `Spielplan mit ${matches.length} Spielen für ${teams.length} Teams erstellt (Gruppen à ${groupSize} Teams)`
    });
});

// Admin: Spielzeit setzen
app.post('/api/admin/schedule', (req, res) => {
    const { password, matchId, datetime, field } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ungültiges Passwort' });
    }
    
    const match = matches.find(m => m.id === matchId);
    if (!match) {
        return res.status(404).json({ error: 'Spiel nicht gefunden' });
    }
    
    match.scheduled = {
        datetime: new Date(datetime),
        field: field || 'Hauptplatz'
    };
    
    autoSave();
    res.json({ success: true, match });
});

// Admin: Alle Spiele automatisch planen (abwechselnd zwischen Gruppen)
app.post('/api/admin/schedule-all', (req, res) => {
    const { password, startTime, matchDuration, field } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ungültiges Passwort' });
    }
    
    const unscheduledMatches = matches.filter(m => !m.scheduled);
    if (unscheduledMatches.length === 0) {
        return res.status(400).json({ error: 'Keine ungeplanIten Spiele vorhanden' });
    }
    
    // Gruppiere Spiele nach Gruppen
    const groupedMatches = {};
    unscheduledMatches.forEach(match => {
        const groupName = match.group || 'Ko-Phase';
        if (!groupedMatches[groupName]) {
            groupedMatches[groupName] = [];
        }
        groupedMatches[groupName].push(match);
    });
    
    // Erstelle abwechselnde Reihenfolge
    const groupNames = Object.keys(groupedMatches);
    const alternatingSchedule = [];
    let maxGamesPerGroup = Math.max(...Object.values(groupedMatches).map(g => g.length));
    
    for (let i = 0; i < maxGamesPerGroup; i++) {
        groupNames.forEach(groupName => {
            if (groupedMatches[groupName][i]) {
                alternatingSchedule.push(groupedMatches[groupName][i]);
            }
        });
    }
    
    // Parse Startzeit
    const [hours, minutes] = startTime.split(':');
    const today = new Date();
    let currentTime = new Date(today.getFullYear(), today.getMonth(), today.getDate(), parseInt(hours), parseInt(minutes));
    
    // Plane alle Spiele
    alternatingSchedule.forEach(match => {
        match.scheduled = {
            datetime: new Date(currentTime),
            field: field || 'Hauptplatz'
        };
        currentTime = new Date(currentTime.getTime() + matchDuration * 60000); // Nächste Zeit
    });
    
    autoSave();
    res.json({ success: true, scheduledMatches: alternatingSchedule.length });
});

// API: Aktuelles Live-Spiel abrufen (für Zuschauer)
app.get('/api/live-match', (req, res) => {
    const liveMatch = matches.find(m => m.liveScore?.isLive);
    
    if (!liveMatch) {
        return res.json({ liveMatch: null });
    }
    
    res.json({ 
        liveMatch: {
            id: liveMatch.id,
            team1: liveMatch.team1,
            team2: liveMatch.team2,
            score1: liveMatch.liveScore.score1,
            score2: liveMatch.liveScore.score2,
            startTime: liveMatch.liveScore.startTime,
            halfTimeMinutes: liveMatch.liveScore.halfTimeMinutes,
            currentHalf: liveMatch.liveScore.currentHalf,
            halfTimeBreak: liveMatch.liveScore.halfTimeBreak,
            isPaused: liveMatch.liveScore.isPaused,
            pausedTime: liveMatch.liveScore.pausedTime || 0,
            firstHalfEndTime: liveMatch.liveScore.firstHalfEndTime,
            secondHalfStartTime: liveMatch.liveScore.secondHalfStartTime,
            minute: liveMatch.liveScore.minute || 0,
            group: liveMatch.group
        }
    });
});

// Admin: Aktuelles Spiel setzen
app.post('/api/admin/current-match', (req, res) => {
    const { password, matchId } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ungültiges Passwort' });
    }
    
    if (currentTournament) {
        currentTournament.currentMatch = matchId;
        autoSave();
    }
    
    res.json({ success: true });
});

// Admin: Live-Score aktualisieren
app.post('/api/admin/live-score', (req, res) => {
    const { password, matchId, score1, score2 } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ungültiges Passwort' });
    }
    
    const match = matches.find(m => m.id === matchId);
    if (!match || !match.liveScore?.isLive) {
        return res.status(404).json({ error: 'Kein laufendes Spiel gefunden' });
    }
    
    // Update nur die Scores, Zeit wird automatisch berechnet
    match.liveScore.score1 = parseInt(score1) || 0;
    match.liveScore.score2 = parseInt(score2) || 0;
    
    // Berechne aktuelle Minute für Speicherung
    const now = new Date();
    const startTime = new Date(match.liveScore.startTime);
    const halfTimeMinutes = match.liveScore.halfTimeMinutes || 45;
    
    let currentMinute = 0;
    if (match.liveScore.currentHalf === 1) {
        const elapsedTime = now - startTime - (match.liveScore.pausedTime || 0);
        currentMinute = Math.floor(elapsedTime / (1000 * 60));
    } else if (match.liveScore.currentHalf === 2 && match.liveScore.secondHalfStartTime) {
        const secondHalfStart = new Date(match.liveScore.secondHalfStartTime);
        const elapsedTime = now - secondHalfStart - (match.liveScore.pausedTime || 0);
        currentMinute = Math.floor(elapsedTime / (1000 * 60));
    }
    
    match.liveScore.minute = Math.max(0, currentMinute);
    
    autoSave();
    res.json({ success: true, match });
});

// Admin: Spiel mit Halbzeitlänge starten
app.post('/api/admin/start-match', (req, res) => {
    const { password, matchId, halfTimeMinutes } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ungültiges Passwort' });
    }
    
    const match = matches.find(m => m.id === matchId);
    if (!match) {
        return res.status(404).json({ error: 'Spiel nicht gefunden' });
    }
    
    // Set as current match
    if (currentTournament) {
        currentTournament.currentMatch = matchId;
    }
    
    // Start match with timer
    match.liveScore = {
        score1: 0,
        score2: 0,
        minute: 0,
        isLive: true,
        isPaused: false,
        startTime: new Date(),
        pausedTime: 0, // Gesamte Pausenzeit in Millisekunden
        halfTimeMinutes: parseInt(halfTimeMinutes) || 45,
        currentHalf: 1,
        halfTimeBreak: false,
        firstHalfEndTime: null,
        secondHalfStartTime: null
    };
    
    autoSave();
    res.json({ success: true, match });
});

// Admin: Spiel pausieren
app.post('/api/admin/pause-match', (req, res) => {
    const { password, matchId } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ungültiges Passwort' });
    }
    
    const match = matches.find(m => m.id === matchId);
    if (!match || !match.liveScore?.isLive) {
        return res.status(404).json({ error: 'Kein laufendes Spiel gefunden' });
    }
    
    if (!match.liveScore.isPaused) {
        match.liveScore.isPaused = true;
        match.liveScore.pauseStartTime = new Date();
        
        autoSave();
        res.json({ success: true, message: 'Spiel pausiert' });
    } else {
        res.status(400).json({ error: 'Spiel ist bereits pausiert' });
    }
});

// Admin: Spiel fortsetzen
app.post('/api/admin/resume-match', (req, res) => {
    const { password, matchId } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ungültiges Passwort' });
    }
    
    const match = matches.find(m => m.id === matchId);
    if (!match || !match.liveScore?.isLive) {
        return res.status(404).json({ error: 'Kein laufendes Spiel gefunden' });
    }
    
    if (match.liveScore.isPaused) {
        // Addiere Pausenzeit zur Gesamtpausenzeit
        const pauseDuration = new Date() - new Date(match.liveScore.pauseStartTime);
        match.liveScore.pausedTime += pauseDuration;
        match.liveScore.isPaused = false;
        delete match.liveScore.pauseStartTime;
        
        autoSave();
        res.json({ success: true, message: 'Spiel fortgesetzt' });
    } else {
        res.status(400).json({ error: 'Spiel ist nicht pausiert' });
    }
});

// Admin: Halbzeit starten
app.post('/api/admin/halftime-break', (req, res) => {
    const { password, matchId } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ungültiges Passwort' });
    }
    
    const match = matches.find(m => m.id === matchId);
    if (!match || !match.liveScore?.isLive) {
        return res.status(404).json({ error: 'Kein laufendes Spiel gefunden' });
    }
    
    if (match.liveScore.currentHalf === 1) {
        match.liveScore.halfTimeBreak = true;
        match.liveScore.firstHalfEndTime = new Date();
        match.liveScore.isPaused = true;
        
        autoSave();
        res.json({ success: true, message: 'Halbzeitpause gestartet' });
    } else {
        res.status(400).json({ error: 'Halbzeit nur nach der ersten Halbzeit möglich' });
    }
});

// Admin: Zweite Halbzeit starten
app.post('/api/admin/start-second-half', (req, res) => {
    const { password, matchId } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ungültiges Passwort' });
    }
    
    const match = matches.find(m => m.id === matchId);
    if (!match || !match.liveScore?.isLive) {
        return res.status(404).json({ error: 'Kein laufendes Spiel gefunden' });
    }
    
    if (match.liveScore.halfTimeBreak && match.liveScore.currentHalf === 1) {
        match.liveScore.halfTimeBreak = false;
        match.liveScore.currentHalf = 2;
        match.liveScore.secondHalfStartTime = new Date();
        match.liveScore.isPaused = false;
        
        autoSave();
        res.json({ success: true, message: 'Zweite Halbzeit gestartet' });
    } else {
        res.status(400).json({ error: 'Zweite Halbzeit kann nur nach Halbzeitpause gestartet werden' });
    }
});

// Admin: Spiel abschließen
app.post('/api/admin/finish-match', (req, res) => {
    const { password, matchId } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ungültiges Passwort' });
    }
    
    const match = matches.find(m => m.id === matchId);
    if (!match || !match.liveScore) {
        return res.status(404).json({ error: 'Spiel nicht gefunden oder kein Live-Score' });
    }
    
    match.score1 = match.liveScore.score1;
    match.score2 = match.liveScore.score2;
    match.completed = true;
    match.liveScore.isLive = false;
    
    if (match.phase === 'group') {
        updateGroupTable(match.group, matches);
    }
    
    // Aktuelles Spiel zurücksetzen
    if (currentTournament && currentTournament.currentMatch === matchId) {
        currentTournament.currentMatch = null;
    }
    
    autoSave();
    res.json({ success: true, match });
});

// Aktuelles Turnier abrufen
app.get('/api/tournament', (req, res) => {
    if (!currentTournament) {
        return res.json({ tournament: null });
    }
    res.json({ tournament: currentTournament });
});

// Spielplan abrufen
app.get('/api/matches', (req, res) => {
    res.json(matches);
});

// Admin: Ergebnis eintragen
app.post('/api/admin/result', (req, res) => {
    const { password, matchId, score1, score2 } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ungültiges Passwort' });
    }
    
    const match = matches.find(m => m.id === matchId);
    if (!match) {
        return res.status(404).json({ error: 'Spiel nicht gefunden' });
    }
    
    match.score1 = parseInt(score1);
    match.score2 = parseInt(score2);
    match.completed = true;
    
    if (match.phase === 'group') {
        updateGroupTable(match.group, matches);
    }
    
    autoSave();
    res.json({ success: true, match });
});

// Admin-Login prüfen
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        res.json({ success: true });
    } else {
        res.status(401).json({ error: 'Ungültiges Passwort' });
    }
});

// Daten beim Start laden
loadData();

// Server starten
app.listen(PORT, '0.0.0.0', () => {
    console.log(`CVJM Fellbach Fußballturnier-Server läuft auf Port ${PORT}`);
    console.log(`Admin-Passwort: ${ADMIN_PASSWORD}`);
    console.log(`Daten werden in ${DATA_FILE} gespeichert`);
});