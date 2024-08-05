import cors from 'cors';
import bodyParser from 'body-parser';
import container from './lib/winston';
import morgan from 'morgan';
import { CdsService } from './rems-cds-hooks/resources/CdsService';
import remsService from './hooks/rems.ordersign';
import orderSelectService from './hooks/rems.orderselect';
import patientViewService from './hooks/rems.patientview';
import encounterStartService from './hooks/rems.encounterstart';
import { Server } from '@projecttacoma/node-fhir-server-core';
import env from 'env-var';
import https from 'https';
import fs from 'fs';
import { TypedRequestBody, TypedResponseBody } from './rems-cds-hooks/resources/HookTypes';
import { Config } from './config';
import { IncomingMessage, ServerResponse } from 'node:http';
import axios from 'axios';
import path from 'path';

const logger = container.get('application');

const initialize = (config: Config): REMSIntermediary => {
  //const logLevel = _.get(config, 'logging.level');
  return new REMSIntermediary(config.fhirServerConfig)
    .configureMiddleware()
    .configureSession()
    .configureHelmet()
    .configurePassport()
    .setPublicDirectory()
    .setProfileRoutes()
    .registerCdsHooks(config.server)
    .setupLogin()
    .setErrorRoutes();
};

type CdsHooksService = {
  definition: CdsService;
  handler: (req: TypedRequestBody, res: TypedResponseBody) => void;
};

/**
 * @name exports
 * @static
 * @summary Main Server for the application
 * @class Server
 */
class REMSIntermediary extends Server {
  services: CdsService[];
  cdsHooksEndpoint: string | undefined;

  /**
   * @method constructor
   * @description Setup defaults for the server instance
   */

  constructor(config: Config['fhirServerConfig']) {
    super(config);
    this.services = [];
    return this;
  }

  _app() {
    return this.app;
  }

  /**
   * @method configureMiddleware
   * @description Enable all the standard middleware
   */
  configureMiddleware(): REMSIntermediary {
    super.configureMiddleware();
    this.app.set('showStackError', true);
    this.app.set('jsonp callback', true);
    this.app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
    this.app.use(bodyParser.json({ limit: '50mb' }));

    this.app.use(cors());
    this.app.options('*', cors());

    return this;
  }

  /**
   * @method configureLogstream
   * @description Enable streaming logs via morgan
   */
  configureLogstream({
    log,
    level = 'info'
  }: { log?: any; level?: string } = {}): REMSIntermediary {
    super.configureLogstream;
    this.app.use(
      log
        ? log
        : morgan('combined', {
            stream: { write: message => logger.log(level, message) }
          })
    );

    return this;
  }

  registerService({ definition, handler }: CdsHooksService): REMSIntermediary {
    this.services.push(definition);
    this.app.post(`${this.cdsHooksEndpoint}/${definition.id}`, handler);

    //TODO: remove this after request generator is updated to a new order-sign prefetch
    // add a post endpoint to match the old CRD server
    this.app.post(`/r4${this.cdsHooksEndpoint}/${definition.hook}-crd`, handler);

    return this;
  }

  registerCdsHooks({ discoveryEndpoint }: Config['server']): REMSIntermediary {
    this.cdsHooksEndpoint = discoveryEndpoint;
    this.registerService(remsService);
    this.registerService(orderSelectService);
    this.registerService(patientViewService);
    this.registerService(encounterStartService);
    this.app.get(discoveryEndpoint, (_req: any, res: { json: (arg0: { services: any }) => any }) =>
      res.json({ services: this.services })
    );
    return this;
  }

  setupLogin() {
    this.app.get('/', async (req: any, res: { sendFile: (arg0: string) => void; }) => {
        res.sendFile(path.join(__dirname, '../public', 'index.html'));

    });
    this.app.get('/login', async (req: any, res: { sendFile: (arg0: string) => void; }) => {
      res.sendFile(path.join(__dirname, '../public', 'login.html'));

  });
    this.app.post('/authenticate', async (req: any, res: any) => {
      const { username, password } = req.body;
      const user = username || env.get('VITE_USER').asString();
      const pw = password || env.get('VITE_PASSWORD').asString();
      const clientId = env.get('VITE_CLIENT').asString() || 'app-login';
      const params = new URLSearchParams();
      params.append('username',  user);
      params.append('password',  pw);
      params.append('grant_type', 'password');
      params.append('client_id', clientId);
      axios
        .post(
          `${env.get('VITE_AUTH').asString()}/realms/${env
            .get('VITE_REALM')
            .asString()}/protocol/openid-connect/token`,
          params,
          { withCredentials: true }
        )
        .then(result => {
          console.log('result data access token -- > ', result.data.access_token);
          res.sendFile(path.join(__dirname, '../public', 'authenticated.html'));
        })
        .catch(err => {
          console.error(err);
          res.sendFile(path.join(__dirname, '../public', 'error.html'));

        });
    })
    return this;
  }

  /**
   * @method listen
   * @description Start listening on the configured port
   * @param {number} port - Default port to listen on
   * @param {function} [callback] - Optional callback for listen
   */
  listen(
    { port }: Config['server'],
    callback: () => void
  ): https.Server<typeof IncomingMessage, typeof ServerResponse> | unknown {
    // If we want to use https, read in the cert files and start https server
    if (env.get('USE_HTTPS').required().asBool()) {
      const credentials = {
        key: fs.readFileSync(env.get('HTTPS_KEY_PATH').required().asUrlString()),
        cert: fs.readFileSync(env.get('HTTPS_CERT_PATH').required().asUrlString())
      };
      return https.createServer(credentials, this.app).listen(port, callback);
    }
    return this.app.listen(port, callback);
  }
}

// Start the application

export { REMSIntermediary, initialize };
