const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');
const { createServer } = require('http');

const app = express();
const server = createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
const PORT = process.env.PORT || 5678;

// Middleware
app.use(cors());
app.use(express.json({ 
    limit: '10mb',
    type: 'application/json'
}));
app.use(express.static('public'));

// JSON Error Handling Middleware
app.use((error, req, res, next) => {
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
        console.error('JSON Parse Error:', error.message);
        return res.status(400).json({ error: 'Invalid JSON format' });
    }
    next(error);
});

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
let tournamentRules = "";
let contactData = {
    address: "CVJM Fellbach\nStuttgarter Straße 75\n70734 Fellbach",
    email: "info@cvjm-fellbach.de",
    phone: "+49 711 589 399 33",
    website: "https://www.cvjm-fellbach.de",
    additional: "Bei Fragen zum Turnier wende dich bitte an die oben genannten Kontakte."
};

// Verfügbare Trikotfarben
const AVAILABLE_COLORS = [
    { name: 'Rot', value: 'red', hex: '#dc2626' },
    { name: 'Blau', value: 'blue', hex: '#2563eb' },
    { name: 'Grün', value: 'green', hex: '#16a34a' },
    { name: 'Gelb', value: 'yellow', hex: '#eab308' },
    { name: 'Orange', value: 'orange', hex: '#ea580c' },
    { name: 'Lila', value: 'purple', hex: '#9333ea' },
    { name: 'Weiß', value: 'white', hex: '#ffffff' },
    { name: 'Schwarz', value: 'black', hex: '#000000' },
    { name: 'Pink', value: 'pink', hex: '#ec4899' },
    { name: 'Türkis', value: 'teal', hex: '#0891b2' },
    { name: 'Grau', value: 'gray', hex: '#6b7280' },
    { name: 'Braun', value: 'brown', hex: '#92400e' }
];

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
            contactData = data.contactData || contactData;
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
            contactData,
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

// Admin-Authentifizierung
const ADMIN_PASSWORD = '1234qwer!';

// ========================= ELFMETER-FUNKTIONEN =========================

/**
 * Generiert Elfmeterschießen zwischen Teams mit gleichem Tabellenplatz
 */
function generatePenaltyShootouts(groups) {
    const penaltyMatches = [];
    
    groups.forEach(group => {
        const groupedByPosition = {};
        
        // Gruppiere Teams nach Position (ohne finale Sortierung)
        group.table.forEach((team, index) => {
            const position = index + 1;
            if (!groupedByPosition[position]) {
                groupedByPosition[position] = [];
            }
            groupedByPosition[position].push(team);
        });
        
        // Für jede Position mit mehr als einem Team, erstelle Elfmeterschießen
        Object.entries(groupedByPosition).forEach(([position, teamsAtPosition]) => {
            if (teamsAtPosition.length > 1) {
                console.log(`Gruppe ${group.name}, Position ${position}: ${teamsAtPosition.length} Teams gleichauf - Elfmeterschießen erforderlich`);
                
                // Prüfe ob sie wirklich exakt gleich sind (Punkte, Tordifferenz, Tore)
                const referenceTeam = teamsAtPosition[0];
                const areEqual = teamsAtPosition.every(team => 
                    team.points === referenceTeam.points &&
                    team.goalDiff === referenceTeam.goalDiff &&
                    team.goalsFor === referenceTeam.goalsFor &&
                    team.goalsAgainst === referenceTeam.goalsAgainst
                );
                
                if (areEqual) {
                    // Erstelle Elfmeterschießen zwischen allen beteiligten Teams
                    for (let i = 0; i < teamsAtPosition.length; i++) {
                        for (let j = i + 1; j < teamsAtPosition.length; j++) {
                            const team1 = teamsAtPosition[i];
                            const team2 = teamsAtPosition[j];
                            
                            // Prüfe Direktvergleich
                            const directMatches = matches.filter(m => 
                                m.completed && m.group === group.name &&
                                ((m.team1 === team1.team && m.team2 === team2.team) ||
                                 (m.team1 === team2.team && m.team2 === team1.team))
                            );
                            
                            let needsPenalty = true;
                            if (directMatches.length > 0) {
                                // Berechne Direktvergleich
                                let team1DirectPoints = 0;
                                let team2DirectPoints = 0;
                                let team1DirectGoals = 0;
                                let team2DirectGoals = 0;
                                
                                directMatches.forEach(match => {
                                    if (match.team1 === team1.team) {
                                        team1DirectGoals += match.score1;
                                        team2DirectGoals += match.score2;
                                        if (match.score1 > match.score2) team1DirectPoints += 3;
                                        else if (match.score2 > match.score1) team2DirectPoints += 3;
                                        else { team1DirectPoints += 1; team2DirectPoints += 1; }
                                    } else {
                                        team1DirectGoals += match.score2;
                                        team2DirectGoals += match.score1;
                                        if (match.score2 > match.score1) team1DirectPoints += 3;
                                        else if (match.score1 > match.score2) team2DirectPoints += 3;
                                        else { team1DirectPoints += 1; team2DirectPoints += 1; }
                                    }
                                });
                                
                                // Wenn Direktvergleich entscheidet, kein Elfmeterschießen
                                if (team1DirectPoints !== team2DirectPoints || 
                                    (team1DirectGoals - team2DirectGoals) !== 0) {
                                    needsPenalty = false;
                                }
                            }
                            
                            if (needsPenalty) {
                                const penaltyMatch = {
                                    id: `penalty_${group.name.toLowerCase()}_${Date.now()}_${i}_${j}`,
                                    phase: 'penalty',
                                    group: group.name,
                                    team1: team1.team,
                                    team2: team2.team,
                                    score1: null,
                                    score2: null,
                                    completed: false,
                                    isPenaltyShootout: true,
                                    penaltyInfo: {
                                        reason: `Gleichstand um Position ${position}`,
                                        team1Stats: team1,
                                        team2Stats: team2,
                                        group: group.name
                                    }
                                };
                                
                                penaltyMatches.push(penaltyMatch);
                                console.log(`Elfmeterschießen erstellt: ${team1.team} vs ${team2.team} (Position ${position})`);
                            }
                        }
                    }
                }
            }
        });
    });
    
    return penaltyMatches;
}

/**
 * Aktualisiert Gruppentabelle und behandelt Elfmeterschießen
 */
function updateGroupTableWithPenalties(groupName, matches) {
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
        entry.penaltyWins = 0; // Neue Eigenschaft für Elfmeter-Siege
    });
    
    // Calculate stats from matches (ohne Elfmeterschießen)
    const groupMatches = matches.filter(m => m.group === groupName && m.completed && !m.isPenaltyShootout);
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
    
    // Behandle Elfmeterschießen
    const penaltyMatches = matches.filter(m => m.group === groupName && m.completed && m.isPenaltyShootout);
    penaltyMatches.forEach(match => {
        const team1Entry = group.table.find(t => t.team === match.team1);
        const team2Entry = group.table.find(t => t.team === match.team2);
        
        if (match.score1 > match.score2) {
            team1Entry.penaltyWins++;
        } else if (match.score2 > match.score1) {
            team2Entry.penaltyWins++;
        }
    });
    
    // Sort table (erweitert mit Elfmeterschießen)
    group.table.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.goalDiff !== a.goalDiff) return b.goalDiff - a.goalDiff;
        if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
        // Elfmeterschießen als letztes Kriterium
        return (b.penaltyWins || 0) - (a.penaltyWins || 0);
    });
}

// ========================= VERBESSERTE VALIDIERUNGS-ALGORITHMEN =========================

// Erweiterte Validierungsfunktion für Spielverteilung
function validateGameDistribution(teams, format, options) {
    const validation = {
        isValid: true,
        warnings: [],
        impossibleConstraints: [],
        suggestions: [],
        recommendations: []
    };
    
    if (format === 'groups') {
        const { groupSize, maxGamesPerTeam } = options;
        const groupCount = Math.ceil(teams.length / groupSize);
        
        // Berechne tatsächliche Gruppengrößen
        for (let i = 0; i < groupCount; i++) {
            const startIndex = i * groupSize;
            const endIndex = Math.min(startIndex + groupSize, teams.length);
            const actualGroupSize = endIndex - startIndex;
            const groupName = String.fromCharCode(65 + i);
            
            if (maxGamesPerTeam) {
                // Prüfe mathematische Möglichkeit
                const totalGameSlots = actualGroupSize * maxGamesPerTeam;
                const possibleMatches = Math.floor(totalGameSlots / 2);
                const maxPossibleMatches = Math.floor(actualGroupSize * (actualGroupSize - 1) / 2);
                
                console.log(`Gruppe ${groupName}: ${actualGroupSize} Teams, ${maxGamesPerTeam} Spiele pro Team`);
                console.log(`- Spiel-Slots: ${totalGameSlots}, mögliche Spiele: ${possibleMatches}`);
                console.log(`- Max. mögliche Spiele in Gruppe: ${maxPossibleMatches}`);
                
                // Mathematisch unmöglich?
                if (totalGameSlots % 2 !== 0) {
                    validation.isValid = false;
                    validation.impossibleConstraints.push(
                        `Gruppe ${groupName}: ${actualGroupSize} Teams × ${maxGamesPerTeam} Spiele = ${totalGameSlots} Spiel-Slots. Das ist eine ungerade Zahl - mathematisch unmöglich!`
                    );
                    
                    // Vorschläge für gerade Anzahl
                    const suggestions = [];
                    for (let games = 1; games <= actualGroupSize - 1; games++) {
                        if ((actualGroupSize * games) % 2 === 0) {
                            suggestions.push(`${games} Spiele pro Team`);
                        }
                    }
                    validation.suggestions.push(
                        `Gruppe ${groupName}: Mögliche Spielanzahlen: ${suggestions.join(', ')}`
                    );
                }
                
                // Zu viele Spiele gewünscht?
                if (possibleMatches > maxPossibleMatches) {
                    validation.isValid = false;
                    validation.impossibleConstraints.push(
                        `Gruppe ${groupName}: ${possibleMatches} Spiele gewünscht, aber nur ${maxPossibleMatches} möglich bei ${actualGroupSize} Teams`
                    );
                }
                
                // Zu wenig Spiele für faire Verteilung?
                if (maxGamesPerTeam < 2 && actualGroupSize > 3) {
                    validation.warnings.push(
                        `Gruppe ${groupName}: Nur ${maxGamesPerTeam} Spiel(e) pro Team bei ${actualGroupSize} Teams - sehr wenig für faire Bewertung`
                    );
                }
            }
        }
    } else if (format === 'swiss') {
        const { rounds } = options;
        const totalGameSlots = teams.length * rounds;
        
        console.log(`Swiss System Validierung: ${teams.length} Teams × ${rounds} Runden = ${totalGameSlots} Spiel-Slots`);
        
        if (totalGameSlots % 2 !== 0) {
            validation.isValid = false;
            validation.impossibleConstraints.push(
                `Swiss System: ${teams.length} Teams × ${rounds} Runden = ${totalGameSlots} Spiel-Slots (ungerade Zahl - unmöglich!)`
            );
            
            // Gerade Rundenzahlen vorschlagen
            const evenRounds = [];
            for (let r = 1; r <= teams.length - 1; r++) {
                if ((teams.length * r) % 2 === 0) {
                    evenRounds.push(r);
                }
            }
            validation.suggestions.push(
                `Mögliche Rundenzahlen für ${teams.length} Teams: ${evenRounds.slice(0, 8).join(', ')}`
            );
        }
        
        // Prüfe ob genügend verschiedene Gegner verfügbar sind
        const maxPossibleOpponents = teams.length - 1;
        if (rounds > maxPossibleOpponents) {
            validation.isValid = false;
            validation.impossibleConstraints.push(
                `Unmöglich: ${rounds} Runden für ${teams.length} Teams - maximal ${maxPossibleOpponents} verschiedene Gegner möglich`
            );
        }
        
        // Warnung bei sehr vielen Runden
        if (rounds > maxPossibleOpponents * 0.8) {
            validation.warnings.push(
                `Hohe Rundenzahl: ${rounds} von maximal ${maxPossibleOpponents} - könnte schwierig zu planen werden`
            );
        }
    }
    
    return validation;
}

// Hilfsfunktionen
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

