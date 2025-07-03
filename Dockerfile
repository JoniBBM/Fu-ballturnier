FROM node:18-alpine

WORKDIR /app

# Package files kopieren und Dependencies installieren
COPY package*.json ./
RUN npm install

# Nodemon für Live-Reload installieren (für Development)
RUN npm install -g nodemon

# Saves-Ordner erstellen
RUN mkdir -p /app/saves

# Code kopieren (für Production)
COPY . .

EXPOSE 5678

# Standard-Command
CMD ["npm", "start"]