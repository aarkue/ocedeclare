FROM node:18-alpine

WORKDIR /app-frontend

COPY package.json .

RUN npm install

COPY . .

RUN npm run build

CMD [ "npm", "run", "preview", "--", "--host", "--port", "4567" ]