// Analysiere Tournament-Konfiguration und gib Empfehlungen
function analyzeTournamentConfiguration(teamCount, requestedFormat, options = {}) {
    const analysis = {
        feasible: true,
        warnings: [],
        recommendations: [],
        alternatives: [],
        chosenConfig: null,
        validation: null
    };
    
    console.log(`Analysiere Turnier: ${teamCount} Teams, Format: ${requestedFormat}`, options);
    
    // Erste mathematische Validierung
    const validation = validateGameDistribution({ length: teamCount }, requestedFormat, options);
    analysis.validation = validation;
    
    if (!validation.isValid) {
        analysis.feasible = false;
        analysis.warnings.push(...validation.impossibleConstraints);
        analysis.recommendations.push(...validation.suggestions);
    }
    
    if (validation.warnings.length > 0) {
        analysis.warnings.push(...validation.warnings);
    }
    
    if (requestedFormat === 'groups') {
        const { groupSize, maxGamesPerTeam } = options;
        const groupCount = Math.ceil(teamCount / groupSize);
        const actualGroupSizes = [];
        
        // Berechne tatsächliche Gruppengrößen
        for (let i = 0; i < groupCount; i++) {
            const startIndex = i * groupSize;
            const endIndex = Math.min(startIndex + groupSize, teamCount);
            actualGroupSizes.push(endIndex - startIndex);
        }
        
        // Empfehlungen für bessere Konfiguration
        if (!analysis.feasible || teamCount % groupSize !== 0) {
            const betterConfigs = [];
            
            // Teste verschiedene Gruppengrößen
            for (let testSize = 3; testSize <= 6; testSize++) {
                const testGroups = Math.ceil(teamCount / testSize);
                let validConfig = true;
                
                for (let g = 0; g < testGroups; g++) {
                    const start = g * testSize;
                    const end = Math.min(start + testSize, teamCount);
                    const groupTeams = end - start;
                    
                    if (maxGamesPerTeam) {
                        const gameSlots = groupTeams * maxGamesPerTeam;
                        if (gameSlots % 2 !== 0) {
                            validConfig = false;
                            break;
                        }
                    }
                }
                
                if (validConfig) {
                    const remainder = teamCount % testSize;
                    betterConfigs.push({
                        size: testSize,
                        groups: testGroups,
                        remainder: remainder,
                        score: remainder === 0 ? 100 : (10 - remainder),
                        description: `${testSize} Teams pro Gruppe (${testGroups} Gruppen)`
                    });
                }
            }
            
            betterConfigs.sort((a, b) => b.score - a.score);
            if (betterConfigs.length > 0) {
                analysis.alternatives.push({
                    format: 'groups',
                    description: `Bessere Gruppenkonfiguration: ${betterConfigs[0].description}`,
                    config: betterConfigs[0],
                    advantages: [
                        'Mathematisch korrekte Spielverteilung',
                        'Ausgeglichenere Gruppengrößen',
                        'Faire Spielanzahl für alle Teams'
                    ]
                });
            }
        }
        
        analysis.chosenConfig = { 
            format: 'groups', 
            groupSize, 
            maxGamesPerTeam,
            actualGroupSizes,
            mathematicallyValid: validation.isValid
        };
        
    } else if (requestedFormat === 'swiss') {
        const { rounds } = options;
        const maxPossibleRounds = teamCount - 1;
        
        if (rounds > maxPossibleRounds) {
            analysis.warnings.push(`Maximal ${maxPossibleRounds} Runden möglich mit ${teamCount} Teams`);
            analysis.feasible = false;
        }
        
        analysis.chosenConfig = { 
            format: 'swiss', 
            rounds: Math.min(rounds, maxPossibleRounds),
            totalMatches: Math.floor(teamCount * rounds / 2),
            mathematicallyValid: validation.isValid
        };
    }
    
    // Champions League Alternative (wenn Gruppen-Problem)
    if (!analysis.feasible && requestedFormat === 'groups') {
        // Teste Swiss System
        for (let testRounds = 3; testRounds <= Math.min(7, teamCount - 1); testRounds++) {
            const gameSlots = teamCount * testRounds;
            if (gameSlots % 2 === 0) {
                analysis.alternatives.push({
                    format: 'swiss',
                    description: `Champions League Format: ${testRounds} Runden`,
                    rounds: testRounds,
                    totalMatches: gameSlots / 2,
                    advantages: [
                        'Keine Gruppenprobleme',
                        'Alle Teams spielen gleich viele Spiele',
                        'Faire Verteilung garantiert',
                        'Champions League feeling'
                    ]
                });
                break; // Erste gültige Alternative reicht
            }
        }
    }
    
    return analysis;
}

// ========================= INTELLIGENTER SWISS SYSTEM ALGORITHMUS =========================

/**
 * Intelligenter Swiss System Generator mit Backtracking
 * Garantiert, dass alle Teams exakt die gewünschte Anzahl von Spielen bekommen
 */
function generateIntelligentSwissSystem(teams, targetGamesPerTeam) {
    console.log(`Starte intelligenten Swiss System: ${teams.length} Teams, ${targetGamesPerTeam} Spiele pro Team`);
    
    const teamCount = teams.length;
    const totalGameSlots = teamCount * targetGamesPerTeam;
    const expectedMatches = totalGameSlots / 2;
    
    // Validierung
    if (totalGameSlots % 2 !== 0) {
        throw new Error(`Unmögliche Konfiguration: ${teamCount} Teams × ${targetGamesPerTeam} Spiele = ${totalGameSlots} Spiel-Slots (ungerade Zahl)`);
    }
    
    if (targetGamesPerTeam >= teamCount) {
        throw new Error(`Unmögliche Konfiguration: ${targetGamesPerTeam} Spiele pro Team, aber nur ${teamCount - 1} verschiedene Gegner verfügbar`);
    }
    
    console.log(`Ziel: ${expectedMatches} Spiele für perfekte Verteilung`);
    
    // Initialisiere Team-Zustand
    const teamStates = teams.map(team => ({
        name: team.name,
        gamesPlayed: 0,
        opponents: new Set(),
        targetGames: targetGamesPerTeam
    }));
    
    const matches = [];
    const maxAttempts = 10; // Mehrere Versuche bei verschiedenen Reihenfolgen
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        console.log(`Versuch ${attempt}/${maxAttempts}...`);
        
        // Reset für neuen Versuch
        matches.length = 0;
        teamStates.forEach(team => {
            team.gamesPlayed = 0;
            team.opponents.clear();
        });
        
        const shuffledTeams = shuffleArray([...teamStates]);
        
        if (backtrackSwissMatches(shuffledTeams, matches, 0, expectedMatches)) {
            console.log(`✅ Erfolg in Versuch ${attempt}! ${matches.length} Spiele generiert.`);
            
            // Validiere Endergebnis
            const finalValidation = validateSwissResult(teamStates, matches, targetGamesPerTeam);
            if (finalValidation.isValid) {
                console.log(`✅ Finale Validierung erfolgreich: Alle Teams haben exakt ${targetGamesPerTeam} Spiele`);
                return convertToMatchFormat(matches);
            } else {
                console.log(`❌ Finale Validierung fehlgeschlagen:`, finalValidation.errors);
                continue; // Nächster Versuch
            }
        }
        
        console.log(`❌ Versuch ${attempt} fehlgeschlagen`);
    }
    
    throw new Error(`Konnte nach ${maxAttempts} Versuchen keine gültige Swiss System Verteilung finden. Möglicherweise ist die Konfiguration zu restriktiv.`);
}

/**
 * Backtracking-Algorithmus für Swiss System
 */
function backtrackSwissMatches(teamStates, matches, matchIndex, targetMatches) {
    // Erfolgsbedingung: Alle Matches erstellt und alle Teams haben die richtige Anzahl Spiele
    if (matches.length >= targetMatches) {
        return teamStates.every(team => team.gamesPlayed === team.targetGames);
    }
    
    // Finde Teams, die noch Spiele brauchen
    const availableTeams = teamStates.filter(team => team.gamesPlayed < team.targetGames);
    
    if (availableTeams.length < 2) {
        return false; // Nicht genug Teams für weitere Matches
    }
    
    // Sortiere nach Priorität: Teams mit weniger Spielen zuerst
    availableTeams.sort((a, b) => {
        const gamesDiff = a.gamesPlayed - b.gamesPlayed;
        if (gamesDiff !== 0) return gamesDiff;
        
        // Bei gleicher Spielanzahl: Teams mit weniger Gegnern zuerst
        return a.opponents.size - b.opponents.size;
    });
    
    // Probiere alle möglichen Paarungen aus
    for (let i = 0; i < availableTeams.length; i++) {
        const team1 = availableTeams[i];
        
        for (let j = i + 1; j < availableTeams.length; j++) {
            const team2 = availableTeams[j];
            
            // Prüfe, ob diese Paarung gültig ist
            if (canTeamsPlay(team1, team2)) {
                
                // Führe Match aus
                const match = {
                    team1: team1.name,
                    team2: team2.name,
                    matchIndex: matches.length
                };
                
                executeMatch(team1, team2, match);
                matches.push(match);
                
                // Rekursiver Aufruf
                if (backtrackSwissMatches(teamStates, matches, matchIndex + 1, targetMatches)) {
                    return true; // Lösung gefunden
                }
                
                // Backtrack: Match rückgängig machen
                undoMatch(team1, team2, match);
                matches.pop();
            }
        }
    }
    
    return false; // Keine Lösung auf diesem Pfad
}

/**
 * Prüft, ob zwei Teams gegeneinander spielen können
 */
function canTeamsPlay(team1, team2) {
    // Teams dürfen nicht bereits gegeneinander gespielt haben
    if (team1.opponents.has(team2.name) || team2.opponents.has(team1.name)) {
        return false;
    }
    
    // Beide Teams müssen noch Spiele brauchen
    if (team1.gamesPlayed >= team1.targetGames || team2.gamesPlayed >= team2.targetGames) {
        return false;
    }
    
    return true;
}

/**
 * Führt ein Match zwischen zwei Teams aus
 */
function executeMatch(team1, team2, match) {
    team1.gamesPlayed++;
    team2.gamesPlayed++;
    team1.opponents.add(team2.name);
    team2.opponents.add(team1.name);
}

/**
 * Macht ein Match zwischen zwei Teams rückgängig (für Backtracking)
 */
function undoMatch(team1, team2, match) {
    team1.gamesPlayed--;
    team2.gamesPlayed--;
    team1.opponents.delete(team2.name);
    team2.opponents.delete(team1.name);
}

/**
 * Validiert das finale Ergebnis des Swiss Systems
 */
function validateSwissResult(teamStates, matches, expectedGamesPerTeam) {
    const validation = {
        isValid: true,
        errors: [],
        teamStats: {}
    };
    
    // Prüfe jedes Team
    teamStates.forEach(team => {
        validation.teamStats[team.name] = {
            gamesPlayed: team.gamesPlayed,
            opponents: Array.from(team.opponents)
        };
        
        if (team.gamesPlayed !== expectedGamesPerTeam) {
            validation.isValid = false;
            validation.errors.push(`${team.name}: ${team.gamesPlayed} Spiele statt ${expectedGamesPerTeam}`);
        }
    });
    
    // Prüfe auf doppelte Spiele
    const seenMatches = new Set();
    matches.forEach(match => {
        const key1 = `${match.team1}-${match.team2}`;
        const key2 = `${match.team2}-${match.team1}`;
        
        if (seenMatches.has(key1) || seenMatches.has(key2)) {
            validation.isValid = false;
            validation.errors.push(`Doppeltes Spiel: ${match.team1} vs ${match.team2}`);
        }
        
        seenMatches.add(key1);
    });
    
    return validation;
}

/**
 * Konvertiert interne Match-Darstellung zu API-Format
 */
function convertToMatchFormat(matches) {
    return matches.map((match, index) => ({
        id: `swiss_${index}`,
        phase: 'swiss',
        group: 'Champions League Format',
        team1: match.team1,
        team2: match.team2,
        score1: null,
        score2: null,
        completed: false
    }));
}

// VERBESSERTES Gruppensystem
function createImprovedGroups(teams, groupSize = 4) {
    const shuffledTeams = shuffleArray(teams);
    const groups = [];
    const teamCount = shuffledTeams.length;
    const idealGroupCount = Math.ceil(teamCount / groupSize);
    
    console.log(`Erstelle verbesserte Gruppen: ${teamCount} Teams, angestrebte Größe ${groupSize}`);
    
    // Berechne optimale Gruppenverteilung
    const baseTeamsPerGroup = Math.floor(teamCount / idealGroupCount);
    const groupsWithExtraTeam = teamCount % idealGroupCount;
    
    let teamIndex = 0;
    for (let i = 0; i < idealGroupCount; i++) {
        const currentGroupSize = baseTeamsPerGroup + (i < groupsWithExtraTeam ? 1 : 0);
        const groupTeams = shuffledTeams.slice(teamIndex, teamIndex + currentGroupSize);
        
        const group = {
            name: `Gruppe ${String.fromCharCode(65 + i)}`,
            teams: groupTeams,
            table: groupTeams.map(team => ({
                team: team.name,
                games: 0,
                wins: 0,
                draws: 0,
                losses: 0,
                goalsFor: 0,
                goalsAgainst: 0,
                goalDiff: 0,
                points: 0,
                penaltyWins: 0
            }))
        };
        
        groups.push(group);
        teamIndex += currentGroupSize;
        
        console.log(`${group.name}: ${currentGroupSize} Teams - ${groupTeams.map(t => t.name).join(', ')}`);
    }
    
    return groups;
}

