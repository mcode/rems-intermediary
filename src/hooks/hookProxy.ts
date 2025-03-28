import config from '../config';
import { Coding } from 'fhir/r4';
import { Connection } from '../lib/schemas/Phonebook';
import axios from 'axios';
import path, { join } from 'path';
import * as fs from 'fs';
import AdmZip from 'adm-zip';
import { parseString } from 'xml2js';
import * as os from 'os';

export const EHRWhitelist = {
  any: 'any', // wildcard, accept anything
  testEhr: config.general.ehrUrl,
}

interface MedicationApiResponse {
  brand_name: string;
  generic_name: string;
  product_ndc: string;
  rems_administrator: string;
  rems_endpoint: string;
  rems_approval_date: string;
  rems_modification_date: string;
}

const REMSAdminWhitelist = {
  standardRemsAdmin: config?.general?.remsAdminHookPath,
  standardRemsAdminEtasu: config?.general?.remsAdminFhirEtasuPath,
  discoveryUrlBase: config?.general?.discoveryBaseUrl,
  discoveryApiEndpoint: config?.general?.discoveryApiUrl,
  discoverySplZipEndpoint: config?.general?.discoverySplZipUrl,
  zipFileName: config?.general?.splZipFileName,
};

const phonebook = [
  {
    code: '6064', // iPLEDGE
    system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
    brand_name: "Isotretinoin",
    generic_name: "ISOTRETINOIN",
    to: REMSAdminWhitelist.standardRemsAdmin,
    toEtasu: REMSAdminWhitelist.standardRemsAdminEtasu,
    from: [EHRWhitelist.any]
  },
  {
    code: '1237051', // TIRF
    system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
    brand_name: "Fentanyl Citrate",
    generic_name: "FENTANYL CITRATE",
    to: REMSAdminWhitelist.standardRemsAdmin,
    toEtasu: REMSAdminWhitelist.standardRemsAdminEtasu,
    from: [EHRWhitelist.any]
  },
  {
    code: '2183126', // Turalio
    system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
    brand_name: "Turalio",
    generic_name: "PEXIDARTINIB HYDROCHLORIDE",
    to: REMSAdminWhitelist.standardRemsAdmin,
    toEtasu: REMSAdminWhitelist.standardRemsAdminEtasu,
    from: [EHRWhitelist.any]
  },
  {
    code: '1666386', // Addyi
    system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
    brand_name: "ADDYI",
    generic_name: "FLIBANSERINE",
    to: REMSAdminWhitelist.standardRemsAdmin,
    toEtasu: REMSAdminWhitelist.standardRemsAdminEtasu,
    from: [EHRWhitelist.any]
  },
  {
    code: '70771-1557-4', // iPLEDGE
    system: 'http://hl7.org/fhir/sid/ndc',
    brand_name: "Isotretinoin",
    generic_name: "ISOTRETINOIN",
    // to: REMSAdminWhitelist.standardRemsAdmin,
    // toEtasu: REMSAdminWhitelist.standardRemsAdminEtasu,
    directoryLookupType: 'spl',
    rems_spl_date: "20230912",
    from: [EHRWhitelist.any]
  },
  {
    code: '63459-502-01', // TIRF
    system: 'http://hl7.org/fhir/sid/ndc',
    brand_name: "Fentanyl Citrate",
    generic_name: "FENTANYL CITRATE",
    // to: REMSAdminWhitelist.standardRemsAdmin,
    // toEtasu: REMSAdminWhitelist.standardRemsAdminEtasu,
    directoryLookupType: 'spl',
    rems_spl_date: "20230401",
    from: [EHRWhitelist.any]
  },
  {
    code: '65597-407-20', // Turalio
    system: 'http://hl7.org/fhir/sid/ndc',
    brand_name: "Turalio",
    generic_name: "PEXIDARTINIB HYDROCHLORIDE",
    // to: REMSAdminWhitelist.standardRemsAdmin,
    // toEtasu: REMSAdminWhitelist.standardRemsAdminEtasu,
    directoryLookupType: 'api',
    from: [EHRWhitelist.any]
  }, 
  {
    code: '58604-214', // Addyi
    system: 'http://hl7.org/fhir/sid/ndc',
    brand_name: "ADDYI",
    generic_name: "FLIBANSERINE",
    // to: REMSAdminWhitelist.standardRemsAdmin,
    // toEtasu: REMSAdminWhitelist.standardRemsAdminEtasu,
    directoryLookupType: 'api',
    from: [EHRWhitelist.any]
  }
];


