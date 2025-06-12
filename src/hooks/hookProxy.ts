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
  rems_cds_endpoint: string;
  rems_fhir_base_url: string;
  rems_approval_date: string;
  rems_modification_date: string;
}

interface DrugInfo {
  brandName: string;
  genericName: string;
  remsCdsEndpoint?: string;
  remsFhirBaseUrl?: string;
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
    code: '65597-407-20', // Turalio
    system: 'http://hl7.org/fhir/sid/ndc',
    brand_name: "Turalio",
    generic_name: "PEXIDARTINIB HYDROCHLORIDE",
    from: [EHRWhitelist.any]
  },
  {
    code: '58604-214-30', // Addyi
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

function extractRemsEndpoints(subjectOf: any[]): { cdsEndpoint: string | null, fhirBaseUrl: string | null } {
  let cdsEndpoint: string | null = null;
  let fhirBaseUrl: string | null = null;

  for (const item of subjectOf) {
    if (item.document && 
        item.document[0] && 
        item.document[0].title && 
        item.document[0].title[0] && 
        item.document[0].text && 
        item.document[0].text[0] && 
        item.document[0].text[0].reference) {
      
      const title = item.document[0].title[0];
      const referenceValue = item.document[0].text[0].reference[0];
      let remsUrl;
      
      if (typeof referenceValue === 'string') {
        remsUrl = referenceValue;
      } else if (referenceValue.$ && referenceValue.$.value) {
        remsUrl = referenceValue.$.value;
      }
      
      if (remsUrl) {
        // Check for CDS hooks discovery endpoint
        if (title.includes('CDS Hooks Discovery') || title.includes('CDS Services')) {
          if (remsUrl.includes(':rems_cds_discovery:')) {
            cdsEndpoint = remsUrl.split(':rems_cds_discovery:')[1];
          } else if (remsUrl.includes(':rems_discovery:')) {
            cdsEndpoint = remsUrl.split(':rems_discovery:')[1];
          } else {
            cdsEndpoint = remsUrl;
          }
        }
        
        // Check for FHIR base URL
        if (title.includes('FHIR Base URL') || title.includes('FHIR Server')) {
          if (remsUrl.includes(':rems_fhir_base:')) {
            fhirBaseUrl = remsUrl.split(':rems_fhir_base:')[1];
          } else {
            fhirBaseUrl = remsUrl;
          }
        }
      }
    }
  }
  
  return { cdsEndpoint, fhirBaseUrl };
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
  const zipFiles = files.filter((file: string) => file.endsWith('.zip'));
  console.log(`Found ${zipFiles.length} zip files in ${spl_files_dir}`);
  
  return zipFiles.map((file: string) => join(spl_files_dir, file));
}

function extractInnerZip(zipPath: string, innerExtractPath: string): string | null {
  try {
    const targetZipFile = path.basename(zipPath);
    const targetDirName = targetZipFile.replace('.zip', '');
    const specificInnerExtractPath = join(innerExtractPath, targetDirName);
    
    const targetZip = new AdmZip(zipPath);
    targetZip.extractAllTo(innerExtractPath, true);
    
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
    console.log('Downloading latest SPL zip...');
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    fs.writeFileSync(savePath, response.data);
    return true;
  } catch (error) {
    console.error('Error downloading SPL zip:', error);
    return false;
  }
}

function extractZip(zipPath: string, extractPath: string): boolean {
  try {
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(extractPath, true);
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

async function saveOrUpdateEntry(entryToSave: any, model: any): Promise<{ action: 'created' | 'updated' | 'skipped' }> {
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
      return { action: 'updated' };
    } else {
      return { action: 'skipped' };
    }
  } else {
    const resource = new model(entryToSave);
    await resource.save();
    return { action: 'created' };
  }
}

function extractAllDrugsFromXml(xmlObj: any): DrugInfo[] {
  try {
    if (!validateXmlStructure(xmlObj)) {
      return [];
    }

    const components = xmlObj.document.component[0].structuredBody[0].component;
    const productSection = findProductSection(components);

    if (!productSection || !productSection.section || !productSection.section[0].subject) {
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

        let remsCdsEndpoint: string | undefined;
        let remsFhirBaseUrl: string | undefined;

        if (subject.manufacturedProduct[0].subjectOf) {
          const endpoints = extractRemsEndpoints(subject.manufacturedProduct[0].subjectOf);
          remsCdsEndpoint = endpoints.cdsEndpoint || undefined;
          remsFhirBaseUrl = endpoints.fhirBaseUrl || undefined;
        }

        const drugInfo: DrugInfo = {
          brandName,
          genericName,
          remsCdsEndpoint,
          remsFhirBaseUrl,
          productNdc: productNdc || undefined
        };

        drugs.push(drugInfo);
      }
    }

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
    console.log('Processing SPL files...');

    const spl_files_dir = join(extractPath, 'rems_document_spl_files');
    const allZipPaths = getAllSplZipPaths(spl_files_dir);
    console.log(`Found ${allZipPaths.length} SPL zip files to process`);

    const allValidDrugs: any[] = [];
    let splEndpointCount = 0;
    let splApiEndpointCount = 0;

    for (const zipPath of allZipPaths) {
      console.log(`Processing: ${path.basename(zipPath)}`);
      
      const specificInnerExtractPath = extractInnerZip(zipPath, innerExtractPath);
      if (!specificInnerExtractPath) continue;

      const xmlPath = findXmlFile(specificInnerExtractPath);
      if (!xmlPath) continue;

      const xmlData = await parseXmlContent(xmlPath);
      if (!xmlData) continue;

      const drugs = extractAllDrugsFromXml(xmlData);
      console.log(`  Extracted ${drugs.length} drugs from XML`);

      for (const drug of drugs) {
        let validDrug: any = null;

        if (drug.remsCdsEndpoint && drug.remsFhirBaseUrl) {
          console.log(`  🎯 SPL REMS FOUND: ${drug.brandName}`);
          console.log(`     CDS: ${drug.remsCdsEndpoint}`);
          console.log(`     FHIR: ${drug.remsFhirBaseUrl}`);
          validDrug = createDrugEntry(drug);
          if (validDrug) {
            splEndpointCount++;
          }
        } else {
          const apiResult = await tryApiLookupForDrug(drug);
          
          if (apiResult) {
            console.log(`  🎯 API REMS FOUND: ${drug.brandName}`);
            console.log(`     CDS: ${apiResult.rems_cds_endpoint}`);
            console.log(`     FHIR: ${apiResult.rems_fhir_base_url}`);
            validDrug = createDrugEntry(drug, apiResult.rems_cds_endpoint, apiResult.rems_fhir_base_url, apiResult.product_ndc);
            if (validDrug) {
              splApiEndpointCount++;
            }
          }
        }

        if (validDrug) {
          allValidDrugs.push(validDrug);
        }
      }
    }

    console.log(`Found ${allValidDrugs.length} valid drugs in SPL files`);
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
      if (result && result.rems_cds_endpoint && result.rems_fhir_base_url) {
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

function createDrugEntry(drug: DrugInfo, cdsEndpoint?: string, fhirBaseUrl?: string, apiNdc?: string): any | null {
  let code: string;
  let system: string;
  
  if (drug.productNdc) {
    code = drug.productNdc;
    system = 'http://hl7.org/fhir/sid/ndc';
  } else if (apiNdc) {
    code = apiNdc;
    system = 'http://hl7.org/fhir/sid/ndc';
  } else {
    const rxNormMatch = findRxNormCodeFromPhonebook(drug.brandName, drug.genericName);
    if (rxNormMatch) {
      code = rxNormMatch.code;
      system = rxNormMatch.system;
    } else {
      return null;
    }
  }

  const finalCdsEndpoint = cdsEndpoint || drug.remsCdsEndpoint;
  const finalFhirBaseUrl = fhirBaseUrl || drug.remsFhirBaseUrl;

  if (!finalCdsEndpoint || !finalFhirBaseUrl) {
    return null;
  }

  const cdsUrl = finalCdsEndpoint.endsWith('/') 
    ? finalCdsEndpoint + 'cds-services/rems-'
    : finalCdsEndpoint + '/cds-services/rems-';
    
  const etasuUrl = finalFhirBaseUrl.endsWith('/') 
    ? finalFhirBaseUrl + '4_0_0/GuidanceResponse/$rems-etasu'
    : finalFhirBaseUrl + '/4_0_0/GuidanceResponse/$rems-etasu';

  return {
    code: code,
    system: system,
    brand_name: drug.brandName,
    generic_name: drug.genericName,
    to: cdsUrl,
    toEtasu: etasuUrl,
    from: [EHRWhitelist.any]
  };
}

async function processPhonebookEntries(splDrugs: any[]): Promise<{ drugs: any[], stats: { phonebookApi: number, phonebookDefault: number } }> {
  console.log('Processing phonebook entries...');
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
      const brandInSpl = splDrugNames.has(entry.brand_name.toLowerCase());
      const genericInSpl = splDrugNames.has(entry.generic_name.toLowerCase());
      
      if (brandInSpl || genericInSpl) {
        continue; // Skip if already found in SPL
      }
      
      const apiResult = await getRemsFromDirectoryApi(entry.code);
      
      let entryToSave = { ...entry } as any;
      
      if (apiResult && apiResult.rems_cds_endpoint && apiResult.rems_fhir_base_url) {
        console.log(`🎯 PHONEBOOK API REMS FOUND: ${entry.brand_name} (${entry.code})`);
        console.log(`   CDS: ${apiResult.rems_cds_endpoint}`);
        console.log(`   FHIR: ${apiResult.rems_fhir_base_url}`);
        
        entryToSave.to = apiResult.rems_cds_endpoint.endsWith('/') 
          ? apiResult.rems_cds_endpoint + 'cds-services/rems-'
          : apiResult.rems_cds_endpoint + '/cds-services/rems-';
        
        entryToSave.toEtasu = apiResult.rems_fhir_base_url.endsWith('/') 
          ? apiResult.rems_fhir_base_url + '4_0_0/GuidanceResponse/$rems-etasu'
          : apiResult.rems_fhir_base_url + '/4_0_0/GuidanceResponse/$rems-etasu';
        
        phonebookApiCount++;
      } else {
        entryToSave.to = REMSAdminWhitelist.standardRemsAdmin;
        entryToSave.toEtasu = REMSAdminWhitelist.standardRemsAdminEtasu;
        phonebookDefaultCount++;
      }
      
      validPhonebookDrugs.push(entryToSave);
    } catch (error) {
      console.error(`Error processing phonebook entry ${entry.code}:`, error);
    }
  }

  console.log(`Processed ${validPhonebookDrugs.length} phonebook entries (${phonebookApiCount} via API, ${phonebookDefaultCount} using defaults)`);
  return {
    drugs: validPhonebookDrugs,
    stats: {
      phonebookApi: phonebookApiCount,
      phonebookDefault: phonebookDefaultCount
    }
  };
}

async function downloadSplZip(): Promise<any> {
  const baseFilePath = join(process.cwd(), 'rems-spl-files');
  const extractPath = join(baseFilePath, 'extracted');
  const innerExtractPath = join(baseFilePath, 'inner_extracted');
  const mainZipPath = join(baseFilePath, REMSAdminWhitelist.zipFileName);

  createDirectories([baseFilePath, extractPath, innerExtractPath]);

  try {
    const splZipUrl = `${REMSAdminWhitelist.discoveryUrlBase}${REMSAdminWhitelist.discoverySplZipEndpoint}`;
    const downloadSuccess = await fetchAndSaveZip(splZipUrl, mainZipPath);
    if (!downloadSuccess) return null;

    cleanDirectories([extractPath, innerExtractPath]);

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

    const apiUrl = `${REMSAdminWhitelist.discoveryUrlBase}${REMSAdminWhitelist.discoveryApiEndpoint}?search=${searchKey}="${searchValue}"`;

    const response = await axios.get(apiUrl);

    if (response.status === 200 && response.data.results && response.data.results.length > 0) {
      const medication: MedicationApiResponse = response.data.results[0];
      
      if (!medication.rems_cds_endpoint || !medication.rems_fhir_base_url) {
        return null;
      }
      
      return medication;
    } else {
      return null;
    }
  } catch (error: any) {
    if (error.response?.status !== 404) {
      console.error(`API error for ${searchValue}:`, error.message);
    }
    return null;
  }
}

export async function loadPhonebook() {
  const model = Connection;

  try {
    console.log('Starting drug registration process...');

    // Step 1: Download and prepare SPL files
    await downloadSplZip();

    // Step 2: Process all SPL files
    const splResult = await processAllSplFiles();

    // Step 3: Process phonebook entries
    const phonebookResult = await processPhonebookEntries(splResult.drugs);

    // Step 4: Save all valid drugs to database
    console.log('Saving to database...');
    const allValidDrugs = [...splResult.drugs, ...phonebookResult.drugs];
    
    let savedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    for (const drug of allValidDrugs) {
      const result = await saveOrUpdateEntry(drug, model);
      if (result.action === 'created') savedCount++;
      else if (result.action === 'updated') updatedCount++;
      else skippedCount++;
    }

    console.log('\n🎯 REMS ENDPOINT SUMMARY:');
    console.log(`SPL Endpoints Found: ${splResult.stats.splEndpoint}`);
    console.log(`API Endpoints Found: ${splResult.stats.splApiEndpoint + phonebookResult.stats.phonebookApi}`);
    console.log(`Default Endpoints Used: ${phonebookResult.stats.phonebookDefault}`);
    console.log(`\nDatabase: ${savedCount} saved | ${updatedCount} updated | ${skippedCount} skipped`);

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
      return connection;
    }
  }
}