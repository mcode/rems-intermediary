import { constants as fhirConstants } from '@projecttacoma/node-fhir-server-core';
import 'dotenv/config';
import * as env from 'env-var';

// Set up whitelist
const whitelistEnv = env.get('WHITELIST').asArray() || false;

// If no whitelist is present, disable CORS
// If its length is 1, set it to a string, so * works
// If there are multiple, keep them as an array
const whitelist = whitelistEnv && whitelistEnv.length === 1 ? whitelistEnv[0] : whitelistEnv;

export type Config = {
  server: {
    port: number | undefined;
    discoveryEndpoint: string;
  };
  smart: {
    endpoint: string;
  };
  logging: {
    level: string;
  };
  general: {
    remsAdminHookPath: string;
    remsAdminFhirEtasuPath: string;
  };
  database: {
    selected: string;
    mongoConfig: {
      location: string | undefined;
      db_name: string | undefined;
      options: {
        useUnifiedTopology: boolean;
        useNewUrlParser: boolean;
      };
    };
  };
  fhirServerConfig: {
    auth: {};
    server: {
      port: number | undefined;
      corsOptions: {
        maxAge: number;
        origin: string | boolean | string[];
      };
    };
    logging: {
      level: string;
    };
    security: {
      url: string;
      valueUri: string;
    }[];
    profiles: {
      guidanceresponse: {
        service: string;
        versions: any[];
        operation: {
          name: string;
          route: string;
          method: string;
          reference: string;
        }[];
      };
    };
  };
};

const config: Config = {
  server: {
    port: env.get('PORT').asInt(),
    discoveryEndpoint: '/cds-services'
  },
  smart: {
    endpoint: env.get('SMART_ENDPOINT').required().asUrlString()
  },
  logging: {
    level: 'info'
  },
  general: {
    //resourcePath: 'src/cds-library/CRD-DTR'
    remsAdminHookPath: 'http://localhost:8090/cds-services/rems-',
    remsAdminFhirEtasuPath: 'http://localhost:8090/4_0_0/GuidanceResponse/$rems-etasu'
  },
  database: {
    selected: 'mongo',
    mongoConfig: {
      location: env.get('MONGO_URL').asString(),
      db_name: env.get('MONGO_DB_NAME').asString(),
      options: {
        //auto_reconnect: true,
        useUnifiedTopology: true,
        useNewUrlParser: true
      }
    }
  },
  fhirServerConfig: {
    auth: {
      // This server's URI
      //resourceServer: env.get('RESOURCE_SERVER').required().asUrlString()
      //
      // if you use this strategy, you need to add the corresponding env vars to docker-compose
      //
      // strategy: {
      // 	name: 'bearer',
      // 	useSession: false,
      // 	service: './src/strategies/bearer.strategy.js'
      // },
    },
    server: {
      // support various ENV that uses PORT vs SERVER_PORT
      port: env.get('PORT').asInt(),
      // allow Access-Control-Allow-Origin
      corsOptions: {
        maxAge: 86400,
        origin: whitelist
      }
    },
    logging: {
      level: env.get('LOGGING_LEVEL').required().asString()
    },
    //
    // If you want to set up conformance statement with security enabled
    // Uncomment the following block
    //
    security: [
      {
        url: 'authorize',
        valueUri: `${env.get('AUTH_SERVER_URI').required().asUrlString()}/authorize`
      },
      {
        url: 'token',
        valueUri: `${env.get('AUTH_SERVER_URI').required().asUrlString()}/token`
      }
      // optional - registration
    ],
    //
    // Add any profiles you want to support.  Each profile can support multiple versions
    // if supported by core.  To support multiple versions, just add the versions to the array.
    //
    // Example:
    // Account: {
    //		service: './src/services/account/account.service.js',
    //		versions: [ VERSIONS['4_0_0'], VERSIONS['3_0_1'], VERSIONS['1_0_2'] ]
    // },
    //
    profiles: {
      guidanceresponse: {
        service: './src/services/guidanceresponse.service.ts',
        versions: [fhirConstants.VERSIONS['4_0_0']],
        operation: [
          {
            name: 'rems-etasu',
            route: '/$rems-etasu',
            method: 'POST',
            reference:
              'https://build.fhir.org/ig/HL7/fhir-medication-rems-ig/OperationDefinition-REMS-ETASU.html'
          }
        ]
      }
    }
  }
};

export default config;
