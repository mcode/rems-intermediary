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
import  { extractDrugFromNcpdp, ndcToCoding, getMessageType, Qualifier, getToQualifier, getHeaderTo } from './lib/ncpdpHelpers';
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
          console.log('    No authorization token available - forwarding without auth');
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

    return this;
  }


  registerNcpdpScript({ ncpdpScriptForwardUrl, ehrBaseUrl, ppaPharmacyEndpoints }: Config['general']) {
    console.log('Registering NCPDP SCRIPT endpoint with intelligent routing');

    const getPharmacyRoute = (pharmacyId: string | undefined, fallbackUrl: string) => {
      if (!pharmacyId) return fallbackUrl;

      try {
        const endpoints = JSON.parse(ppaPharmacyEndpoints || '[]');
        const endpoint = endpoints.find((entry: any) => entry.id === pharmacyId);
        return endpoint?.scriptUrl || endpoint?.ncpdpScriptUrl || endpoint?.url || fallbackUrl;
      } catch (error: any) {
        console.error('Could not parse pharmacy routing config:', error.message);
        return fallbackUrl;
      }
    };

    const getPpaMessage = (body: any) => body?.Message || body?.MessageType;

    const getPpaTo = (body: any): string | undefined => {
      const to = getPpaMessage(body)?.Header?.To;
      if (typeof to === 'string') return to;
      return to?.['#text'] || to?._;
    };

    const isPpaRequest = (body: any) => Boolean(getPpaMessage(body)?.Body?.PPARequest);
    const isPpaMessage = (body: any) =>
      getPpaMessage(body)?.['@TransactionDomain'] === 'PPA' || isPpaRequest(body);

    const validatePpaRequest = (body: any) => {
      const message = getPpaMessage(body);
      const errors: string[] = [];

      if (!message) {
        return ['Missing Message'];
      }

      if (message['@TransactionDomain'] !== 'PPA') {
        errors.push('Message TransactionDomain must be PPA');
      }
      if (message['@TransactionVersion'] !== '2.0') {
        errors.push('Message TransactionVersion must be 2.0');
      }
      if (!message.Body?.PPARequest) {
        errors.push('Missing Body.PPARequest');
      }

      const header = message.Header;
      if (!header) {
        errors.push('Missing Header');
      } else {
        ['To', 'From', 'MessageID', 'SentTime'].forEach(key => {
          if (!header[key]) errors.push(`Missing Header.${key}`);
        });
        [
          'SenderSoftwareDeveloper',
          'SenderSoftwareProduct',
          'SenderSoftwareVersionRelease',
          'SenderSoftwareOperator'
        ].forEach(key => {
          if (!header.SenderSoftware?.[key]) errors.push(`Missing Header.SenderSoftware.${key}`);
        });
      }

      return errors;
    };

    const buildPpaError = (body: any, code: string, description: string) => {
      const header = getPpaMessage(body)?.Header || {};
      return {
        Message: {
          '@TransactionDomain': 'PPA',
          '@TransactionVersion': '2.0',
          Header: {
            To: header.From || 'Unknown',
            From: 'Intermediary',
            MessageID: `PPAError-${Date.now()}`,
            RelatesToMessageID: header.MessageID,
            SentTime: new Date().toISOString(),
            SenderSoftware: {
              SenderSoftwareDeveloper: 'REMS Prototype',
              SenderSoftwareProduct: 'REMS Intermediary',
              SenderSoftwareVersionRelease: '1',
              SenderSoftwareOperator: 'Intermediary'
            }
          },
          Body: {
            Error: {
              TransactionErrorCode: code,
              Description: description
            }
          }
        }
      };
    };

    const forwardPpaRequest = async (req: any, res: any, routeName: string) => {
      const message = getPpaMessage(req.body);
      const to = getPpaTo(req.body);

      const validationErrors = validatePpaRequest(req.body);
      if (validationErrors.length > 0) {
        return res.status(400).json(buildPpaError(req.body, '602', validationErrors.join('; ')));
      }

      const endpoints = JSON.parse(ppaPharmacyEndpoints || '[]');
      const endpoint = endpoints.find((entry: any) => entry.id === to);
      const ppaUrl = endpoint?.scriptUrl || endpoint?.ncpdpScriptUrl || endpoint?.url;

      if (!ppaUrl) {
        return res
          .status(404)
          .json(buildPpaError(req.body, '601', `No pharmacy PPA route configured for ${to}`));
      }

      console.log(`Forwarding PPARequest from ${routeName} to pharmacy ${to}: ${ppaUrl}`);
      const response = await axios.post(ppaUrl, req.body, {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        }
      });
      return res.status(response.status).json(response.data);
    };
    
    this.app.post('/ncpdp/script', async (req: any, res: any) => {
      try {
        console.log('Processing NCPDP SCRIPT message');

        if (isPpaMessage(req.body)) {
          return forwardPpaRequest(req, res, '/ncpdp/script');
        }

        const ehrEndpoint = ehrBaseUrl + '/ncpdp/script'
              
        // Determine message type
        const messageType = getMessageType(req.body);
        console.log(`Message type: ${messageType}`);

        if (messageType === 'NewRx') {
          const pharmacyId = getHeaderTo(req.body);
          const pharmacyEndpoint = getPharmacyRoute(pharmacyId, ncpdpScriptForwardUrl);
          console.log(`Forwarding NewRx to pharmacy ${pharmacyId || 'default'}: ${pharmacyEndpoint}`);
          
          const options = {
            method: 'POST',
            data: req.body,
            headers: req.headers
          };
          
          const response = await axios(pharmacyEndpoint, options);
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
          
          // grab the qualifier from the to
          const qualifier = getToQualifier(req.body);
          
          if (qualifier == Qualifier.Clinic || qualifier == Qualifier.Prescriber) {
            // Send to EHR
            console.log(`Sending RxFill to EHR: ${ehrEndpoint}`);

            await axios.post(ehrEndpoint, req.body, { headers: req.headers })
                .then(() => console.log('✓ RxFill sent to EHR'))
                .catch(err => console.error('✗ Error sending RxFill to EHR:', err.message));

          } else if (qualifier == Qualifier.REMSAdministrator) {
            // Send to REMS Admin if REMS drug
            if (drugInfo && drugInfo.ndc) {
              const coding = ndcToCoding(drugInfo.ndc);
              const serviceConnection = await getServiceConnection(coding, undefined);
              
              if (serviceConnection && serviceConnection.toNcpdp) {
                console.log(`Sending RxFill to REMS Admin: ${serviceConnection.toNcpdp}`);
                console.log(`  Drug: ${drugInfo.description || 'Unknown'} (${drugInfo.ndc})`);
                
                await axios.post(serviceConnection.toNcpdp, req.body, { headers: req.headers })
                    .then(() => console.log('✓ RxFill sent to REMS Admin'))
                    .catch(err => console.error('✗ Error sending RxFill to REMS Admin:', err.message));
              }
            }
          }
          
          // Return success status
          return res.send({ status: 'success', message: 'RxFill processed' });
        }

        // Unknown message type
        console.error(`Unknown NCPDP message type: ${messageType}`);
        return res.status(400).send(`Unknown NCPDP message type: ${messageType}`);
        
      } catch (error: any) {
        console.error('Error processing NCPDP message:', error.message);
        if (isPpaMessage(req.body)) {
          return res.status(500).json(buildPpaError(req.body, '601', error.message));
        }
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
          toNcpdp: req.body.toNcpdp,
          from: req.body.from || [EHRWhitelist.any],
          code: req.body.code,
          system: req.body.system,
          brand_name: req.body.brand_name || req.body.brandName || req.body.code,
          generic_name: req.body.generic_name || req.body.genericName
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
    
    // Get all hook sessions
    this.app.get('/api/sessions', async (req: any, res: any) => {
      try {
        const sessions = await HookSession.find();
        res.json({ count: sessions.length, sessions });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // Clear all hook sessions
    this.app.post('/api/sessions/clear', async (req: any, res: any) => {
      try {
        const result = await HookSession.deleteMany({});
        res.json({ message: `Cleared ${result.deletedCount} session(s)`, deletedCount: result.deletedCount });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
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
