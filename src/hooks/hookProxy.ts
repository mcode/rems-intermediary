import config from '../config';
import { Coding } from 'fhir/r4';

enum EHRWhitelist {
  any = 'any', // wildcard, accept anything
  testEhr = 'http://localhost:8080/test-ehr/r4'
}

const REMSAdminWhitelist = {
  standardRemsAdmin: config?.general?.remsAdminHookPath,
  example: 'http://localhost:example'
};

enum SupportedCodeSystems {
  snomed = 'http://snomed.info/sct',
  rxnorm = 'http://www.nlm.nih.gov/research/umls/rxnorm',
  ndc = 'http://hl7.org/fhir/sid/ndc'
}

interface Connection {
  to: string; // who the request should go to
  from: string[]; // who the request is coming from
}

interface PhonebookEntry {
  [code: string]: Connection[];
}
type Phonebook = {
  [key: string]: PhonebookEntry;
};
const phonebook: Phonebook = {
  [SupportedCodeSystems.rxnorm]: {
    '6064': [
      // iPLEDGE
      {
        to: REMSAdminWhitelist.standardRemsAdmin,
        from: [EHRWhitelist.any]
      }
    ],
    '1237051': [
      // TIRF
      {
        to: REMSAdminWhitelist.standardRemsAdmin,
        from: [EHRWhitelist.testEhr]
      }
    ],
    '2183126': [
      // Turalio
      {
        to: REMSAdminWhitelist.standardRemsAdmin,
        from: [EHRWhitelist.any]
      }
    ],
    '1666386': [
      // Addyi
      {
        to: REMSAdminWhitelist.standardRemsAdmin,
        from: [EHRWhitelist.any]
      }
    ]
  },
  [SupportedCodeSystems.ndc]: {
    '0245-0571-01': [
      // iPLEDGE
      {
        to: REMSAdminWhitelist.standardRemsAdmin,
        from: [EHRWhitelist.any]
      }
    ],
    '63459-502-30': [
      // TIRF
      {
        to: REMSAdminWhitelist.standardRemsAdmin,
        from: [EHRWhitelist.any]
      }
    ],
    '65597-402-20': [
      // Turalio
      {
        to: REMSAdminWhitelist.standardRemsAdmin,
        from: [EHRWhitelist.any]
      }
    ]
  }
};

export const getServiceUrl = (coding: Coding, requester: string | undefined) => {
  if (coding.system && coding.code && requester) {
    const connections = phonebook[coding.system]?.[coding.code];
    if (!connections) {
      return undefined;
    }
    const connMap = connections
      .map(conn => {
        let isAny = false;
        const filteredConns = conn.from.filter(registeredRequester => {
          if (registeredRequester === EHRWhitelist.any) {
            isAny = true;
            return true;
          } else if (registeredRequester === requester) {
            return true;
          }
        });
        if (filteredConns.length > 0) {
          // found a match
          return {
            isAny: isAny,
            conn: conn
          };
        }
      })
      .filter(e => {
        return e;
      });
    if (connMap.length > 0) {
      // we have somewhere to send it
      for (const result of connMap) {
        if (result && !result.isAny) {
          return result.conn.to;
        }
      }
      return connMap[0]?.conn.to; // return our first result, which must be an 'any'
    }
  }
};
