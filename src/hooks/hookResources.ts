import {
  MedicationRequest,
  Coding,
  FhirResource,
  Task,
  Patient,
  Bundle,
  Medication,
  BundleEntry
} from 'fhir/r4';
import Card, { Link, Suggestion, Action } from '../cards/Card';
import {
  Hook,
  HookPrefetch,
  TypedRequestBody,
  TypedResponseBody
} from '../rems-cds-hooks/resources/HookTypes';
import config from '../config';

import axios from 'axios';
import { ServicePrefetch } from '../rems-cds-hooks/resources/CdsService';
import { hydrate } from '../rems-cds-hooks/prefetch/PrefetchHydrator';
import { responseToJSON } from 'fhirclient/lib/lib';
import { getServiceUrl } from './hookProxy';

type HandleCallback = (
  res: TypedResponseBody,
  hydratedPrefetch: HookPrefetch | undefined,
  contextRequest: FhirResource | undefined,
  patient: FhirResource | undefined
) => Promise<void>;

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
          url: 'http://localhost:3003'
        }
      }
    ]
  }
}
// handles all hooks, any supported hook should pass through this function
export async function handleHook(
  req: TypedRequestBody,
  res: TypedResponseBody,
  hookPrefetch: ServicePrefetch,
  contextRequest: FhirResource | undefined
) {
  if(contextRequest && contextRequest.resourceType === 'MedicationRequest'){
    const drugCode = getDrugCodeFromMedicationRequest(contextRequest);

    const forwardData = (hook: Hook, url: string) => {
      // remove the auth token before any forwarding occurs
      delete hook.fhirAuthorization;
      const options = {
        method: 'POST',
        data: hook
      };
      const response = axios(url, options);
      response.then(e => {
        res.json(e.data);
      });
    }
    if(drugCode) {
      let hook: Hook = req.body;
      const serviceUrl = await getServiceUrl(drugCode, hook.fhirServer?.toString());
      if(serviceUrl) {
        const url = serviceUrl + hook.hook;
        console.log('rems-admin hook url: ' + url);
        if(hook.fhirAuthorization && hook.fhirServer && hook.fhirAuthorization.access_token) {
          hydrate(getFhirResource, hookPrefetch, hook).then((hydratedPrefetch) => {
            if(hydratedPrefetch) {
              hook.prefetch = hydratedPrefetch;
            }
            forwardData(hook, url);
          })
        } else {
          forwardData(hook, url);
        }
      } else {
        // unsupported drug code, TODO - what to do when we don't have a service url
        res.json(createErrorCard('Unsupported Drug Code'));
      }
    } else {
      // drug code could not be extracted
      res.json(createErrorCard('Could not extract drug code from request'));
    }
  } else {
    // context request is not a medicationRequest
    res.json(createErrorCard('No Medication Request found in hook'));
  }
}
