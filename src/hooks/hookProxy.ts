import config from '../config';
import { Coding } from 'fhir/r4';
import { Connection } from '../lib/schemas/Phonebook';
import axios from 'axios';
import path, { join } from 'path';
import * as fs from 'fs';
import AdmZip from 'adm-zip';
import { parseString } from 'xml2js';

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
    code: '0245-0571-01', // iPLEDGE
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
    code: '63459-502-30', // TIRF
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
    code: '65597-402-20', // Turalio
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

// helper functions 
function validateXmlStructure(xmlObj: any): boolean {
    if (!xmlObj || !xmlObj.document) {
      console.error('Invalid XML object structure');
      return false;
    }
    
    if (!xmlObj.document.component || 
        !xmlObj.document.component[0] || 
        !xmlObj.document.component[0].structuredBody || 
        !xmlObj.document.component[0].structuredBody[0] || 
        !xmlObj.document.component[0].structuredBody[0].component) {
      console.error('XML document does not have the expected structure');
      return false;
    }
    
    return true;
  }

function findProductSection(components: any[]): any | null {
    return components.find((comp: any) => {
      return comp.section && 
             comp.section[0] && 
             comp.section[0].code && 
             comp.section[0].code[0] && 
             (comp.section[0].code[0].$ && comp.section[0].code[0].$.code === '48780-1'); // SPL PRODUCT DATA ELEMENTS SECTION
    });
  }

function getDrugNames(product: any): { brandName: string, genericName: string } | null {
    if (!product.name || !product.name[0]) {
      return null;
    }
    
    const brandName = product.name[0];
    let genericName = brandName;
    
    if (product.asEntityWithGeneric && 
        product.asEntityWithGeneric[0] && 
        product.asEntityWithGeneric[0].genericMedicine && 
        product.asEntityWithGeneric[0].genericMedicine[0] && 
        product.asEntityWithGeneric[0].genericMedicine[0].name) {
      genericName = product.asEntityWithGeneric[0].genericMedicine[0].name[0];
    }
    
    return { brandName, genericName };
  }

function extractRemsEndpoint(subjectOf: any[]): string | null {
    for (const item of subjectOf) {
      if (item.document && 
          item.document[0] && 
          item.document[0].title && 
          item.document[0].title[0] && 
          item.document[0].title[0].includes('REMS API') && 
          item.document[0].text && 
          item.document[0].text[0] && 
          item.document[0].text[0].reference) {
        
        const referenceValue = item.document[0].text[0].reference[0];
        let remsUrl;
        
        if (typeof referenceValue === 'string') {
          remsUrl = referenceValue;
        } else if (referenceValue.$ && referenceValue.$.value) {
          remsUrl = referenceValue.$.value;
        }
        
        if (remsUrl) {
          if (remsUrl.includes(':rems_discovery:')) {
            return remsUrl.split(':rems_discovery:')[1];
          } else {
            return remsUrl;
          }
        }
      }
    }
    
    return null;
  }

function getTargetZipPath(rems_spl_date: string, spl_files_dir: string): string | null {
  if (!fs.existsSync(spl_files_dir)) {
    console.error(`Directory ${spl_files_dir} does not exist`);
    return null;
  }
  
  const files = fs.readdirSync(spl_files_dir);
  const targetZipFile = files.find((file: string) => file.startsWith(rems_spl_date));
  
  if (!targetZipFile) {
    console.error(`No SPL file found for rems_spl_date: ${rems_spl_date}`);
    return null;
  }
  
  return join(spl_files_dir, targetZipFile);
}

function extractInnerZip(zipPath: string, innerExtractPath: string): string | null {
  try {
    const targetZipFile = path.basename(zipPath);
    const targetDirName = targetZipFile.replace('.zip', '');
    const specificInnerExtractPath = join(innerExtractPath, targetDirName);
    
    console.log(`Extracting latest inner zip file: ${targetZipFile}`);
    const targetZip = new AdmZip(zipPath);
    targetZip.extractAllTo(innerExtractPath, true);
    console.log(`Latest inner zip file extracted to ${specificInnerExtractPath}`);
    
    return specificInnerExtractPath;
  } catch (error) {
    console.error('Error extracting inner zip:', error);
    return null;
  }
}

function findXmlFile(extractPath: string): string | null {
  if (!fs.existsSync(extractPath)) {
    console.error(`Expected directory ${extractPath} does not exist`);
    return null;
  }
  
  const innerFiles = fs.readdirSync(extractPath);
  const xmlFile = innerFiles.find((file: string) => file.endsWith('.xml'));
  
  if (!xmlFile) {
    console.error('No XML file found in the extracted SPL file');
    return null;
  }
  
  return join(extractPath, xmlFile);
}