function generateImprovedGroupMatches(groups, maxGamesPerTeam = null) {
    const matches = [];
    
    groups.forEach((group, groupIndex) => {
        const teams = group.teams;
        console.log(`Generiere Spiele für ${group.name}: ${teams.length} Teams, max ${maxGamesPerTeam || 'alle'} Spiele pro Team`);
        
        if (!maxGamesPerTeam || maxGamesPerTeam >= teams.length - 1) {
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
        } else {
            // Limitierte Spiele: Verwende Fair Distribution
            const teamGames = {};
            teams.forEach(team => teamGames[team.name] = 0);
            
            // Erstelle alle möglichen Paarungen
            const possibleMatches = [];
            for (let i = 0; i < teams.length; i++) {
                for (let j = i + 1; j < teams.length; j++) {
                    possibleMatches.push({
                        team1: teams[i].name,
                        team2: teams[j].name,
                        team1Index: i,
                        team2Index: j,
                        priority: Math.random()
                    });
                }
            }
            
            // Sortiere zufällig für Fairness
            possibleMatches.sort((a, b) => a.priority - b.priority);
            
            // Greedy-Auswahl für gleichmäßige Verteilung
            possibleMatches.forEach(possibleMatch => {
                if (teamGames[possibleMatch.team1] < maxGamesPerTeam && 
                    teamGames[possibleMatch.team2] < maxGamesPerTeam) {
                    
                    matches.push({
                        id: `group_${groupIndex}_${possibleMatch.team1Index}_${possibleMatch.team2Index}`,
                        phase: 'group',
                        group: group.name,
                        team1: possibleMatch.team1,
                        team2: possibleMatch.team2,
                        score1: null,
                        score2: null,
                        completed: false
                    });
                    
                    teamGames[possibleMatch.team1]++;
                    teamGames[possibleMatch.team2]++;
                }
            });
            
            console.log(`${group.name} Spielverteilung:`, teamGames);
        }
    });
    
    return matches;
}

// Prüft ob alle Gruppenspiele abgeschlossen sind
function checkGroupPhaseCompletion() {
    console.log('=== Gruppenphase-Check ===');
    console.log('Turnier vorhanden?', !!currentTournament);
    console.log('Turnier-Status:', currentTournament?.status);
    
    if (!currentTournament || currentTournament.status !== 'active') {
        console.log('Turnier nicht aktiv oder nicht vorhanden');
        return false;
    }
    
    // Für Champions League Format (Swiss System) - alle Teams in einer Liga
    if (currentTournament.settings?.format === 'swiss') {
        console.log('Swiss/Champions League Format erkannt');
        const swissMatches = matches.filter(m => 
            m.phase === 'group' && 
            !m.completed && 
            !m.isPenaltyShootout
        );
        console.log('Unabgeschlossene Swiss-Spiele:', swissMatches.length);
        return swissMatches.length === 0; // Alle Liga-Spiele abgeschlossen
    }
    
    // Für klassisches Gruppensystem ODER wenn Format undefined ist
    console.log('Klassisches Gruppensystem (oder Format undefined)');
    console.log('Anzahl Gruppen:', currentTournament.groups?.length || 0);
    
    // Fallback: Wenn keine Gruppen aber Matches existieren, prüfe alle Gruppenspiele
    if (!currentTournament.groups || currentTournament.groups.length === 0) {
        console.log('Keine Gruppen vorhanden - verwende Fallback-Methode');
        
        // Erst versuchen mit phase: 'group'
        let allGroupMatches = matches.filter(m => 
            m.phase === 'group' && 
            !m.completed && 
            !m.isPenaltyShootout
        );
        
        // Fallback: Wenn keine Matches mit phase: 'group', dann alle non-KO Matches
        if (allGroupMatches.length === 0) {
            console.log('Keine Matches mit phase: "group" gefunden, verwende alle non-KO Matches');
            allGroupMatches = matches.filter(m => 
                !m.completed && 
                !m.isPenaltyShootout &&
                !(m.phase === 'quarterfinal' || m.phase === 'semifinal' || m.phase === 'final') &&
                !(m.group?.toLowerCase().includes('finale')) &&
                !(m.group?.toLowerCase().includes('halbfinale')) &&
                !(m.group?.toLowerCase().includes('viertelfinale')) &&
                !(m.group?.toLowerCase().includes('platz'))
            );
        }
        
        console.log('Unabgeschlossene Gruppenspiele (Fallback):', allGroupMatches.length);
        return allGroupMatches.length === 0;
    }
    
    // Prüfe jede Gruppe einzeln
    for (const group of currentTournament.groups) {
        const groupMatches = matches.filter(m => 
            m.group === group.name && 
            m.phase === 'group' && 
            !m.completed && 
            !m.isPenaltyShootout
        );
        
        console.log(`Gruppe ${group.name}: ${groupMatches.length} unabgeschlossene Spiele`);
        
        if (groupMatches.length > 0) {
            return false; // Noch unabgeschlossene Spiele in dieser Gruppe
        }
    }
    
    console.log('Alle Gruppenspiele abgeschlossen!');
    return true; // Alle Gruppenspiele abgeschlossen
}

// Generiert automatisch K.O.-Spiele wenn Gruppenphase beendet ist
function generateFinalTableAndKnockoutMatches(customConfig = null) {
    console.log('=== K.O.-Generierung Start ===');
    
    const groupPhaseComplete = checkGroupPhaseCompletion();
    console.log('Gruppenphase abgeschlossen?', groupPhaseComplete);
    
    if (!groupPhaseComplete) {
        console.log('Gruppenphase noch nicht abgeschlossen');
        return false;
    }
    
    // Prüfe ob bereits K.O.-Spiele existieren
    const existingKoMatches = matches.filter(m => 
        m.phase === 'quarterfinal' || 
        m.phase === 'semifinal' || 
        m.phase === 'final' ||
        m.group?.toLowerCase().includes('finale') ||
        m.group?.toLowerCase().includes('platz')
    );
    
    if (existingKoMatches.length > 0) {
        console.log('K.O.-Spiele bereits generiert');
        return false;
    }
    
    let finalTable = [];
    
    // Erstelle finale Tabelle abhängig vom Format
    if (currentTournament.settings?.format === 'swiss' || 
        (!currentTournament.groups || currentTournament.groups.length === 0)) {
        // Champions League: Alle Teams in einer Liga ODER Fallback für undefined format
        console.log('Verwende Swiss-System oder Fallback-Modus für finale Tabelle');
        const allTeams = new Set();
        
        // Erst versuchen mit phase: 'group'
        let groupMatches = matches.filter(m => m.phase === 'group');
        
        // Fallback: Wenn keine Matches mit phase: 'group', dann alle non-KO Matches
        if (groupMatches.length === 0) {
            console.log('Keine Matches mit phase: "group", verwende alle non-KO Matches für Tabelle');
            groupMatches = matches.filter(m => 
                !(m.phase === 'quarterfinal' || m.phase === 'semifinal' || m.phase === 'final') &&
                !(m.group?.toLowerCase().includes('finale')) &&
                !(m.group?.toLowerCase().includes('halbfinale')) &&
                !(m.group?.toLowerCase().includes('viertelfinale')) &&
                !(m.group?.toLowerCase().includes('platz'))
            );
        }
        
        groupMatches.forEach(m => {
            allTeams.add(m.team1);
            allTeams.add(m.team2);
        });
        
        console.log('Gefundene Teams:', Array.from(allTeams));
        console.log('Verwendete Matches für Tabelle:', groupMatches.length);
        
        finalTable = Array.from(allTeams).map(teamName => {
            const teamStats = {
                team: teamName,
                games: 0,
                wins: 0,
                draws: 0,
                losses: 0,
                goalsFor: 0,
                goalsAgainst: 0,
                goalDiff: 0,
                points: 0,
                penaltyWins: 0
            };
            
            // Berechne Statistiken aus allen Spielen
            groupMatches.filter(m => 
                m.completed && 
                !m.isPenaltyShootout &&
                (m.team1 === teamName || m.team2 === teamName)
            ).forEach(match => {
                const isTeam1 = match.team1 === teamName;
                const ownScore = isTeam1 ? match.score1 : match.score2;
                const oppScore = isTeam1 ? match.score2 : match.score1;
                
                teamStats.games++;
                teamStats.goalsFor += ownScore;
                teamStats.goalsAgainst += oppScore;
                teamStats.goalDiff = teamStats.goalsFor - teamStats.goalsAgainst;
                
                if (ownScore > oppScore) {
                    teamStats.wins++;
                    teamStats.points += 3;
                } else if (ownScore === oppScore) {
                    teamStats.draws++;
                    teamStats.points += 1;
                } else {
                    teamStats.losses++;
                }
            });
            
            // Penalty-Siege zählen
            groupMatches.filter(m => 
                m.isPenaltyShootout && 
                m.completed &&
                (m.team1 === teamName || m.team2 === teamName)
            ).forEach(penalty => {
                const isTeam1 = penalty.team1 === teamName;
                const ownScore = isTeam1 ? penalty.score1 : penalty.score2;
                const oppScore = isTeam1 ? penalty.score2 : penalty.score1;
                
                if (ownScore > oppScore) {
                    teamStats.penaltyWins++;
                }
            });
            
            return teamStats;
        });
    } else {
        // Klassisches Gruppensystem: Gruppensieger und -zweite
        for (const group of currentTournament.groups) {
            if (group.table && group.table.length >= 2) {
                // Sortiere Tabelle (sollte bereits sortiert sein)
                const sortedTable = [...group.table].sort((a, b) => {
                    if (b.points !== a.points) return b.points - a.points;
                    if (b.goalDiff !== a.goalDiff) return b.goalDiff - a.goalDiff;
                    if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
                    return b.penaltyWins - a.penaltyWins;
                });
                
                // Gruppensieger und -zweiter zur finalen Tabelle hinzufügen
                finalTable.push({
                    ...sortedTable[0],
                    groupPosition: 1,
                    groupName: group.name
                });
                
                if (sortedTable.length >= 2) {
                    finalTable.push({
                        ...sortedTable[1],
                        groupPosition: 2,
                        groupName: group.name
                    });
                }
            }
        }
        
        // Sortiere finale Tabelle: Gruppensieger zuerst, dann Gruppenzweite
        finalTable.sort((a, b) => {
            if (a.groupPosition !== b.groupPosition) {
                return a.groupPosition - b.groupPosition;
            }
            if (b.points !== a.points) return b.points - a.points;
            if (b.goalDiff !== a.goalDiff) return b.goalDiff - a.goalDiff;
            if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
            return b.penaltyWins - a.penaltyWins;
        });
    }
    
    // Generiere K.O.-Spiele mit benutzerdefinierter oder Standard-Konfiguration
    const knockoutConfig = customConfig || {
        enableQuarterfinals: finalTable.length >= 8,
        enableThirdPlace: true,
        enableFifthPlace: finalTable.length >= 6,
        enableSeventhPlace: finalTable.length >= 8
    };
    
    console.log('Verwende K.O.-Konfiguration:', knockoutConfig);
    
    const koMatches = generateKnockoutMatches(finalTable, knockoutConfig);
    
    if (koMatches.length > 0) {
        matches.push(...koMatches);
        
        // Speichere finale Tabelle im Turnier
        if (!currentTournament.finalTable) {
            currentTournament.finalTable = finalTable;
        }
        
        console.log(`K.O.-Phase generiert: ${koMatches.length} Spiele erstellt`);
        console.log('Finale Tabelle:', finalTable.map(t => `${t.team} (${t.points} Pkt.)`));
        
        autoSave();
        return true;
    }
    
    return false;
}

