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

interface DrugInfo {
  brandName: string;
  genericName: string;
  remsEndpoint?: string;
  productNdc?: string;
  approvalId?: string;
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
    from: [EHRWhitelist.any]
  },
  {
    code: '1237051', // TIRF
    system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
    brand_name: "Fentanyl Citrate",
    generic_name: "FENTANYL CITRATE",
    from: [EHRWhitelist.any]
  },
  {
    code: '2183126', // Turalio
    system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
    brand_name: "Turalio",
    generic_name: "PEXIDARTINIB HYDROCHLORIDE",
    from: [EHRWhitelist.any]
  },
  {
    code: '1666386', // Addyi
    system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
    brand_name: "ADDYI",
    generic_name: "FLIBANSERINE",
    from: [EHRWhitelist.any]
  },
  {
    code: '0245-0571-01', // iPLEDGE
    system: 'http://hl7.org/fhir/sid/ndc',
    brand_name: "Isotretinoin",
    generic_name: "ISOTRETINOIN",
    from: [EHRWhitelist.any]
  },
  {
    code: '63459-502-30', // TIRF
    system: 'http://hl7.org/fhir/sid/ndc',
    brand_name: "Fentanyl Citrate",
    generic_name: "FENTANYL CITRATE",
    from: [EHRWhitelist.any]
  },
  {
    code: '65597-402-20', // Turalio
    system: 'http://hl7.org/fhir/sid/ndc',
    brand_name: "Turalio",
    generic_name: "PEXIDARTINIB HYDROCHLORIDE",
    from: [EHRWhitelist.any]
  },
  {
    code: '58604-214', // Addyi
    system: 'http://hl7.org/fhir/sid/ndc',
    brand_name: "ADDYI",
    generic_name: "FLIBANSERINE",
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
    
    let brandName: string;
    if (typeof product.name[0] === 'string') {
      brandName = product.name[0].trim();
    } else if (typeof product.name[0] === 'object' && product.name[0]._) {
      brandName = product.name[0]._.trim();
      if (product.name[0].suffix && Array.isArray(product.name[0].suffix)) {
        brandName += ' ' + product.name[0].suffix.join(' ');
      }
    } else {
      return null;
    }
    
    let genericName = brandName;
    
    if (product.asEntityWithGeneric && 
        product.asEntityWithGeneric[0] && 
        product.asEntityWithGeneric[0].genericMedicine && 
        product.asEntityWithGeneric[0].genericMedicine[0] && 
        product.asEntityWithGeneric[0].genericMedicine[0].name) {
      
      const genericNameRaw = product.asEntityWithGeneric[0].genericMedicine[0].name[0];
      if (typeof genericNameRaw === 'string') {
        genericName = genericNameRaw.trim();
      } else if (typeof genericNameRaw === 'object' && genericNameRaw._) {
        genericName = genericNameRaw._.trim();
        if (genericNameRaw.suffix && Array.isArray(genericNameRaw.suffix)) {
          genericName += ' ' + genericNameRaw.suffix.join(' ');
        }
      }
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

function extractProductNdc(subject: any): string | null {
  if (subject.manufacturedProduct && 
      subject.manufacturedProduct[0] && 
      subject.manufacturedProduct[0].subjectOf) {
    
    for (const subjectOfItem of subject.manufacturedProduct[0].subjectOf) {
      if (subjectOfItem.approval && 
          subjectOfItem.approval[0] && 
          subjectOfItem.approval[0].id && 
          subjectOfItem.approval[0].id[0] && 
          subjectOfItem.approval[0].id[0].$) {
        
        const extension = subjectOfItem.approval[0].id[0].$.extension;
        if (extension && (extension.startsWith('NDA') || extension.startsWith('ANDA'))) {
          // ToDo: Map Approval code to NDC code
          // For now return null and force api check via brand/generic name
          return null;
        }
      }
    }
  }
  
  return null;
}

function findRxNormCodeFromPhonebook(brandName: string, genericName: string): { code: string; system: string } | null {
  const match = phonebook.find(entry => 
    entry.brand_name.toLowerCase() === brandName.toLowerCase() ||
    entry.generic_name.toLowerCase() === genericName.toLowerCase() ||
    entry.brand_name.toLowerCase() === genericName.toLowerCase() ||
    entry.generic_name.toLowerCase() === brandName.toLowerCase()
  );
  
  if (match) {
    return {
      code: match.code,
      system: match.system
    };
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

function getAllSplZipPaths(spl_files_dir: string): string[] {
  if (!fs.existsSync(spl_files_dir)) {
    console.error(`Directory ${spl_files_dir} does not exist`);
    return [];
  }
  
  const files = fs.readdirSync(spl_files_dir);
  return files
    .filter((file: string) => file.endsWith('.zip'))
    .map((file: string) => join(spl_files_dir, file));
}

function extractInnerZip(zipPath: string, innerExtractPath: string): string | null {
  try {
    const targetZipFile = path.basename(zipPath);
    const targetDirName = targetZipFile.replace('.zip', '');
    const specificInnerExtractPath = join(innerExtractPath, targetDirName);
    
    console.log(`Extracting inner zip file: ${targetZipFile}`);
    const targetZip = new AdmZip(zipPath);
    targetZip.extractAllTo(innerExtractPath, true);
    console.log(`Inner zip file extracted to ${specificInnerExtractPath}`);
    
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

async function saveOrUpdateEntry(entryToSave: any, model: any): Promise<void> {
  const existingEntry = await model.findOne({ code: entryToSave.code, system: entryToSave.system });
  
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

function extractAllDrugsFromXml(xmlObj: any): DrugInfo[] {
  try {
    if (!validateXmlStructure(xmlObj)) {
      return [];
    }

    console.log('Extracting all drugs from XML document');

    const components = xmlObj.document.component[0].structuredBody[0].component;
    const productSection = findProductSection(components);

    if (!productSection || !productSection.section || !productSection.section[0].subject) {
      console.error('No product data elements section found in XML');
      return [];
    }

    const subjects = productSection.section[0].subject;
    const drugs: DrugInfo[] = [];

    for (const subject of subjects) {
      if (subject.manufacturedProduct &&
        subject.manufacturedProduct[0] &&
        subject.manufacturedProduct[0].manufacturedProduct) {

        const product = subject.manufacturedProduct[0].manufacturedProduct[0];
        const drugNames = getDrugNames(product);
        
        if (!drugNames) continue;

        const { brandName, genericName } = drugNames;
        const productNdc = extractProductNdc(subject);

        let remsEndpoint: string | null = null;
        if (subject.manufacturedProduct[0].subjectOf) {
          remsEndpoint = extractRemsEndpoint(subject.manufacturedProduct[0].subjectOf);
        }

        const drugInfo: DrugInfo = {
          brandName,
          genericName,
          remsEndpoint: remsEndpoint || undefined,
          productNdc: productNdc || undefined
        };

        drugs.push(drugInfo);
        
        if (remsEndpoint) {
          console.log(`Found drug with REMS endpoint: ${brandName} -> ${remsEndpoint}`);
        } else {
          console.log(`Found drug without REMS endpoint: ${brandName}`);
        }
      }
    }

    console.log(`Extracted ${drugs.length} drugs from XML`);
    return drugs;
  } catch (error) {
    console.error('Error extracting drugs from XML:', error);
    return [];
  }
}

async function processAllSplFiles(): Promise<{ drugs: any[], stats: { splEndpoint: number, splApiEndpoint: number} }> {
  const baseFilePath = join(process.cwd(), 'rems-spl-files');
  const extractPath = join(baseFilePath, 'extracted');
  const innerExtractPath = join(baseFilePath, 'inner_extracted');

  try {
    console.log('Processing all SPL files...');

    const spl_files_dir = join(extractPath, 'rems_document_spl_files');
    const allZipPaths = getAllSplZipPaths(spl_files_dir);

    const allValidDrugs: any[] = [];
    let splEndpointCount = 0;
    let splApiEndpointCount = 0;

    for (const zipPath of allZipPaths) {
      console.log(`\n--- Processing SPL file: ${path.basename(zipPath)} ---`);
      
      const specificInnerExtractPath = extractInnerZip(zipPath, innerExtractPath);
      if (!specificInnerExtractPath) continue;

      const xmlPath = findXmlFile(specificInnerExtractPath);
      if (!xmlPath) continue;

      const xmlData = await parseXmlContent(xmlPath);
      if (!xmlData) continue;

      const drugs = extractAllDrugsFromXml(xmlData);

      for (const drug of drugs) {
        let validDrug: any = null;

        if (drug.remsEndpoint) {
          console.log(`SPL drug with endpoint: ${drug.brandName}`);
          validDrug = createDrugEntry(drug, drug.remsEndpoint);
          if (validDrug) {
            splEndpointCount++;
          }
        } else {
          console.log(`Trying API lookup for SPL drug: ${drug.brandName}`);
          
          const apiResult = await tryApiLookupForDrug(drug);
          
          if (apiResult) {
            console.log(`Found API endpoint for SPL drug: ${drug.brandName}`);
            validDrug = createDrugEntry(drug, apiResult.rems_endpoint, apiResult.product_ndc);
            if (validDrug) {
              splApiEndpointCount++;
            } 
          } else {
            // console.log(`No API endpoint found for SPL drug: ${drug.brandName}`);
          }
        }

        if (validDrug) {
          allValidDrugs.push(validDrug);
        }
      }
    }

    console.log(`\nTotal valid drugs found in SPL files: ${allValidDrugs.length}`);
    return {
      drugs: allValidDrugs,
      stats: {
        splEndpoint: splEndpointCount,
        splApiEndpoint: splApiEndpointCount,
      }
    };
  } catch (error) {
    console.error('Error processing SPL files:', error);
    return {
      drugs: [],
      stats: {
        splEndpoint: 0,
        splApiEndpoint: 0,
      }
    };
  }
}
async function tryApiLookupForDrug(drug: DrugInfo): Promise<MedicationApiResponse | null> {
  const searchStrategies = [
    { key: 'product_ndc', value: drug.productNdc },
    { key: 'brand_name', value: drug.brandName },
    { key: 'generic_name', value: drug.genericName }
  ];

  for (const strategy of searchStrategies) {
    if (!strategy.value) continue;
    
    try {
      const result = await getRemsFromDirectoryApi(strategy.value, strategy.key);
      if (result) {
        return result;
      }
    } catch (error: any) {
      if (error.response?.status !== 404) {
        console.error(`API lookup failed for ${strategy.key}=${strategy.value}:`, error.message);
      }
    }
  }

  return null;
}

function createDrugEntry(drug: DrugInfo, remsEndpoint: string, apiNdc?: string): any | null {
  let code: string;
  let system: string;
  
  if (drug.productNdc) {
    code = drug.productNdc;
    system = 'http://hl7.org/fhir/sid/ndc';
    console.log(`Using SPL NDC code: ${code} for drug: ${drug.brandName}`);
  } else if (apiNdc) {
    code = apiNdc;
    system = 'http://hl7.org/fhir/sid/ndc';
    console.log(`Using API NDC code: ${code} for drug: ${drug.brandName}`);
  } else {
    const rxNormMatch = findRxNormCodeFromPhonebook(drug.brandName, drug.genericName);
    if (rxNormMatch) {
      code = rxNormMatch.code;
      system = rxNormMatch.system;
      console.log(`Using RxNorm code from phonebook: ${code} for drug: ${drug.brandName}`);
    } else {
      console.log(`No valid code found for drug: ${drug.brandName}, skipping registration`);
      return null;
    }
  }

  return {
    code: code,
    system: system,
    brand_name: drug.brandName,
    generic_name: drug.genericName,
    to: remsEndpoint + 'cds-services/rems-',
    toEtasu: remsEndpoint + '4_0_0/GuidanceResponse/$rems-etasu',
    from: [EHRWhitelist.any]
  };
}

async function processPhonebookEntries(splDrugs: any[]): Promise<{ drugs: any[], stats: { phonebookApi: number, phonebookDefault: number } }> {
  console.log('\n--- Processing phonebook entries ---');
  const validPhonebookDrugs: any[] = [];
  let phonebookApiCount = 0;
  let phonebookDefaultCount = 0;

  const splDrugNames = new Set<string>();
  splDrugs.forEach(drug => {
    if (drug.brand_name && typeof drug.brand_name === 'string') {
      splDrugNames.add(drug.brand_name.toLowerCase());
    }
    if (drug.generic_name && typeof drug.generic_name === 'string') {
      splDrugNames.add(drug.generic_name.toLowerCase());
    }
  });

  for (const entry of phonebook) {
    try {
      console.log(`Processing phonebook entry: ${entry.brand_name} (${entry.code})`);
      
      const brandInSpl = splDrugNames.has(entry.brand_name.toLowerCase());
      const genericInSpl = splDrugNames.has(entry.generic_name.toLowerCase());
      
      if (brandInSpl || genericInSpl) {
        console.log(`Skipping phonebook entry for ${entry.brand_name} - already found in SPL`);
        continue;
      }
      
      const apiResult = await getRemsFromDirectoryApi(entry.code);
      
      let entryToSave = { ...entry } as any;
      
      if (apiResult) {
        entryToSave.to = apiResult.rems_endpoint + 'cds-services/rems-';
        entryToSave.toEtasu = apiResult.rems_endpoint + '4_0_0/GuidanceResponse/$rems-etasu';
        
        console.log(`Found API endpoint for phonebook drug: ${entry.brand_name}`);
        phonebookApiCount++;
      } else {
        // Use environment defaults only for phonebook entries
        entryToSave.to = REMSAdminWhitelist.standardRemsAdmin;
        entryToSave.toEtasu = REMSAdminWhitelist.standardRemsAdminEtasu;
        console.log(`Using default endpoints for phonebook drug: ${entry.brand_name}`);
        phonebookDefaultCount++;
      }
      
      validPhonebookDrugs.push(entryToSave);
    } catch (error) {
      console.error(`Error processing phonebook entry ${entry.code}:`, error);
    }
  }

  console.log(`Total valid phonebook drugs: ${validPhonebookDrugs.length}`);
  return {
    drugs: validPhonebookDrugs,
    stats: {
      phonebookApi: phonebookApiCount,
      phonebookDefault: phonebookDefaultCount
    }
  };
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

export async function getRemsFromDirectoryApi(searchValue: string, searchKey: string = 'product_ndc'): Promise<MedicationApiResponse | null> {
  try {
    if (!searchValue) {
      return null;
    }

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
  } catch (error: any) {
    if (error.response?.status === 404) {
      console.log(`${searchKey} ${searchValue} not found in API`);
    } else {
      console.error('Error fetching from directory API:', error.message);
    }
    return null;
  }
}

export async function loadPhonebook() {
  const model = Connection;

  try {
    console.log('\n========================================');
    console.log('Starting drug registration process...');
    console.log('========================================');

    // Step 1: Download and prepare SPL files
    console.log('\nStep 1: Downloading SPL files...');
    await downloadSplZip();

    // Step 2: Process all SPL files
    console.log('\nStep 2: Processing all SPL files...');
    const splResult = await processAllSplFiles();

    // Step 3: Process phonebook entries
    console.log('\nStep 3: Processing phonebook entries...');
    const phonebookResult = await processPhonebookEntries(splResult.drugs);

    // Step 4: Save all valid drugs to database
    console.log('\nStep 4: Saving drugs to database...');
    const allValidDrugs = [...splResult.drugs, ...phonebookResult.drugs];
    
    for (const drug of allValidDrugs) {
      await saveOrUpdateEntry(drug, model);
    }

    console.log('\n========================================');
    console.log(`Drug registration completed successfully!`);
    console.log(`Total drugs registered: ${allValidDrugs.length}`);
    console.log('');
    console.log('Registration breakdown:');
    console.log(`  SPL drugs with endpoints in files: ${splResult.stats.splEndpoint}`);
    console.log(`  SPL drugs found via API fallback: ${splResult.stats.splApiEndpoint}`);
    console.log(`  Phonebook drugs found via API: ${phonebookResult.stats.phonebookApi}`);
    console.log(`  Phonebook drugs using defaults: ${phonebookResult.stats.phonebookDefault}`);
    console.log('========================================');

  } catch (error) {
    console.error('Error in loadPhonebook:', error);
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