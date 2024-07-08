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


// handles all hooks, any supported hook should pass through this function
export async function handleHook(
  req: TypedRequestBody,
  res: TypedResponseBody,
  hookPrefetch: ServicePrefetch,
  contextRequest: FhirResource | undefined
) {
  const url = config?.general?.remsAdminHookPath + req?.body?.hook;
  console.log('rems-admin hook url: ' + url);

  //TODO: lookup hook url based on medication from the database
  //  look at rems-admin hookResources code to determine how to get the medication code

  const forwardData = (hook: Hook) => {
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

  let hook: Hook = req.body;
  if(hook.fhirAuthorization && hook.fhirServer && hook.fhirAuthorization.access_token) {
    hydrate(getFhirResource, hookPrefetch, hook).then((hydratedPrefetch) => {
      if(hydratedPrefetch) {
        hook.prefetch = hydratedPrefetch;
      }
      forwardData(hook);
    })
  } else {
    forwardData(hook);
  }
}
