---
name: doku
description: Architektur-Doku dieses Projekts in docs/doku/ lesen und pflegen – die einzige Doku des Projekts (Aufbau, Code-Erklärungen, Sicherheit, Abläufe, Anleitungen, Changelog, Änderungsanträge). Nutzen, bevor du dich in unbekanntem Code orientierst, und immer wenn du Komponenten, Dateien, Schnittstellen, Abhängigkeiten, Sicherheit oder Betrieb änderst.
---

# doku

Zielgruppe: Menschen mit IT-Verständnis, die nicht programmieren. Schreibe auf Deutsch, in kurzen klaren Sätzen, Fachbegriffe im Nebensatz erklären. Kein Code in Erklärungen.

## Lesen (billig, statt viele Dateien zu öffnen)

```
node .claude/doku/doku.mjs summary [--brief]    # ganzes System in wenigen Zeilen
node .claude/doku/doku.mjs show <id>            # Baustein inkl. Dateien, Sicherheit, "genutzt von"
node .claude/doku/doku.mjs context <datei…>     # zu welchem Baustein gehört eine Datei?
node .claude/doku/doku.mjs context --changed    # welche Doku betrifft meine Änderungen?
node .claude/doku/doku.mjs coverage             # Dateien ohne Baustein
```

## Wann was aktualisieren

| Änderung | Doku |
|---|---|
| neue/entfernte Datei | `files:` des Bausteins (Erklärung 1–2 Sätze), ggf. `path` |
| neuer Baustein, neue Abhängigkeit, Endpoint, Event, Tabelle | Baustein-Datei: `uses`, `provides` |
| Anmeldung, Verschlüsselung, Ports, Geheimnisse, Erreichbarkeit | `[tls, auth=…]` an `uses`, `zone`, `exposure`, `security:` |
| neuer wichtiger Ablauf | `flows/` |
| Installation, Betrieb, Update, Notfall geändert | `guides/` |
| Architekturentscheidung | `node .claude/doku/doku.mjs new decision "Titel"` |
| größere Änderung abgeschlossen | Eintrag in `changes/` mit `status: implemented` (Changelog) |

Nicht nötig bei: Bugfixes und Refactorings innerhalb einer Datei, Tests, Styling. Der Stop-Hook meldet sich, wenn Dateien neu sind/fehlen und die Doku unverändert ist. Ist nichts zu tun, erneut beenden.

## Geschützte Bereiche (Änderungsanträge)

Steht in project.md `protected: [...]`, darfst du dort erst nach Genehmigung durch einen Menschen ändern. Der Hook blockiert sonst das Bearbeiten.
1. `node .claude/doku/doku.mjs change new "Titel" --affects <id|layer:x> --risk mittel` → Warum / Was ändert sich / Risiko und Rückweg / Test ausfüllen
2. `node .claude/doku/doku.mjs change submit <nr>` → dem Nutzer sagen, dass der Antrag im Portal wartet, und **stoppen**
3. Später `node .claude/doku/doku.mjs change status <nr>`; erst bei „genehmigt“ umsetzen. Den Antragstext danach nicht mehr ändern (sonst verfällt die Genehmigung).
4. Fertig: `node .claude/doku/doku.mjs change done <nr>`
Nie den Status selbst auf approved setzen – die Genehmigung zählt nur im Portal.

## Format

Baustein `docs/doku/components/<id>.md` (Unterordner = Bereich, optional):

```markdown
---
type: service            # service api gateway ui page module lib store db cache queue job worker function external storage cli config
layer: backend           # Bereich; Klartext-Namen in project.md: layers: [ui: Oberfläche, api: Schnittstelle, …]
path: src/orders/        # Ordner, Datei oder Glob; Liste: [src/a/, src/b.ts]
tech: [node, express]
provides:
  - http POST /orders
  - event order.created
uses:
  - db: sql "orders, order_items" [auth=passwort, port=5432, intern]
  - payments: call "createPaymentIntent()"
  - stripe: http "POST /v1/payment_intents" [tls, auth=api-key]
  - shop-web:cart: http                 # anderes Projekt: projekt:baustein
files:
  - routes.js: Nimmt die Anfragen an und prüft die Eingaben.
  - service.js: Eigentliche Logik einer Bestellung – Preise prüfen, speichern, Zahlung anstoßen.
zone: intern             # Netzwerkzone (client, edge, dmz, intern, data, extern); Standard aus project.md "zone:" oder geschätzt
exposure: internal       # public | internal | local | none
security:
  - auth: Nur angemeldete Nutzer (Session-Cookie, HttpOnly)
  - input: Mengen und IDs werden geprüft
---
Herzstück des Checkouts: legt Bestellungen an und stößt die Zahlung an. Ablauf: [[checkout]].
```

`uses`: `ziel: protokoll beschreibung [sicherheit]`. Protokolle: http grpc graphql ws sql cache file event queue call exec smtp. Sicherheit: `tls`, `plain`, `mtls`, `auth=<wie>`, `auth=none`, `port=<n>`, sonstige Hinweise frei.
`security`-Arten: auth access transport storage network secrets input ratelimit headers logging backup privacy other.
Optional: `name`, `id`, `summary`, `status` (active planned experimental deprecated), `tags`, `owner`, `links`. Der erste Satz des Texts wird zur Kurzbeschreibung.

Ablauf `docs/doku/flows/<id>.md` (wird Sequenzdiagramm und lässt sich auf dem Graphen abspielen):
```markdown
---
name: Checkout
trigger: Kunde klickt „Kaufen“
actors: [kunde]
steps:
  - kunde -> web: Kaufen
  - web -> orders: POST /orders
  - orders ->> worker: order.created     # ->> asynchron, -->> asynchrone Antwort
  - orders --> web: 201                  # --> Antwort
  - note orders: prüft Lagerbestand
  - == Versand ==                        # Abschnitt
---
```

Anleitung `docs/doku/guides/<id>.md`: `title`, `order` (Reihenfolge), `audience` (Betrieb, Entwicklung …), Text Schritt für Schritt mit Befehlen in Codeblöcken. Mindestens: Installation, Betrieb, Aktualisieren, Notfall.
Änderung `docs/doku/changes/NNNN-titel.md`: `title`, `status` (draft proposed approved rejected implemented cancelled), `date`, `affects: [ids|layer:x]`, `risk`, `implemented`.
project.md: `name`, `summary`, `tech`, `repo`, `layers: [key: Label]`, `zone`, `zones: [key: Label]`, `security:` (systemweit), `protected:`.
Links im Text: `[[id]]` oder `[[projekt:id]]`. Frontmatter: ` #` startet einen Kommentar; Werte mit `: ` oder `#` in Anführungszeichen.

## Prüfen

`node .claude/doku/doku.mjs check` (kaputte Verweise, fehlende Pfade/Dateien, Formatfehler), `--with ../anderes-projekt` für Querverweise. `node .claude/doku/doku.mjs coverage` zeigt Code ohne Baustein.

## Neues Projekt dokumentieren

1. `node .claude/doku/doku.mjs coverage` und Ordnerstruktur ansehen, Bausteine schneiden (meist 5–30), Bereiche festlegen.
2. project.md (name, summary, tech, repo, layers mit Labels, zone/zones, security).
3. Pro Baustein: Datei mit `uses` (+ Sicherheit), `files:` für jede Datei, `zone`/`security`.
4. 1–3 wichtige Abläufe, Anleitungen Installation/Betrieb/Aktualisieren/Notfall.
5. `node .claude/doku/doku.mjs check` bis 0 Fehler.
