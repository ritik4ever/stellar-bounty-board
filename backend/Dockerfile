FROM node:20
WORKDIR /app


COPY package*.json ./
RUN npm install --no-audit --no-fund


COPY . ./

EXPOSE 3001
CMD ["npm", "run", "dev"]