// K.O.-System Generierung
function generateKnockoutMatches(finalTable, knockoutConfig) {
    console.log('Generiere K.O.-System...', knockoutConfig);
    
    const koMatches = [];
    const { enableQuarterfinals, enableThirdPlace, enableFifthPlace, enableSeventhPlace } = knockoutConfig;
    
    if (enableQuarterfinals && finalTable.length >= 8) {
        // Sortiere Teams nach Gruppen-Gewinner/Zweitplatzierte
        const groupWinners = finalTable.filter(t => t.groupPosition === 1);
        const groupRunnersUp = finalTable.filter(t => t.groupPosition === 2);
        
        // Erstelle optimale Paarungen um Gruppen-Rematches zu vermeiden
        const quarterfinalsIds = [];
        const pairings = [];
        
        // Versuche Paarungen zu erstellen, wo Teams aus verschiedenen Gruppen spielen
        for (let i = 0; i < Math.min(groupWinners.length, groupRunnersUp.length); i++) {
            // Finde einen Zweitplatzierten aus einer anderen Gruppe für jeden Gruppensieger
            let bestOpponent = null;
            let bestOpponentIndex = -1;
            
            for (let j = 0; j < groupRunnersUp.length; j++) {
                if (!groupRunnersUp[j].paired && groupRunnersUp[j].groupName !== groupWinners[i].groupName) {
                    bestOpponent = groupRunnersUp[j];
                    bestOpponentIndex = j;
                    break;
                }
            }
            
            if (bestOpponent) {
                pairings.push({ team1: groupWinners[i], team2: bestOpponent });
                groupRunnersUp[bestOpponentIndex].paired = true;
            }
        }
        
        // Falls nicht genug optimale Paarungen möglich sind, verwende Standard-Logik
        if (pairings.length < 4) {
            console.log('Verwende Standard-Paarungen für Viertelfinale');
            for (let i = 0; i < 4; i++) {
                const team1 = finalTable[i];
                const team2 = finalTable[7 - i];
                const matchId = `quarterfinal_${i + 1}`;
                
                koMatches.push({
                    id: matchId,
                    phase: 'quarterfinal',
                    group: 'Viertelfinale',
                    team1: team1.team,
                    team2: team2.team,
                    score1: null,
                    score2: null,
                    completed: false,
                    koInfo: {
                        position1: i + 1,
                        position2: 8 - i,
                        description: `Viertelfinale ${i + 1}: ${i + 1}. vs ${8 - i}.`
                    }
                });
                
                quarterfinalsIds.push(matchId);
            }
        } else {
            // Verwende optimierte Paarungen
            for (let i = 0; i < pairings.length; i++) {
                const matchId = `quarterfinal_${i + 1}`;
                
                koMatches.push({
                    id: matchId,
                    phase: 'quarterfinal',
                    group: 'Viertelfinale',
                    team1: pairings[i].team1.team,
                    team2: pairings[i].team2.team,
                    score1: null,
                    score2: null,
                    completed: false,
                    koInfo: {
                        position1: pairings[i].team1.position,
                        position2: pairings[i].team2.position,
                        description: `Viertelfinale ${i + 1}`
                    }
                });
                
                quarterfinalsIds.push(matchId);
            }
        }
        
        // Halbfinale aus Viertelfinale-Siegern
        koMatches.push({
            id: 'semifinal_1',
            phase: 'semifinal',
            group: 'Halbfinale',
            team1: `Sieger ${quarterfinalsIds[0]}`,
            team2: `Sieger ${quarterfinalsIds[1]}`,
            score1: null,
            score2: null,
            completed: false,
            koInfo: {
                dependsOn: [quarterfinalsIds[0], quarterfinalsIds[1]],
                description: 'Halbfinale 1'
            }
        });
        
        koMatches.push({
            id: 'semifinal_2',
            phase: 'semifinal', 
            group: 'Halbfinale',
            team1: `Sieger ${quarterfinalsIds[2]}`,
            team2: `Sieger ${quarterfinalsIds[3]}`,
            score1: null,
            score2: null,
            completed: false,
            koInfo: {
                dependsOn: [quarterfinalsIds[2], quarterfinalsIds[3]],
                description: 'Halbfinale 2'
            }
        });
        
        // Finale
        koMatches.push({
            id: 'final',
            phase: 'final',
            group: 'Finale',
            team1: 'Sieger semifinal_1',
            team2: 'Sieger semifinal_2',
            score1: null,
            score2: null,
            completed: false,
            koInfo: {
                dependsOn: ['semifinal_1', 'semifinal_2'],
                description: 'Finale'
            }
        });
        
        // Spiel um Platz 3
        if (enableThirdPlace) {
            koMatches.push({
                id: 'third_place',
                phase: 'placement',
                group: 'Platzierungsspiele',
                team1: 'Verlierer semifinal_1',
                team2: 'Verlierer semifinal_2',
                score1: null,
                score2: null,
                completed: false,
                koInfo: {
                    dependsOn: ['semifinal_1', 'semifinal_2'],
                    description: 'Spiel um Platz 3'
                }
            });
        }
        
    } else {
        // Direktes Halbfinale bei weniger als 8 Teams: 1vs4, 2vs3
        if (finalTable.length >= 4) {
            koMatches.push({
                id: 'semifinal_1',
                phase: 'semifinal',
                group: 'Halbfinale',
                team1: finalTable[0].team,
                team2: finalTable[3].team,
                score1: null,
                score2: null,
                completed: false,
                koInfo: {
                    position1: 1,
                    position2: 4,
                    description: 'Halbfinale 1: 1. vs 4.'
                }
            });
            
            koMatches.push({
                id: 'semifinal_2',
                phase: 'semifinal',
                group: 'Halbfinale',
                team1: finalTable[1].team,
                team2: finalTable[2].team,
                score1: null,
                score2: null,
                completed: false,
                koInfo: {
                    position1: 2,
                    position2: 3,
                    description: 'Halbfinale 2: 2. vs 3.'
                }
            });
            
            // Finale
            koMatches.push({
                id: 'final',
                phase: 'final',
                group: 'Finale',
                team1: 'Sieger semifinal_1',
                team2: 'Sieger semifinal_2',
                score1: null,
                score2: null,
                completed: false,
                koInfo: {
                    dependsOn: ['semifinal_1', 'semifinal_2'],
                    description: 'Finale'
                }
            });
            
            // Spiel um Platz 3
            if (enableThirdPlace) {
                koMatches.push({
                    id: 'third_place',
                    phase: 'placement',
                    group: 'Platzierungsspiele',
                    team1: 'Verlierer semifinal_1',
                    team2: 'Verlierer semifinal_2',
                    score1: null,
                    score2: null,
                    completed: false,
                    koInfo: {
                        dependsOn: ['semifinal_1', 'semifinal_2'],
                        description: 'Spiel um Platz 3'
                    }
                });
            }
        }
    }
    
    // Platzierungsspiele für die restlichen Teams
    if (enableFifthPlace && finalTable.length >= 6) {
        if (enableQuarterfinals && finalTable.length >= 8) {
            // Spiel um Platz 5: Verlierer der Viertelfinale (5.-8. Platz)
            koMatches.push({
                id: 'fifth_place_semi1',
                phase: 'placement',
                group: 'Platzierungsspiele',
                team1: 'Verlierer quarterfinal_1',
                team2: 'Verlierer quarterfinal_2',
                score1: null,
                score2: null,
                completed: false,
                koInfo: {
                    dependsOn: ['quarterfinal_1', 'quarterfinal_2'],
                    description: 'Halbfinale um Platz 5/6'
                }
            });
            
            koMatches.push({
                id: 'fifth_place_semi2',
                phase: 'placement',
                group: 'Platzierungsspiele',
                team1: 'Verlierer quarterfinal_3',
                team2: 'Verlierer quarterfinal_4',
                score1: null,
                score2: null,
                completed: false,
                koInfo: {
                    dependsOn: ['quarterfinal_3', 'quarterfinal_4'],
                    description: 'Halbfinale um Platz 7/8'
                }
            });
            
            koMatches.push({
                id: 'fifth_place',
                phase: 'placement',
                group: 'Platzierungsspiele',
                team1: 'Sieger fifth_place_semi1',
                team2: 'Sieger fifth_place_semi2',
                score1: null,
                score2: null,
                completed: false,
                koInfo: {
                    dependsOn: ['fifth_place_semi1', 'fifth_place_semi2'],
                    description: 'Spiel um Platz 5'
                }
            });
            
            if (enableSeventhPlace) {
                koMatches.push({
                    id: 'seventh_place',
                    phase: 'placement',
                    group: 'Platzierungsspiele',
                    team1: 'Verlierer fifth_place_semi1',
                    team2: 'Verlierer fifth_place_semi2',
                    score1: null,
                    score2: null,
                    completed: false,
                    koInfo: {
                        dependsOn: ['fifth_place_semi1', 'fifth_place_semi2'],
                        description: 'Spiel um Platz 7'
                    }
                });
            }
        } else {
            // Direktes Spiel um Platz 5 bei weniger Teams
            koMatches.push({
                id: 'fifth_place',
                phase: 'placement',
                group: 'Platzierungsspiele',
                team1: finalTable[4].team,
                team2: finalTable[5].team,
                score1: null,
                score2: null,
                completed: false,
                koInfo: {
                    position1: 5,
                    position2: 6,
                    description: 'Spiel um Platz 5: 5. vs 6.'
                }
            });
        }
    }
    
    console.log(`K.O.-System generiert: ${koMatches.length} Spiele`);
    koMatches.forEach(match => {
        console.log(`${match.id}: ${match.team1} vs ${match.team2} (${match.koInfo.description})`);
    });
    
    return koMatches;
}

