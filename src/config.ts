import { constants as fhirConstants } from '@projecttacoma/node-fhir-server-core';
import 'dotenv/config';
import * as env from 'env-var';

// Set up whitelist
const whitelistEnv = env.get('WHITELIST').asArray() || false;

// If no whitelist is present, disable CORS
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
    remsAdminHookPath: string | undefined;
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
    remsAdminHookPath: env.get('REMS_ADMIN_HOOK_PATH').asString(),
    remsAdminFhirEtasuPath:
      env.get('REMS_ADMIN_FHIR_PATH').asString() + '/GuidanceResponse/$rems-etasu'
  },
  database: {
    selected: 'mongo',
    mongoConfig: {
      location: env.get('MONGO_URL').asString(),
      db_name: env.get('MONGO_DB_NAME').asString(),
      options: {
        useUnifiedTopology: true,
        useNewUrlParser: true
      }
    }
  },
  fhirServerConfig: {
    auth: {},
    server: {
      port: env.get('PORT').asInt(),
      corsOptions: {
        maxAge: 86400,
        origin: whitelist
      }
    },
    logging: {
      level: env.get('LOGGING_LEVEL').required().asString()
    },
    security: [
      {
        url: 'authorize',
        valueUri: `${env.get('AUTH_SERVER_URI').required().asUrlString()}/authorize`
      },
      {
        url: 'token',
        valueUri: `${env.get('AUTH_SERVER_URI').required().asUrlString()}/token`
      }
    ],
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
