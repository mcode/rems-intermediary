import cors, { CorsOptions } from 'cors';
import bodyParser from 'body-parser';
import container from './lib/winston';
import morgan from 'morgan';
import { CdsService } from './rems-cds-hooks/resources/CdsService';
import remsService from './hooks/rems.ordersign';
import orderSelectService from './hooks/rems.orderselect';
import patientViewService from './hooks/rems.patientview';
import encounterStartService from './hooks/rems.encounterstart';
import { Server } from '@projecttacoma/node-fhir-server-core';
import * as env from 'env-var';
import https from 'https';
import fs from 'fs';
import { TypedRequestBody, TypedResponseBody } from './rems-cds-hooks/resources/HookTypes';
import { Config } from './config';
import { IncomingMessage, ServerResponse } from 'node:http';
import axios from 'axios';
import path from 'path';
import { Connection } from './lib/schemas/Phonebook';
import { EHRWhitelist, loadPhonebook } from './hooks/hookProxy';
import cookieParser from 'cookie-parser';
import  { extractDrugFromNcpdp, ndcToCoding, getMessageType} from './lib/ncpdpHelpers';
import { getServiceConnection } from './hooks/hookProxy';
import { HookSession } from './lib/schemas/HookSession';
import { Communication } from 'fhir/r4';

const logger = container.get('application');

