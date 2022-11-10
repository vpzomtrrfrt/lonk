FROM node:16-alpine
WORKDIR /usr/src/lonk
COPY package.json .
RUN npm install
COPY static .
COPY index.js .

CMD ["node", "index.js"]
