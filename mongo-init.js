// Create Databases
const dbRemsIntermediary = db.getSiblingDB('remsintermediary');
dbRemsIntermediary.createUser({ user: 'intermediary-user',
  pwd: 'pass',
  roles: [
    { role: 'readWrite', db: 'remsintermediary' } 
  ]
});
// Create Collections
dbRemsIntermediary.createCollection('remsintermediary-tmp');

// add the administrator user
const dbAdmin = db.getSiblingDB('admin');
dbAdmin.createUser({ user: 'intermediary-admin-pims-root',
    pwd: 'intermediary-admin-pims-password',
    roles: [
        { role: 'userAdminAnyDatabase', db: 'admin' }
    ]
});