function extractDrugInfoFromXml(xmlObj: any, searchDrugName: string): any | null {
  try {
    if (!xmlObj || !xmlObj.document) {
      console.error('Invalid XML object structure');
      return null;
    }

    console.log(`Searching for drug ${searchDrugName} in XML document`);
    
    // Navigate through the document structure to find the product sections
    if (!xmlObj.document.component || 
        !xmlObj.document.component[0] || 
        !xmlObj.document.component[0].structuredBody || 
        !xmlObj.document.component[0].structuredBody[0] || 
        !xmlObj.document.component[0].structuredBody[0].component) {
      console.error('XML document does not have the expected structure');
      return null;
    }
    
    const components = xmlObj.document.component[0].structuredBody[0].component;
    
    // Find product data elements section
    const productSection = components.find((comp: any) => {
      return comp.section && 
             comp.section[0] && 
             comp.section[0].code && 
             comp.section[0].code[0] && 
             (comp.section[0].code[0].$ && comp.section[0].code[0].$.code === '48780-1'); // SPL PRODUCT DATA ELEMENTS SECTION
    });
    
    if (!productSection || !productSection.section || !productSection.section[0].subject) {
      console.error('No product data elements section found in XML');
      return null;
    }
    
    // Loop through all subjects (manufactured products) to find our target drug
    const subjects = productSection.section[0].subject;
    
    for (const subject of subjects) {
      if (subject.manufacturedProduct && 
          subject.manufacturedProduct[0] && 
          subject.manufacturedProduct[0].manufacturedProduct) {
        
        const product = subject.manufacturedProduct[0].manufacturedProduct[0];
        
        // Get drug name
        if (!product.name || !product.name[0]) {
          continue;
        }
        
        const brandName = product.name[0];
        let genericName = brandName;
        
        // Try to get generic name if available
        if (product.asEntityWithGeneric && 
            product.asEntityWithGeneric[0] && 
            product.asEntityWithGeneric[0].genericMedicine && 
            product.asEntityWithGeneric[0].genericMedicine[0] && 
            product.asEntityWithGeneric[0].genericMedicine[0].name) {
          genericName = product.asEntityWithGeneric[0].genericMedicine[0].name[0];
        }
        
        // Check if this is the drug we're looking for
        const brandNameMatch = brandName.toUpperCase() === searchDrugName.toUpperCase();
        const genericNameMatch = genericName.toUpperCase() === searchDrugName.toUpperCase();
        
        if (brandNameMatch || genericNameMatch) {
          console.log(`Found matching drug: ${brandName} / ${genericName}`);
          
          // Look for REMS API endpoint in subjectOf section
          if (subject.manufacturedProduct[0].subjectOf) {
            for (const subjectOf of subject.manufacturedProduct[0].subjectOf) {
              if (subjectOf.document && 
                  subjectOf.document[0] && 
                  subjectOf.document[0].title && 
                  subjectOf.document[0].title[0] && 
                  subjectOf.document[0].title[0].includes('REMS API') && 
                  subjectOf.document[0].text && 
                  subjectOf.document[0].text[0] && 
                  subjectOf.document[0].text[0].reference) {
                
                const referenceValue = subjectOf.document[0].text[0].reference[0];
                let remsUrl;
                
                // Handle different XML formats
                if (typeof referenceValue === 'string') {
                  // Direct string format
                  remsUrl = referenceValue;
                } else if (referenceValue.$ && referenceValue.$.value) {
                  // Object with value attribute
                  remsUrl = referenceValue.$.value;
                }
                
                if (remsUrl) {
                  // Extract the URL, handling different formats
                  let cdsServiceUrl;
                  if (remsUrl.includes(':rems_discovery:')) {
                    cdsServiceUrl = remsUrl.split(':rems_discovery:')[1];
                  } else {
                    cdsServiceUrl = remsUrl;
                  }
                  
                  // Create the return object with drug info and endpoints
                  const drugInfo = {
                    brandName: brandName,
                    genericName: genericName,
                    remsEndpoint: cdsServiceUrl,                  };
                  
                  console.log(`Found REMS endpoint for ${brandName}: ${cdsServiceUrl}`);
                  return drugInfo;
                }
              }
            }
          }
          
          // Found the drug but no REMS endpoint
          console.log(`Found drug ${brandName} but no REMS endpoint in XML`);
          return {
            brandName: brandName,
            genericName: genericName,
            remsEndpoint: null,
            etasuEndpoint: null
          };
        }
      }
    }
    
    console.log(`Drug ${searchDrugName} not found in XML`);
    return null;
  } catch (error) {
    console.error('Error extracting drug info from XML:', error);
    return null;
  }
}

