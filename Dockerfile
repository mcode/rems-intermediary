FROM node:18-alpine 
WORKDIR /rems-intermediary
COPY --chown=node:node . .

RUN npm install
WORKDIR /rems-intermediary/frontend
RUN npm install 

WORKDIR /rems-intermediary

HEALTHCHECK --interval=45s --start-period=45s --timeout=10m --retries=10 CMD (wget --no-verbose --tries=1 --spider http://localhost:3003 && wget --no-verbose --tries=1 --spider http://localhost:9080) || exit 1
EXPOSE 3003
EXPOSE 9080
CMD ./dockerRunnerProd.sh