const initialize = (config: Config): REMSIntermediary => {
  //const logLevel = _.get(config, 'logging.level');
  return new REMSIntermediary(config.fhirServerConfig)
    .configureMiddleware(config.fhirServerConfig.server.corsOptions)
    .configureSession()
    .configureHelmet()
    .configurePassport()
    .setPublicDirectory()
    .setProfileRoutes()
    .registerEndpoint()
    .registerCdsHooks(config.server)
    .registerNcpdpScript(config.general)
    .registerFhirCommunicationEndpoint() 
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
  configureMiddleware(corsOptions: CorsOptions): REMSIntermediary {
    super.configureMiddleware();
    this.app.set('showStackError', true);
    this.app.set('jsonp callback', true);
    this.app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
    this.app.use(bodyParser.json({ limit: '50mb' }));
    this.app.use(bodyParser.text({ limit: '50mb', type: 'application/xml' }));
    this.app.use(cookieParser());
    this.app.use(cors(corsOptions));
    this.app.options('*', cors(corsOptions));

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

  /**
   * @method registerFhirCommunicationEndpoint
   * @description Register FHIR-compliant Communication endpoint for proxying
   * 
   * Implements the FHIR RESTful API specification for creating Communication resources.
   * 
   */
  registerFhirCommunicationEndpoint(): REMSIntermediary {
    console.log('Registering FHIR Communication endpoint');
    
    // FHIR R4 standard endpoint for creating Communication resources
    this.app.post('/Communication', async (req: any, res: any) => {
      console.log('\n Received Communication resource from REMS Admin');
      
      try {
        const communication: Communication = req.body;

        // Validate that this is a Communication resource
        if (!communication || communication.resourceType !== 'Communication') {
          console.error(' Invalid resource: not a Communication');
          return res.status(400).json({
            resourceType: 'OperationOutcome',
            issue: [{
              severity: 'error',
              code: 'invalid',
              diagnostics: 'Request body must be a Communication resource'
            }]
          });
        }

        console.log(`   Status: ${communication.status}`);
        console.log(`   Subject: ${communication.subject?.reference}`);

        // Extract patient ID from Communication.subject
        // Communication.subject is a Reference, typically "Patient/12345"
        if (!communication.subject?.reference) {
          console.error(' Communication missing subject reference');
          return res.status(400).json({
            resourceType: 'OperationOutcome',
            issue: [{
              severity: 'error',
              code: 'required',
              diagnostics: 'Communication.subject is required to identify target EHR'
            }]
          });
        }

        // Parse patient ID from reference
        const patientRef = communication.subject.reference;
        const patientId = patientRef.includes('/') ? 
          patientRef.split('/').pop() : 
          patientRef;

        if (!patientId) {
          console.error(' Could not extract patient ID from subject reference');
          return res.status(400).json({
            resourceType: 'OperationOutcome',
            issue: [{
              severity: 'error',
              code: 'invalid',
              diagnostics: `Invalid subject reference format: ${patientRef}`
            }]
          });
        }

        console.log(`   Patient ID: ${patientId}`);

        // Look up active session for this patient
        const session = await HookSession.findActiveSession(patientId);

        if (!session) {
          console.error(` No active session found for patient ${patientId}`);
          return res.status(404).json({
            resourceType: 'OperationOutcome',
            issue: [{
              severity: 'error',
              code: 'not-found',
              diagnostics: `No active CDS Hook session found for patient ${patientId}`
            }]
          });
        }

        console.log(` Found active session for patient ${patientId}`);
        console.log(`   EHR FHIR Server: ${session.ehrFhirServer}`);
        console.log(`   Hook Type: ${session.hookType}`);
        console.log(`   Hook Instance: ${session.hookInstance}`);

        // Build EHR Communication endpoint URL
        const ehrUrl = session.ehrFhirServer.endsWith('/') ?
          `${session.ehrFhirServer}Communication` :
          `${session.ehrFhirServer}/Communication`;

        console.log(` Forwarding Communication to EHR: ${ehrUrl}`);

        // Prepare request to EHR
        const options: any = {
          method: 'POST',
          url: ehrUrl,
          data: communication,
          headers: {
            'Content-Type': 'application/fhir+json'
          }
        };

        // Add authorization if available from the stored session
        if (session.ehrAuthorization && session.ehrAuthorization.access_token) {
          options.headers['Authorization'] = `Bearer ${session.ehrAuthorization.access_token}`;
          console.log('    Using stored OAuth token');
        } else {
          console.log('     No authorization token available - forwarding without auth');
        }

        try {
          // Forward Communication to EHR
          const ehrResponse = await axios(options);
          
          console.log(` Successfully forwarded Communication to EHR (status: ${ehrResponse.status})`);
          
          // Update session statistics
          await session.incrementCommunications();
          
          // Return EHR's response to REMS Admin
          // Per FHIR spec, successful create returns 201 Created with the created resource
          res.status(ehrResponse.status).json(ehrResponse.data);
          
        } catch (ehrError: any) {
          console.error(` Error forwarding Communication to EHR:`, ehrError.message);
          
          if (ehrError.response) {
            // EHR returned an error
            console.error(`   EHR responded with status ${ehrError.response.status}`);
            console.error(`   EHR response: ${JSON.stringify(ehrError.response.data)}`);
            
            // Forward EHR's error response to REMS Admin
            return res.status(ehrError.response.status).json(ehrError.response.data);
          } else if (ehrError.code === 'ETIMEDOUT' || ehrError.code === 'ECONNREFUSED') {
            // Network error
            console.error('   Network error: EHR unreachable');
            return res.status(502).json({
              resourceType: 'OperationOutcome',
              issue: [{
                severity: 'error',
                code: 'timeout',
                diagnostics: 'Unable to reach EHR FHIR server'
              }]
            });
          } else {
            // Other error
            console.error(`   Unexpected error: ${ehrError.message}`);
            return res.status(500).json({
              resourceType: 'OperationOutcome',
              issue: [{
                severity: 'error',
                code: 'exception',
                diagnostics: 'Internal error while forwarding Communication to EHR'
              }]
            });
          }
        }

      } catch (error: any) {
        console.error(' Error processing Communication request:', error.message);
        console.error(error.stack);
        
        return res.status(500).json({
          resourceType: 'OperationOutcome',
          issue: [{
            severity: 'error',
            code: 'exception',
            diagnostics: 'Internal server error processing Communication resource'
          }]
        });
      }
    });

    // Optional: Add GET /Communication endpoint for CapabilityStatement compliance
    // This would typically return a search bundle, but for now we can return 501 Not Implemented
    this.app.get('/Communication', async (_req: any, res: any) => {
      res.status(501).json({
        resourceType: 'OperationOutcome',
        issue: [{
          severity: 'information',
          code: 'not-supported',
          diagnostics: 'Search operations on Communication not supported. Use POST to create.'
        }]
      });
    });

    // Optional: Add CapabilityStatement that advertises Communication support
    // This is the proper FHIR way to declare supported operations
    this.app.get('/metadata', async (_req: any, res: any) => {
      res.json({
        resourceType: 'CapabilityStatement',
        status: 'active',
        date: new Date().toISOString(),
        kind: 'instance',
        software: {
          name: 'REMS Intermediary',
          version: '1.0.0'
        },
        implementation: {
          description: 'REMS Intermediary - Proxies Communication resources to EHRs'
        },
        fhirVersion: '4.0.1',
        format: ['application/fhir+json'],
        rest: [{
          mode: 'server',
          resource: [{
            type: 'Communication',
            interaction: [{
              code: 'create',
              documentation: 'Create Communication resource - proxied to originating EHR'
            }]
          }]
        }]
      });
    });

    return this;
  }

  registerNcpdpScript({ ncpdpScriptForwardUrl, ehrUrl }: Config['general']) {
    console.log('Registering NCPDP SCRIPT endpoint with intelligent routing');
    
    this.app.post('/ncpdp/script', async (req: any, res: any) => {
      try {
        console.log('Processing NCPDP SCRIPT message');

        const ehrEndpoint = ehrUrl + '/script'
              
        // Determine message type
        const messageType = getMessageType(req.body);
        console.log(`Message type: ${messageType}`);

        if (messageType === 'NewRx') {
          console.log(`Forwarding NewRx to pharmacy: ${ncpdpScriptForwardUrl}`);
          
          const options = {
            method: 'POST',
            data: req.body,
            headers: req.headers
          };
          
          const response = await axios(ncpdpScriptForwardUrl, options);
          return res.send(response.data);
        }

        if (messageType === 'REMSInitiationRequest' || messageType === 'REMSRequest') {
          const drugInfo = extractDrugFromNcpdp(req.body);
          
          if (!drugInfo || !drugInfo.ndc) {
            console.error('Could not extract drug code from REMS message');
            return res.status(400).send('Could not extract drug code from REMS message');
          }

          const coding = ndcToCoding(drugInfo.ndc);
          console.log(`Looking up REMS Admin for NDC: ${coding.code}`);

          const serviceConnection = await getServiceConnection(coding, undefined);
          
          if (serviceConnection && serviceConnection.toNcpdp) {
            const ncpdpEndpoint = serviceConnection.toNcpdp;
            console.log(`Forwarding ${messageType} to REMS Admin: ${ncpdpEndpoint}`);
            console.log(`  Drug: ${drugInfo.description || 'Unknown'} (${drugInfo.ndc})`);
            
            const options = {
              method: 'POST',
              data: req.body,
              headers: req.headers
            };
            
            const response = await axios(ncpdpEndpoint, options);
            console.log('Received response from REMS Admin');
            return res.send(response.data);
          } else {
            console.error(`No REMS Admin found for drug code: ${drugInfo.ndc}`);
            return res.status(404).send('No REMS Admin found for this drug');
          }
        }

        if (messageType === 'RxFill') {
          console.log('Processing RxFill message');
          
          const drugInfo = extractDrugFromNcpdp(req.body);
          const promises = [];
          
          // Send to EHR
 
          console.log(`Sending RxFill to EHR: ${ehrEndpoint}`);
          promises.push(
            axios.post(ehrEndpoint, req.body, { headers: req.headers })
              .then(() => console.log('✓ RxFill sent to EHR'))
              .catch(err => console.error('✗ Error sending RxFill to EHR:', err.message))
          );
      
          
          // Send to REMS Admin if REMS drug
          if (drugInfo && drugInfo.ndc) {
            const coding = ndcToCoding(drugInfo.ndc);
            const serviceConnection = await getServiceConnection(coding, undefined);
            
            if (serviceConnection && serviceConnection.toNcpdp) {
              console.log(`Sending RxFill to REMS Admin: ${serviceConnection.toNcpdp}`);
              console.log(`  Drug: ${drugInfo.description || 'Unknown'} (${drugInfo.ndc})`);
              
              promises.push(
                axios.post(serviceConnection.toNcpdp, req.body, { headers: req.headers })
                  .then(() => console.log('✓ RxFill sent to REMS Admin'))
                  .catch(err => console.error('✗ Error sending RxFill to REMS Admin:', err.message))
              );
            }
          }
          
          // Wait for all sends to complete
          await Promise.all(promises);
          
          // Return success status
          return res.send({ status: 'success', message: 'RxFill processed' });
        }

        // Unknown message type
        console.error(`Unknown NCPDP message type: ${messageType}`);
        return res.status(400).send(`Unknown NCPDP message type: ${messageType}`);
        
      } catch (error: any) {
        console.error('Error processing NCPDP message:', error.message);
        return res.status(500).send('Error processing NCPDP message: ' + error.message);
      }
    });
    
    return this;
  }

  setupLogin() {
    this.app.get('/', async (req: any, res: { sendFile: (arg0: string) => void }) => {
      res.sendFile(path.join(__dirname, '../public', 'index.html'));
    });
    this.app.get('/login', async (req: any, res: { sendFile: (arg0: string) => void }) => {
      res.sendFile(path.join(__dirname, '../public', 'login.html'));
    });
    this.app.post('/authenticate', async (req: any, res: any) => {
      const { username, password } = req.body;
      const user = username || env.get('VITE_USER').asString();
      const pw = password || env.get('VITE_PASSWORD').asString();
      const clientId = env.get('VITE_CLIENT').asString() || 'app-login';
      const params = new URLSearchParams();
      params.append('username', user);
      params.append('password', pw);
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
            path: '/' // Cookie path
          });
          res.sendFile(path.join(__dirname, '../public', 'authenticated.html'));
        })
        .catch(err => {
          console.error(err);
          res.sendFile(path.join(__dirname, '../public', 'error.html'));
        });
    });
    return this;
  }
  registerEndpoint() {
    this.app.get('/register', async (req: any, res: { sendFile: (arg0: string) => void }) => {
      if (req.cookies && req.cookies.access_token) {
        res.sendFile(path.join(__dirname, '../public', 'register.html'));
      } else {
        res.sendFile(path.join(__dirname, '../public', 'login.html'));
      }
    });
    this.app.get('/connections', async (req: any, res: { sendFile: (arg0: string) => void }) => {
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
          to: req.body.to,
          toEtasu: req.body.toEtasu,
          from: req.body.from || [EHRWhitelist.any],
          code: req.body.code,
          system: req.body.system
        });
        resource
          .save()
          .then(() => {
            res.sendStatus(200);
          })
          .catch(e => {
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
          new: true
        });

        if (!updatedConnection) {
          return res.status(404).send({ message: 'Connection not found' });
        }

        res.send(updatedConnection);
      } catch (error) {
        res.status(400).send({ message: 'Error updating connection', error });
      }
    });
    this.app.post('/api/reload', async (req: any, res: any) => {
      console.log('Processing phonebook reload');
      await loadPhonebook();
      res.send('Reload completed');
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