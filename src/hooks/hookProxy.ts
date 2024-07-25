import config from "../config";
import { Coding } from "fhir/r4";
import { Connection } from "../lib/schemas/Phonebook";

enum EHRWhitelist {
    any = 'any', // wildcard, accept anything
    testEhr = 'http://localhost:8080/test-ehr/r4'
}

const REMSAdminWhitelist = {
    standardRemsAdmin: config?.general?.remsAdminHookPath,
    example: 'http://localhost:example'
}

enum SupportedCodeSystems {
    snomed = 'http://snomed.info/sct',
    rxnorm = 'http://www.nlm.nih.gov/research/umls/rxnorm',
    ndc = 'http://hl7.org/fhir/sid/ndc',
}

const pbook = [
    {
        code: '6064',
        system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
        to: REMSAdminWhitelist.standardRemsAdmin,
        from: [EHRWhitelist.any]
    },
    {
        code: '1237051',
        system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
        to: REMSAdminWhitelist.standardRemsAdmin,
        from: [EHRWhitelist.any]
    },
    {
        code: '2183126',
        system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
        to: REMSAdminWhitelist.standardRemsAdmin,
        from: [EHRWhitelist.any]
    },
    {
        code: '1666386',
        system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
        to: REMSAdminWhitelist.standardRemsAdmin,
        from: [EHRWhitelist.any]
    },
    {
        code: '0245-0571-01',
        system: 'http://hl7.org/fhir/sid/ndc',
        to: REMSAdminWhitelist.standardRemsAdmin,
        from: [EHRWhitelist.any]
    },
    {
        code: '63459-502-30',
        system: 'http://hl7.org/fhir/sid/ndc',
        to: REMSAdminWhitelist.standardRemsAdmin,
        from: [EHRWhitelist.any]
    },
    {
        code: '65597-402-20',
        system: 'http://hl7.org/fhir/sid/ndc',
        to: REMSAdminWhitelist.standardRemsAdmin,
        from: [EHRWhitelist.any]
    },
]
export async function loadPhonebook() {
    const model = Connection;
    for (const entry of pbook) {
        const doesExist = await model.exists({ code: entry.code, to: entry.to });
        if(!doesExist) {
            const resource = new model(entry);
            await resource.save();

        } else {
            console.log(`Skipping code ${entry.code} - already in database`);
        }
    }
}
export async function getServiceUrl(coding: Coding, requester: string | undefined) {
    const connectionModel = Connection;
    if (coding.system && coding.code && requester) {
        const connection = await connectionModel.findOne({code: coding.code, system: coding.system});
        if (!connection) {
            return undefined;
        }
        const sources = connection.from.filter((registeredRequester) => {
            if (registeredRequester === EHRWhitelist.any) {
                return true;
            } else if (registeredRequester === requester) {
                return true;
            }
        });
        if(sources.length > 0) {
            // valid requester, forward request
            return connection.to;
        }
    }
}