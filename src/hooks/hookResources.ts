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
  //TODO: remove the auth token
  //TODO: hydrate the prefetch
  const options = {
    method: 'POST',
    data: req.body
  };
  const response = axios(url, options);
  response.then(e => {
    res.json(e.data);
  });

  /* prefetch hydration code below...
  try {
    const fhirUrl = req.body.fhirServer;
    const fhirAuth = req.body.fhirAuthorization;
    if (fhirUrl && fhirAuth && fhirAuth.access_token) {
      hydrate(getFhirResource, hookPrefetch, req.body).then(hydratedPrefetch => {
        handleCard(req, res, hydratedPrefetch, contextRequest, callback);
      });
    } else {
      if (req.body.prefetch) {
        handleCard(req, res, req.body.prefetch, contextRequest, callback);
      } else {
        handleCard(req, res, {}, contextRequest, callback);
      }
    }
  } catch (error) {
    console.log(error);
    res.json(buildErrorCard('Unknown Error'));
  }
  */
}
