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

// Saves-Ordner
const SAVES_DIR = path.join(__dirname, 'saves');

// Saves-Ordner erstellen falls nicht vorhanden
if (!fs.existsSync(SAVES_DIR)) {
    fs.mkdirSync(SAVES_DIR);
    console.log('Saves-Ordner erstellt:', SAVES_DIR);
}

// In-Memory-Datenbank
let tournaments = [];
let teams = [];
let matches = [];
let currentTournament = null;
let tournamentRules = ""; // Neue Variable für Regeln

// Daten für bestimmtes Jahr laden
function loadDataForYear(year) {
    const filename = path.join(SAVES_DIR, `${year}.json`);
    try {
        if (fs.existsSync(filename)) {
            const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
            tournaments = data.tournaments || [];
            teams = data.teams || [];
            matches = data.matches || [];
            currentTournament = data.currentTournament || null;
            tournamentRules = data.tournamentRules || "";
            console.log(`Daten für ${year} geladen: ${teams.length} Teams, ${matches.length} Spiele`);
            return true;
        }
    } catch (error) {
        console.error(`Fehler beim Laden der Daten für ${year}:`, error);
    }
    return false;
}

// Daten für aktuelles Jahr speichern
function saveData() {
    if (!currentTournament) {
        console.log('Keine aktuellen Turnierdaten zum Speichern');
        return;
    }
    
    const year = currentTournament.year;
    const filename = path.join(SAVES_DIR, `${year}.json`);
    
    try {
        const data = {
            tournaments,
            teams,
            matches,
            currentTournament,
            tournamentRules,
            lastUpdated: new Date().toISOString()
        };
        fs.writeFileSync(filename, JSON.stringify(data, null, 2));
        console.log(`Daten für ${year} gespeichert in:`, filename);
    } catch (error) {
        console.error(`Fehler beim Speichern der Daten für ${year}:`, error);
    }
}

// Automatisches Speichern bei Änderungen
function autoSave() {
    saveData();
}

