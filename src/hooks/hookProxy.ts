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
  ndcCode?: string;
  remsEndpoint?: string;
  source: 'spl' | 'api' | 'phonebook';
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
    to: REMSAdminWhitelist.standardRemsAdmin,
    toEtasu: REMSAdminWhitelist.standardRemsAdminEtasu,
    from: [EHRWhitelist.any]
  },
  {
    code: '63459-502-30', // TIRF
    system: 'http://hl7.org/fhir/sid/ndc',
    brand_name: "Fentanyl Citrate",
    generic_name: "FENTANYL CITRATE",
    to: REMSAdminWhitelist.standardRemsAdmin,
    toEtasu: REMSAdminWhitelist.standardRemsAdminEtasu,
    from: [EHRWhitelist.any]
  },
  {
    code: '65597-402-20', // Turalio
    system: 'http://hl7.org/fhir/sid/ndc',
    brand_name: "Turalio",
    generic_name: "PEXIDARTINIB HYDROCHLORIDE",
    to: REMSAdminWhitelist.standardRemsAdmin,
    toEtasu: REMSAdminWhitelist.standardRemsAdminEtasu,
    from: [EHRWhitelist.any]
  },
  {
    code: '58604-214', // Addyi
    system: 'http://hl7.org/fhir/sid/ndc',
    brand_name: "ADDYI",
    generic_name: "FLIBANSERINE",
    to: REMSAdminWhitelist.standardRemsAdmin,
    toEtasu: REMSAdminWhitelist.standardRemsAdminEtasu,
    from: [EHRWhitelist.any]
  }
];

// Helper functions
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
             (comp.section[0].code[0].$ && comp.section[0].code[0].$.code === '48780-1');
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

function extractNdcCode(subject: any): string | null {
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
                    // This might not be NDC, but could be used as identifier
                    // You might need to adjust this based on actual SPL structure
                    return extension;
                }
            }
        }
    }
    
    return null;
}

function extractAllDrugsFromXml(xmlObj: any): DrugInfo[] {
    const drugs: DrugInfo[] = [];
    
    try {
        if (!validateXmlStructure(xmlObj)) {
            return drugs;
        }

        const components = xmlObj.document.component[0].structuredBody[0].component;
        const productSection = findProductSection(components);

        if (!productSection || !productSection.section || !productSection.section[0].subject) {
            console.error('No product data elements section found in XML');
            return drugs;
        }

        const subjects = productSection.section[0].subject;

        for (const subject of subjects) {
            if (subject.manufacturedProduct &&
                subject.manufacturedProduct[0] &&
                subject.manufacturedProduct[0].manufacturedProduct) {

                const product = subject.manufacturedProduct[0].manufacturedProduct[0];
                const drugNames = getDrugNames(product);
                
                if (!drugNames) continue;

                const { brandName, genericName } = drugNames;
                let remsEndpoint: string | null = null;
                let ndcCode: string | null = null;

                // Extract REMS endpoint if available
                if (subject.manufacturedProduct[0].subjectOf) {
                    remsEndpoint = extractRemsEndpoint(subject.manufacturedProduct[0].subjectOf);
                    ndcCode = extractNdcCode(subject);
                }

                drugs.push({
                    brandName,
                    genericName,
                    ndcCode: ndcCode || undefined,
                    remsEndpoint: remsEndpoint || undefined,
                    source: 'spl'
                });
            }
        }
        
        console.log(`Extracted ${drugs.length} drugs from SPL`);
        return drugs;
    } catch (error) {
        console.error('Error extracting drugs from XML:', error);
        return drugs;
    }
}

async function getAllDrugsFromSplZip(): Promise<DrugInfo[]> {
    const baseFilePath = join(process.cwd(), 'rems-spl-files');
    const extractPath = join(baseFilePath, 'extracted');
    const innerExtractPath = join(baseFilePath, 'inner_extracted');

    try {
        console.log('Processing all SPL files for drug extraction...');
        
        const spl_files_dir = join(extractPath, 'rems_document_spl_files');
        
        if (!fs.existsSync(spl_files_dir)) {
            console.error(`SPL files directory ${spl_files_dir} does not exist`);
            return [];
        }

        const files = fs.readdirSync(spl_files_dir);
        const allDrugs: DrugInfo[] = [];
        
        for (const file of files) {
            if (!file.endsWith('.zip')) continue;
            
            console.log(`Processing SPL file: ${file}`);
            
            const zipPath = join(spl_files_dir, file);
            const specificInnerExtractPath = extractInnerZip(zipPath, innerExtractPath);
            
            if (!specificInnerExtractPath) continue;
            
            const xmlPath = findXmlFile(specificInnerExtractPath);
            if (!xmlPath) continue;
            
            const xmlData = await parseXmlContent(xmlPath);
            if (!xmlData) continue;
            
            const drugs = extractAllDrugsFromXml(xmlData);
            allDrugs.push(...drugs);
        }
        
        console.log(`Total drugs extracted from all SPL files: ${allDrugs.length}`);
        return allDrugs;
    } catch (error) {
        console.error('Error processing SPL files:', error);
        return [];
    }
}

