import { XMLParser } from 'fast-xml-parser';
import { Coding } from 'fhir/r4';

const XML_PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: true,
  trimValues: true
};

interface NcpdpDrugInfo {
  ndc?: string;
  description?: string;
}

export enum Qualifier {
  Pharmacy = "P",                       // Pharmacy
  Clinic = "C",                         // Clinic
  Mailbox = "M",                        // Mailbox
  Prescriber = "P",                     // Prescriber
  CentralFillFacility = "CF",           // Central Fill Facility
  MutuallyDefined = "ZZZ",              // Mutually Defined
  Payer = "PY",                         // Payer
  DirectIDSecureEmailAddress = "DIRECT",// Direct ID secure email address
  REMSAdministrator="REMS",             // REMS Administrator
  Unknown="?"                           // Unknown / Error
}

/**
 * 
 * Determine the to:qualifier from the NCPDP message xml
 */
export function getToQualifier(xmlData: string | any): Qualifier {
  try {
    let parsedXml;

    if (typeof xmlData === 'object') {
      parsedXml = xmlData;
    } else {
      const parser = new XMLParser(XML_PARSER_OPTIONS);
      parsedXml = parser.parse(xmlData);
    }

    const message = parsedXml?.Message || parsedXml?.message;
    if (!message) {
      console.log('Error: NCPDP XML missing Message')
      return Qualifier.Unknown;
    }

    const header = message?.Header || message?.header;
    if (!header) {
      console.log('Error: NCPDP XML missing Header')
      return Qualifier.Unknown;
    }

    const to = header?.To || header?.to;
    if (!to) {
      console.log('Error: NCPDP XML missing To')
      return Qualifier.Unknown;
    }

    const qualifier = to['@_Qualifier'];

    if (!qualifier) {
      console.log('Error: NCPDP XML missing Qualifier')
      return Qualifier.Unknown;
    }

    return qualifier;

  } catch (error) {
    console.error('Error determining NCPDP To Qualifier:', error);
    return Qualifier.Unknown;
  }
}

/**
 * Determine NCPDP message type from parsed XML
 */
export function getMessageType(xmlData: string | any): string {
  try {
    let parsedXml;

    if (typeof xmlData === 'object') {
      parsedXml = xmlData;
    } else {
      const parser = new XMLParser(XML_PARSER_OPTIONS);
      parsedXml = parser.parse(xmlData);
    }

    const message = parsedXml?.Message || parsedXml?.message;
    if (!message) {
      return 'Unknown';
    }

    const body = message?.Body || message?.body;
    if (!body) {
      return 'Unknown';
    }

    // Check for each message type
    if (body.NewRx || body.newrx) return 'NewRx';
    if (body.REMSInitiationRequest || body.remsinitiationrequest) return 'REMSInitiationRequest';
    if (body.REMSRequest || body.remsrequest) return 'REMSRequest';
    if (body.RxFill || body.rxfill) return 'RxFill';
    if (body.Status || body.status) return 'Status';
    if (body.Error || body.error) return 'Error';
    if (body.REMSInitiationResponse || body.remsinitiationresponse) return 'REMSInitiationResponse';
    if (body.REMSResponse || body.remsresponse) return 'REMSResponse';

    return 'Unknown';
  } catch (error) {
    console.error('Error determining message type:', error);
    return 'Unknown';
  }
}

/**
 * Extract drug information (NDC code) from NCPDP SCRIPT message
 */
export function extractDrugFromNcpdp(xmlData: string | any): NcpdpDrugInfo | null {
  try {
    let parsedXml;

    // If xmlData is already parsed (JSON object), use it directly
    if (typeof xmlData === 'object') {
      parsedXml = xmlData;
    } else {
      // Parse XML string
      const parser = new XMLParser(XML_PARSER_OPTIONS);
      parsedXml = parser.parse(xmlData);
    }

    const message = parsedXml?.Message || parsedXml?.message;
    if (!message) {
      console.log('No Message element found in NCPDP');
      return null;
    }

    const body = message?.Body || message?.body;
    if (!body) {
      console.log('No Body element found in NCPDP');
      return null;
    }

    // Check for different NCPDP message types
    const remsInitiationRequest = body?.REMSInitiationRequest || body?.remsinitiationrequest;
    const remsRequest = body?.REMSRequest || body?.remsrequest;
    const rxFill = body?.RxFill || body?.rxfill;
    const newRx = body?.NewRx || body?.newrx;

    let medicationPrescribed;
    let medicationDispensed;

    if (remsInitiationRequest) {
      medicationPrescribed = remsInitiationRequest.MedicationPrescribed || remsInitiationRequest.medicationprescribed;
    } else if (remsRequest) {
      medicationPrescribed = remsRequest.MedicationPrescribed || remsRequest.medicationprescribed;
    } else if (rxFill) {
      medicationDispensed = rxFill.MedicationDispensed || rxFill.medicationdispensed;
      medicationPrescribed = rxFill.MedicationPrescribed || rxFill.medicationprescribed;
    } else if (newRx) {
      medicationPrescribed = newRx.MedicationPrescribed || newRx.medicationprescribed;
    }

    if (medicationDispensed) {
      const product = medicationDispensed.Product || medicationDispensed.product;
      const drugCoded = product?.DrugCoded || product?.drugcoded || medicationDispensed.DrugCoded || medicationDispensed.drugcoded;
      
      let ndc = drugCoded?.NDC || drugCoded?.ndc;
      
      if (!ndc) {
        const productCode = drugCoded?.ProductCode || drugCoded?.productcode;
        ndc = productCode?.Code || productCode?.code;
      }

      const description = medicationDispensed.DrugDescription || medicationDispensed.drugdescription;

      if (ndc) {
        console.log(`Extracted NDC from NCPDP (MedicationDispensed): ${ndc}, Description: ${description || 'N/A'}`);
        return {
          ndc: ndc,
          description: description
        };
      }
    }

    if (medicationPrescribed) {
      // Extract NDC
      const product = medicationPrescribed.Product || medicationPrescribed.product;
      const drugCoded = product?.DrugCoded || product?.drugcoded || medicationPrescribed.DrugCoded || medicationPrescribed.drugcoded;
      
      let ndc = drugCoded?.NDC || drugCoded?.ndc;
      
      // Also check ProductCode for NDC
      if (!ndc) {
        const productCode = drugCoded?.ProductCode || drugCoded?.productcode;
        ndc = productCode?.Code || productCode?.code;
      }

      const description = medicationPrescribed.DrugDescription || medicationPrescribed.drugdescription;

      if (ndc) {
        console.log(`Extracted NDC from NCPDP (MedicationPrescribed): ${ndc}, Description: ${description || 'N/A'}`);
        return {
          ndc: ndc,
          description: description
        };
      }
    }

    console.log('Could not extract NDC from NCPDP message');
    return null;
  } catch (error) {
    console.error('Error extracting drug from NCPDP:', error);
    return null;
  }
}

/**
 * Convert NDC code to FHIR Coding format
 */
export function ndcToCoding(ndc: string): Coding {
  return {
    system: 'http://hl7.org/fhir/sid/ndc',
    code: ndc
  };
}