// Beim Start das aktuelle Jahr laden
function loadCurrentYearData() {
    const currentYear = new Date().getFullYear();
    if (!loadDataForYear(currentYear)) {
        console.log(`Keine gespeicherten Daten für ${currentYear} gefunden - Start mit leerer Datenbank`);
        tournaments = [];
        teams = [];
        matches = [];
        currentTournament = null;
        tournamentRules = "";
    }
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

function generateGroupMatches(groups, maxGamesPerTeam = null) {
    const matches = [];
    
    groups.forEach((group, groupIndex) => {
        const teams = group.teams;
        
        if (maxGamesPerTeam && teams.length > maxGamesPerTeam + 1) {
            // Limitierte Spiele pro Team: Optimierte Paarung
            const teamGames = {};
            teams.forEach(team => {
                teamGames[team.name] = 0;
            });
            
            // Erstelle alle möglichen Paarungen
            const allPossibleMatches = [];
            for (let i = 0; i < teams.length; i++) {
                for (let j = i + 1; j < teams.length; j++) {
                    allPossibleMatches.push({
                        team1: teams[i].name,
                        team2: teams[j].name,
                        team1Index: i,
                        team2Index: j
                    });
                }
            }
            
            // Shuffle für Fairness
            const shuffledMatches = shuffleArray(allPossibleMatches);
            
            // Wähle Spiele aus bis maxGamesPerTeam erreicht
            shuffledMatches.forEach((match, index) => {
                if (teamGames[match.team1] < maxGamesPerTeam && teamGames[match.team2] < maxGamesPerTeam) {
                    matches.push({
                        id: `group_${groupIndex}_${match.team1Index}_${match.team2Index}`,
                        phase: 'group',
                        group: group.name,
                        team1: match.team1,
                        team2: match.team2,
                        score1: null,
                        score2: null,
                        completed: false
                    });
                    teamGames[match.team1]++;
                    teamGames[match.team2]++;
                }
            });
        } else {
            // Standard: Jeder gegen Jeden
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
        }
    });
    return matches;
}

function assignReferees(matches, groups) {
    // Erstelle Liste aller Teams pro Gruppe
    const teamsByGroup = {};
    groups.forEach(group => {
        teamsByGroup[group.name] = group.teams.map(t => t.name);
    });
    
    const groupNames = Object.keys(teamsByGroup);
    const refereeAssignments = {};
    
    // Track wie oft jedes Team bereits Schiedsrichter war
    const refereeCount = {};
    Object.values(teamsByGroup).flat().forEach(team => {
        refereeCount[team] = 0;
    });
    
    matches.forEach(match => {
        const matchGroup = match.group;
        
        // Finde andere Gruppen (nicht die Gruppe des aktuellen Spiels)
        const otherGroups = groupNames.filter(g => g !== matchGroup);
        
        if (otherGroups.length > 0) {
            // Sammle alle verfügbaren Schiedsrichter-Teams aus anderen Gruppen
            const availableReferees = [];
            otherGroups.forEach(groupName => {
                teamsByGroup[groupName].forEach(team => {
                    // Team kann nur Schiedsrichter sein wenn es nicht selbst spielt
                    if (team !== match.team1 && team !== match.team2) {
                        availableReferees.push({
                            team: team,
                            group: groupName,
                            count: refereeCount[team]
                        });
                    }
                });
            });
            
            if (availableReferees.length > 0) {
                // Sortiere nach wenigsten Schiedsrichter-Einsätzen für faire Verteilung
                availableReferees.sort((a, b) => a.count - b.count);
                
                // Wähle Team mit wenigsten Einsätzen
                const selectedReferee = availableReferees[0];
                match.referee = {
                    team: selectedReferee.team,
                    group: selectedReferee.group
                };
                
                // Aktualisiere Counter
                refereeCount[selectedReferee.team]++;
                
                console.log(`Schiedsrichter für ${match.team1} vs ${match.team2}: ${selectedReferee.team} (${selectedReferee.group})`);
            }
        }
    });
    
    return matches;
}

function intelligentScheduling(matches, groups, startTime, matchDuration, field) {
    // Parse Startzeit
    const [hours, minutes] = startTime.split(':').map(num => parseInt(num));
    const today = new Date();
    let currentTime = new Date(today.getFullYear(), today.getMonth(), today.getDate(), hours, minutes, 0, 0);
    
    // Track wann jedes Team zuletzt gespielt hat
    const lastPlayTime = {};
    const allTeams = groups.flatMap(g => g.teams.map(t => t.name));
    allTeams.forEach(team => {
        lastPlayTime[team] = null;
    });
    
    // Kopiere Matches für Manipulation
    const unscheduledMatches = [...matches];
    const scheduledMatches = [];
    
    // Minimum Pause zwischen Spielen eines Teams (in Minuten)
    const minimumRestTime = matchDuration * 1.5; // 1.5x Spieldauer als Mindestpause
    
    while (unscheduledMatches.length > 0) {
        let bestMatch = null;
        let bestScore = -1;
        
        // Finde das beste nächste Spiel
        unscheduledMatches.forEach((match, index) => {
            const team1LastTime = lastPlayTime[match.team1];
            const team2LastTime = lastPlayTime[match.team2];
            
            // Berechne wie lange die Teams schon pausiert haben
            const team1RestTime = team1LastTime ? (currentTime - team1LastTime) / (1000 * 60) : Infinity;
            const team2RestTime = team2LastTime ? (currentTime - team2LastTime) / (1000 * 60) : Infinity;
            
            // Beide Teams müssen genug Pause gehabt haben
            if (team1RestTime >= minimumRestTime && team2RestTime >= minimumRestTime) {
                // Score basiert auf der Pausenzeit (länger pausiert = höhere Priorität)
                const score = Math.min(team1RestTime, team2RestTime);
                
                if (score > bestScore) {
                    bestMatch = { match, index };
                    bestScore = score;
                }
            }
        });
        
        // Falls kein Spiel die Mindestpause erfüllt, nimm das mit der längsten Pause
        if (!bestMatch) {
            let longestRest = -1;
            unscheduledMatches.forEach((match, index) => {
                const team1LastTime = lastPlayTime[match.team1];
                const team2LastTime = lastPlayTime[match.team2];
                
                const team1RestTime = team1LastTime ? (currentTime - team1LastTime) / (1000 * 60) : Infinity;
                const team2RestTime = team2LastTime ? (currentTime - team2LastTime) / (1000 * 60) : Infinity;
                
                const minRest = Math.min(team1RestTime, team2RestTime);
                
                if (minRest > longestRest) {
                    bestMatch = { match, index };
                    longestRest = minRest;
                }
            });
        }
        
        if (bestMatch) {
            const match = bestMatch.match;
            
            // Schedule das Spiel
            match.scheduled = {
                datetime: new Date(currentTime),
                field: field || 'Hauptplatz'
            };
            
            // Update letzte Spielzeit für beide Teams
            lastPlayTime[match.team1] = new Date(currentTime);
            lastPlayTime[match.team2] = new Date(currentTime);
            
            console.log(`Scheduled: ${match.team1} vs ${match.team2} at ${currentTime.toLocaleTimeString('de-DE')} (Referee: ${match.referee?.team || 'TBD'})`);
            
            // Entferne von unscheduled und füge zu scheduled hinzu
            unscheduledMatches.splice(bestMatch.index, 1);
            scheduledMatches.push(match);
            
            // Nächster Zeitslot
            currentTime = new Date(currentTime.getTime() + matchDuration * 60000);
        } else {
            // Fallback: Nimm erstes verfügbares Spiel
            console.warn('Fallback scheduling used');
            const match = unscheduledMatches[0];
            match.scheduled = {
                datetime: new Date(currentTime),
                field: field || 'Hauptplatz'
            };
            
            lastPlayTime[match.team1] = new Date(currentTime);
            lastPlayTime[match.team2] = new Date(currentTime);
            
            unscheduledMatches.splice(0, 1);
            scheduledMatches.push(match);
            currentTime = new Date(currentTime.getTime() + matchDuration * 60000);
        }
    }
    
    return scheduledMatches;
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

// Regeln abrufen
app.get('/api/rules', (req, res) => {
    res.json({ rules: tournamentRules });
});

// Admin: Regeln speichern
app.post('/api/admin/rules', (req, res) => {
    const { password, rules } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ungültiges Passwort' });
    }
    
    tournamentRules = rules || "";
    autoSave();
    res.json({ success: true, rules: tournamentRules });
});

// Admin: Turnier erstellen
app.post('/api/admin/tournament', (req, res) => {
    const { password, year } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ungültiges Passwort' });
    }
    
    const tournamentYear = year || new Date().getFullYear();
    
    // Lade Daten für das Jahr falls vorhanden
    loadDataForYear(tournamentYear);
    
    // Prüfe ob bereits ein Turnier für das Jahr existiert
    if (currentTournament && currentTournament.year === tournamentYear) {
        return res.status(400).json({ error: `Für ${tournamentYear} existiert bereits ein Turnier` });
    }
    
    currentTournament = {
        id: Date.now(),
        year: tournamentYear,
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
    tournaments = [currentTournament]; // Nur aktuelles Turnier in Array
    
    autoSave();
    
    res.json({ success: true, tournament: currentTournament });
});

// Admin: Anmeldung schließen und Spielplan generieren
app.post('/api/admin/close-registration', (req, res) => {
    const { password, groupSize, enableThirdPlace, enableFifthPlace, enableSeventhPlace, maxGamesPerTeam } = req.body;
    
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
    currentTournament.lastUpdated = new Date().toISOString();
    
    // Einstellungen speichern
    currentTournament.settings = {
        groupSize: groupSize || 4,
        enableThirdPlace: enableThirdPlace || false,
        enableFifthPlace: enableFifthPlace || false,
        enableSeventhPlace: enableSeventhPlace || false,
        maxGamesPerTeam: maxGamesPerTeam || null
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
    
    // Spielplan generieren mit maxGamesPerTeam Limit
    const groupMatches = generateGroupMatches(groups, currentTournament.settings.maxGamesPerTeam);
    
    // Schiedsrichter zuweisen
    const matchesWithReferees = assignReferees(groupMatches, groups);
    matches = [...matchesWithReferees];
    
    // Status auf aktiv setzen
    currentTournament.status = 'active';
    currentTournament.phase = 'group';
    
    autoSave();
    
    console.log(`Turnier aktiviert: ${teams.length} Teams, ${matches.length} Spiele generiert mit Schiedsrichtern`);
    
    res.json({ 
        success: true, 
        tournament: currentTournament, 
        matchesGenerated: matches.length,
        message: `Spielplan mit ${matches.length} Spielen für ${teams.length} Teams erstellt (Gruppen à ${groupSize} Teams, max. ${maxGamesPerTeam || 'alle'} Spiele pro Team, mit Schiedsrichter-Einteilung)`
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

// Admin: Alle Spiele automatisch planen (intelligenter Algorithmus)
app.post('/api/admin/schedule-all', (req, res) => {
    const { password, startTime, matchDuration, field } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ungültiges Passwort' });
    }
    
    const unscheduledMatches = matches.filter(m => !m.scheduled);
    if (unscheduledMatches.length === 0) {
        return res.status(400).json({ error: 'Keine ungeplanIten Spiele vorhanden' });
    }
    
    // Parse Startzeit korrekt
    if (!/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(startTime)) {
        return res.status(400).json({ error: 'Ungültiges Zeitformat. Bitte HH:MM verwenden.' });
    }
    
    console.log(`Intelligent scheduling: Start at ${startTime}, duration ${matchDuration}min`);
    
    try {
        // Verwende intelligenten Scheduling-Algorithmus
        const scheduledMatches = intelligentScheduling(
            unscheduledMatches, 
            currentTournament.groups, 
            startTime, 
            parseInt(matchDuration), 
            field
        );
        
        // Update die Matches im globalen Array
        scheduledMatches.forEach(scheduledMatch => {
            const originalMatch = matches.find(m => m.id === scheduledMatch.id);
            if (originalMatch) {
                originalMatch.scheduled = scheduledMatch.scheduled;
            }
        });
        
        // Update tournament lastUpdated timestamp
        if (currentTournament) {
            currentTournament.lastUpdated = new Date().toISOString();
        }
        
        autoSave();
        res.json({ 
            success: true, 
            scheduledMatches: scheduledMatches.length,
            message: `${scheduledMatches.length} Spiele intelligent geplant mit optimalen Pausen und Schiedsrichter-Verteilung`
        });
        
    } catch (error) {
        console.error('Error during intelligent scheduling:', error);
        res.status(500).json({ error: 'Fehler beim intelligenten Planen der Spiele' });
    }
});

// API: Nächstes geplantes Spiel abrufen
app.get('/api/next-match', (req, res) => {
    const now = new Date();
    
    // Finde das nächste geplante Spiel
    const upcomingMatches = matches
        .filter(m => m.scheduled && !m.completed && new Date(m.scheduled.datetime) > now)
        .sort((a, b) => new Date(a.scheduled.datetime) - new Date(b.scheduled.datetime));
    
    if (upcomingMatches.length > 0) {
        const nextMatch = upcomingMatches[0];
        res.json({ 
            nextMatch: {
                id: nextMatch.id,
                team1: nextMatch.team1,
                team2: nextMatch.team2,
                group: nextMatch.group,
                datetime: nextMatch.scheduled.datetime,
                field: nextMatch.scheduled.field,
                referee: nextMatch.referee || null
            }
        });
    } else {
        res.json({ nextMatch: null });
    }
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
            group: liveMatch.group,
            pauseStartTime: liveMatch.liveScore.pauseStartTime
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
    
    // Update nur die Scores
    match.liveScore.score1 = parseInt(score1) || 0;
    match.liveScore.score2 = parseInt(score2) || 0;
    match.liveScore.lastScoreUpdate = new Date();
    
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
    const startTime = new Date();
    match.liveScore = {
        score1: 0,
        score2: 0,
        minute: 0,
        isLive: true,
        isPaused: false,
        startTime: startTime,
        pausedTime: 0, // Gesamte Pausenzeit in Millisekunden
        halfTimeMinutes: parseInt(halfTimeMinutes) || 45,
        currentHalf: 1,
        halfTimeBreak: false,
        firstHalfEndTime: null,
        secondHalfStartTime: null,
        lastScoreUpdate: startTime
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
    
    if (!match.liveScore.isPaused && !match.liveScore.halfTimeBreak) {
        match.liveScore.isPaused = true;
        match.liveScore.pauseStartTime = new Date();
        
        autoSave();
        res.json({ success: true, message: 'Spiel pausiert' });
    } else {
        res.status(400).json({ error: 'Spiel ist bereits pausiert oder in Halbzeitpause' });
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
    
    if (match.liveScore.isPaused && match.liveScore.pauseStartTime) {
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
        match.liveScore.isPaused = false; // Halbzeitpause ist kein normaler Pause-Zustand
        
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
    match.liveScore.finishedAt = new Date();
    
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
loadCurrentYearData();

// Server starten
app.listen(PORT, '0.0.0.0', () => {
    console.log(`CVJM Fellbach Fußballturnier-Server läuft auf Port ${PORT}`);
    console.log(`Admin-Passwort: ${ADMIN_PASSWORD}`);
    console.log(`Daten werden in ${SAVES_DIR} gespeichert`);
});