async function lookupDrugInApi(drugInfo: DrugInfo): Promise<DrugInfo | null> {
    try {
        const searchAttempts = [];
        
        if (drugInfo.ndcCode) {
            searchAttempts.push({ key: 'product_ndc', value: drugInfo.ndcCode });
        }
        
        searchAttempts.push(
            { key: 'generic_name', value: drugInfo.genericName },
            { key: 'brand_name', value: drugInfo.brandName }
        );

        for (const attempt of searchAttempts) {
            const apiResult = await getRemsFromDirectoryApi(attempt.value, attempt.key);
            
            if (apiResult && apiResult.rems_endpoint) {
                console.log(`Found API result for ${drugInfo.brandName} using ${attempt.key}=${attempt.value}`);
                return {
                    ...drugInfo,
                    remsEndpoint: apiResult.rems_endpoint,
                    source: 'api'
                };
            }
        }
        
        return null;
    } catch (error) {
        console.error(`Error looking up ${drugInfo.brandName} in API:`, error);
        return null;
    }
}

export async function getRemsFromDirectoryApi(searchValue: string, searchKey: string = 'product_ndc'): Promise<MedicationApiResponse | null> {
    try {
        if (!searchValue) {
            return null;
        }

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

async function downloadSplZip(): Promise<boolean> {
    const baseFilePath = join(process.cwd(), 'rems-spl-files');
    const extractPath = join(baseFilePath, 'extracted');
    const innerExtractPath = join(baseFilePath, 'inner_extracted');
    const mainZipPath = join(baseFilePath, REMSAdminWhitelist.zipFileName);

    createDirectories([baseFilePath, extractPath, innerExtractPath]);

    try {
        const splZipUrl = `${REMSAdminWhitelist.discoveryUrlBase}${REMSAdminWhitelist.discoverySplZipEndpoint}`;
        const downloadSuccess = await fetchAndSaveZip(splZipUrl, mainZipPath);
        if (!downloadSuccess) return false;

        cleanDirectories([extractPath, innerExtractPath]);

        const extractSuccess = extractZip(mainZipPath, extractPath);
        if (!extractSuccess) return false;

        return true;
    } catch (error) {
        console.error('Error downloading SPL zip files:', error);
        return false;
    }
}

function createDatabaseEntry(drugInfo: DrugInfo, code: string, system: string): any {
    const endpoints = drugInfo.remsEndpoint ? {
        to: drugInfo.remsEndpoint + 'cds-services/rems-',
        toEtasu: drugInfo.remsEndpoint + '4_0_0/GuidanceResponse/$rems-etasu'
    } : {
        to: REMSAdminWhitelist.standardRemsAdmin,
        toEtasu: REMSAdminWhitelist.standardRemsAdminEtasu
    };

    return {
        code,
        system,
        brand_name: drugInfo.brandName,
        generic_name: drugInfo.genericName,
        ...endpoints,
        from: [EHRWhitelist.any]
    };
}

export async function loadPhonebook() {
    const model = Connection;
    console.log('Starting  REMS endpoint discovery...');

    try {
        // Download and extract SPL files
        console.log('Downloading SPL files...');
        const downloadSuccess = await downloadSplZip();
        if (!downloadSuccess) {
            console.error('Failed to download SPL files, using existing data only');
        }

        // Extract all drugs from SPL files
        console.log('Extracting drugs from SPL files...');
        const splDrugs = await getAllDrugsFromSplZip();
        
        // For drugs without REMS endpoints, try API lookup
        console.log('Looking up missing endpoints via API...');
        const foundDrugs: DrugInfo[] = [];
        
        for (const drug of splDrugs) {
            if (drug.remsEndpoint) {
                foundDrugs.push(drug);
            } else {
                console.log(`No SPL endpoint for ${drug.brandName}, trying API...`);
                const apiResult = await lookupDrugInApi(drug);
                foundDrugs.push(apiResult || drug);
            }
        }

        // Process phonebook entries (guaranteed fallback with hardcoded endpoints)
        console.log('Processing phonebook entries as fallback...');
        
        for (const entry of phonebook) {
            try {
                // Always process phonebook entries to ensure fallback coverage
                const existingEntry = await model.findOne({ code: entry.code, system: entry.system });
                
                // Check if we already have this drug with a discovered endpoint
                const hasDiscoveredEndpoint = foundDrugs.some(d => 
                    (d.genericName.toLowerCase() === entry.generic_name.toLowerCase() ||
                     d.brandName.toLowerCase() === entry.brand_name.toLowerCase()) &&
                    d.remsEndpoint
                );

                let entryToSave;
                
                if (hasDiscoveredEndpoint) {
                    const discoveredDrug = foundDrugs.find(d => 
                        d.genericName.toLowerCase() === entry.generic_name.toLowerCase() ||
                        d.brandName.toLowerCase() === entry.brand_name.toLowerCase()
                    );
                    
                    entryToSave = {
                        code: entry.code,
                        system: entry.system,
                        brand_name: entry.brand_name,
                        generic_name: entry.generic_name,
                        to: discoveredDrug?.remsEndpoint ? discoveredDrug.remsEndpoint + 'cds-services/rems-' : entry.to,
                        toEtasu: discoveredDrug?.remsEndpoint ? discoveredDrug.remsEndpoint + '4_0_0/GuidanceResponse/$rems-etasu' : entry.toEtasu,
                        from: entry.from
                    };
                    
                    console.log(`Using discovered endpoint for phonebook entry: ${entry.brand_name}`);
                } else {
                    entryToSave = { ...entry };
                    console.log(`Using phonebook fallback endpoints for: ${entry.brand_name}`);
                }

                if (existingEntry) {
                    const hasChanges = existingEntry.to !== entryToSave.to || 
                                       existingEntry.toEtasu !== entryToSave.toEtasu;
                    
                    if (hasChanges) {
                        await model.updateOne(
                            { code: entry.code, system: entry.system },
                            { 
                                $set: { 
                                    to: entryToSave.to, 
                                    toEtasu: entryToSave.toEtasu
                                }
                            }
                        );
                        console.log(`Updated phonebook entry ${entry.brand_name} with new endpoints`);
                    } else {
                        console.log(`No changes for phonebook entry ${entry.brand_name}`);
                    }
                } else {
                    const resource = new model(entryToSave);
                    await resource.save();
                    console.log(`Added phonebook entry ${entry.brand_name} to database`);
                }
            } catch (error) {
                console.error(`Error processing phonebook entry ${entry.brand_name}:`, error);
            }
        }

        // Save remaining SPL-discovered drugs that aren't in phonebook
        console.log('Saving additional SPL-discovered drugs...');
        
        for (const drugInfo of foundDrugs) {
            try {
                const inPhonebook = phonebook.some(p => 
                    p.generic_name.toLowerCase() === drugInfo.genericName.toLowerCase() ||
                    p.brand_name.toLowerCase() === drugInfo.brandName.toLowerCase()
                );
                
                if (inPhonebook) {
                    continue; 
                }
                
                let code: string;
                let system: string;
                
                if (drugInfo.ndcCode) {
                    code = drugInfo.ndcCode;
                    system = 'http://hl7.org/fhir/sid/ndc';
                } else {
                    code = drugInfo.genericName;
                    system = 'http://www.nlm.nih.gov/research/umls/rxnorm';
                }

                const existingEntry = await model.findOne({ code, system });
                const entryToSave = createDatabaseEntry(drugInfo, code, system);

                if (existingEntry) {
                    const hasChanges = existingEntry.to !== entryToSave.to || 
                                       existingEntry.toEtasu !== entryToSave.toEtasu;
                    
                    if (hasChanges) {
                        await model.updateOne(
                            { code, system },
                            { 
                                $set: { 
                                    to: entryToSave.to, 
                                    toEtasu: entryToSave.toEtasu
                                }
                            }
                        );
                        console.log(`Updated SPL drug ${drugInfo.brandName} (${drugInfo.source}) with new endpoints`);
                    } else {
                        console.log(`No changes for SPL drug ${drugInfo.brandName} (${drugInfo.source})`);
                    }
                } else {
                    const resource = new model(entryToSave);
                    await resource.save();
                    console.log(`Added SPL drug ${drugInfo.brandName} (${drugInfo.source}) to database`);
                }
            } catch (error) {
                console.error(`Error processing SPL drug ${drugInfo.brandName}:`, error);
            }
        }

        console.log(`\nPhonebook loading complete!`);
        console.log(`- SPL drugs processed: ${splDrugs.length}`);
        console.log(`- Drugs with SPL endpoints: ${splDrugs.filter(d => d.remsEndpoint).length}`);
        console.log(`- Drugs with API endpoints: ${foundDrugs.filter(d => d.source === 'api').length}`);
        console.log(`- Phonebook entries processed: ${phonebook.length}`);
        console.log(`- Additional SPL drugs saved: ${foundDrugs.filter(d => !phonebook.some(p => 
            p.generic_name.toLowerCase() === d.genericName.toLowerCase() ||
            p.brand_name.toLowerCase() === d.brandName.toLowerCase()
        )).length}`);
        
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