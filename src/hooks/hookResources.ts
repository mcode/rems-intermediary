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

export function getDrugCodeFromMedicationRequest(medicationRequest: MedicationRequest) {
  if (medicationRequest) {
    if (medicationRequest?.medicationCodeableConcept) {
      console.log('Get Medication code from CodeableConcept');
      return medicationRequest?.medicationCodeableConcept?.coding?.[0];
    } else if (medicationRequest?.medicationReference) {
      const reference = medicationRequest?.medicationReference;
      let coding = null;
      medicationRequest?.contained?.every(e => {
        if (e.resourceType + '/' + e.id === reference.reference) {
          if (e.resourceType === 'Medication') {
            console.log('Get Medication code from contained resource');
            coding = e.code?.coding?.[0];
          }
        }
      });
      console.log('Found code: ' + JSON.stringify(coding));
      return coding;
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
    const drugCode = getDrugCodeFromMedicationRequest(contextRequest);

    const forwardData = (hook: Hook, url: string) => {
      console.log('zzzz forwardData: ');
      console.log(url); //zzzz
      console.log(hook); //zzzz
      // remove the auth token before any forwarding occurs
      delete hook.fhirAuthorization;
      const options = {
        method: 'POST',
        data: hook,
        timeout: 5000,
      };

      console.log(url); //zzzz
      const response = axios(url, options);
      response.then(e => {
        res.json(e.data);
      })
      .catch(err => {
        console.log('zzzz: error in forwardData call:');
        console.log(err);
        res.json({ cards: [] }); // Return fallback response
      });
    };
    if (drugCode) {
      const hook: Hook = req.body;
      const serviceConnection = await getServiceConnection(drugCode, hook.fhirServer?.toString());
      if (serviceConnection) {
        const url = serviceConnection.to + hook.hook;
        console.log('rems-admin hook url: ' + url);
        if (hook.fhirAuthorization && hook.fhirServer && hook.fhirAuthorization.access_token) {
          hydrate(getFhirResource, hookPrefetch, hook).then(hydratedPrefetch => {
            if (hydratedPrefetch) {
              hook.prefetch = hydratedPrefetch;
            }
            forwardData(hook, url);
          });
        } else {
          forwardData(hook, url);
        }
      } else {
        // unsupported drug code, send back empty card list
        res.json({ cards: [] });
      }
    } else {
      // drug code could not be extracted
      res.json(createErrorCard('Could not extract drug code from request'));
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
            const drugCode = getDrugCodeFromMedicationRequest(bundleEntry?.resource);

            if (drugCode) {
              console.log('    medication: ' + drugCode?.display);
              const serviceConnection = await getServiceConnection(
                drugCode,
                hook.fhirServer?.toString()
              );
              if (serviceConnection) {
                const url = serviceConnection.to + hook.hook;
                urlList.push(url);
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
            uniqueUrls.forEach((url: string) => {
              // remove the auth token before any forwarding occurs
              delete hook.fhirAuthorization;
              const options = {
                method: 'POST',
                data: hook
              };
              const response = axios(url, options);
              response.then(e => {
                cards = [...cards, ...e.data.cards];

                urlCount--;
                if (urlCount <= 0) {
                  // return the final list of cards
                  res.json({ cards });
                }
              });
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
