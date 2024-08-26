FROM node:18-alpine 
WORKDIR /rems-intermediary
COPY --chown=node:node . .
RUN npm install
RUN apk update 
RUN apk upgrade
RUN apk search curl 
RUN apk add curl
HEALTHCHECK --interval=60s --timeout=10m --retries=10 CMD curl --fail http://localhost:3003 || exit 1
EXPOSE 3003
CMD npm start