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
import { Connection } from './lib/schemas/Phonebook';
import { EHRWhitelist } from './hooks/hookProxy';
import cookieParser from 'cookie-parser';

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
    .registerEndpoint()
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
    this.app.use(cookieParser());
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
          res.cookie('access_token', result.data.access_token, {
            httpOnly: true, // Make the cookie HTTP only
            maxAge: 60 * 60 * 24 * 1000, // 1 day in milliseconds
            path: '/', // Cookie path
          });
          res.sendFile(path.join(__dirname, '../public', 'authenticated.html'));
        })
        .catch(err => {
          console.error(err);
          res.sendFile(path.join(__dirname, '../public', 'error.html'));

        });
    })
    return this;
  }
  registerEndpoint() {
    this.app.get('/register', async (req: any, res: { sendFile: (arg0: string) => void; }) => {
      if (req.cookies && req.cookies.access_token) {
        res.sendFile(path.join(__dirname, '../public', 'register.html'));
      } else {
        res.sendFile(path.join(__dirname, '../public', 'login.html'));
      }
    });
    this.app.get('/connections', async (req: any, res: { sendFile: (arg0: string) => void; }) => {
      if (req.cookies && req.cookies.access_token) {
        res.sendFile(path.join(__dirname, '../public', 'connections.html'));
      } else {
        res.sendFile(path.join(__dirname, '../public', 'login.html'));
      }
    });
    this.app.get('/api/connections', async (req: any, res: any) => {
      try {
          const connections = await Connection.find();
          res.send(connections);
      } catch (error) {
          res.status(500).send({ message: 'Error fetching connections', error });
      }
  });
    this.app.post('/api/connections', async (req: any, res: any) => {
      const model = Connection;
      console.log(req.body);
      try {
        const resource = new model({
          to: req.body.endpoint,
          toEtasu: req.body.etasuEndpoint,
          from: req.body.ehr || [EHRWhitelist.any],
          code: req.body.code,
          system: req.body.system,
        })
        resource.save().then(() => {
          res.sendStatus(200);
        }).catch((e) => {
          res.sendStatus(500);
        });
      } catch (error) {
        res.status(400).send({ message: 'Error registering connection', error });
      }
    });
    this.app.delete('/api/connections/:id', async (req: any, res: any) => {
      try {
          const { id } = req.params;
          const deletedConnection = await Connection.findByIdAndDelete(id);
  
          if (!deletedConnection) {
              return res.status(404).send({ message: 'Connection not found' });
          }
  
          res.send({ message: 'Connection deleted successfully' });
      } catch (error) {
          res.status(400).send({ message: 'Error deleting connection', error });
      }
  });
    this.app.put('/api/connections/:id', async (req: any, res: any) => {
      try {
          const { id } = req.params;
          const updateData = req.body;
  
          const updatedConnection = await Connection.findByIdAndUpdate(id, updateData, {
              new: true,
          });
  
          if (!updatedConnection) {
              return res.status(404).send({ message: 'Connection not found' });
          }
  
          res.send(updatedConnection);
      } catch (error) {
          res.status(400).send({ message: 'Error updating connection', error });
      }
  });
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