function assignReferees(matches, groups) {
    // Erstelle Liste aller Teams pro Gruppe
    const teamsByGroup = {};
    if (groups && groups.length > 0) {
        groups.forEach(group => {
            teamsByGroup[group.name] = group.teams.map(t => t.name);
        });
    } else {
        // Für Swiss System: Alle Teams sind in einer "Gruppe"
        teamsByGroup['Champions League Format'] = teams.map(t => t.name);
    }
    
    const groupNames = Object.keys(teamsByGroup);
    const refereeCount = {};
    Object.values(teamsByGroup).flat().forEach(team => {
        refereeCount[team] = 0;
    });
    
    matches.forEach(match => {
        const matchGroup = match.group;
        
        // Finde andere Gruppen (nicht die Gruppe des aktuellen Spiels)
        let otherGroups = groupNames.filter(g => g !== matchGroup);
        
        // Fallback: Wenn keine anderen Gruppen, verwende alle Teams
        if (otherGroups.length === 0) {
            otherGroups = groupNames;
        }
        
        if (otherGroups.length > 0) {
            const availableReferees = [];
            otherGroups.forEach(groupName => {
                teamsByGroup[groupName].forEach(team => {
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
                availableReferees.sort((a, b) => a.count - b.count);
                const selectedReferee = availableReferees[0];
                match.referee = {
                    team: selectedReferee.team,
                    group: selectedReferee.group
                };
                refereeCount[selectedReferee.team]++;
            }
        }
    });
    
    return matches;
}

function intelligentScheduling(matches, groups, startTime, matchDuration, field) {
    const [hours, minutes] = startTime.split(':').map(num => parseInt(num));
    const today = new Date();
    let currentTime = new Date(today.getFullYear(), today.getMonth(), today.getDate(), hours, minutes, 0, 0);
    
    const lastPlayTime = {};
    const allTeams = teams.map(t => t.name);
    allTeams.forEach(team => {
        lastPlayTime[team] = null;
    });
    
    const unscheduledMatches = [...matches];
    const scheduledMatches = [];
    const minimumRestTime = matchDuration * 1.5;
    
    while (unscheduledMatches.length > 0) {
        let bestMatch = null;
        let bestScore = -1;
        
        unscheduledMatches.forEach((match, index) => {
            // Überspringe K.O.-Spiele mit Platzhalter-Teams
            if ((match.team1 && match.team1.includes('Sieger ')) || 
                (match.team1 && match.team1.includes('Verlierer ')) ||
                (match.team2 && match.team2.includes('Sieger ')) || 
                (match.team2 && match.team2.includes('Verlierer '))) {
                return;
            }
            
            const team1LastTime = lastPlayTime[match.team1];
            const team2LastTime = lastPlayTime[match.team2];
            
            const team1RestTime = team1LastTime ? (currentTime - team1LastTime) / (1000 * 60) : Infinity;
            const team2RestTime = team2LastTime ? (currentTime - team2LastTime) / (1000 * 60) : Infinity;
            
            if (team1RestTime >= minimumRestTime && team2RestTime >= minimumRestTime) {
                const score = Math.min(team1RestTime, team2RestTime);
                
                if (score > bestScore) {
                    bestMatch = { match, index };
                    bestScore = score;
                }
            }
        });
        
        if (!bestMatch) {
            let longestRest = -1;
            unscheduledMatches.forEach((match, index) => {
                // Überspringe K.O.-Spiele mit Platzhalter-Teams
                if ((match.team1 && match.team1.includes('Sieger ')) || 
                    (match.team1 && match.team1.includes('Verlierer ')) ||
                    (match.team2 && match.team2.includes('Sieger ')) || 
                    (match.team2 && match.team2.includes('Verlierer '))) {
                    return;
                }
                
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
            
            match.scheduled = {
                datetime: new Date(currentTime),
                field: field || 'Hauptplatz'
            };
            
            lastPlayTime[match.team1] = new Date(currentTime);
            lastPlayTime[match.team2] = new Date(currentTime);
            
            unscheduledMatches.splice(bestMatch.index, 1);
            scheduledMatches.push(match);
            currentTime = new Date(currentTime.getTime() + matchDuration * 60000);
        } else {
            // Überspringe alle K.O.-Spiele mit Platzhaltern
            const remainingNonPlaceholderMatches = unscheduledMatches.filter(match => 
                !(match.team1 && match.team1.includes('Sieger ')) && 
                !(match.team1 && match.team1.includes('Verlierer ')) &&
                !(match.team2 && match.team2.includes('Sieger ')) && 
                !(match.team2 && match.team2.includes('Verlierer '))
            );
            
            if (remainingNonPlaceholderMatches.length === 0) {
                // Alle verbleibenden Spiele haben Platzhalter - breche ab
                console.log('Nur K.O.-Spiele mit Platzhalter-Teams übrig, beende Planung');
                break;
            }
            
            console.warn('Fallback scheduling used');
            const match = remainingNonPlaceholderMatches[0];
            const matchIndex = unscheduledMatches.indexOf(match);
            
            match.scheduled = {
                datetime: new Date(currentTime),
                field: field || 'Hauptplatz'
            };
            
            lastPlayTime[match.team1] = new Date(currentTime);
            lastPlayTime[match.team2] = new Date(currentTime);
            
            unscheduledMatches.splice(matchIndex, 1);
            scheduledMatches.push(match);
            currentTime = new Date(currentTime.getTime() + matchDuration * 60000);
        }
    }
    
    return scheduledMatches;
}

function updateGroupTable(groupName, matches) {
    updateGroupTableWithPenalties(groupName, matches);
}

// ========================= ROUTES =========================

// Startseite
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Admin-Seite
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Verfügbare Trikotfarben abrufen
app.get('/api/jersey-colors', (req, res) => {
    const colorUsage = {};
    
    // Zähle wie oft jede Farbe verwendet wird
    AVAILABLE_COLORS.forEach(color => {
        colorUsage[color.value] = teams.filter(team => team.jerseyColor === color.value).length;
    });
    
    const colorsWithUsage = AVAILABLE_COLORS.map(color => ({
        ...color,
        usage: colorUsage[color.value] || 0
    }));
    
    res.json(colorsWithUsage);
});

// Teams registrieren (erweitert mit Trikotfarbe)
app.post('/api/teams', (req, res) => {
    const { teamName, contactName, contactInfo, jerseyColor } = req.body;
    
    if (!teamName || !contactName || !contactInfo || !jerseyColor) {
        return res.status(400).json({ error: 'Alle Felder sind erforderlich' });
    }
    
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
    
    // Prüfe ob die Farbe gültig ist
    const validColor = AVAILABLE_COLORS.find(color => color.value === jerseyColor);
    if (!validColor) {
        return res.status(400).json({ error: 'Ungültige Trikotfarbe' });
    }
    
    const team = {
        id: Date.now(),
        name: teamName,
        contact: {
            name: contactName,
            info: contactInfo
        },
        jerseyColor: jerseyColor,
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
        name: team.name,
        jerseyColor: team.jerseyColor
    }));
    res.json(publicTeams);
});

// Admin: Alle Teams mit Kontaktdaten
app.get('/api/admin/teams', (req, res) => {
    res.json(teams);
});

// ========= NEUE ROUTE: Tournament-Konfiguration analysieren ==========
app.post('/api/admin/analyze-tournament-config', (req, res) => {
    const { password, format, options } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ungültiges Passwort' });
    }
    
    if (teams.length === 0) {
        return res.status(400).json({ error: 'Keine Teams zum Analysieren' });
    }
    
    try {
        const analysis = analyzeTournamentConfiguration(teams.length, format, options);
        
        res.json({ 
            success: true, 
            analysis: analysis,
            teamCount: teams.length
        });
    } catch (error) {
        console.error('Error during tournament analysis:', error);
        res.status(500).json({ error: 'Fehler bei der Turnier-Analyse: ' + error.message });
    }
});

// ========= VERBESSERTE ROUTE: Anmeldung schließen (nur Gruppen + Swiss System) ==========
app.post('/api/admin/close-registration', (req, res) => {
    const { 
        password, 
        format, // 'groups', 'swiss'
        groupSize, 
        rounds, // für Swiss System
        maxGamesPerTeam,
        enableQuarterfinals,
        enableThirdPlace, 
        enableFifthPlace, 
        enableSeventhPlace 
    } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ungültiges Passwort' });
    }
    
    if (!currentTournament || currentTournament.status !== 'registration') {
        return res.status(400).json({ error: 'Kein Turnier in Anmeldephase vorhanden' });
    }
    
    if (teams.length < 4) {
        return res.status(400).json({ error: 'Mindestens 4 Teams für Spielplan erforderlich' });
    }
    
    console.log(`Schließe Anmeldung mit Format: ${format}`, { groupSize, rounds, maxGamesPerTeam });
    
    // VALIDIERE ZUERST DIE KONFIGURATION
    const validation = validateGameDistribution(teams, format, { groupSize, rounds, maxGamesPerTeam });
    if (!validation.isValid) {
        return res.status(400).json({ 
            error: 'Mathematisch unmögliche Konfiguration!', 
            details: validation.impossibleConstraints,
            suggestions: validation.suggestions
        });
    }
    
    // Anmeldung schließen
    currentTournament.status = 'closed';
    currentTournament.registrationClosedAt = new Date();
    currentTournament.lastUpdated = new Date().toISOString();
    
    // Einstellungen speichern
    currentTournament.settings = {
        format: format || 'groups',
        groupSize: groupSize || 4,
        rounds: rounds || null,
        maxGamesPerTeam: maxGamesPerTeam || null,
        enableQuarterfinals: enableQuarterfinals || false,
        enableThirdPlace: enableThirdPlace || false,
        enableFifthPlace: enableFifthPlace || false,
        enableSeventhPlace: enableSeventhPlace || false
    };
    
    let generatedMatches = [];
    
    try {
        if (format === 'swiss') {
            // Intelligenter Swiss System (Champions League Style)
            currentTournament.format = 'swiss';
            currentTournament.groups = [{
                name: 'Champions League Format',
                teams: teams,
                table: teams.map(team => ({
                    team: team.name,
                    games: 0,
                    wins: 0,
                    draws: 0,
                    losses: 0,
                    goalsFor: 0,
                    goalsAgainst: 0,
                    goalDiff: 0,
                    points: 0,
                    penaltyWins: 0
                }))
            }];
            
            const targetGamesPerTeam = rounds || Math.min(Math.ceil(Math.log2(teams.length)) + 1, teams.length - 1);
            console.log(`Generiere Swiss System mit ${targetGamesPerTeam} Spielen pro Team...`);
            
            generatedMatches = generateIntelligentSwissSystem(teams, targetGamesPerTeam);
            
        } else {
            // Standard Gruppensystem (verbessert)
            currentTournament.format = 'groups';
            const groups = createImprovedGroups(teams, currentTournament.settings.groupSize);
            currentTournament.groups = groups;
            
            generatedMatches = generateImprovedGroupMatches(groups, currentTournament.settings.maxGamesPerTeam);
        }
        
        // Schiedsrichter zuweisen
        const matchesWithReferees = assignReferees(generatedMatches, currentTournament.groups);
        matches = [...matchesWithReferees];
        
        // Status auf aktiv setzen
        currentTournament.status = 'active';
        currentTournament.phase = currentTournament.format === 'groups' ? 'group' : currentTournament.format;
        
        autoSave();
        
        console.log(`✅ Turnier aktiviert mit ${format}: ${teams.length} Teams, ${matches.length} Spiele generiert`);
        
        // Finale Validierung für Swiss System
        if (format === 'swiss') {
            const teamGameCounts = {};
            teams.forEach(team => teamGameCounts[team.name] = 0);
            matches.forEach(match => {
                teamGameCounts[match.team1]++;
                teamGameCounts[match.team2]++;
            });
            
            console.log('Finale Swiss System Verteilung:', teamGameCounts);
            
            // Prüfe, ob alle Teams gleich viele Spiele haben
            const gameCounts = Object.values(teamGameCounts);
            const allEqual = gameCounts.every(count => count === gameCounts[0]);
            
            if (!allEqual) {
                console.warn('⚠️ Warnung: Nicht alle Teams haben gleich viele Spiele!', teamGameCounts);
            }
        }
        
        res.json({ 
            success: true, 
            tournament: currentTournament, 
            matchesGenerated: matches.length,
            format: format,
            message: `Spielplan mit ${matches.length} Spielen für ${teams.length} Teams erstellt (Format: ${format})`
        });
        
    } catch (error) {
        console.error('Fehler beim Generieren des Spielplans:', error);
        
        // Rollback bei Fehler
        currentTournament.status = 'registration';
        delete currentTournament.registrationClosedAt;
        
        res.status(500).json({ 
            error: 'Fehler beim Erstellen des Spielplans: ' + error.message,
            suggestion: 'Versuche es mit anderen Einstellungen oder einem anderen Format.'
        });
    }
});

// Elfmeterschießen generieren
app.post('/api/admin/generate-penalties', (req, res) => {
    const { password } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ungültiges Passwort' });
    }
    
    if (!currentTournament || !currentTournament.groups) {
        return res.status(400).json({ error: 'Kein aktives Turnier mit Gruppen' });
    }
    
    try {
        const penaltyMatches = generatePenaltyShootouts(currentTournament.groups);
        
        if (penaltyMatches.length === 0) {
            return res.json({ 
                success: true, 
                message: 'Keine Elfmeterschießen erforderlich - alle Plätze sind eindeutig entschieden',
                penaltyMatches: 0
            });
        }
        
        // Füge Elfmeterschießen zu den Matches hinzu
        matches.push(...penaltyMatches);
        
        autoSave();
        
        res.json({
            success: true,
            message: `${penaltyMatches.length} Elfmeterschießen generiert für Gleichstände`,
            penaltyMatches: penaltyMatches.length,
            matches: penaltyMatches
        });
        
    } catch (error) {
        console.error('Error generating penalty shootouts:', error);
        res.status(500).json({ error: 'Fehler beim Generieren der Elfmeterschießen: ' + error.message });
    }
});

// Admin: Team löschen
app.delete('/api/admin/teams/:teamId', (req, res) => {
    const { password } = req.body;
    const teamId = parseInt(req.params.teamId);
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ungültiges Passwort' });
    }
    
    const teamIndex = teams.findIndex(t => t.id === teamId);
    if (teamIndex === -1) {
        return res.status(404).json({ error: 'Team nicht gefunden' });
    }
    
    const teamName = teams[teamIndex].name;
    
    // Entferne Team aus allen Matches
    matches.forEach(match => {
        if (match.team1 === teamName || match.team2 === teamName) {
            match.team1 = match.team1 === teamName ? 'GELÖSCHT' : match.team1;
            match.team2 = match.team2 === teamName ? 'GELÖSCHT' : match.team2;
        }
    });
    
    // Entferne Team aus Gruppen
    if (currentTournament && currentTournament.groups) {
        currentTournament.groups.forEach(group => {
            group.teams = group.teams.filter(t => t.name !== teamName);
            group.table = group.table.filter(t => t.team !== teamName);
        });
    }
    
    teams.splice(teamIndex, 1);
    autoSave();
    
    res.json({ success: true, message: `Team "${teamName}" erfolgreich gelöscht` });
});

// Admin: Team bearbeiten
app.put('/api/admin/teams/:teamId', (req, res) => {
    const { password, teamName, contactName, contactInfo, jerseyColor } = req.body;
    const teamId = parseInt(req.params.teamId);
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ungültiges Passwort' });
    }
    
    const team = teams.find(t => t.id === teamId);
    if (!team) {
        return res.status(404).json({ error: 'Team nicht gefunden' });
    }
    
    const oldName = team.name;
    
    if (teamName !== oldName && teams.find(t => t.name === teamName)) {
        return res.status(400).json({ error: 'Teamname bereits vergeben' });
    }
    
    team.name = teamName;
    team.contact.name = contactName;
    team.contact.info = contactInfo;
    
    if (jerseyColor) {
        const validColor = AVAILABLE_COLORS.find(color => color.value === jerseyColor);
        if (validColor) {
            team.jerseyColor = jerseyColor;
        }
    }
    
    if (teamName !== oldName) {
        matches.forEach(match => {
            if (match.team1 === oldName) match.team1 = teamName;
            if (match.team2 === oldName) match.team2 = teamName;
            if (match.referee && match.referee.team === oldName) {
                match.referee.team = teamName;
            }
        });
        
        if (currentTournament && currentTournament.groups) {
            currentTournament.groups.forEach(group => {
                group.teams.forEach(t => {
                    if (t.name === oldName) t.name = teamName;
                });
                group.table.forEach(t => {
                    if (t.team === oldName) t.team = teamName;
                });
            });
        }
    }
    
    autoSave();
    res.json({ success: true, team });
});

// Admin: Match löschen
app.delete('/api/admin/matches/:matchId', (req, res) => {
    const { password } = req.body;
    const matchId = req.params.matchId;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ungültiges Passwort' });
    }
    
    const matchIndex = matches.findIndex(m => m.id === matchId);
    if (matchIndex === -1) {
        return res.status(404).json({ error: 'Spiel nicht gefunden' });
    }
    
    const match = matches[matchIndex];
    
    if (match.completed && match.phase === 'group') {
        matches.splice(matchIndex, 1);
        updateGroupTable(match.group, matches);
        matches.splice(matchIndex, 0, match);
    }
    
    matches.splice(matchIndex, 1);
    autoSave();
    
    res.json({ success: true, message: `Spiel "${match.team1} vs ${match.team2}" erfolgreich gelöscht` });
});

// Admin: Match bearbeiten
app.put('/api/admin/matches/:matchId', (req, res) => {
    const { password, team1, team2, group, referee, datetime, field } = req.body;
    const matchId = req.params.matchId;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ungültiges Passwort' });
    }
    
    const match = matches.find(m => m.id === matchId);
    if (!match) {
        return res.status(404).json({ error: 'Spiel nicht gefunden' });
    }
    
    if (team1) match.team1 = team1;
    if (team2) match.team2 = team2;
    if (group) match.group = group;
    
    if (referee !== undefined) {
        if (referee === null || referee === '') {
            delete match.referee;
        } else {
            match.referee = referee;
        }
    }
    
    if (datetime || field) {
        if (!match.scheduled) match.scheduled = {};
        if (datetime) match.scheduled.datetime = new Date(datetime);
        if (field) match.scheduled.field = field;
    }
    
    if (match.completed && match.phase === 'group') {
        updateGroupTable(match.group, matches);
    }
    
    autoSave();
    res.json({ success: true, match });
});

