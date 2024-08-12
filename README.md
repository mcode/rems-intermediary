# Description 
The [REMS](https://www.fda.gov/drugs/drug-safety-and-availability/risk-evaluation-and-mitigation-strategies-rems) Intermediary application is an app that acts as an intermediary between the provider client systems and the REMS Administrator for [CDS Hooks](https://cds-hooks.org/) calls of the type order-sign, order-select, patient-view and encounter-start. This allows for the clients to register the intermediary and send all requests to it instead of registering individual REMS Administrators. The REMS Intermediary application also acts as an intermediary between the provider and pharmacy applications for querying the ETASU status using the FHIR Operation $rems-etasu on the GuidanceResponse resource.

# Getting Started with REMS Intermediary

To get started, first clone the repository using a method that is most convenient for you.  If using git, run the following command:

`git clone https://github.com/mcode/rems-intermediary.git`

The following technologies must be installed on your computer to continue:
* [NPM](https://www.npmjs.com/)
* [Node](https://nodejs.org/en)

## Initialization

After cloning the repository, the submodules must be initialized. Run the following command:

### `git submodule update --init`

Next, install the required dependencies by running the following:

### `npm install`

## Running the Mongo DB instance

The REMS Intermediary relies on MongoDB for it's backing database.
Follow the mongodb setup instructions in the [REMS End to End Setup Guide](https://github.com/mcode/rems-setup/blob/main/EndToEndSetupGuide.md#mongodb).

If you would rather run with docker, follow the setup found in the [REMS Simple Setup Guide](https://github.com/mcode/rems-setup/blob/main/SimpleSetupGuide.md) (this will also setup the other REMS applications in docker as well).

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:8090/cds-services](http://localhost:8090/cds-services) to view the CDS Services discovery information in the browser.

You will also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://create-react-app.dev/docs/running-tests/) for more information.

## Usage

zzzz
The REMS Intermediary interacts with the [Request Generator](https://github.com/mcode/request-generator), [REMS SMART on FHIR app](https://github.com/mcode/rems-smart-on-fhir), and an [EHR](https://github.com/mcode/test-ehr). These apps are provided as part of the REMS ecosystem, but any individual part may be swapped out for something custom. The REMS Admin responds to CDS Hooks requests as well as the FHIR operation for the REMS ETASU check ($rems-etasu).

Typically, a CDS Hook will be sent from the EHR to the REMS Admin, which will respond with cards that contain information about next steps. These cards may contain a link to a SMART app. Clicking on these links in the Request Generator or REMS SMART on FHIR App acting as the EHR will launch a SMART app automatically. These links will contain information on the requirements that must be met for the REMS program. This includes forms for registration and acknowledgement of the risks involved. The REMS Intermediary stands in between the REMS Admin and CDS Hooks client. It receives the hooks call from the EHR (client), performs the prefetch on the data if necessary, and forwards the request to the appropriate REMS Administrator with the FHIR Authorization information stripped out. The return from these calls are forwarded back to the original client. This allows the client to only know about the intermediary for the REMS interactions, simplifying registration. The SMART on FHIR apps from each REMS Administration will however still need to be registered with each EHR.

The FHIR Server built into the REMS Intermediary contains a REMS ETASU check at the GuidanceResponse/$rems-etasu endpoint. This request will be forward to the appropriate REMS Administrator, and the return will be forwarded back to the client. The return includes a FHIR Parameter containing a GuidanceResponse with the status of the ETATSU and nested GuidanceResponse for each requirement.

## Routes

* `/cds-services` - The base CDS Hooks Discovery endpoint that serves a list of supported hooks/services in JSON.
* `/cds-services/rems-order-sign` - The CDS Hooks endpoint for order-sign
* `/cds-services/rems-order-select` - The CDS Hooks endpoint for order-select
* `/cds-services/rems-patient-view` - The CDS Hooks endpoint for patient-view
* `/cds-services/rems-encounter-start` - The CDS Hooks endpoint for encounter-start
* `/4_0_0 - The base of the FHIR Server
* `/4_0_0/GuidanceResponse/$rems-etasu` - The endpoint for FHIR Operation used for checking the ETASU status
  * Input requires a parameter containing the following:
    * `patient` - Patient FHIR Resource, must include `medication` with `patient`
    * `medication` - Medication or MedicationRequest FHIR Resource, must include `patient` with `medication`
    * `authNumber` - String containing the REMS Authorization Number, may be sent without `patient` or `medication`
  * Returns a GuidanceResponse within a Parameter with the status
    * Contains Nested GuidanceResponse resources for each ETASU requirement with their status

## Environment Variables

### How To Override Defaults

The .env file contains the default URI paths, which can be overwritten from the start command as follows:
a) `REACT_APP_LAUNCH_URL=http://example.com PORT=6000 npm start` or b) by specifying the environment variables and desired values in a `.env.local`.

> **Bug**: Do note that the `SMART_ENDPOINT` environment variable cannot be overwritten in a `.env.local`, it must be done in the `.env`.

Following are a list of modifiable paths:

| URI Name        | Default                                            | Description                                                                                           |
| --------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------|
| AUTH_SERVER_URI | `http://localhost:8090`                            | The base url of the auth server, currently set to the base url of this app.                           |
| HTTPS_CERT_PATH | `server.cert`                                      | Path to a certificate for encryption, allowing HTTPS. Unnecessary if using HTTP.                      |
| HTTPS_KEY_PATH  | `server.key`                                       | Path to a key for encryption, allowing HTTPS. Unnecessary if using HTTP.                              |
| LOGGING_LEVEL   | `debug`                                            | Amount to output in the log, can be changed to verbose, info, warn, or error.                         |
| MONGO_DB_NAME   | `remsintermediary`                                 | Name of the database table being used. Should be changed if not using the Mongo instructions above.   |                 
| MONGO_URL       | `mongodb://intermediary-user:pass@127.0.0.1:27017` | URL for the connection to the database, should be changed if not using the Mongo instructions above.  |
| PORT            | `8090`                                             | Port that this server should run on, change if there are conflicts with port usage.                   |
| USE_HTTPS       | `false`                                            | Change to true to enable HTTPS. Ensure that HTTPS_CERT_PATH and HTTPS_KEY_PATH are valid.             |
| WHITELIST       | `http://localhost, http://localhost:3005`          | List of valid URLs for CORS. Should include any URLs the server accesses for resources.               |
| VITE_REALM      | `ClientFhirServer`                                 | Realm used for authentication with keycloak server.                                                   |
| VITE_AUTH       | `http://localhost:8180`                            | Keycloak server for user authentication.                                                              |
| VITE_USER       | `alice`                                            | User for connecting to Keycloak authentication server.                                                |
| VITE_PASSWORD   | `alice`                                            | Password for connecting to Keycloak authentication server.                                            |
| VITE_CLIENT     | `app-login`                                        | Client used for connecting to keycloak authentication server.                                         |
| REMS_ADMIN_HOOK_PATH | `http://localhost:8090/cds-services/rems-`    | REMS Administrator default base path for CDS Hooks.   |
| REMS_ADMIN_FHIR_PATH   |  `http://localhost:8090/4_0_0/`   | REMS Administrator default base path for the FHIR Server   |