async function getDrugXmlFromSplZip(rems_spl_date?: string): Promise<any> {
  // Create base directories to store and process the zip files
  const baseFilePath = join(process.cwd(), 'rems-spl-files');
  const extractPath = join(baseFilePath, 'extracted');
  const innerExtractPath = join(baseFilePath, 'inner_extracted');
  const mainZipPath = join(baseFilePath, REMSAdminWhitelist.zipFileName);
  
  // Create directories if they don't exist
  if (!fs.existsSync(baseFilePath)) {
    fs.mkdirSync(baseFilePath, { recursive: true });
  }
  if (!fs.existsSync(extractPath)) {
    fs.mkdirSync(extractPath, { recursive: true });
  }
  if (!fs.existsSync(innerExtractPath)) {
    fs.mkdirSync(innerExtractPath, { recursive: true });
  }
  
  try {
      // Always re-download the main zip file to ensure we have the latest data
      console.log(`Downloading latest SPL zip from ${REMSAdminWhitelist.discoveryUrlBase}${REMSAdminWhitelist.discoverySplZipEndpoint}`);
      
      const splZipUrl = `${REMSAdminWhitelist.discoveryUrlBase}${REMSAdminWhitelist.discoverySplZipEndpoint}`;
      const response = await axios.get(splZipUrl, { responseType: 'arraybuffer' });
      fs.writeFileSync(mainZipPath, response.data);
      
      console.log('Latest SPL zip downloaded successfully');

      // Clean extraction directories to ensure fresh data
      fs.rmSync(extractPath, { recursive: true, force: true });
      fs.rmSync(innerExtractPath, { recursive: true, force: true });
      fs.mkdirSync(extractPath, { recursive: true });
      fs.mkdirSync(innerExtractPath, { recursive: true });


      console.log('Extracting latest SPL zip file');
      const mainZip = new AdmZip(mainZipPath);
      mainZip.extractAllTo(extractPath, true);
      console.log('latest SPL zip extracted successfully');

    
    // If a specific rems_spl_date is provided, find and process that zip file
    if (rems_spl_date) {
      console.log(`Looking for SPL file with date: ${rems_spl_date}`);
      
      // Check in the rems_document_spl_files subdirectory
      const spl_files_dir = join(extractPath, 'rems_document_spl_files');
      
      if (!fs.existsSync(spl_files_dir)) {
        console.error(`Directory ${spl_files_dir} does not exist`);
        return null;
      }
      
      const files = fs.readdirSync(spl_files_dir);
      
      const targetZipFile = files.find(file => file.startsWith(rems_spl_date));
      
      if (!targetZipFile) {
        console.error(`No SPL file found for rems_spl_date: ${rems_spl_date}`);
        return null;
      }
      
      const targetZipPath = join(spl_files_dir, targetZipFile);
      
      // Check if this specific zip has already been extracted
      const targetDirName = targetZipFile.replace('.zip', '');
      const specificInnerExtractPath = join(innerExtractPath, targetDirName);
      
      const zipAlreadyExtracted = fs.existsSync(specificInnerExtractPath)
      
      // Extract the target zip file if needed
      console.log(`Extracting latest inner zip file: ${targetZipFile}`);
      const targetZip = new AdmZip(targetZipPath);
      targetZip.extractAllTo(innerExtractPath, true);
      console.log(`Latest inner zip file extracted to ${specificInnerExtractPath}`);

    
      
      if (!fs.existsSync(specificInnerExtractPath)) {
        console.error(`Expected directory ${specificInnerExtractPath} does not exist`);
        return null;
      }
      
      // Find the XML file in the nested directory
      const innerFiles = fs.readdirSync(specificInnerExtractPath);
      const xmlFile = innerFiles.find(file => file.endsWith('.xml'));
      
      if (!xmlFile) {
        console.error('No XML file found in the extracted SPL file');
        return null;
      }
      
      // Read and parse the XML file
      const xmlPath = join(specificInnerExtractPath, xmlFile);
      const xmlContent = fs.readFileSync(xmlPath, 'utf-8');
      
      // Parse XML content using xml2js
      return new Promise((resolve, reject) => {
        parseString(xmlContent, (err: any, result: any) => {
          if (err) {
            console.error('Error parsing XML:', err);
            reject(err);
          } else {
            resolve(result);
          }
        });
      });
    } else {
      // If no specific date is provided, return a list of available dates
      const spl_files_dir = join(extractPath, 'rems_document_spl_files');
      if (!fs.existsSync(spl_files_dir)) {
        console.error(`Directory ${spl_files_dir} does not exist`);
        return [];
      }
      
      const files = fs.readdirSync(spl_files_dir);
      return files.map(file => {
        // Extract date information from filenames
        const datePart = file.split('_')[0]; // Assuming format is DATE_otherinfo.zip
        return { date: datePart, filename: file };
      });
    }
  } catch (error) {
    console.error('Error processing SPL zip files:', error);
    return null;
  }
}

