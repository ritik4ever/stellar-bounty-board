FROM node:20
WORKDIR /app


COPY backend/package*.json ./
RUN npm install --no-audit --no-fund


COPY backend/ ./

EXPOSE 3001
CMD ["npm", "run", "dev"]
