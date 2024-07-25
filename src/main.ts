import { initialize } from './server';
import container from './lib/winston';
import config from './config';
import { Database } from './lib/Database';
import { MongoDatabase } from './lib/MongoDatabase';
import constants from './constants';
import { Globals } from './globals';
import { loadPhonebook } from './hooks/hookProxy';

/**
 * @name exports
 * @static
 * @summary Setup server and start the application
 * @function main
 */
export default async function main() {
  const logger = container.get('application');

  // Build our server
  logger.info('Initializing REMS Intermediary');

  const { server: serverConfig, database: databaseConfig } = config;

  // Setup the database
  let dbClient: Database;
  switch (databaseConfig.selected) {
    case constants.MONGO_DB:
    default:
      dbClient = new MongoDatabase(databaseConfig.mongoConfig);
  }
  try {
    await dbClient.connect();
    console.log('Connected to Database');
  } catch (dbErr: any) {
    console.error(dbErr.message);
    process.exit(1);
  }
  Globals.databaseClient = dbClient.client;
  Globals.database = dbClient.database;
  loadPhonebook();
  const app = initialize(config);

  // Start the application
  app.listen(serverConfig, () => {
    logger.info('Application listening on port: ' + serverConfig.port);
  });
}
