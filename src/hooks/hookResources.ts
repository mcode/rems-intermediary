import { MedicationRequest, FhirResource } from 'fhir/r4';
import Card, { Link } from '../cards/Card';
import {
  Hook,
  SupportedHooks,
  TypedRequestBody,
  TypedResponseBody
} from '../rems-cds-hooks/resources/HookTypes';
import config from '../config'
import axios from 'axios';
import { ServicePrefetch } from '../rems-cds-hooks/resources/CdsService';
import { hydrate } from '../rems-cds-hooks/prefetch/PrefetchHydrator';
import { getServiceConnection } from './hookProxy';
import { HookSession } from '../lib/schemas/HookSession';
import * as env from 'env-var';

export interface CardRule {
  links: Link[];
  summary?: string;
  stakeholderType?: string;
  cardDetails?: string;
}
const source = {
  label: 'MCODE REMS Intermediary Prototype',
  url: new URL('https://github.com/mcode/rems-intermediary')
};

export function buildErrorCard(reason: string) {
  const errorCard = new Card('Bad Request', reason, source, 'warning');
  const cards = {
    cards: [errorCard.card]
  };
  return cards;
}

export function getDrugCodesFromMedicationRequest(medicationRequest: MedicationRequest) {
  if (medicationRequest) {
    if (medicationRequest?.medicationCodeableConcept) {
      console.log('Get Medication codes from CodeableConcept');
      return medicationRequest?.medicationCodeableConcept?.coding;
    } else if (medicationRequest?.medicationReference) {
      const reference = medicationRequest?.medicationReference;
      let codes = null;
      medicationRequest?.contained?.every(e => {
        if (e.resourceType + '/' + e.id === reference.reference) {
          if (e.resourceType === 'Medication') {
            console.log('Get Medication code from contained resource');
            codes = e.code?.coding;
          }
        }
      });
      console.log('Found codes: ' + JSON.stringify(codes));
      return codes;
    }
  }
  return null;
}

