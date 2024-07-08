import { resolveSchema } from '@projecttacoma/node-fhir-server-core';
import * as moment from 'moment';
import 'moment-timezone';
import * as fs from 'fs';
import crypto from 'crypto';
import { FhirResource } from 'fhir/r4';
import LibraryModel from '../lib/schemas/resources/Library';
import PatientModel from '../lib/schemas/resources/Patient';
import QuestionnaireModel from '../lib/schemas/resources/Questionnaire';
import QuestionnaireResponseModel from '../lib/schemas/resources/QuestionnaireResponse';
import ValueSetModel from '../lib/schemas/resources/ValueSet';
import { Model } from 'mongoose';
import { glob } from 'glob';

class ResourceExistsException extends Error {}

export class FhirUtilities {
  static getLibrary(baseVersion: string) {
    return resolveSchema(baseVersion, 'Library');
  }

  static getPatient(baseVersion: string) {
    return resolveSchema(baseVersion, 'Patient');
  }

  static getQuestionnaire(baseVersion: string) {
    return resolveSchema(baseVersion, 'Questionnaire');
  }

  static getQuestionnaireResponse(baseVersion: string) {
    return resolveSchema(baseVersion, 'QuestionnaireResponse');
  }

  static getValueSet(baseVersion: string) {
    return resolveSchema(baseVersion, 'ValueSet');
  }

  static getMeta = (baseVersion: string) => {
    return resolveSchema(baseVersion, 'Meta');
  };

  static async store(resource: FhirResource, model: Model<any>, baseVersion = '4_0_0') {
    // If no resource ID was provided, generate one.
    let id = '';
    if (!resource.id) {
      // If no resource ID was provided, generate one.
      id = crypto.randomUUID();
    } else {
      id = resource.id;
    }
    console.log('    FhirUtilities::store: ' + resource.resourceType + ' -- ' + id);
    const fhirResource = new model(resource);
    // Create the resource's metadata
    const Meta = FhirUtilities.getMeta(baseVersion);
    fhirResource.meta = new Meta({
      versionId: '1',
      lastUpdated: moment.utc().format('YYYY-MM-DDTHH:mm:ssZ')
    });

    const doesExist = await model.exists({ id: fhirResource.id });
    if (!doesExist) {
      return await fhirResource.save();
    } else {
      throw new ResourceExistsException(
        `Resource ${fhirResource.resourceType} with id ${fhirResource.id} already exists`
      );
    }
  }

  static async loadResources(resourcePath: string) {
    console.log('Loading FHIR Resources from: ' + resourcePath);
    // this assumes the cds-library directory structure of
    // libraries ->  <lib name> -> R4 -> resources -> * json resources
    const files = glob.sync(`${resourcePath}/*/R4/resources/*.json`);
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const jsonString = fs.readFileSync(file, 'utf8');
      try {
        const resource = JSON.parse(jsonString);
        // Build the strings to connect to the collections
        let model;
        switch (resource.resourceType) {
          case 'Library':
            model = LibraryModel;
            break;
          case 'Patient':
            model = PatientModel;
            break;
          case 'Questionnaire':
            model = QuestionnaireModel;
            break;
          case 'QuestionnaireResponse':
            model = QuestionnaireResponseModel;
            break;
          case 'ValueSet':
            model = ValueSetModel;
            break;
        }
        if (model) {
          try {
            await FhirUtilities.store(resource, model);
          } catch (e: any) {
            //catch the resource exist exception and keep going.
            // there are better ways to deal with this but involves
            // a larger rework effort which can happen later
            if (!(e instanceof ResourceExistsException)) {
              throw e;
            }
          }
        } else {
          console.log('    Unsupported FHIR Resource Type');
        }
      } catch (parseError: any) {
        console.warn('Failed to parse json file: ' + file);
        console.warn(parseError);
      }
    }
  }

}
