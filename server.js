const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 5678;

// Middleware
app.use(cors());
app.use(express.json());
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
let tournamentRules = "";

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

// Admin-Authentifizierung
const ADMIN_PASSWORD = '1234qwer!';

// ========================= NEUE VALIDIERUNGS-ALGORITHMEN =========================

// Neue Validierungsfunktion für Spielverteilung
function validateGameDistribution(teams, format, options) {
    const validation = {
        isValid: true,
        warnings: [],
        impossibleConstraints: [],
        suggestions: []
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
        
        if (totalGameSlots % 2 !== 0) {
            validation.isValid = false;
            validation.impossibleConstraints.push(
                `Swiss System: ${teams.length} Teams × ${rounds} Runden = ${totalGameSlots} Spiel-Slots (ungerade Zahl - unmöglich!)`
            );
            
            // Gerade Rundenzahlen vorschlagen
            const evenRounds = [];
            for (let r = 2; r <= teams.length - 1; r++) {
                if ((teams.length * r) % 2 === 0) {
                    evenRounds.push(r);
                }
            }
            validation.suggestions.push(
                `Mögliche Rundenzahlen: ${evenRounds.slice(0, 5).join(', ')}`
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

// NEUER Swiss System Algorithmus (Champions League Style)
function generateSwissSystemMatches(teams, rounds) {
    console.log(`Generiere Swiss System: ${teams.length} Teams, ${rounds} Runden`);
    
    const matches = [];
    const teamStats = teams.map(team => ({
        name: team.name,
        opponents: new Set(),
        gamesPlayed: 0
    }));
    
    for (let round = 1; round <= rounds; round++) {
        console.log(`Generiere Runde ${round}...`);
        
        // Sortiere Teams nach gespielten Spielen und dann zufällig für diese Runde
        const availableTeams = shuffleArray([...teamStats]);
        const roundMatches = [];
        const usedThisRound = new Set();
        
        // Greedy-Algorithmus für optimale Paarungen
        while (availableTeams.length >= 2) {
            let bestMatch = null;
            let bestScore = -1;
            
            for (let i = 0; i < availableTeams.length; i++) {
                for (let j = i + 1; j < availableTeams.length; j++) {
                    const team1 = availableTeams[i];
                    const team2 = availableTeams[j];
                    
                    // Skip if already used this round or if they played before
                    if (usedThisRound.has(team1.name) || usedThisRound.has(team2.name)) {
                        continue;
                    }
                    
                    if (team1.opponents.has(team2.name)) {
                        continue;
                    }
                    
                    // Bewerte diese Paarung (bevorzuge Teams mit weniger Spielen)
                    const score = 1000 - Math.abs(team1.gamesPlayed - team2.gamesPlayed) * 10;
                    
                    if (score > bestScore) {
                        bestMatch = { team1, team2, i, j };
                        bestScore = score;
                    }
                }
            }
            
            if (bestMatch) {
                // Erstelle Match
                const match = {
                    id: `swiss_r${round}_${roundMatches.length}`,
                    phase: 'swiss',
                    group: 'Champions League Format',
                    team1: bestMatch.team1.name,
                    team2: bestMatch.team2.name,
                    round: round,
                    score1: null,
                    score2: null,
                    completed: false
                };
                
                roundMatches.push(match);
                
                // Update Stats
                bestMatch.team1.opponents.add(bestMatch.team2.name);
                bestMatch.team2.opponents.add(bestMatch.team1.name);
                bestMatch.team1.gamesPlayed++;
                bestMatch.team2.gamesPlayed++;
                
                usedThisRound.add(bestMatch.team1.name);
                usedThisRound.add(bestMatch.team2.name);
                
                // Entferne Teams aus availableTeams
                availableTeams.splice(Math.max(bestMatch.i, bestMatch.j), 1);
                availableTeams.splice(Math.min(bestMatch.i, bestMatch.j), 1);
                
                console.log(`Runde ${round}: ${bestMatch.team1.name} vs ${bestMatch.team2.name}`);
            } else {
                // Keine weiteren gültigen Paarungen möglich
                console.log(`Runde ${round}: Keine weiteren Paarungen möglich, ${availableTeams.length} Teams übrig`);
                break;
            }
        }
        
        matches.push(...roundMatches);
        console.log(`Runde ${round} abgeschlossen: ${roundMatches.length} Spiele`);
    }
    
    // Validierung
    const teamGameCounts = {};
    teams.forEach(team => teamGameCounts[team.name] = 0);
    matches.forEach(match => {
        teamGameCounts[match.team1]++;
        teamGameCounts[match.team2]++;
    });
    
    console.log('Swiss System Spielverteilung:', teamGameCounts);
    
    return matches;
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
                points: 0
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

// K.O.-System Generierung
function generateKnockoutMatches(finalTable, knockoutConfig) {
    console.log('Generiere K.O.-System...', knockoutConfig);
    
    const koMatches = [];
    const { enableQuarterfinals, enableThirdPlace, enableFifthPlace, enableSeventhPlace } = knockoutConfig;
    
    if (enableQuarterfinals && finalTable.length >= 8) {
        // Viertelfinale: 1vs8, 2vs7, 3vs6, 4vs5
        const quarterfinalsIds = [];
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
        teamsByGroup['Liga'] = teams.map(t => t.name);
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

// ========================= ROUTES =========================

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

// ========= NEUE ROUTE: Tournament-Konfiguration analysieren ==========
app.post('/api/admin/analyze-tournament-config', (req, res) => {
    const { password, format, options } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Ungültiges Passwort' });
    }
    
    if (teams.length === 0) {
        return res.status(400).json({ error: 'Keine Teams zum Analysieren' });
    }
    
    const analysis = analyzeTournamentConfiguration(teams.length, format, options);
    
    res.json({ 
        success: true, 
        analysis: analysis,
        teamCount: teams.length
    });
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
            // Swiss System (Champions League Style)
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
                    points: 0
                }))
            }];
            
            generatedMatches = generateSwissSystemMatches(teams, rounds || Math.min(Math.ceil(Math.log2(teams.length)) + 1, teams.length - 1));
            
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
        
        console.log(`Turnier aktiviert mit ${format}: ${teams.length} Teams, ${matches.length} Spiele generiert`);
        
        res.json({ 
            success: true, 
            tournament: currentTournament, 
            matchesGenerated: matches.length,
            format: format,
            message: `Spielplan mit ${matches.length} Spielen für ${teams.length} Teams erstellt (Format: ${format})`
        });
        
    } catch (error) {
        console.error('Fehler beim Generieren des Spielplans:', error);
        res.status(500).json({ error: 'Fehler beim Erstellen des Spielplans: ' + error.message });
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
    const { password, teamName, contactName, contactInfo } = req.body;
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
        match.liveScore.isPaused = false;
        
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