function parseXmlContent(xmlPath: string): Promise<any> {
  try {
    const xmlContent = fs.readFileSync(xmlPath, 'utf-8');
    
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
  } catch (error) {
    console.error('Error reading XML file:', error);
    return Promise.reject(error);
  }
}

function createDirectories(paths: string[]): void {
  for (const path of paths) {
    if (!fs.existsSync(path)) {
      fs.mkdirSync(path, { recursive: true });
    }
  }
}

function cleanDirectories(paths: string[]): void {
  for (const path of paths) {
    fs.rmSync(path, { recursive: true, force: true });
    fs.mkdirSync(path, { recursive: true });
  }
}

async function fetchAndSaveZip(url: string, savePath: string): Promise<boolean> {
  try {
    console.log(`Downloading latest SPL zip from ${url}`);
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    fs.writeFileSync(savePath, response.data);
    console.log('Latest SPL zip downloaded successfully');
    return true;
  } catch (error) {
    console.error('Error downloading SPL zip:', error);
    return false;
  }
}

function extractZip(zipPath: string, extractPath: string): boolean {
  try {
    console.log('Extracting latest SPL zip file');
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(extractPath, true);
    console.log('latest SPL zip extracted successfully');
    return true;
  } catch (error) {
    console.error('Error extracting zip:', error);
    return false;
  }
}

function getSplFileList(splFilesDir: string): any[] {
  if (!fs.existsSync(splFilesDir)) {
    console.error(`Directory ${splFilesDir} does not exist`);
    return [];
  }
  
  const files = fs.readdirSync(splFilesDir);
  return files.map((file: string) => {
    const datePart = file.split('_')[0];
    return { date: datePart, filename: file };
  });
}

async function updateEntryWithApiResults(entry: any): Promise<any> {
  console.log(`Using API lookup for ${entry.brand_name} (${entry.code})`);
  
  const apiResult = await getRemsFromDirectoryApi(entry.code);
  const entryToSave = { ...entry };
  
  if (apiResult) {
    entryToSave.to = apiResult.rems_endpoint + 'cds-services/rems-';
    entryToSave.toEtasu = apiResult.rems_endpoint + '4_0_0/GuidanceResponse/$rems-etasu';
    console.log(`Updated REMS endpoints for ${entry.brand_name} from API`);
  } else {
    console.log(`No API results found for ${entry.brand_name}, using default endpoints`);
    entryToSave.to = REMSAdminWhitelist.standardRemsAdmin;
    entryToSave.toEtasu = REMSAdminWhitelist.standardRemsAdminEtasu;
  }
  
  return entryToSave;
}