// Funktion zum Aktualisieren abhängiger K.O.-Spiele
function updateDependentKnockoutMatches(completedMatchId) {
    const completedMatch = matches.find(m => m.id === completedMatchId);
    if (!completedMatch || !completedMatch.completed) return;
    
    // Bestimme Sieger und Verlierer (berücksichtige Elfmeterschießen)
    let winner, loser;
    
    if (completedMatch.penaltyWinner) {
        // Sieger durch Elfmeterschießen
        winner = completedMatch.penaltyWinner === 1 ? completedMatch.team1 : completedMatch.team2;
        loser = completedMatch.penaltyWinner === 1 ? completedMatch.team2 : completedMatch.team1;
    } else {
        // Regulärer Sieger
        const totalScore1 = completedMatch.score1 + (completedMatch.liveScore?.overtime?.score1 || 0);
        const totalScore2 = completedMatch.score2 + (completedMatch.liveScore?.overtime?.score2 || 0);
        
        winner = totalScore1 > totalScore2 ? completedMatch.team1 : completedMatch.team2;
        loser = totalScore1 > totalScore2 ? completedMatch.team2 : completedMatch.team1;
    }
    
    // Finde alle Spiele, die von diesem Spiel abhängen
    matches.forEach(match => {
        if (match.koInfo && match.koInfo.dependsOn && match.koInfo.dependsOn.includes(completedMatchId)) {
            // Ersetze Platzhalter-Teams
            if (match.team1 === `Sieger ${completedMatchId}`) {
                match.team1 = winner;
            } else if (match.team1 === `Verlierer ${completedMatchId}`) {
                match.team1 = loser;
            }
            
            if (match.team2 === `Sieger ${completedMatchId}`) {
                match.team2 = winner;
            } else if (match.team2 === `Verlierer ${completedMatchId}`) {
                match.team2 = loser;
            }
        }
    });
}

// Admin: Ergebnis bearbeiten
app.put('/api/admin/results/:matchId', (req, res) => {
    const { password, score1, score2 } = req.body;
    const matchId = req.params.matchId;
    
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
        
        // Prüfe ob alle Gruppenspiele abgeschlossen sind und generiere K.O.-Spiele
        const koGenerated = generateFinalTableAndKnockoutMatches();
        if (koGenerated) {
            console.log('K.O.-Phase automatisch generiert nach Spielergebnis');
        }
    } else if (match.phase !== 'group') {
        // Bei K.O.-Spielen: Aktualisiere abhängige Spiele
        updateDependentKnockoutMatches(matchId);
    }
    
    autoSave();
    res.json({ success: true, match });
});

// Admin: Neues Match hinzufügen
app.post('/api/admin/matches', (req, res) => {
    const { password, team1, team2, group, phase, referee, datetime, field } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ungültiges Passwort' });
    }
    
    if (!team1 || !team2) {
        return res.status(400).json({ error: 'Beide Teams sind erforderlich' });
    }
    
    const newMatch = {
        id: `manual_${Date.now()}`,
        phase: phase || 'group',
        group: group || 'Manuell',
        team1: team1,
        team2: team2,
        score1: null,
        score2: null,
        completed: false
    };
    
    if (referee) {
        newMatch.referee = referee;
    }
    
    if (datetime || field) {
        newMatch.scheduled = {};
        if (datetime) newMatch.scheduled.datetime = new Date(datetime);
        if (field) newMatch.scheduled.field = field;
    }
    
    matches.push(newMatch);
    autoSave();
    
    res.json({ success: true, match: newMatch });
});

// Admin: Turnier-Status ändern
app.put('/api/admin/tournament/status', (req, res) => {
    const { password, status } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ungültiges Passwort' });
    }
    
    if (!currentTournament) {
        return res.status(404).json({ error: 'Kein aktives Turnier' });
    }
    
    const validStatuses = ['registration', 'closed', 'active', 'finished'];
    if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Ungültiger Status' });
    }
    
    currentTournament.status = status;
    currentTournament.lastUpdated = new Date().toISOString();
    
    autoSave();
    res.json({ success: true, tournament: currentTournament });
});

// Admin: Finale Tabelle für K.O.-Konfiguration abrufen
app.post('/api/admin/get-final-table', (req, res) => {
    const { password } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ungültiges Passwort' });
    }
    
    if (!currentTournament) {
        return res.status(404).json({ error: 'Kein aktives Turnier' });
    }
    
    try {
        let finalTable = [];
        
        // Erstelle finale Tabelle abhängig vom Format (gleiche Logik wie in generateFinalTableAndKnockoutMatches)
        if (currentTournament.settings?.format === 'swiss' || 
            (!currentTournament.groups || currentTournament.groups.length === 0)) {
            
            const allTeams = new Set();
            
            // Erst versuchen mit phase: 'group'
            let groupMatches = matches.filter(m => m.phase === 'group');
            
            // Fallback: Wenn keine Matches mit phase: 'group', dann alle non-KO Matches
            if (groupMatches.length === 0) {
                groupMatches = matches.filter(m => 
                    !(m.phase === 'quarterfinal' || m.phase === 'semifinal' || m.phase === 'final') &&
                    !(m.group?.toLowerCase().includes('finale')) &&
                    !(m.group?.toLowerCase().includes('halbfinale')) &&
                    !(m.group?.toLowerCase().includes('viertelfinale')) &&
                    !(m.group?.toLowerCase().includes('platz'))
                );
            }
            
            groupMatches.forEach(m => {
                allTeams.add(m.team1);
                allTeams.add(m.team2);
            });
            
            finalTable = Array.from(allTeams).map(teamName => {
                const teamStats = {
                    team: teamName,
                    games: 0,
                    wins: 0,
                    draws: 0,
                    losses: 0,
                    goalsFor: 0,
                    goalsAgainst: 0,
                    goalDiff: 0,
                    points: 0,
                    penaltyWins: 0
                };
                
                // Berechne Statistiken aus allen Spielen
                groupMatches.filter(m => 
                    m.completed && 
                    !m.isPenaltyShootout &&
                    (m.team1 === teamName || m.team2 === teamName)
                ).forEach(match => {
                    const isTeam1 = match.team1 === teamName;
                    const ownScore = isTeam1 ? match.score1 : match.score2;
                    const oppScore = isTeam1 ? match.score2 : match.score1;
                    
                    teamStats.games++;
                    teamStats.goalsFor += ownScore;
                    teamStats.goalsAgainst += oppScore;
                    teamStats.goalDiff = teamStats.goalsFor - teamStats.goalsAgainst;
                    
                    if (ownScore > oppScore) {
                        teamStats.wins++;
                        teamStats.points += 3;
                    } else if (ownScore === oppScore) {
                        teamStats.draws++;
                        teamStats.points += 1;
                    } else {
                        teamStats.losses++;
                    }
                });
                
                // Penalty-Siege zählen
                groupMatches.filter(m => 
                    m.isPenaltyShootout && 
                    m.completed &&
                    (m.team1 === teamName || m.team2 === teamName)
                ).forEach(penalty => {
                    const isTeam1 = penalty.team1 === teamName;
                    const ownScore = isTeam1 ? penalty.score1 : penalty.score2;
                    const oppScore = isTeam1 ? penalty.score2 : penalty.score1;
                    
                    if (ownScore > oppScore) {
                        teamStats.penaltyWins++;
                    }
                });
                
                return teamStats;
            });
            
            // Sortiere finale Tabelle
            finalTable.sort((a, b) => {
                if (b.points !== a.points) return b.points - a.points;
                if (b.goalDiff !== a.goalDiff) return b.goalDiff - a.goalDiff;
                if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
                return b.penaltyWins - a.penaltyWins;
            });
            
        } else {
            // Klassisches Gruppensystem: Gruppensieger und -zweite
            for (const group of currentTournament.groups) {
                if (group.table && group.table.length >= 2) {
                    const sortedTable = [...group.table].sort((a, b) => {
                        if (b.points !== a.points) return b.points - a.points;
                        if (b.goalDiff !== a.goalDiff) return b.goalDiff - a.goalDiff;
                        if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
                        return b.penaltyWins - a.penaltyWins;
                    });
                    
                    // Gruppensieger und -zweiter zur finalen Tabelle hinzufügen
                    finalTable.push({
                        ...sortedTable[0],
                        groupPosition: 1,
                        groupName: group.name
                    });
                    
                    if (sortedTable.length >= 2) {
                        finalTable.push({
                            ...sortedTable[1],
                            groupPosition: 2,
                            groupName: group.name
                        });
                    }
                }
            }
            
            // Sortiere finale Tabelle: Gruppensieger zuerst, dann Gruppenzweite
            finalTable.sort((a, b) => {
                if (a.groupPosition !== b.groupPosition) {
                    return a.groupPosition - b.groupPosition;
                }
                if (b.points !== a.points) return b.points - a.points;
                if (b.goalDiff !== a.goalDiff) return b.goalDiff - a.goalDiff;
                if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
                return b.penaltyWins - a.penaltyWins;
            });
        }
        
        res.json({
            success: true,
            finalTable: finalTable
        });
        
    } catch (error) {
        console.error('Fehler beim Erstellen der finalen Tabelle:', error);
        res.status(500).json({ 
            error: 'Fehler beim Erstellen der finalen Tabelle',
            details: error.message
        });
    }
});

// Admin: K.O.-Spiele manuell generieren
app.post('/api/admin/generate-knockout', (req, res) => {
    const { password, config } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ungültiges Passwort' });
    }
    
    if (!currentTournament) {
        return res.status(404).json({ error: 'Kein aktives Turnier' });
    }
    
    // Prüfe ob bereits K.O.-Spiele existieren
    const existingKoMatches = matches.filter(m => 
        m.phase === 'quarterfinal' || 
        m.phase === 'semifinal' || 
        m.phase === 'final' ||
        m.group?.toLowerCase().includes('finale') ||
        m.group?.toLowerCase().includes('platz')
    );
    
    if (existingKoMatches.length > 0) {
        return res.status(400).json({ 
            error: 'K.O.-Spiele wurden bereits generiert',
            existingMatches: existingKoMatches.length
        });
    }
    
    console.log('Versuche K.O.-Spiele zu generieren...');
    console.log('Turnier-Status:', currentTournament?.status);
    console.log('Turnier-Format:', currentTournament?.settings?.format);
    console.log('Anzahl Matches:', matches.length);
    
    // Debug: Zeige alle vorhandenen Matches
    console.log('Alle Matches:');
    matches.forEach((match, index) => {
        console.log(`  ${index + 1}. ${match.team1} vs ${match.team2} - Phase: ${match.phase || 'undefined'} - Gruppe: ${match.group || 'undefined'} - Abgeschlossen: ${match.completed}`);
    });
    
    const koGenerated = generateFinalTableAndKnockoutMatches(config);
    
    if (koGenerated) {
        const newKoMatches = matches.filter(m => 
            m.phase === 'quarterfinal' || 
            m.phase === 'semifinal' || 
            m.phase === 'final' ||
            m.group?.toLowerCase().includes('finale') ||
            m.group?.toLowerCase().includes('platz')
        );
        
        res.json({ 
            success: true, 
            message: 'K.O.-Spiele erfolgreich generiert',
            matchesGenerated: newKoMatches.length,
            finalTable: currentTournament.finalTable
        });
    } else {
        // Debugging-Informationen hinzufügen
        const groupMatches = matches.filter(m => m.phase === 'group');
        const incompleteGroupMatches = groupMatches.filter(m => !m.completed && !m.isPenaltyShootout);
        
        console.log('K.O.-Generierung fehlgeschlagen:');
        console.log('- Anzahl Gruppenspiele:', groupMatches.length);
        console.log('- Unabgeschlossene Gruppenspiele:', incompleteGroupMatches.length);
        console.log('- Gruppen:', currentTournament?.groups?.length || 0);
        
        res.status(400).json({ 
            error: 'K.O.-Spiele konnten nicht generiert werden',
            reason: 'Gruppenphase noch nicht abgeschlossen oder unzureichende Daten',
            debug: {
                tournamentStatus: currentTournament?.status,
                groupMatches: groupMatches.length,
                incompleteMatches: incompleteGroupMatches.length,
                groups: currentTournament?.groups?.length || 0,
                format: currentTournament?.settings?.format
            }
        });
    }
});

// Admin: Turnier komplett zurücksetzen
app.delete('/api/admin/tournament/reset', (req, res) => {
    const { password, confirmText } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ungültiges Passwort' });
    }
    
    if (confirmText !== 'RESET') {
        return res.status(400).json({ error: 'Bestätigung erforderlich: Schreibe "RESET"' });
    }
    
    if (!currentTournament) {
        return res.status(404).json({ error: 'Kein aktives Turnier zum Zurücksetzen' });
    }
    
    const year = currentTournament.year;
    
    teams = [];
    matches = [];
    currentTournament = null;
    tournaments = [];
    tournamentRules = "";
    
    const filename = path.join(SAVES_DIR, `${year}.json`);
    try {
        if (fs.existsSync(filename)) {
            fs.unlinkSync(filename);
            console.log(`Turnierdatei ${filename} gelöscht`);
        }
    } catch (error) {
        console.error('Fehler beim Löschen der Turnierdatei:', error);
    }
    
    console.log(`Turnier ${year} komplett zurückgesetzt`);
    
    res.json({ 
        success: true, 
        message: `Turnier ${year} wurde komplett zurückgesetzt. Alle Teams, Spiele und Einstellungen wurden gelöscht.` 
    });
});