// Function to get drug info via the directory service API
async function getRemsFromDirectoryApi(ndc_code: string): Promise<MedicationApiResponse | null> {
  try {
    let searchKey;
    let searchValue;

    if (!ndc_code) {
      return null
    }

    searchKey = "product_ndc"
    searchValue = ndc_code
    
    // Call the directory service API
    const apiUrl = `${REMSAdminWhitelist.discoveryUrlBase}${REMSAdminWhitelist.discoveryApiEndpoint}?search=${searchKey}="${searchValue}"`;
    console.log(`Fetching ${searchKey} ${searchValue} from directory service API: ${apiUrl}`);
    
    const response = await axios.get(apiUrl);
    
    if (response.status === 200 && response.data.results && response.data.results.length > 0) {
      const medication: MedicationApiResponse = response.data.results[0];
      
      console.log(`Found ${searchKey} ${searchValue} info from API:`, medication);
      return medication;
    } else {
    console.log(`${searchKey} ${searchValue} not found in API`);
    return null;
    }
  } catch (error) {
    console.error('Error fetching from directory API:', error);
    return null;
  }
}


export async function loadPhonebook() {
  const model = Connection;
  
  for (const entry of phonebook) {
    try {
      // Check if entry already exists in database
      const existingEntry = await model.findOne({ code: entry.code, system: entry.system });
      const doesExist = existingEntry !== null;

      // Create a copy of the entry to modify
      const entryToSave = { ...entry };
      
      // Always process directory lookup regardless of whether entry exists
      if (entry.directoryLookupType) {
        // Case 1: API lookup
        if (entry.directoryLookupType === 'api') {
          console.log(`Using API lookup for ${entry.brand_name} (${entry.code})`);
          
          // Get information from the directory API
          const apiResult = await getRemsFromDirectoryApi(
            entry.code
          );
          
          if (apiResult) {
            // Update entry with API results
            entryToSave.to = apiResult.rems_endpoint + 'cds-services/rems-';
            entryToSave.toEtasu = apiResult.rems_endpoint + '4_0_0/GuidanceResponse/$rems-etasu';
            console.log(`Updated REMS endpoints for ${entry.brand_name} from API`);
          } else {
            console.log(`No API results found for ${entry.brand_name}, using default endpoints`);
            entryToSave.to = REMSAdminWhitelist.standardRemsAdmin;
            entryToSave.toEtasu = REMSAdminWhitelist.standardRemsAdminEtasu;
          }
        } 
        // Case 2: SPL lookup
        else if (entry.directoryLookupType === 'spl' && entry.rems_spl_date) {
          console.log(`Using SPL lookup for ${entry.brand_name} (${entry.code})`);
          
          // Get the XML data from the SPL zip
          const xmlData = await getDrugXmlFromSplZip(entry.rems_spl_date);
          
          if (xmlData) {
            // Extract drug info from the XML
            const drugInfo = extractDrugInfoFromXml(xmlData, entry.generic_name || entry.brand_name);
            
            if (drugInfo && drugInfo.remsEndpoint) {
              entryToSave.to = drugInfo.remsEndpoint + 'cds-services/rems-';
              entryToSave.toEtasu = drugInfo.remsEndpoint + '4_0_0/GuidanceResponse/$rems-etasu';
              console.log(`Updated REMS endpoints for ${entry.brand_name} from SPL`);
            } else {
              console.log(`No REMS endpoints found in SPL for ${entry.brand_name}, using default endpoints`);
              entryToSave.to = REMSAdminWhitelist.standardRemsAdmin;
              entryToSave.toEtasu = REMSAdminWhitelist.standardRemsAdminEtasu;
            }
          } else {
            console.log(`Failed to get SPL data for ${entry.brand_name}, using default endpoints`);
            entryToSave.to = REMSAdminWhitelist.standardRemsAdmin;
            entryToSave.toEtasu = REMSAdminWhitelist.standardRemsAdminEtasu;
          }
        }
      }
      
      if (doesExist) {
        // Check if there are any changes to the existing entry
        const hasChanges = existingEntry.to !== entryToSave.to || 
                           existingEntry.toEtasu !== entryToSave.toEtasu;
        
        if (hasChanges) {
          // Update the existing entry with new information
          await model.updateOne(
            { code: entry.code, system: entry.system },
            { 
              $set: { 
                to: entryToSave.to, 
                toEtasu: entryToSave.toEtasu
              }
            }
          );
          console.log(`Updated existing code ${entry.code} in database with new endpoints`);
        } else {
          console.log(`No changes detected for code ${entry.code}, skipping update in database`);
        }
      } else {
        // Save the new entry to the database
        const resource = new model(entryToSave);
        await resource.save();
        console.log(`Added code ${entry.code} to database`);
      }    
    } catch (error) {
      console.error(`Error processing entry ${entry.code}:`, error);
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