export function getFhirResource(token: string, req: TypedRequestBody) {
  const ehrUrl = `${req.body.fhirServer}/${token}`;
  const access_token = req.body.fhirAuthorization?.access_token;
  const options = {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${access_token}`
    }
  };
  const response = axios(ehrUrl, options);
  return response.then(e => {
    return e.data;
  });
}

const createErrorCard = (summary: string) => {
  return {
    cards: [
      {
        summary: summary,
        indicator: 'warning',
        source: {
          label: 'REMS Intermediary',
          url: config.server.backendApiBase,
        }
      }
    ]
  };
};

// handles all hooks, any supported hook should pass through this function
export async function handleHook(
  req: TypedRequestBody,
  res: TypedResponseBody,
  hookPrefetch: ServicePrefetch,
  contextRequest: FhirResource | undefined
) {
  const hookType = req?.body?.hook;

  if (contextRequest && contextRequest.resourceType === 'MedicationRequest') {

    const forwardData = async (hook: Hook, url: string) => {
      // Store original EHR details BEFORE modifying the hook
      const originalFhirServer = hook.fhirServer?.toString();
      const originalAuth = hook.fhirAuthorization;
      
      try {
        // Create and save HookSession to MongoDB
        // This stores the EHR FHIR server URL and authorization for later use
        const session = await HookSession.createFromHook(hook);
        
        console.log(`\ Created HookSession in MongoDB:`);
        console.log(`   Session ID: ${session._id}`);
        console.log(`   Patient: ${session.patientId}`);
        console.log(`   Hook Instance: ${session.hookInstance}`);
        console.log(`   EHR FHIR Server: ${session.ehrFhirServer}`);
        console.log(`   Authorization stored: ${session.ehrAuthorization?.access_token ? 'Yes' : 'No'}`);

        // Get intermediary's FHIR base URL from environment
        const intermediaryFhirUrl = env.get('INTERMEDIARY_FHIR_URL').asString() || 
                                    config.server.backendApiBase || 
                                    `http://localhost:${config.server.port}`;
        
        // Override the fhirServer URL to point to intermediary
        hook.fhirServer = new URL(intermediaryFhirUrl);
        
        // Remove authorization before forwarding to REMS Admin
        delete hook.fhirAuthorization;
        
        console.log(`\n Forwarding CDS Hook to REMS Admin:`);
        console.log(`   Original EHR: ${originalFhirServer}`);
        console.log(`   Overridden to: ${hook.fhirServer}`);
        console.log(`   REMS Admin will POST Communications to: ${hook.fhirServer}/Communication\n`);
        
        const options = {
          method: 'POST',
          data: hook,
          timeout: 5000,
        };
        
        const response = await axios(url, options);
        res.json(response.data);
        
      } catch (err: any) {
        console.error(' Error in forwardData:', err.message);
        console.error(err.stack);
        res.json({ cards: [] }); // Return fallback response
      }
    };

    let drugCodes = getDrugCodesFromMedicationRequest(contextRequest);
    if (drugCodes) {
      let found = false;

      for (let i = 0; i < (drugCodes?.length ? drugCodes?.length : 0); i++) {
        let drugCode = drugCodes?.[i];
        console.log('  Processing drugCode: ' + JSON.stringify(drugCode));

        if (drugCode) {
          const hook: Hook = req.body;
          let serviceConnection = await getServiceConnection(drugCode, hook.fhirServer?.toString());
          if (serviceConnection) {
            const url = serviceConnection.to + hook.hook;
            console.log('REMS Admin hook URL: ' + url);
            if (hook.fhirAuthorization && hook.fhirServer && hook.fhirAuthorization.access_token) {
              hydrate(getFhirResource, hookPrefetch, hook).then(async hydratedPrefetch => {
                if (hydratedPrefetch) {
                  hook.prefetch = hydratedPrefetch;
                }
                await forwardData(hook, url);
              });
            } else {
              await forwardData(hook, url);
            }

            found = true;
            // if medication found and works, do not continue through medications
            break;
          }
        }
      }

      if (!found) {
        // unsupported drug code, send back empty card list
        res.json({ cards: [] });
      }
    } else {
      // drug code could not be extracted
      res.json(createErrorCard('Could not extract drug codes from request'));
    }

  } else {
    if (hookType === SupportedHooks.ORDER_SELECT || hookType === SupportedHooks.ORDER_SIGN) {
      // context request is not a medicationRequest
      res.json(createErrorCard('No Medication Request found in hook'));
    } else if (
      hookType === SupportedHooks.PATIENT_VIEW ||
      hookType === SupportedHooks.ENCOUNTER_START
    ) {
      // complete the prefetch
      const hook: Hook = req.body;

      if (hook.fhirAuthorization && hook.fhirServer && hook.fhirAuthorization.access_token) {
        hydrate(getFhirResource, hookPrefetch, hook).then(async hydratedPrefetch => {
          if (hydratedPrefetch) {
            hook.prefetch = hydratedPrefetch;
          }
          await processMedications(hook);
        });
      } else {
        await processMedications(hook);
      }
    } else {
      res.json(createErrorCard('Unsupported hook type: ' + hookType));
    }
  }

  async function processMedications(hook: Hook) {
    if (hook && hook.prefetch && hook.prefetch.medicationRequests?.resourceType === 'Bundle') {
      const medicationRequests = hook?.prefetch?.medicationRequests;

      // loop through the prefetch medications
      if (medicationRequests.entry) {
        let medReqCount = medicationRequests?.entry.length;
        if (medReqCount <= 0) {
          res.json({ cards: [] });
          return;
        }

        const urlList: string[] = [];
        medicationRequests?.entry.forEach(async bundleEntry => {
          if (bundleEntry?.resource?.resourceType == 'MedicationRequest') {

            const drugCodes = getDrugCodesFromMedicationRequest(bundleEntry?.resource);
            if (drugCodes) {
              for (let i = 0; i < (drugCodes?.length ? drugCodes?.length : 0); i++) {
                let drugCode = drugCodes?.[i];
                if (drugCode) {
                  console.log('    medication: ' + drugCode?.display);
                  const serviceConnection = await getServiceConnection(
                    drugCode,
                    hook.fhirServer?.toString()
                  );
                  if (serviceConnection) {
                    const url = serviceConnection.to + hook.hook;
                    urlList.push(url);
                    // if medication found and works, do not continue through medications
                    break;
                  }
                }
              }
            }
          }

          medReqCount--;
          if (medReqCount <= 0) {
            let cards: Card[] = [];
            const uniqueUrls = [...new Set(urlList)];
            let urlCount = uniqueUrls.length;
            if (urlCount <= 0) {
              res.json({ cards: [] });
              return;
            }
            uniqueUrls.forEach(async (url: string) => {
              // Store original before modification
              const originalFhirServer = hook.fhirServer?.toString();
              
              try {
                // Create and save HookSession to MongoDB
                const session = await HookSession.createFromHook(hook);
                
                console.log(`\n🔐 Created HookSession in MongoDB (${hookType}):`);
                console.log(`   Session ID: ${session._id}`);
                console.log(`   Patient: ${session.patientId}`);

                // Get intermediary's FHIR base URL
                const intermediaryFhirUrl = env.get('INTERMEDIARY_FHIR_URL').asString() || 
                                            config.server.backendApiBase || 
                                            `http://localhost:${config.server.port}`;
                
                // Override fhirServer to point to intermediary
                hook.fhirServer = new URL(intermediaryFhirUrl);
                
                // Remove authorization
                delete hook.fhirAuthorization;
                
                console.log(`   Original EHR: ${originalFhirServer}`);
                console.log(`   Overridden to: ${hook.fhirServer}\n`);
                
                const options = {
                  method: 'POST',
                  data: hook
                };
                
                const response = await axios(url, options);
                cards = [...cards, ...response.data.cards];

                urlCount--;
                if (urlCount <= 0) {
                  // return the final list of cards
                  res.json({ cards });
                }
              } catch (error: any) {
                console.error(' Error in processMedications:', error.message);
                urlCount--;
                if (urlCount <= 0) {
                  res.json({ cards });
                }
              }
            });
          }
        });
      } else {
        res.json({ cards: [] });
      }
    } else {
      res.json(createErrorCard('No MedicationRequests in ' + hookType + ' hook'));
    }
  }
}