// Admin: Gruppen neu organisieren
app.post('/api/admin/tournament/reorganize-groups', (req, res) => {
    const { password, groupSize } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ungültiges Passwort' });
    }
    
    if (!currentTournament) {
        return res.status(404).json({ error: 'Kein aktives Turnier' });
    }
    
    if (teams.length === 0) {
        return res.status(400).json({ error: 'Keine Teams zum Organisieren' });
    }
    
    matches = matches.filter(m => m.phase !== 'group');
    
    const newGroups = createImprovedGroups(teams, groupSize || 4);
    currentTournament.groups = newGroups;
    currentTournament.settings.groupSize = groupSize || 4;
    
    const groupMatches = generateImprovedGroupMatches(newGroups, currentTournament.settings.maxGamesPerTeam);
    const matchesWithReferees = assignReferees(groupMatches, newGroups);
    
    matches = [...matches, ...matchesWithReferees];
    
    currentTournament.lastUpdated = new Date().toISOString();
    autoSave();
    
    res.json({ 
        success: true, 
        tournament: currentTournament,
        newMatches: matchesWithReferees.length,
        message: `Gruppen neu organisiert: ${newGroups.length} Gruppen mit ${matchesWithReferees.length} neuen Spielen`
    });
});

// Admin: Alle Matches zurücksetzen (Ergebnisse löschen)
app.post('/api/admin/matches/reset-results', (req, res) => {
    const { password } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ungültiges Passwort' });
    }
    
    let resetCount = 0;
    matches.forEach(match => {
        if (match.completed) {
            match.score1 = null;
            match.score2 = null;
            match.completed = false;
            if (match.liveScore) {
                match.liveScore.isLive = false;
            }
            resetCount++;
        }
    });
    
    if (currentTournament && currentTournament.groups) {
        currentTournament.groups.forEach(group => {
            group.table.forEach(entry => {
                entry.games = 0;
                entry.wins = 0;
                entry.draws = 0;
                entry.losses = 0;
                entry.goalsFor = 0;
                entry.goalsAgainst = 0;
                entry.goalDiff = 0;
                entry.points = 0;
                entry.penaltyWins = 0;
            });
        });
    }
    
    autoSave();
    res.json({ 
        success: true, 
        message: `${resetCount} Spielergebnisse zurückgesetzt und Tabellen geleert` 
    });
});

// Admin: Alle Zeitplanungen zurücksetzen
app.post('/api/admin/matches/reset-schedule', (req, res) => {
    const { password } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ungültiges Passwort' });
    }
    
    let resetCount = 0;
    matches.forEach(match => {
        if (match.scheduled) {
            delete match.scheduled;
            resetCount++;
        }
    });
    
    autoSave();
    res.json({ 
        success: true, 
        message: `${resetCount} Zeitplanungen zurückgesetzt` 
    });
});

// Admin: Alle Spiele automatisch planen
app.post('/api/admin/matches/schedule-all', (req, res) => {
    const { password, startTime, matchDuration, field } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ungültiges Passwort' });
    }
    
    if (!currentTournament) {
        return res.status(404).json({ error: 'Kein aktives Turnier' });
    }
    
    // Validierung der Parameter
    if (!startTime || !matchDuration || !field) {
        return res.status(400).json({ 
            error: 'Startzeit, Spieldauer und Platz sind erforderlich' 
        });
    }
    
    try {
        // Finde alle ungeplanten Spiele (ohne K.O.-Spiele)
        const unscheduledMatches = matches.filter(match => 
            !match.scheduled && 
            !match.completed &&
            !(match.phase === 'quarterfinal' || match.phase === 'semifinal' || match.phase === 'final') &&
            !(match.group?.toLowerCase().includes('finale')) &&
            !(match.group?.toLowerCase().includes('halbfinale')) &&
            !(match.group?.toLowerCase().includes('viertelfinale')) &&
            !(match.group?.toLowerCase().includes('platz'))
        );
        
        if (unscheduledMatches.length === 0) {
            return res.json({
                success: true,
                message: 'Alle Spiele sind bereits geplant',
                scheduledCount: 0
            });
        }
        
        // Parse Startzeit
        const [startHour, startMinute] = startTime.split(':').map(Number);
        if (isNaN(startHour) || isNaN(startMinute)) {
            return res.status(400).json({ error: 'Ungültige Startzeit (Format: HH:MM)' });
        }
        
        // Parse Spieldauer
        const duration = parseInt(matchDuration);
        if (isNaN(duration) || duration <= 0) {
            return res.status(400).json({ error: 'Ungültige Spieldauer' });
        }
        
        // Erstelle Zeitplan für heute
        const today = new Date();
        let currentDateTime = new Date(today);
        currentDateTime.setHours(startHour, startMinute, 0, 0);
        
        console.log(`Plane ${unscheduledMatches.length} Spiele ab ${currentDateTime.toLocaleString()}`);
        
        // Plane jedes Spiel
        unscheduledMatches.forEach((match, index) => {
            match.scheduled = {
                datetime: new Date(currentDateTime).toISOString(),
                field: field
            };
            
            console.log(`Spiel ${index + 1}: ${match.team1} vs ${match.team2} um ${currentDateTime.toLocaleTimeString()}`);
            
            // Nächste Zeit berechnen (Spieldauer + 5 Min Pause)
            currentDateTime.setMinutes(currentDateTime.getMinutes() + duration + 5);
        });
        
        // Turnier-Timestamp aktualisieren
        if (currentTournament) {
            currentTournament.lastUpdated = new Date().toISOString();
        }
        
        autoSave();
        
        res.json({
            success: true,
            message: `${unscheduledMatches.length} Spiele erfolgreich geplant`,
            scheduledCount: unscheduledMatches.length,
            startTime: startTime,
            field: field,
            duration: duration
        });
        
    } catch (error) {
        console.error('Fehler beim Planen der Spiele:', error);
        res.status(500).json({ 
            error: 'Fehler beim Planen der Spiele',
            details: error.message
        });
    }
});

