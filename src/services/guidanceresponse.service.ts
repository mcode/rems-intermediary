import { Coding, Medication, MedicationRequest, Parameters } from 'fhir/r4';
import { EHRWhitelist, getServiceConnection } from '../hooks/hookProxy';
import axios from 'axios';

const getMedicationCode = (
  medication: Medication | MedicationRequest | undefined
): Coding | undefined => {
  const selectRoutingCode = (codings: Coding[] | undefined) => {
    const ndc = codings?.find(medCode => medCode?.system?.toLowerCase().endsWith('/ndc'));
    if (ndc) return ndc;

    return codings?.find(medCode => medCode?.system?.toLowerCase().includes('rxnorm'));
  };

  if (medication?.resourceType == 'Medication') {
    return selectRoutingCode(medication?.code?.coding);
  } else {
    if (medication?.medicationCodeableConcept) {
      return selectRoutingCode(medication?.medicationCodeableConcept?.coding);
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
};

module.exports.remsEtasu = async (args: any, context: any, logger: any) => {
  logger.info('Processing REMS Etasu request');
  const parameters: Parameters = args?.resource;
  let medication: Medication | MedicationRequest | undefined;

  parameters?.parameter?.forEach(param => {
    if (
      param?.name === 'medication' &&
      (param?.resource?.resourceType === 'Medication' ||
        param.resource?.resourceType === 'MedicationRequest')
    ) {
      medication = param.resource;
    }
  });
  const medCode = getMedicationCode(medication);
  if (medCode) {
    const serviceConnection = await getServiceConnection(medCode, EHRWhitelist.any); // might need to get the requester from somewhere
    if (serviceConnection && serviceConnection.toEtasu) {
      const options = {
        method: 'POST',
        data: parameters
      };
      const response = await axios(serviceConnection.toEtasu, options);
      return response.data;
    }
  }
  return 'No Etasu Found';
};

export {};
