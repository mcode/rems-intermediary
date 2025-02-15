import config from '../config';
import { Coding } from 'fhir/r4';
import { Connection } from '../lib/schemas/Phonebook';

export const EHRWhitelist = {
  any: 'any', // wildcard, accept anything
  testEhr: config.general.ehrUrl,
}

const REMSAdminWhitelist = {
  standardRemsAdmin: config?.general?.remsAdminHookPath,
  standardRemsAdminEtasu: config?.general?.remsAdminFhirEtasuPath,
  example: 'http://localhost:example'
};

const phonebook = [
  {
    code: '6064', // iPLEDGE
    system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
    to: REMSAdminWhitelist.standardRemsAdmin,
    toEtasu: REMSAdminWhitelist.standardRemsAdminEtasu,
    from: [EHRWhitelist.any]
  },
  {
    code: '1237051', // TIRF
    system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
    to: REMSAdminWhitelist.standardRemsAdmin,
    toEtasu: REMSAdminWhitelist.standardRemsAdminEtasu,
    from: [EHRWhitelist.any]
  },
  {
    code: '2183126', // Turalio
    system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
    to: REMSAdminWhitelist.standardRemsAdmin,
    toEtasu: REMSAdminWhitelist.standardRemsAdminEtasu,
    from: [EHRWhitelist.any]
  },
  {
    code: '1666386', // Addyi
    system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
    to: REMSAdminWhitelist.standardRemsAdmin,
    toEtasu: REMSAdminWhitelist.standardRemsAdminEtasu,
    from: [EHRWhitelist.any]
  },
  {
    code: '0245-0571-01', // iPLEDGE
    system: 'http://hl7.org/fhir/sid/ndc',
    to: REMSAdminWhitelist.standardRemsAdmin,
    toEtasu: REMSAdminWhitelist.standardRemsAdminEtasu,
    from: [EHRWhitelist.any]
  },
  {
    code: '63459-502-30', // TIRF
    system: 'http://hl7.org/fhir/sid/ndc',
    to: REMSAdminWhitelist.standardRemsAdmin,
    toEtasu: REMSAdminWhitelist.standardRemsAdminEtasu,
    from: [EHRWhitelist.any]
  },
  {
    code: '65597-402-20', // Turalio
    system: 'http://hl7.org/fhir/sid/ndc',
    to: REMSAdminWhitelist.standardRemsAdmin,
    toEtasu: REMSAdminWhitelist.standardRemsAdminEtasu,
    from: [EHRWhitelist.any]
  }
];
export async function loadPhonebook() {
  const model = Connection;
  for (const entry of phonebook) {
    const doesExist = await model.exists({ code: entry.code, system: entry.system });

    if (!doesExist) {
      const resource = new model(entry);
      await resource.save();
    } else {
      console.log(`Skipping code ${entry.code} - already in database`);
    }
  }
}

export async function getServiceConnection(coding: Coding, requester: string | undefined) {
  const connectionModel = Connection;
  if (coding.system && coding.code) {
    const connection = await connectionModel.findOne({ code: coding.code, system: coding.system });
    if (!connection) {
      return undefined;
    }
    const sources = connection.from.filter(registeredRequester => {
      return registeredRequester === EHRWhitelist.any || registeredRequester === requester;
    });
    if (sources.length > 0) {
      // valid requester, forward request
      return connection;
    }
  }
}
