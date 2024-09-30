FROM node:18-alpine 
WORKDIR /rems-intermediary
COPY --chown=node:node . .

RUN npm install

HEALTHCHECK --interval=30s --start-period=15s --timeout=10m --retries=10 CMD wget --no-verbose --tries=1 --spider http://localhost:3003 || exit 1
EXPOSE 3003
CMD npm start