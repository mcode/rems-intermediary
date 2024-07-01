FROM node:18-alpine 
WORKDIR /rems-intermediary
COPY --chown=node:node . .
RUN npm install
EXPOSE 3003
CMD npm run start