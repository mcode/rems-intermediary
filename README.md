### rems-intermediary
Mock intermediary system to model stakeholder in workflow demo. See [rems-setup guide](https://github.com/mcode/rems-setup) for more information on the project. 

This is a [Next.js](https://nextjs.org/) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Getting Started

First, run the development server:

```bash
npm start
```

Open [http://localhost:3003](http://localhost:3003) with your browser to see the result.


## Setting Up the Database

- Setup and Run MongoDB

  - Download the latest version for your OS from [www.mongodb.com/try/download/community](https://www.mongodb.com/try/download/community)

    ```bash
    # Extract the downloaded package
    tar -xvf <package.tgz> # Mac & Linux
    unzip <package.zip # Windows

    # Navigate into directory
    cd <package>

    # Create folder for database
    mkdir db

    # Run mongo
    ./bin/mongod --dbpath db --port 19000
    ```
- Setup Mongo Shell `mongosh` to initialize the database

  - Download latest version for your OS from [www.mongodb.com/try/download/shell](https://www.mongodb.com/try/download/shell)

    ```bash
    # Extract the package
    tar -xvf <package.tgz> # Mac & Linux
    unzip <package.zip # Windows

    # Navigate into directory
    cd <package>

    # Initialize the database
    # NOTE: Database must already be running
    ./bin/mongosh mongodb://localhost:19000 ./mongo-init.js
    ```