// Admin: Daten exportieren
app.get('/api/admin/export/:year?', (req, res) => {
    const year = req.params.year || (currentTournament ? currentTournament.year : new Date().getFullYear());
    
    const exportData = {
        year: year,
        tournament: currentTournament,
        teams: teams,
        matches: matches,
        rules: tournamentRules,
        exportedAt: new Date().toISOString()
    };
    
    res.setHeader('Content-Disposition', `attachment; filename="turnier_${year}_export.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.json(exportData);
});

// Regeln abrufen
app.get('/api/rules', (req, res) => {
    res.json({ rules: tournamentRules });
});

// Kontaktdaten abrufen
app.get('/api/contact', (req, res) => {
    res.json(contactData);
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

// Admin: Kontaktdaten bearbeiten
app.post('/api/admin/contact', (req, res) => {
    const { password, address, nextcloudGroup, additional } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ungültiges Passwort' });
    }
    
    contactData = {
        address: address || "",
        nextcloudGroup: nextcloudGroup || "",
        additional: additional || ""
    };
    
    autoSave();
    res.json({ success: true, contact: contactData });
});

// Admin: Turnier erstellen
app.post('/api/admin/tournament', (req, res) => {
    const { password, year } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ungültiges Passwort' });
    }
    
    const tournamentYear = year || new Date().getFullYear();
    
    loadDataForYear(tournamentYear);
    
    if (currentTournament && currentTournament.year === tournamentYear) {
        return res.status(400).json({ error: `Für ${tournamentYear} existiert bereits ein Turnier` });
    }
    
    currentTournament = {
        id: Date.now(),
        year: tournamentYear,
        settings: {},
        status: 'registration',
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
    
    teams = [];
    matches = [];
    tournaments = [currentTournament];
    
    autoSave();
    
    res.json({ success: true, tournament: currentTournament });
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
// Admin: K.O.-Spiele intelligent planen
app.post('/api/admin/schedule-knockout', (req, res) => {
    const { password, startTime, matchDuration, field, breakBetweenRounds } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ungültiges Passwort' });
    }
    
    if (!/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(startTime)) {
        return res.status(400).json({ error: 'Ungültiges Zeitformat. Bitte HH:MM verwenden.' });
    }
    
    const koMatches = matches.filter(m => m.phase !== 'group');
    const schedulableMatches = koMatches.filter(m => !m.scheduled && 
        !(m.team1.includes('Sieger ') || m.team1.includes('Verlierer ') ||
          m.team2.includes('Sieger ') || m.team2.includes('Verlierer ')));
    
    if (schedulableMatches.length === 0) {
        return res.status(400).json({ error: 'Keine K.O.-Spiele zum Planen verfügbar' });
    }
    
    const [hours, minutes] = startTime.split(':').map(num => parseInt(num));
    const today = new Date();
    let currentTime = new Date(today.getFullYear(), today.getMonth(), today.getDate(), hours, minutes, 0, 0);
    
    // Sortiere nach Phasen (quarterfinals -> semifinals -> finals -> placement)
    const phaseOrder = { 'quarterfinal': 1, 'semifinal': 2, 'final': 3, 'placement': 4 };
    schedulableMatches.sort((a, b) => phaseOrder[a.phase] - phaseOrder[b.phase]);
    
    let scheduledCount = 0;
    let currentPhase = null;
    
    schedulableMatches.forEach(match => {
        // Neue Phase = längere Pause
        if (currentPhase && currentPhase !== match.phase) {
            currentTime = new Date(currentTime.getTime() + (breakBetweenRounds || 30) * 60000);
        }
        
        match.scheduled = {
            datetime: new Date(currentTime),
            field: field || 'Hauptplatz'
        };
        
        currentTime = new Date(currentTime.getTime() + parseInt(matchDuration) * 60000);
        currentPhase = match.phase;
        scheduledCount++;
    });
    
    if (currentTournament) {
        currentTournament.lastUpdated = new Date().toISOString();
    }
    
    autoSave();
    res.json({ 
        success: true, 
        scheduledMatches: scheduledCount,
        message: `${scheduledCount} K.O.-Spiele geplant`
    });
});

app.post('/api/admin/schedule-all', (req, res) => {
    const { password, startTime, matchDuration, field } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ungültiges Passwort' });
    }
    
    const unscheduledMatches = matches.filter(m => !m.scheduled);
    if (unscheduledMatches.length === 0) {
        return res.status(400).json({ error: 'Keine ungeplanten Spiele vorhanden' });
    }
    
    if (!/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(startTime)) {
        return res.status(400).json({ error: 'Ungültiges Zeitformat. Bitte HH:MM verwenden.' });
    }
    
    console.log(`Intelligent scheduling: Start at ${startTime}, duration ${matchDuration}min`);
    
    try {
        const scheduledMatches = intelligentScheduling(
            unscheduledMatches, 
            currentTournament.groups, 
            startTime, 
            parseInt(matchDuration), 
            field
        );
        
        scheduledMatches.forEach(scheduledMatch => {
            const originalMatch = matches.find(m => m.id === scheduledMatch.id);
            if (originalMatch) {
                originalMatch.scheduled = scheduledMatch.scheduled;
            }
        });
        
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
        broadcastUpdate('current-match-changed', { matchId, currentMatch: matchId });
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
    
    match.liveScore.score1 = parseInt(score1) || 0;
    match.liveScore.score2 = parseInt(score2) || 0;
    match.liveScore.lastScoreUpdate = new Date();
    
    autoSave();
    broadcastUpdate('live-score-update', { matchId, score1: match.liveScore.score1, score2: match.liveScore.score2, match });
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
    
    if (currentTournament) {
        currentTournament.currentMatch = matchId;
    }
    
    const startTime = new Date();
    match.liveScore = {
        score1: 0,
        score2: 0,
        minute: 0,
        isLive: true,
        isPaused: false,
        startTime: startTime,
        pausedTime: 0,
        halfTimeMinutes: parseInt(halfTimeMinutes) || 45,
        currentHalf: 1,
        halfTimeBreak: false,
        firstHalfEndTime: null,
        secondHalfStartTime: null,
        lastScoreUpdate: startTime
    };
    
    autoSave();
    broadcastUpdate('match-started', { matchId, match, currentMatch: matchId });
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
        broadcastUpdate('match-paused', { matchId, match });
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
        const pauseDuration = new Date() - new Date(match.liveScore.pauseStartTime);
        match.liveScore.pausedTime += pauseDuration;
        match.liveScore.isPaused = false;
        delete match.liveScore.pauseStartTime;
        
        autoSave();
        broadcastUpdate('match-resumed', { matchId, match });
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
        match.liveScore.isPaused = false;
        
        autoSave();
        broadcastUpdate('halftime-started', { matchId, match });
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
        broadcastUpdate('second-half-started', { matchId, match });
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
    
    // Bei K.O.-Spielen: Prüfe auf Unentschieden
    if (match.phase !== 'group') {
        const totalScore1 = match.liveScore.score1 + (match.liveScore.overtime?.score1 || 0);
        const totalScore2 = match.liveScore.score2 + (match.liveScore.overtime?.score2 || 0);
        
        // Nach regulärer Spielzeit unentschieden
        if (match.liveScore.currentHalf === 2 && match.liveScore.score1 === match.liveScore.score2) {
            return res.status(400).json({ 
                error: 'unentschieden_ko',
                message: 'K.O.-Spiel ist unentschieden - Verlängerung erforderlich',
                requiresOvertime: true
            });
        }
        
        // Nach Verlängerung unentschieden
        if (match.liveScore.currentHalf === 4 && totalScore1 === totalScore2) {
            return res.status(400).json({ 
                error: 'unentschieden_ko_overtime',
                message: 'K.O.-Spiel ist nach Verlängerung unentschieden - Elfmeterschießen erforderlich',
                requiresPenaltyShootout: true
            });
        }
        
        // Elfmeterschießen nicht beendet
        if (match.liveScore.penaltyShootout?.isActive) {
            return res.status(400).json({ 
                error: 'penalty_shootout_active',
                message: 'Elfmeterschießen ist noch aktiv',
                requiresPenaltyCompletion: true
            });
        }
        
        // Setze Endresultat bei Elfmeterschießen
        if (match.liveScore.penaltyShootout?.finished) {
            const penalty = match.liveScore.penaltyShootout;
            if (penalty.score1 > penalty.score2) {
                match.score1 = totalScore1;
                match.score2 = totalScore2;
                match.penaltyWinner = 1;
            } else {
                match.score1 = totalScore1;
                match.score2 = totalScore2;
                match.penaltyWinner = 2;
            }
        }
    }
    
    match.score1 = match.liveScore.score1;
    match.score2 = match.liveScore.score2;
    match.completed = true;
    match.liveScore.isLive = false;
    match.liveScore.finishedAt = new Date();
    
    if (match.phase === 'group') {
        updateGroupTable(match.group, matches);
        
        // Prüfe ob alle Gruppenspiele abgeschlossen sind und generiere K.O.-Spiele
        const koGenerated = generateFinalTableAndKnockoutMatches();
        if (koGenerated) {
            console.log('K.O.-Phase automatisch generiert nach Live-Spiel Ende');
        }
    } else if (match.phase !== 'group') {
        // Bei K.O.-Spielen: Aktualisiere abhängige Spiele
        updateDependentKnockoutMatches(matchId);
    }
    
    if (currentTournament && currentTournament.currentMatch === matchId) {
        currentTournament.currentMatch = null;
    }
    
    autoSave();
    broadcastUpdate('match-finished', { matchId, match });
    res.json({ success: true, match });
});

// Admin: Verlängerung starten
app.post('/api/admin/start-overtime', (req, res) => {
    const { password, matchId, overtimeDuration } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ungültiges Passwort' });
    }
    
    const match = matches.find(m => m.id === matchId);
    if (!match || !match.liveScore?.isLive) {
        return res.status(404).json({ error: 'Kein laufendes Spiel gefunden' });
    }
    
    if (match.phase === 'group') {
        return res.status(400).json({ error: 'Verlängerung nur in K.O.-Spielen möglich' });
    }
    
    if (match.liveScore.score1 !== match.liveScore.score2) {
        return res.status(400).json({ error: 'Verlängerung nur bei Unentschieden möglich' });
    }
    
    // Initialisiere Verlängerung
    match.liveScore.overtime = {
        isActive: true,
        currentHalf: 1, // Erste Halbzeit der Verlängerung
        duration: parseInt(overtimeDuration) || 15, // Standard: 15 Minuten pro Halbzeit
        score1: 0,
        score2: 0,
        startTime: new Date(),
        halfTimeBreak: false
    };
    
    match.liveScore.currentHalf = 3; // Kennzeichnet Verlängerung
    match.liveScore.isPaused = false;
    
    autoSave();
    broadcastUpdate('overtime-started', { matchId, match });
    res.json({ success: true, message: 'Verlängerung gestartet' });
});

// Admin: Verlängerung Halbzeit
app.post('/api/admin/overtime-halftime', (req, res) => {
    const { password, matchId } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ungültiges Passwort' });
    }
    
    const match = matches.find(m => m.id === matchId);
    if (!match || !match.liveScore?.overtime?.isActive) {
        return res.status(404).json({ error: 'Keine aktive Verlängerung gefunden' });
    }
    
    if (match.liveScore.overtime.currentHalf === 1) {
        match.liveScore.overtime.halfTimeBreak = true;
        match.liveScore.isPaused = true;
        
        autoSave();
        broadcastUpdate('overtime-halftime', { matchId, match });
        res.json({ success: true, message: 'Verlängerung Halbzeitpause' });
    } else {
        res.status(400).json({ error: 'Halbzeit nur nach der ersten Halbzeit der Verlängerung möglich' });
    }
});

// Admin: Verlängerung zweite Halbzeit
app.post('/api/admin/overtime-second-half', (req, res) => {
    const { password, matchId } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ungültiges Passwort' });
    }
    
    const match = matches.find(m => m.id === matchId);
    if (!match || !match.liveScore?.overtime?.isActive) {
        return res.status(404).json({ error: 'Keine aktive Verlängerung gefunden' });
    }
    
    if (match.liveScore.overtime.halfTimeBreak && match.liveScore.overtime.currentHalf === 1) {
        match.liveScore.overtime.halfTimeBreak = false;
        match.liveScore.overtime.currentHalf = 2;
        match.liveScore.currentHalf = 4; // Zweite Halbzeit Verlängerung
        match.liveScore.isPaused = false;
        
        autoSave();
        broadcastUpdate('overtime-second-half', { matchId, match });
        res.json({ success: true, message: 'Verlängerung zweite Halbzeit gestartet' });
    } else {
        res.status(400).json({ error: 'Zweite Halbzeit der Verlängerung kann nur nach Halbzeitpause gestartet werden' });
    }
});

// Admin: Elfmeterschießen starten
app.post('/api/admin/start-penalty-shootout', (req, res) => {
    const { password, matchId, shootersPerTeam } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ungültiges Passwort' });
    }
    
    const match = matches.find(m => m.id === matchId);
    if (!match || !match.liveScore?.isLive) {
        return res.status(404).json({ error: 'Kein laufendes Spiel gefunden' });
    }
    
    // Gesamtscore inklusive Verlängerung prüfen
    const totalScore1 = match.liveScore.score1 + (match.liveScore.overtime?.score1 || 0);
    const totalScore2 = match.liveScore.score2 + (match.liveScore.overtime?.score2 || 0);
    
    if (totalScore1 !== totalScore2) {
        return res.status(400).json({ error: 'Elfmeterschießen nur bei Unentschieden nach Verlängerung möglich' });
    }
    
    // Initialisiere Elfmeterschießen
    match.liveScore.penaltyShootout = {
        isActive: true,
        shootersPerTeam: parseInt(shootersPerTeam) || 5,
        currentShooter: 1,
        currentTeam: 1, // Team 1 beginnt
        penalties1: [], // Array von {scored: boolean}
        penalties2: [],
        score1: 0,
        score2: 0,
        finished: false
    };
    
    // Beende Verlängerung falls aktiv
    if (match.liveScore.overtime) {
        match.liveScore.overtime.isActive = false;
    }
    
    match.liveScore.currentHalf = 5; // Kennzeichnet Elfmeterschießen
    
    autoSave();
    broadcastUpdate('penalty-shootout-started', { matchId, match });
    res.json({ success: true, message: 'Elfmeterschießen gestartet' });
});

// Admin: Elfmeter Ergebnis
app.post('/api/admin/penalty-result', (req, res) => {
    const { password, matchId, scored } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ungültiges Passwort' });
    }
    
    const match = matches.find(m => m.id === matchId);
    if (!match || !match.liveScore?.penaltyShootout?.isActive) {
        return res.status(404).json({ error: 'Kein aktives Elfmeterschießen gefunden' });
    }
    
    const penalty = match.liveScore.penaltyShootout;
    const isScored = Boolean(scored);
    
    // Füge Elfmeter zu entsprechendem Team hinzu
    if (penalty.currentTeam === 1) {
        penalty.penalties1.push({ scored: isScored });
        if (isScored) penalty.score1++;
    } else {
        penalty.penalties2.push({ scored: isScored });
        if (isScored) penalty.score2++;
    }
    
    // Wechsel zum nächsten Schützen/Team
    if (penalty.currentTeam === 1) {
        penalty.currentTeam = 2;
    } else {
        penalty.currentTeam = 1;
        penalty.currentShooter++;
    }
    
    // Prüfe ob Elfmeterschießen beendet
    const penaltiesTaken1 = penalty.penalties1.length;
    const penaltiesTaken2 = penalty.penalties2.length;
    const maxPenalties = penalty.shootersPerTeam;
    
    // Beide Teams haben gleich viele geschossen und mindestens die Mindestanzahl
    if (penaltiesTaken1 >= maxPenalties && penaltiesTaken2 >= maxPenalties && penaltiesTaken1 === penaltiesTaken2) {
        if (penalty.score1 !== penalty.score2) {
            // Sieger ermittelt
            penalty.finished = true;
            penalty.isActive = false;
        }
        // Bei weiterem Unentschieden: Sudden Death (wird automatisch fortgesetzt)
    }
    
    autoSave();
    broadcastUpdate('penalty-result', { matchId, match, scored: isScored });
    res.json({ success: true, penalty });
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
        
        // Prüfe ob alle Gruppenspiele abgeschlossen sind und generiere K.O.-Spiele
        const koGenerated = generateFinalTableAndKnockoutMatches();
        if (koGenerated) {
            console.log('K.O.-Phase automatisch generiert nach Spielergebnis');
        }
    } else if (match.phase !== 'group') {
        // Bei K.O.-Spielen: Aktualisiere abhängige Spiele
        updateDependentKnockoutMatches(matchId);
    }
    
    autoSave();
    broadcastUpdate('match-result-added', { matchId, match, score1, score2 });
    res.json({ success: true, match });
});

// Admin-Login prüfen
app.post('/api/admin/login', (req, res) => {
    try {
        const { password } = req.body;
        
        if (!password) {
            return res.status(400).json({ error: 'Passwort fehlt' });
        }
        
        if (password === ADMIN_PASSWORD) {
            res.json({ success: true });
        } else {
            res.status(401).json({ error: 'Ungültiges Passwort' });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server-Fehler beim Login' });
    }
});

// Admin: Import von Turnierdaten
app.post('/api/admin/import', (req, res) => {
    try {
        const { password, data } = req.body;
        
        if (password !== ADMIN_PASSWORD) {
            return res.status(401).json({ error: 'Ungültiges Passwort' });
        }
        
        if (!data) {
            return res.status(400).json({ error: 'Keine Daten zum Importieren bereitgestellt' });
        }
        
        // Extrahiere Jahr aus verschiedenen möglichen Quellen
        const year = data.year || (data.tournament && data.tournament.year);
        const exportDate = data.exportDate || data.exportedAt;
        
        // Validiere Import-Daten-Struktur (flexibel für verschiedene Export-Formate)
        if (!year || !exportDate) {
            return res.status(400).json({ 
                error: 'Ungültiges Datenformat: Jahr und Exportdatum erforderlich',
                details: 'Fehlende Felder: ' + (!year ? 'year/tournament.year ' : '') + (!exportDate ? 'exportDate/exportedAt' : ''),
                receivedFields: Object.keys(data)
            });
        }
        
        // Stelle sicher, dass data.year gesetzt ist für die weitere Verarbeitung
        data.year = year;
        
        // Backup current data before import
        const backupData = {
            tournaments: [...tournaments],
            teams: [...teams],
            matches: [...matches],
            currentTournament: currentTournament ? {...currentTournament} : null,
            tournamentRules: tournamentRules
        };
        
        // Import data
        if (data.tournaments && Array.isArray(data.tournaments)) {
            tournaments = data.tournaments;
        }
        
        if (data.teams && Array.isArray(data.teams)) {
            teams = data.teams;
        }
        
        if (data.matches && Array.isArray(data.matches)) {
            matches = data.matches;
        }
        
        if (data.currentTournament) {
            currentTournament = data.currentTournament;
        }
        
        if (data.rules) {
            tournamentRules = data.rules;
        }
        
        // Save imported data
        autoSave();
        
        // Broadcast update to all connected clients
        broadcastUpdate('data-imported', {
            year: data.year,
            importDate: new Date(),
            exportDate: data.exportDate || data.exportedAt,
            teamsCount: teams.length,
            matchesCount: matches.length,
            tournament: currentTournament
        });
        
        res.json({
            success: true,
            message: 'Daten erfolgreich importiert',
            data: {
                year: data.year,
                teamsImported: teams.length,
                matchesImported: matches.length,
                tournamentImported: !!currentTournament
            }
        });
        
    } catch (error) {
        console.error('Import error:', error);
        res.status(500).json({
            error: 'Fehler beim Importieren der Daten',
            details: error.message
        });
    }
});

// Daten beim Start laden
loadCurrentYearData();

// WebSocket Connection Handler
io.on('connection', (socket) => {
    console.log('Admin client connected:', socket.id);
    
    // Send initial data to newly connected admin
    socket.emit('initial-data', {
        tournaments,
        teams,
        matches,
        currentTournament,
        tournamentRules
    });
    
    socket.on('disconnect', () => {
        console.log('Admin client disconnected:', socket.id);
    });
});

// Broadcast function for real-time updates
function broadcastUpdate(event, data) {
    io.emit(event, data);
}

// Server starten
server.listen(PORT, '0.0.0.0', () => {
    console.log(`CVJM Fellbach Fußballturnier-Server läuft auf Port ${PORT}`);
    console.log(`Admin-Passwort: ${ADMIN_PASSWORD}`);
    console.log(`Daten werden in ${SAVES_DIR} gespeichert`);
    console.log(`WebSocket Server aktiv für Live-Updates`);
});