async function updateEntryWithSplResults(entry: any, downloadedSplZip: boolean): Promise<any> {
  console.log(`Using SPL lookup for ${entry.brand_name} (${entry.code})`);
  let localDownloadedSplZip = downloadedSplZip;
  const entryToSave = { ...entry };
  
  if (!localDownloadedSplZip) {
    await downloadSplZip();
    localDownloadedSplZip = true;
  }
  
  const xmlData = await getDrugXmlFromSplZip(entry.rems_spl_date);
  
  if (xmlData) {
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
  
  return entryToSave
}

async function saveOrUpdateEntry(entryToSave: any, existingEntry: any, model: any): Promise<void> {
  if (existingEntry) {
    const hasChanges = existingEntry.to !== entryToSave.to || 
                       existingEntry.toEtasu !== entryToSave.toEtasu;
    
    if (hasChanges) {
      await model.updateOne(
        { code: entryToSave.code, system: entryToSave.system },
        { 
          $set: { 
            to: entryToSave.to, 
            toEtasu: entryToSave.toEtasu
          }
        }
      );
      console.log(`Updated existing code ${entryToSave.code} in database with new endpoints`);
    } else {
      console.log(`No changes detected for code ${entryToSave.code}, skipping update in database`);
    }
  } else {
    const resource = new model(entryToSave);
    await resource.save();
    console.log(`Added code ${entryToSave.code} to database`);
  }
}

function extractDrugInfoFromXml(xmlObj: any, searchDrugName: string): any | null {
  try {

    if (!validateXmlStructure(xmlObj)) {
      return null;
    }

    console.log(`Searching for drug ${searchDrugName} in XML document`);


    const components = xmlObj.document.component[0].structuredBody[0].component;

    const productSection = findProductSection(components);


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

        const drugNames = getDrugNames(product);
        if (!drugNames) continue;
        const { brandName, genericName } = drugNames;


        // Check if this is the drug we're looking for
        const brandNameMatch = brandName.toUpperCase() === searchDrugName.toUpperCase();
        const genericNameMatch = genericName.toUpperCase() === searchDrugName.toUpperCase();

        if (brandNameMatch || genericNameMatch) {
          console.log(`Found matching drug: ${brandName} / ${genericName}`);

          // // Look for REMS API endpoint in subjectOf section
          if (subject.manufacturedProduct[0].subjectOf) {
            const remsEndpoint = extractRemsEndpoint(subject.manufacturedProduct[0].subjectOf);

            // Create the return object with drug info and endpoints
            if (remsEndpoint) {
              const drugInfo = {
                brandName: brandName,
                genericName: genericName,
                remsEndpoint: remsEndpoint,
              };

              console.log(`Found REMS endpoint for ${brandName}: ${remsEndpoint}`);
              return drugInfo;
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

async function getDrugXmlFromSplZip(rems_spl_date: string): Promise<any> {

  const baseFilePath = join(process.cwd(), 'rems-spl-files');
  const extractPath = join(baseFilePath, 'extracted');
  const innerExtractPath = join(baseFilePath, 'inner_extracted');

  try {
    console.log(`Looking for SPL file with date: ${rems_spl_date}`);

    // Check in the rems_document_spl_files subdirectory
    const spl_files_dir = join(extractPath, 'rems_document_spl_files');
    const targetZipPath = getTargetZipPath(rems_spl_date, spl_files_dir);

    if (!targetZipPath) {
      return null;
    }

    // Check if this specific zip has already been extracted
    const specificInnerExtractPath = extractInnerZip(targetZipPath, innerExtractPath);

    if (!specificInnerExtractPath) {
      return null;
    }

    // Find the XML file in the nested directory

    const xmlPath = findXmlFile(specificInnerExtractPath);
    
    if (!xmlPath) {
      return null;
    }
    
    // Read and parse the XML file
    return await parseXmlContent(xmlPath);

  } catch (error) {
    console.error('Error extracting and parsing SPL zip files:', error);
    return null;
  }
}

async function downloadSplZip(): Promise<any> {
  // Create base directories to store and process the zip files
  const baseFilePath = join(process.cwd(), 'rems-spl-files');
  const extractPath = join(baseFilePath, 'extracted');
  const innerExtractPath = join(baseFilePath, 'inner_extracted');
  const mainZipPath = join(baseFilePath, REMSAdminWhitelist.zipFileName);

  // Create directories if they don't exist
  createDirectories([baseFilePath, extractPath, innerExtractPath]);

  try {
    // Always re-download the main zip file to ensure we have the latest data
    const splZipUrl = `${REMSAdminWhitelist.discoveryUrlBase}${REMSAdminWhitelist.discoverySplZipEndpoint}`;
    const downloadSuccess = await fetchAndSaveZip(splZipUrl, mainZipPath);
    if (!downloadSuccess) return null;

    // Clean extraction directories to ensure fresh data
    cleanDirectories([extractPath, innerExtractPath]);


    // Extract the main zip
    const extractSuccess = extractZip(mainZipPath, extractPath);
    if (!extractSuccess) return null;

    const spl_files_dir = join(extractPath, 'rems_document_spl_files');
    return getSplFileList(spl_files_dir);
  } catch (error) {
    console.error('Error downloading SPL zip files:', error);
    return null;
  }
}

// Function to get drug info via the directory service API
export async function getRemsFromDirectoryApi(ndc_code: string): Promise<MedicationApiResponse | null> {
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

  let downloadedSplZip = false;

  for (const entry of phonebook) {
    try {
      // Check if entry already exists in database
      const existingEntry = await model.findOne({ code: entry.code, system: entry.system });

      // Create a copy of the entry to modify
      let entryToSave = { ...entry };

      console.log(`\n --------------------------------- \n check REMS endpoint info for ${entry.brand_name}`)

      // Always process directory lookup regardless of whether entry exists
      if (entry.directoryLookupType) {
        // Case 1: API lookup
        if (entry.directoryLookupType === 'api') {
          entryToSave = await updateEntryWithApiResults(entry);
        }
        // Case 2: SPL lookup
        else if (entry.directoryLookupType === 'spl' && entry.rems_spl_date) {
          entryToSave = await updateEntryWithSplResults(entry, downloadedSplZip);
        }
      }
      await saveOrUpdateEntry(entryToSave, existingEntry, model);   
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
    const sources = connection.from.filter((registeredRequester: string | undefined) => {
      return registeredRequester === EHRWhitelist.any || registeredRequester === requester;
    });
    if (sources.length > 0) {
      // valid requester, forward request
      return connection;
    }
  }
}
