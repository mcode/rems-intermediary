import { FhirUtilities } from '../fhir/utilities';
import GuidanceResponseModel from '../lib/schemas/resources/GuidanceResponse';
import { Parameters, Medication, Patient, MedicationRequest } from 'fhir/r4';
import config from '../config';
import axios from 'axios';

module.exports.searchById = async (args: any) => {
  const { id } = args;
  console.log('GuidanceResponse >>> searchById: -- ' + id);
  return await GuidanceResponseModel.findOne({ id: id.toString() }, { _id: 0 }).exec();
};

module.exports.create = async (args: any, req: any) => {
  console.log('GuidanceResponse >>> create');
  const resource = req.req.body;
  const { base_version } = args;
  return await FhirUtilities.store(resource, GuidanceResponseModel, base_version);
};

const getMedicationCode = (
  medication: Medication | MedicationRequest | undefined
): string | undefined => {
  // grab the medication drug code from the Medication resource
  let drugCode;
  if (medication?.resourceType == 'Medication') {
    medication?.code?.coding?.forEach(medCode => {
      if (medCode?.system?.endsWith('rxnorm')) {
        drugCode = medCode?.code;
      }
    });
  } else {
    if (medication?.medicationCodeableConcept) {
      medication?.medicationCodeableConcept?.coding?.forEach(medCode => {
        if (medCode.system?.endsWith('rxnorm')) {
          drugCode = medCode.code;
        }
      });
    } else if (medication?.medicationReference) {
      const ref = medication.medicationReference.reference;
      if (ref?.startsWith('#')) {
        const containedRef = ref.slice(1);
        const match = medication.contained?.find(res => {
          return res.id === containedRef;
        });
        if (match?.resourceType === 'Medication') {
          return getMedicationCode(match);
        }
      }
    }
  }
  return drugCode;
};

module.exports.remsEtasu = async (args: any, context: any, logger: any) => {
  logger.info('Running GuidanceResponse rems-etasu check /$rems-etasu');

  const parameters: Parameters = args?.resource;
  let patient: Patient | undefined;
  let medication: Medication | MedicationRequest | undefined;
  let authNumber: string | undefined;

  parameters?.parameter?.forEach(param => {
    if (param?.name === 'patient' && param?.resource?.resourceType === 'Patient') {
      patient = param.resource;
    } else if (
      param?.name === 'medication' &&
      (param?.resource?.resourceType === 'Medication' ||
        param.resource?.resourceType === 'MedicationRequest')
    ) {
      medication = param.resource;
    } else if (param?.name === 'authNumber') {
      authNumber = param.valueString;
    }
  });

  const url = config?.general?.remsAdminFhirEtasuPath;
  console.log('rems-admin fhir url: ' + url);

  //TODO: look in the database for the correct rems-admin for the medication and forward the request
  const options = {
    method: 'POST',
    data: parameters
  };
  const response = await axios(url, options);
  return response.data;
};
